import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, afterEach } from "vitest";
import { openReadOnlySource, dateToAppleTimestamp } from "./sourceDb";
import { extractRecentMessages } from "./extract";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imessage-export-extract-test-"));
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

/**
 * Builds a minimal fixture chat.db-shaped SQLite file with just the columns
 * extract.ts reads, seeded with messages spanning inside and outside a
 * 3 month window.
 */
function buildFixtureDb(dir: string, since: Date) {
  const fixturePath = path.join(dir, "fixture-chat.db");
  const db = new Database(fixturePath);

  db.exec(`
    CREATE TABLE chat (
      ROWID INTEGER PRIMARY KEY,
      guid TEXT,
      display_name TEXT,
      chat_identifier TEXT
    );

    CREATE TABLE handle (
      ROWID INTEGER PRIMARY KEY,
      id TEXT
    );

    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY,
      handle_id INTEGER,
      is_from_me INTEGER,
      text TEXT,
      date INTEGER,
      service TEXT
    );

    CREATE TABLE chat_message_join (
      chat_id INTEGER,
      message_id INTEGER
    );

    CREATE TABLE chat_handle_join (
      chat_id INTEGER,
      handle_id INTEGER
    );
  `);

  // Chat 1: a 1:1 chat with a display_name, one participant.
  db.prepare(
    `INSERT INTO chat (ROWID, guid, display_name, chat_identifier) VALUES (?, ?, ?, ?)`
  ).run(1, "chat-guid-1", "Alice", "+15551110000");
  db.prepare(`INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)`).run(1, 100);

  // Chat 2: a group chat with a null display_name, falls back to chat_identifier.
  db.prepare(
    `INSERT INTO chat (ROWID, guid, display_name, chat_identifier) VALUES (?, ?, ?, ?)`
  ).run(2, "chat-guid-2", null, "chat123456789");
  db.prepare(`INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)`).run(2, 100);
  db.prepare(`INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)`).run(2, 101);

  // Handles.
  db.prepare(`INSERT INTO handle (ROWID, id) VALUES (?, ?)`).run(100, "+15551110000");
  db.prepare(`INSERT INTO handle (ROWID, id) VALUES (?, ?)`).run(101, "friend@example.com");

  const sinceApple = dateToAppleTimestamp(since);
  const oneDayNs = 24 * 60 * 60 * 1_000_000_000;

  // Message 1: recent, from the other person, in chat 1. Well after `since`.
  db.prepare(
    `INSERT INTO message (ROWID, handle_id, is_from_me, text, date, service) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(1, 100, 0, "hey there", sinceApple + oneDayNs, "iMessage");
  db.prepare(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`).run(1, 1);

  // Message 2: recent, sent by me, in chat 1.
  db.prepare(
    `INSERT INTO message (ROWID, handle_id, is_from_me, text, date, service) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(2, 100, 1, "hi back", sinceApple + oneDayNs, "iMessage");
  db.prepare(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`).run(1, 2);

  // Message 3: exactly at `since`, in chat 2 (boundary condition, inclusive).
  db.prepare(
    `INSERT INTO message (ROWID, handle_id, is_from_me, text, date, service) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(3, 101, 0, "on the boundary", sinceApple, "iMessage");
  db.prepare(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`).run(2, 3);

  // Message 4: old, well before `since`, should be excluded.
  db.prepare(
    `INSERT INTO message (ROWID, handle_id, is_from_me, text, date, service) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(4, 101, 0, "ancient history", sinceApple - 100 * oneDayNs, "iMessage");
  db.prepare(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`).run(2, 4);

  // Message 5: a system message (e.g. group rename) with Apple's handle_id=0
  // sentinel for "no real sender" — there is no handle row with ROWID 0.
  db.prepare(
    `INSERT INTO message (ROWID, handle_id, is_from_me, text, date, service) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(5, 0, 0, null, sinceApple + oneDayNs, "iMessage");
  db.prepare(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`).run(2, 5);

  db.close();
  return fixturePath;
}

describe("extractRecentMessages", () => {
  it("only returns messages on or after `since`, excluding older ones", () => {
    const dir = makeTempDir();
    const since = new Date("2024-01-01T00:00:00.000Z");
    const fixturePath = buildFixtureDb(dir, since);
    const source = openReadOnlySource(fixturePath);

    const { messages } = extractRecentMessages(source, since);

    const ids = messages.map((m) => m.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 5]);
    expect(messages.some((m) => m.text === "ancient history")).toBe(false);
  });

  it("maps a message with is_from_me = 1 to handle_id: null", () => {
    const dir = makeTempDir();
    const since = new Date("2024-01-01T00:00:00.000Z");
    const fixturePath = buildFixtureDb(dir, since);
    const source = openReadOnlySource(fixturePath);

    const { messages } = extractRecentMessages(source, since);

    const fromMe = messages.find((m) => m.id === 2);
    expect(fromMe).toBeDefined();
    expect(fromMe?.is_from_me).toBe(1);
    expect(fromMe?.handle_id).toBeNull();
  });

  it("falls back to chat_identifier when display_name is null", () => {
    const dir = makeTempDir();
    const since = new Date("2024-01-01T00:00:00.000Z");
    const fixturePath = buildFixtureDb(dir, since);
    const source = openReadOnlySource(fixturePath);

    const { chats } = extractRecentMessages(source, since);

    const chat2 = chats.find((c) => c.id === 2);
    expect(chat2).toBeDefined();
    expect(chat2?.display_name).toBe("chat123456789");
    expect(chat2?.is_group).toBe(1);

    const chat1 = chats.find((c) => c.id === 1);
    expect(chat1?.display_name).toBe("Alice");
    expect(chat1?.is_group).toBe(0);
  });

  it("maps a system message with handle_id 0 (no real sender) to handle_id: null", () => {
    const dir = makeTempDir();
    const since = new Date("2024-01-01T00:00:00.000Z");
    const fixturePath = buildFixtureDb(dir, since);
    const source = openReadOnlySource(fixturePath);

    const { messages, handles } = extractRecentMessages(source, since);

    const systemMessage = messages.find((m) => m.id === 5);
    expect(systemMessage).toBeDefined();
    expect(systemMessage?.handle_id).toBeNull();
    // handle_id 0 must never end up in the extracted handles either, since
    // there is no handle row with ROWID 0 for a foreign key to reference.
    expect(handles.some((h) => h.id === 0)).toBe(false);
  });

  it("includes a message dated exactly at `since` (inclusive boundary)", () => {
    const dir = makeTempDir();
    const since = new Date("2024-01-01T00:00:00.000Z");
    const fixturePath = buildFixtureDb(dir, since);
    const source = openReadOnlySource(fixturePath);

    const { messages } = extractRecentMessages(source, since);

    const boundaryMessage = messages.find((m) => m.id === 3);
    expect(boundaryMessage).toBeDefined();
    expect(boundaryMessage?.text).toBe("on the boundary");
    expect(boundaryMessage?.sent_at).toBe(since.toISOString());
  });
});
