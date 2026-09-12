import { openReadOnlySource } from "./sourceDb";
import { DESTINATION_DB_PATH } from "./config";
import { computeContactMetrics, ContactMetrics } from "./metrics";
import { DECLINE_THRESHOLD, SCORE_WEIGHTS } from "./analyzeConfig";
import {
  ContactRecord,
  buildContactIndex,
  copyAddressBookDatabases,
  findAddressBookDatabases,
  readContactsFromDb,
  resolveContactName,
} from "./contactsDb";

/**
 * Turns an average reply latency into a 0-1 responsiveness score: `null`
 * (no observed reply ever happened) scores 0; otherwise faster replies
 * (smaller `avgReplyLatencyHours`) score closer to 1.
 */
export function computeResponsivenessScore(avgReplyLatencyHours: number | null): number {
  if (avgReplyLatencyHours === null) {
    return 0;
  }
  return 1 / (1 + avgReplyLatencyHours);
}

/**
 * Combines decline, balance, and responsiveness into a single weighted
 * priority score using SCORE_WEIGHTS. Higher means more worth reaching out to.
 */
export function computePriorityScore(metrics: ContactMetrics): number {
  return (
    SCORE_WEIGHTS.decline * metrics.declineRatio +
    SCORE_WEIGHTS.balance * metrics.balanceRatio +
    SCORE_WEIGHTS.responsiveness * computeResponsivenessScore(metrics.avgReplyLatencyHours)
  );
}

/**
 * Filters `allMetrics` down to contacts whose decline meets DECLINE_THRESHOLD,
 * attaches each one's priorityScore, and sorts the result descending by that
 * score (highest priority first).
 */
export function getRecommendations(
  allMetrics: ContactMetrics[]
): (ContactMetrics & { priorityScore: number })[] {
  return allMetrics
    .filter((metrics) => metrics.declineRatio >= DECLINE_THRESHOLD)
    .map((metrics) => ({ ...metrics, priorityScore: computePriorityScore(metrics) }))
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Locates every Contacts database on this machine, copies each one locally,
 * reads its contacts, and builds a combined lookup from phone/email to
 * display name. Returns `null` (rather than throwing) if no databases are
 * found, the combined index ends up empty, or anything along the way fails
 * — callers should fall back to printing raw identifiers in that case.
 */
export function resolveContactIndexSafely(): Map<string, string> | null {
  try {
    const dbPaths = findAddressBookDatabases();
    if (dbPaths.length === 0) {
      return null;
    }

    const copyPaths = copyAddressBookDatabases(dbPaths);
    const allRecords: ContactRecord[] = [];
    for (const copyPath of copyPaths) {
      allRecords.push(...readContactsFromDb(copyPath));
    }

    const index = buildContactIndex(allRecords);
    return index.size > 0 ? index : null;
  } catch (err) {
    console.warn(
      "Warning: could not resolve contact names from Contacts:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export function printReport(
  recommendations: (ContactMetrics & { priorityScore: number })[],
  contactIndex: Map<string, string> | null
): void {
  console.log("Outreach recommendations:");

  if (recommendations.length === 0) {
    console.log(
      `  No one currently meets the decline threshold (${formatPercent(
        DECLINE_THRESHOLD
      )} or more drop-off). Nobody stands out as drifting right now.`
    );
    return;
  }

  recommendations.forEach((contact, index) => {
    const chatName = contact.displayName?.trim() ? contact.displayName : null;
    const resolvedName = chatName || !contactIndex ? null : resolveContactName(contactIndex, contact.identifier);
    const name = chatName ?? (resolvedName ? `${resolvedName} (${contact.identifier})` : contact.identifier);
    const rank = index + 1;

    console.log(`  ${rank}. ${name}`);
    console.log(`     Decline: ${formatPercent(contact.declineRatio)} fewer messages than usual`);
    console.log(`     Messages: ${contact.baselineCount} baseline -> ${contact.recentCount} recent`);
    console.log(`     Balance: ${formatPercent(contact.balanceRatio)}`);
    console.log(
      `     Avg reply time: ${
        contact.avgReplyLatencyHours === null
          ? "no clear reply pattern"
          : `${contact.avgReplyLatencyHours.toFixed(1)} hours`
      }`
    );
  });
}

function main(): void {
  try {
    const source = openReadOnlySource(DESTINATION_DB_PATH);
    const allMetrics = computeContactMetrics(source, new Date());
    const recommendations = getRecommendations(allMetrics);
    const contactIndex = resolveContactIndexSafely();
    printReport(recommendations, contactIndex);
  } catch (err) {
    console.error("Analyze failed:", err instanceof Error ? err.message : err);
    console.error(
      "Note: `npm run analyze` reads data/imessages_export.db, which is only " +
        "created by `npm run export`. Run that first if this file doesn't exist yet."
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
