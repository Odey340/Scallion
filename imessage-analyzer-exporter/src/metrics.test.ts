import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, afterEach } from "vitest";
import { openReadOnlySource } from "./sourceDb";
import { MessageRow } from "./destinationDb";
import {
  computeContactMetrics,
  computeDeclineRatio,
  computeBalanceRatio,
  computeAvgReplyLatencyHours,
} from "./metrics";
import {
  RECENT_WINDOW_DAYS,
  BASELINE_WINDOW_DAYS,
  MIN_BASELINE_MESSAGES,
} from "./analyzeConfig";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imessage-export-metrics-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeMessage(overrides: Partial<MessageRow>): MessageRow {
  return {
    id: 0,
    chat_id: 1,
    handle_id: 100,
    is_from_me: 0,
    text: "hi",
    sent_at: new Date().toISOString(),
    service: "iMessage",
    ...overrides,
  };
}

describe("computeDeclineRatio", () => {
  it("is close to the expected value when baseline frequency is clearly higher than recent", () => {
    // Baseline: 60 messages over BASELINE_WINDOW_DAYS -> 1/day.
    // Recent: 3 messages over RECENT_WINDOW_DAYS -> 0.1/day (using default 30 days).
    const baselineFrequencyPerDay = 60 / BASELINE_WINDOW_DAYS;
    const recentFrequencyPerDay = 3 / RECENT_WINDOW_DAYS;

    const expected = 1 - recentFrequencyPerDay / baselineFrequencyPerDay;
    const declineRatio = computeDeclineRatio(baselineFrequencyPerDay, recentFrequencyPerDay);

    expect(declineRatio).toBeCloseTo(expected, 5);
    expect(declineRatio).toBeGreaterThan(0.8);
  });

  it("returns 0 (or near 0) when baseline and recent frequency are equal", () => {
    const baselineFrequencyPerDay = 30 / BASELINE_WINDOW_DAYS;
    const recentFrequencyPerDay = 15 / RECENT_WINDOW_DAYS;

    const declineRatio = computeDeclineRatio(baselineFrequencyPerDay, recentFrequencyPerDay);

    expect(declineRatio).toBeCloseTo(0, 5);
  });

  it("clamps to 0 when recent frequency is higher than baseline (an increase)", () => {
    const declineRatio = computeDeclineRatio(1, 2);
    expect(declineRatio).toBe(0);
  });

  it("returns 0 when baseline frequency is 0, guarding against division by zero", () => {
    const declineRatio = computeDeclineRatio(0, 5);
    expect(declineRatio).toBe(0);
  });
});

describe("computeBalanceRatio", () => {
  it("returns 1 for a perfectly balanced conversation", () => {
    const messages: MessageRow[] = [
      makeMessage({ id: 1, is_from_me: 1 }),
      makeMessage({ id: 2, is_from_me: 0 }),
      makeMessage({ id: 3, is_from_me: 1 }),
      makeMessage({ id: 4, is_from_me: 0 }),
    ];

    expect(computeBalanceRatio(messages)).toBe(1);
  });

  it("returns 0 for a completely one-sided conversation", () => {
    const messages: MessageRow[] = [
      makeMessage({ id: 1, is_from_me: 1 }),
      makeMessage({ id: 2, is_from_me: 1 }),
      makeMessage({ id: 3, is_from_me: 1 }),
    ];

    expect(computeBalanceRatio(messages)).toBe(0);
  });

  it("returns 0 for an empty message list", () => {
    expect(computeBalanceRatio([])).toBe(0);
  });
});

describe("computeAvgReplyLatencyHours", () => {
  it("averages the gaps between alternating messages within the reply window", () => {
    const base = new Date("2024-01-01T00:00:00.000Z").getTime();
    const hour = 60 * 60 * 1000;

    // them -> me: 2h gap (a reply). me -> them: 4h gap (a reply). them -> them: no switch.
    const messages: MessageRow[] = [
      makeMessage({ id: 1, is_from_me: 0, sent_at: new Date(base).toISOString() }),
      makeMessage({ id: 2, is_from_me: 1, sent_at: new Date(base + 2 * hour).toISOString() }),
      makeMessage({ id: 3, is_from_me: 1, sent_at: new Date(base + 3 * hour).toISOString() }),
      makeMessage({ id: 4, is_from_me: 0, sent_at: new Date(base + 7 * hour).toISOString() }),
    ];

    // Reply gaps: 2h (msg1->msg2), 4h (msg3->msg4). Average = 3h.
    expect(computeAvgReplyLatencyHours(messages)).toBeCloseTo(3, 5);
  });

  it("excludes switches whose gap exceeds REPLY_WINDOW_HOURS", () => {
    const base = new Date("2024-01-01T00:00:00.000Z").getTime();
    const hour = 60 * 60 * 1000;

    const messages: MessageRow[] = [
      makeMessage({ id: 1, is_from_me: 0, sent_at: new Date(base).toISOString() }),
      // 100 hours later, well beyond REPLY_WINDOW_HOURS (48) — not a counted reply.
      makeMessage({ id: 2, is_from_me: 1, sent_at: new Date(base + 100 * hour).toISOString() }),
    ];

    expect(computeAvgReplyLatencyHours(messages)).toBeNull();
  });

  it("returns null when no message ever alternates sender", () => {
    const messages: MessageRow[] = [
      makeMessage({ id: 1, is_from_me: 0 }),
      makeMessage({ id: 2, is_from_me: 0 }),
      makeMessage({ id: 3, is_from_me: 0 }),
    ];

    expect(computeAvgReplyLatencyHours(messages)).toBeNull();
  });
});

describe("computeContactMetrics", () => {
  function buildFixtureDestinationDb(dir: string, now: Date) {
    const dbPath = path.join(dir, "fixture-export.db");
    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE chats (
        id INTEGER PRIMARY KEY,
        guid TEXT,
        display_name TEXT,
        is_group INTEGER
      );

      CREATE TABLE handles (
        id INTEGER PRIMARY KEY,
        identifier TEXT
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        chat_id INTEGER,
        handle_id INTEGER,
        is_from_me INTEGER,
        text TEXT,
        sent_at TEXT,
        service TEXT
      );
    `);

    const dayMs = 24 * 60 * 60 * 1000;
    const recentStart = new Date(now.getTime() - RECENT_WINDOW_DAYS * dayMs);
    const baselineStart = new Date(now.getTime() - (RECENT_WINDOW_DAYS + BASELINE_WINDOW_DAYS) * dayMs);

    // Chat 1: a 1:1 chat with plenty of baseline messages (well over MIN_BASELINE_MESSAGES).
    db.prepare(`INSERT INTO chats (id, guid, display_name, is_group) VALUES (?, ?, ?, ?)`).run(
      1,
      "chat-guid-1",
      "Alice",
      0
    );
    db.prepare(`INSERT INTO handles (id, identifier) VALUES (?, ?)`).run(100, "+15551110000");

    let messageId = 1;
    const insertMessage = db.prepare(
      `INSERT INTO messages (id, chat_id, handle_id, is_from_me, text, sent_at, service) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const plentyfulBaselineCount = MIN_BASELINE_MESSAGES + 5;
    for (let i = 0; i < plentyfulBaselineCount; i++) {
      const sentAt = new Date(baselineStart.getTime() + (i + 1) * dayMs);
      insertMessage.run(messageId++, 1, 100, i % 2, "hi", sentAt.toISOString(), "iMessage");
    }

    // Chat 2: a 1:1 chat with too few baseline messages — should be excluded entirely.
    db.prepare(`INSERT INTO chats (id, guid, display_name, is_group) VALUES (?, ?, ?, ?)`).run(
      2,
      "chat-guid-2",
      "Bob",
      0
    );
    db.prepare(`INSERT INTO handles (id, identifier) VALUES (?, ?)`).run(101, "bob@example.com");

    const tooFewBaselineCount = MIN_BASELINE_MESSAGES - 1;
    for (let i = 0; i < tooFewBaselineCount; i++) {
      const sentAt = new Date(baselineStart.getTime() + (i + 1) * dayMs);
      insertMessage.run(messageId++, 2, 101, 0, "hi", sentAt.toISOString(), "iMessage");
    }

    // Chat 3: a group chat with plenty of messages in both windows — should never appear.
    db.prepare(`INSERT INTO chats (id, guid, display_name, is_group) VALUES (?, ?, ?, ?)`).run(
      3,
      "chat-guid-3",
      "Group Chat",
      1
    );
    for (let i = 0; i < plentyfulBaselineCount; i++) {
      const sentAt = new Date(baselineStart.getTime() + (i + 1) * dayMs);
      insertMessage.run(messageId++, 3, 100, 0, "hi", sentAt.toISOString(), "iMessage");
    }

    db.close();
    return dbPath;
  }

  it("excludes a chat with fewer than MIN_BASELINE_MESSAGES baseline messages, and never includes group chats", () => {
    const dir = makeTempDir();
    const now = new Date("2024-06-01T00:00:00.000Z");
    const dbPath = buildFixtureDestinationDb(dir, now);
    const source = openReadOnlySource(dbPath);

    const results = computeContactMetrics(source, now);

    expect(results.map((r) => r.chatId)).toEqual([1]);
    expect(results.some((r) => r.chatId === 2)).toBe(false);
    expect(results.some((r) => r.chatId === 3)).toBe(false);
  });
});
