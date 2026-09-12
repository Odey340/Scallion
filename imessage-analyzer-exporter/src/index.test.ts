import { describe, it, expect, vi } from "vitest";
import { runExport } from "./index";
import { ChatRow, HandleRow, MessageRow } from "./destinationDb";

const FAKE_SOURCE = { query: vi.fn() } as never;
const FAKE_DESTINATION = { fake: "destination-db" } as never;

function buildDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const chats: ChatRow[] = [
    { id: 1, guid: "chat-guid-1", display_name: "Alice", is_group: 0 },
    { id: 2, guid: "chat-guid-2", display_name: "Group", is_group: 1 },
  ];
  const handles: HandleRow[] = [
    { id: 100, identifier: "+15551110000" },
  ];
  const messages: MessageRow[] = [
    {
      id: 1,
      chat_id: 1,
      handle_id: 100,
      is_from_me: 0,
      text: "hey",
      sent_at: "2024-01-01T00:00:00.000Z",
      service: "iMessage",
    },
    {
      id: 2,
      chat_id: 1,
      handle_id: null,
      is_from_me: 1,
      text: "hi back",
      sent_at: "2024-02-01T00:00:00.000Z",
      service: "iMessage",
    },
  ];

  return {
    copySourceDatabase: vi.fn(),
    openReadOnlySource: vi.fn(() => FAKE_SOURCE),
    extractRecentMessages: vi.fn(() => ({ chats, handles, messages })),
    createDestinationDb: vi.fn(() => FAKE_DESTINATION),
    insertChat: vi.fn(),
    insertHandle: vi.fn(),
    insertMessage: vi.fn(),
    ...overrides,
  };
}

describe("runExport", () => {
  it("calls the copy, extract, and write steps in the correct order", () => {
    const deps = buildDeps();
    const calls: string[] = [];
    deps.copySourceDatabase.mockImplementation(() => calls.push("copy"));
    deps.extractRecentMessages.mockImplementation(() => {
      calls.push("extract");
      return {
        chats: [{ id: 1, guid: "g", display_name: null, is_group: 0 }],
        handles: [{ id: 100, identifier: "x" }],
        messages: [
          {
            id: 1,
            chat_id: 1,
            handle_id: 100,
            is_from_me: 0,
            text: "t",
            sent_at: "2024-01-01T00:00:00.000Z",
            service: "iMessage",
          },
        ],
      };
    });
    deps.createDestinationDb.mockImplementation(() => {
      calls.push("createDestination");
      return FAKE_DESTINATION;
    });
    deps.insertChat.mockImplementation(() => calls.push("insertChat"));
    deps.insertHandle.mockImplementation(() => calls.push("insertHandle"));
    deps.insertMessage.mockImplementation(() => calls.push("insertMessage"));

    runExport(deps as never);

    expect(calls).toEqual([
      "copy",
      "extract",
      "createDestination",
      "insertChat",
      "insertHandle",
      "insertMessage",
    ]);
  });

  it("calls extractRecentMessages after opening the source that copySourceDatabase produced", () => {
    const deps = buildDeps();

    runExport(deps as never);

    const copyOrder = deps.copySourceDatabase.mock.invocationCallOrder[0];
    const openOrder = deps.openReadOnlySource.mock.invocationCallOrder[0];
    const extractOrder = deps.extractRecentMessages.mock.invocationCallOrder[0];
    expect(copyOrder).toBeLessThan(openOrder);
    expect(openOrder).toBeLessThan(extractOrder);
    expect(deps.extractRecentMessages).toHaveBeenCalledWith(FAKE_SOURCE, expect.any(Date));
  });

  it("does not call any destination writer functions if extractRecentMessages throws", () => {
    const deps = buildDeps();
    deps.extractRecentMessages.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => runExport(deps as never)).toThrow("boom");

    expect(deps.createDestinationDb).not.toHaveBeenCalled();
    expect(deps.insertChat).not.toHaveBeenCalled();
    expect(deps.insertHandle).not.toHaveBeenCalled();
    expect(deps.insertMessage).not.toHaveBeenCalled();
  });

  it("logs summary counts matching the length of the arrays extractRecentMessages returned", () => {
    const deps = buildDeps();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    runExport(deps as never);

    const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("Chats:    2");
    expect(logged).toContain("Handles:  1");
    expect(logged).toContain("Messages: 2");
    expect(deps.insertChat).toHaveBeenCalledTimes(2);
    expect(deps.insertHandle).toHaveBeenCalledTimes(1);
    expect(deps.insertMessage).toHaveBeenCalledTimes(2);

    logSpy.mockRestore();
  });
});
