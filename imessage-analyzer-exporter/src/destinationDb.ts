import Database from "better-sqlite3";
import { DESTINATION_DB_PATH } from "./config";

export { DESTINATION_DB_PATH };

export interface ChatRow {
  id: number;
  guid: string;
  display_name: string | null;
  is_group: number;
}

export interface HandleRow {
  id: number;
  identifier: string;
}

export interface MessageRow {
  id: number;
  chat_id: number;
  handle_id: number | null;
  is_from_me: number;
  text: string | null;
  sent_at: string;
  service: string | null;
}

/**
 * Opens (creating if needed) the destination export database in normal
 * read-write mode and (re)creates its schema from scratch. Dropping and
 * recreating the tables on every run keeps re-runs of this one-time export
 * idempotent.
 */
export function createDestinationDb(dbPath: string = DESTINATION_DB_PATH): InstanceType<typeof Database> {
  const db = new Database(dbPath);

  db.exec(`
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS handles;
    DROP TABLE IF EXISTS chats;

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
      service TEXT,
      FOREIGN KEY(chat_id) REFERENCES chats(id),
      FOREIGN KEY(handle_id) REFERENCES handles(id)
    );
  `);

  return db;
}

export function insertChat(db: InstanceType<typeof Database>, chat: ChatRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO chats (id, guid, display_name, is_group) VALUES (?, ?, ?, ?)`
  ).run(chat.id, chat.guid, chat.display_name, chat.is_group);
}

export function insertHandle(db: InstanceType<typeof Database>, handle: HandleRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO handles (id, identifier) VALUES (?, ?)`
  ).run(handle.id, handle.identifier);
}

export function insertMessage(db: InstanceType<typeof Database>, message: MessageRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_id, handle_id, is_from_me, text, sent_at, service) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    message.id,
    message.chat_id,
    message.handle_id,
    message.is_from_me,
    message.text,
    message.sent_at,
    message.service
  );
}
