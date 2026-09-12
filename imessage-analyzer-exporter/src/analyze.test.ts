import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeResponsivenessScore,
  computePriorityScore,
  getRecommendations,
  printReport,
  resolveContactIndexSafely,
} from "./analyze";
import { ContactMetrics } from "./metrics";
import { DECLINE_THRESHOLD } from "./analyzeConfig";
import * as contactsDb from "./contactsDb";

function makeMetrics(overrides: Partial<ContactMetrics>): ContactMetrics {
  return {
    chatId: 1,
    identifier: "+15551110000",
    displayName: null,
    baselineCount: 20,
    recentCount: 2,
    baselineFrequencyPerDay: 1,
    recentFrequencyPerDay: 0.1,
    declineRatio: 0.9,
    balanceRatio: 0.5,
    avgReplyLatencyHours: 2,
    ...overrides,
  };
}

describe("computeResponsivenessScore", () => {
  it("returns 0 for null input", () => {
    expect(computeResponsivenessScore(null)).toBe(0);
  });

  it("scores a smaller but positive number for a larger latency than for a smaller one", () => {
    const fast = computeResponsivenessScore(1);
    const slow = computeResponsivenessScore(24);

    expect(fast).toBeGreaterThan(0);
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(fast);
  });
});

describe("computePriorityScore", () => {
  it("orders contacts as the weights imply given fixed inputs", () => {
    // Higher decline, higher balance, faster replies -> strictly higher score.
    const strongCandidate = makeMetrics({
      declineRatio: 0.9,
      balanceRatio: 0.8,
      avgReplyLatencyHours: 1,
    });
    const weakCandidate = makeMetrics({
      declineRatio: 0.5,
      balanceRatio: 0.2,
      avgReplyLatencyHours: 40,
    });

    expect(computePriorityScore(strongCandidate)).toBeGreaterThan(computePriorityScore(weakCandidate));
  });

  it("matches the weighted formula for a hand computed fixture", () => {
    const metrics = makeMetrics({
      declineRatio: 0.6,
      balanceRatio: 0.4,
      avgReplyLatencyHours: 3,
    });

    // 0.5*0.6 + 0.3*0.4 + 0.2*(1/(1+3)) = 0.3 + 0.12 + 0.05 = 0.47
    expect(computePriorityScore(metrics)).toBeCloseTo(0.47, 5);
  });
});

describe("getRecommendations", () => {
  it("excludes contacts below DECLINE_THRESHOLD and sorts the rest by priorityScore descending", () => {
    const belowThreshold = makeMetrics({
      chatId: 1,
      declineRatio: DECLINE_THRESHOLD - 0.1,
      balanceRatio: 1,
      avgReplyLatencyHours: 0,
    });
    const lowPriority = makeMetrics({
      chatId: 2,
      declineRatio: DECLINE_THRESHOLD,
      balanceRatio: 0.1,
      avgReplyLatencyHours: 40,
    });
    const highPriority = makeMetrics({
      chatId: 3,
      declineRatio: 1,
      balanceRatio: 1,
      avgReplyLatencyHours: 0,
    });

    const results = getRecommendations([belowThreshold, lowPriority, highPriority]);

    expect(results.map((r) => r.chatId)).toEqual([3, 2]);
    expect(results[0].priorityScore).toBeGreaterThanOrEqual(results[1].priorityScore);
  });

  it("returns an empty array for all-empty input without throwing", () => {
    expect(() => getRecommendations([])).not.toThrow();
    expect(getRecommendations([])).toEqual([]);
  });
});

function makeRecommendation(overrides: Partial<ContactMetrics> = {}) {
  return { ...makeMetrics(overrides), priorityScore: 1 };
}

describe("printReport", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("prints the resolved name alongside the identifier when resolveContactName finds a match", () => {
    vi.spyOn(contactsDb, "resolveContactName").mockReturnValue("Jane Smith");

    const contact = makeRecommendation({ identifier: "+15551234567", displayName: null });
    printReport([contact], new Map());

    const nameLine = logSpy.mock.calls.map((call) => call.join(" ")).find((line) => line.includes("1."));
    expect(nameLine).toContain("Jane Smith (+15551234567)");
  });

  it("prints only the identifier when resolveContactName returns null", () => {
    vi.spyOn(contactsDb, "resolveContactName").mockReturnValue(null);

    const contact = makeRecommendation({ identifier: "+15559876543", displayName: null });
    printReport([contact], new Map());

    const nameLine = logSpy.mock.calls.map((call) => call.join(" ")).find((line) => line.includes("1."));
    expect(nameLine).toContain("+15559876543");
    expect(nameLine).not.toContain("(");
  });

  it("prints identifiers only, without throwing, when there is no contact index", () => {
    const contact = makeRecommendation({ identifier: "+15550001111", displayName: null });

    expect(() => printReport([contact], null)).not.toThrow();

    const nameLine = logSpy.mock.calls.map((call) => call.join(" ")).find((line) => line.includes("1."));
    expect(nameLine).toContain("+15550001111");
  });
});

describe("resolveContactIndexSafely", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null and warns instead of throwing when the Contacts lookup step fails", () => {
    vi.spyOn(contactsDb, "findAddressBookDatabases").mockImplementation(() => {
      throw new Error("boom");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveContactIndexSafely();

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("lets the rest of the report print using identifiers only when the lookup throws", () => {
    vi.spyOn(contactsDb, "findAddressBookDatabases").mockImplementation(() => {
      throw new Error("boom");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const contactIndex = resolveContactIndexSafely();
    const contact = makeRecommendation({ identifier: "+15552223333", displayName: null });

    expect(() => printReport([contact], contactIndex)).not.toThrow();

    const nameLine = logSpy.mock.calls.map((call) => call.join(" ")).find((line) => line.includes("1."));
    expect(nameLine).toContain("+15552223333");

    logSpy.mockRestore();
  });
});
