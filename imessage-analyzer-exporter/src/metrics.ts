import { ReadOnlySource } from "./sourceDb";
import { ChatRow, HandleRow, MessageRow } from "./destinationDb";
import {
  RECENT_WINDOW_DAYS,
  BASELINE_WINDOW_DAYS,
  MIN_BASELINE_MESSAGES,
  REPLY_WINDOW_HOURS,
} from "./analyzeConfig";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface ContactMetrics {
  chatId: number;
  identifier: string;
  displayName: string | null;
  baselineCount: number;
  recentCount: number;
  baselineFrequencyPerDay: number;
  recentFrequencyPerDay: number;
  declineRatio: number;
  balanceRatio: number;
  avgReplyLatencyHours: number | null;
}

/** Clamps `value` into the inclusive range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Fraction of messages in `baseline` (relative to `recent`) that dropped off.
 * 0 means no decline (or an increase); 1 means messaging has effectively
 * stopped. Guarded against a zero baseline frequency.
 */
export function computeDeclineRatio(baselineFrequencyPerDay: number, recentFrequencyPerDay: number): number {
  if (baselineFrequencyPerDay === 0) {
    return 0;
  }
  return clamp(1 - recentFrequencyPerDay / baselineFrequencyPerDay, 0, 1);
}

/**
 * How evenly a conversation's baseline-period messages are split between the
 * two participants: min(fromMe, fromThem) / max(fromMe, fromThem). 1 is
 * perfectly balanced, 0 is entirely one-sided (or there are no messages from
 * one side).
 */
export function computeBalanceRatio(messages: MessageRow[]): number {
  let fromMeCount = 0;
  let fromThemCount = 0;

  for (const message of messages) {
    if (message.is_from_me === 1) {
      fromMeCount++;
    } else {
      fromThemCount++;
    }
  }

  if (fromMeCount === 0 || fromThemCount === 0) {
    return 0;
  }

  return Math.min(fromMeCount, fromThemCount) / Math.max(fromMeCount, fromThemCount);
}

/**
 * Average turnaround time, in hours, between consecutive messages that
 * switch sender (a reply), counting only switches within REPLY_WINDOW_HOURS
 * of each other. Returns null if no such reply ever occurred. `messages`
 * need not be pre-sorted; this sorts a copy by `sent_at`.
 */
export function computeAvgReplyLatencyHours(messages: MessageRow[]): number | null {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );

  const replyGapsHours: number[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];

    if (previous.is_from_me === current.is_from_me) {
      continue;
    }

    const gapHours =
      (new Date(current.sent_at).getTime() - new Date(previous.sent_at).getTime()) / MS_PER_HOUR;

    if (gapHours <= REPLY_WINDOW_HOURS) {
      replyGapsHours.push(gapHours);
    }
  }

  if (replyGapsHours.length === 0) {
    return null;
  }

  const total = replyGapsHours.reduce((sum, gap) => sum + gap, 0);
  return total / replyGapsHours.length;
}

/**
 * Reads every non-group chat's messages, splits them into a recent window
 * and the baseline window immediately preceding it, and computes decline,
 * balance, and reply-latency metrics for each contact with enough baseline
 * history to be meaningful. Pure data computation: no console output, no
 * scoring, no filtering by DECLINE_THRESHOLD (that's the next stage).
 */
export function computeContactMetrics(db: ReadOnlySource, now: Date): ContactMetrics[] {
  const recentStart = new Date(now.getTime() - RECENT_WINDOW_DAYS * MS_PER_DAY);
  const baselineStart = new Date(
    now.getTime() - (RECENT_WINDOW_DAYS + BASELINE_WINDOW_DAYS) * MS_PER_DAY
  );

  const chats = db.query<ChatRow>(`SELECT id, guid, display_name, is_group FROM chats WHERE is_group = 0`);

  const results: ContactMetrics[] = [];

  for (const chat of chats) {
    const messages = db.query<MessageRow>(
      `SELECT id, chat_id, handle_id, is_from_me, text, sent_at, service
       FROM messages
       WHERE chat_id = ? AND sent_at >= ? AND sent_at < ?`,
      [chat.id, baselineStart.toISOString(), now.toISOString()]
    );

    const baselineMessages = messages.filter(
      (m) => m.sent_at >= baselineStart.toISOString() && m.sent_at < recentStart.toISOString()
    );
    const recentMessages = messages.filter(
      (m) => m.sent_at >= recentStart.toISOString() && m.sent_at < now.toISOString()
    );

    const baselineCount = baselineMessages.length;
    if (baselineCount < MIN_BASELINE_MESSAGES) {
      continue;
    }
    const recentCount = recentMessages.length;

    const baselineFrequencyPerDay = BASELINE_WINDOW_DAYS > 0 ? baselineCount / BASELINE_WINDOW_DAYS : 0;
    const recentFrequencyPerDay = RECENT_WINDOW_DAYS > 0 ? recentCount / RECENT_WINDOW_DAYS : 0;

    const otherHandle = db.query<HandleRow>(
      `SELECT handles.id AS id, handles.identifier AS identifier
       FROM messages
       JOIN handles ON handles.id = messages.handle_id
       WHERE messages.chat_id = ? AND messages.handle_id IS NOT NULL
       LIMIT 1`,
      [chat.id]
    )[0];

    results.push({
      chatId: chat.id,
      identifier: otherHandle?.identifier ?? "",
      displayName: chat.display_name,
      baselineCount,
      recentCount,
      baselineFrequencyPerDay,
      recentFrequencyPerDay,
      declineRatio: computeDeclineRatio(baselineFrequencyPerDay, recentFrequencyPerDay),
      balanceRatio: computeBalanceRatio(baselineMessages),
      avgReplyLatencyHours: computeAvgReplyLatencyHours(baselineMessages),
    });
  }

  return results;
}
