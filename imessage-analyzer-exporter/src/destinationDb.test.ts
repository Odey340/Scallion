import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, afterEach } from "vitest";
import {
  createDestinationDb,
  insertChat,
  insertHandle,
  insertMessage,
} from "./destinationDb";

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "imessage-export-test-")),
    "test.db"
  );
}

let currentDbPath: string | undefined;

afterEach(() => {
  if (currentDbPath) {
    const dir = path.dirname(currentDbPath);
    fs.rmSync(dir, { recursive: true, force: true });
    currentDbPath = undefined;
  }
});

describe("createDestinationDb", () => {
  it("can be called twice in a row without throwing, creating all three tables", () => {
    currentDbPath = tempDbPath();

    expect(() => createDestinationDb(currentDbPath)).not.toThrow();
    const db = createDestinationDb(currentDbPath);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
      )
      .all()
      .map((row: any) => row.name);

    expect(tables).toEqual(["chats", "handles", "messages"]);
    db.close();
  });
});

describe("insertChat / insertHandle / insertMessage", () => {
  it("round-trips inserted rows, including the message -> chat relationship", () => {
    currentDbPath = tempDbPath();
    const db = createDestinationDb(currentDbPath);

    insertChat(db, { id: 1, guid: "chat-guid-1", display_name: "Test Chat", is_group: 0 });
    insertHandle(db, { id: 2, identifier: "+15551234567" });
    insertMessage(db, {
      id: 3,
      chat_id: 1,
      handle_id: 2,
      is_from_me: 0,
      text: "hello world",
      sent_at: "2024-01-01T00:00:00.000Z",
      service: "iMessage",
    });

    const chat = db.prepare(`SELECT * FROM chats WHERE id = ?`).get(1) as any;
    expect(chat).toEqual({
      id: 1,
      guid: "chat-guid-1",
      display_name: "Test Chat",
      is_group: 0,
    });

    const handle = db.prepare(`SELECT * FROM handles WHERE id = ?`).get(2) as any;
    expect(handle).toEqual({ id: 2, identifier: "+15551234567" });

    const message = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(3) as any;
    expect(message).toEqual({
      id: 3,
      chat_id: 1,
      handle_id: 2,
      is_from_me: 0,
      text: "hello world",
      sent_at: "2024-01-01T00:00:00.000Z",
      service: "iMessage",
    });

    const joined = db
      .prepare(
        `SELECT messages.id AS message_id, chats.display_name AS chat_display_name
         FROM messages JOIN chats ON messages.chat_id = chats.id
         WHERE messages.id = ?`
      )
      .get(3) as any;
    expect(joined).toEqual({ message_id: 3, chat_display_name: "Test Chat" });

    db.close();
  });

  it("INSERT OR REPLACE leaves only the second version when the same id is inserted twice", () => {
    currentDbPath = tempDbPath();
    const db = createDestinationDb(currentDbPath);

    insertChat(db, { id: 1, guid: "guid-v1", display_name: "First", is_group: 0 });
    insertChat(db, { id: 1, guid: "guid-v2", display_name: "Second", is_group: 1 });

    const chats = db.prepare(`SELECT * FROM chats`).all();
    expect(chats).toHaveLength(1);
    expect(chats[0]).toEqual({
      id: 1,
      guid: "guid-v2",
      display_name: "Second",
      is_group: 1,
    });

    insertHandle(db, { id: 5, identifier: "old@example.com" });
    insertHandle(db, { id: 5, identifier: "new@example.com" });

    const handles = db.prepare(`SELECT * FROM handles`).all();
    expect(handles).toHaveLength(1);
    expect(handles[0]).toEqual({ id: 5, identifier: "new@example.com" });

    insertMessage(db, {
      id: 9,
      chat_id: 1,
      handle_id: 5,
      is_from_me: 0,
      text: "old text",
      sent_at: "2024-01-01T00:00:00.000Z",
      service: "iMessage",
    });
    insertMessage(db, {
      id: 9,
      chat_id: 1,
      handle_id: 5,
      is_from_me: 1,
      text: "new text",
      sent_at: "2024-02-01T00:00:00.000Z",
      service: "SMS",
    });

    const messages = db.prepare(`SELECT * FROM messages`).all();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      id: 9,
      chat_id: 1,
      handle_id: 5,
      is_from_me: 1,
      text: "new text",
      sent_at: "2024-02-01T00:00:00.000Z",
      service: "SMS",
    });

    db.close();
  });
});
