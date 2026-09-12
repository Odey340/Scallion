import { ReadOnlySource, appleTimestampToDate, dateToAppleTimestamp } from "./sourceDb";
import { ChatRow, HandleRow, MessageRow } from "./destinationDb";

interface SourceChatRow {
  id: number;
  guid: string;
  display_name: string | null;
  chat_identifier: string | null;
  participant_count: number;
}

interface SourceHandleRow {
  id: number;
  identifier: string;
}

interface SourceMessageRow {
  id: number;
  chat_id: number;
  handle_id: number | null;
  is_from_me: number;
  text: string | null;
  date: number;
  service: string | null;
}

/**
 * Pulls every chat, handle, and message from the source database that is
 * involved in a message sent on or after `since`, mapping each into the
 * destination row shapes. Purely in-memory; nothing is written anywhere.
 */
export function extractRecentMessages(
  source: ReadOnlySource,
  since: Date
): { chats: ChatRow[]; handles: HandleRow[]; messages: MessageRow[] } {
  const sinceApple = dateToAppleTimestamp(since);

  const sourceChats = source.query<SourceChatRow>(
    `SELECT
       chat.ROWID AS id,
       chat.guid AS guid,
       chat.display_name AS display_name,
       chat.chat_identifier AS chat_identifier,
       (SELECT COUNT(*) FROM chat_handle_join WHERE chat_handle_join.chat_id = chat.ROWID) AS participant_count
     FROM chat
     WHERE chat.ROWID IN (
       SELECT chat_message_join.chat_id
       FROM chat_message_join
       JOIN message ON message.ROWID = chat_message_join.message_id
       WHERE message.date >= ?
     )`,
    [sinceApple]
  );

  const sourceHandles = source.query<SourceHandleRow>(
    `SELECT DISTINCT
       handle.ROWID AS id,
       handle.id AS identifier
     FROM handle
     JOIN message ON message.handle_id = handle.ROWID
     WHERE message.date >= ?`,
    [sinceApple]
  );

  const sourceMessages = source.query<SourceMessageRow>(
    `SELECT
       message.ROWID AS id,
       chat_message_join.chat_id AS chat_id,
       message.handle_id AS handle_id,
       message.is_from_me AS is_from_me,
       message.text AS text,
       message.date AS date,
       message.service AS service
     FROM message
     JOIN chat_message_join ON chat_message_join.message_id = message.ROWID
     WHERE message.date >= ?`,
    [sinceApple]
  );

  const chats: ChatRow[] = sourceChats.map((chat) => ({
    id: chat.id,
    guid: chat.guid,
    display_name: chat.display_name ?? chat.chat_identifier,
    is_group: chat.participant_count > 1 ? 1 : 0,
  }));

  const handles: HandleRow[] = sourceHandles.map((handle) => ({
    id: handle.id,
    identifier: handle.identifier,
  }));

  const messages: MessageRow[] = sourceMessages.map((message) => ({
    id: message.id,
    chat_id: message.chat_id,
    // handle_id 0 is Apple's sentinel for "no real sender" on system messages
    // (e.g. group membership/name changes) — there's no handle row with
    // ROWID 0, so treat it the same as is_from_me: no handle to reference.
    handle_id:
      message.is_from_me === 1 || message.handle_id === 0
        ? null
        : message.handle_id,
    is_from_me: message.is_from_me,
    text: message.text,
    sent_at: appleTimestampToDate(message.date).toISOString(),
    service: message.service,
  }));

  return { chats, handles, messages };
}
