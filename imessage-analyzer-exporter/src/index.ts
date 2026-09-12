import { copySourceDatabase, openReadOnlySource } from "./sourceDb";
import {
  getThreeMonthsAgo,
  LOCAL_CHAT_DB_COPY_PATH,
  DESTINATION_DB_PATH,
} from "./config";
import { extractRecentMessages } from "./extract";
import {
  createDestinationDb,
  insertChat,
  insertHandle,
  insertMessage,
} from "./destinationDb";

/**
 * The subset of the real modules that `runExport` needs, expressed as an
 * interface so tests can pass in stubs/mocks instead of touching the real
 * chat.db or writing real files.
 */
export interface RunExportDeps {
  copySourceDatabase: typeof copySourceDatabase;
  openReadOnlySource: typeof openReadOnlySource;
  extractRecentMessages: typeof extractRecentMessages;
  createDestinationDb: typeof createDestinationDb;
  insertChat: typeof insertChat;
  insertHandle: typeof insertHandle;
  insertMessage: typeof insertMessage;
}

/**
 * Runs the full one-time export: refresh the local copy of chat.db, extract
 * messages from the last 3 months, and write them into the destination
 * export database. Takes its dependencies as parameters so the orchestration
 * logic can be tested without touching real files.
 *
 * `src/index.ts` never reaches the source database except through
 * `extractRecentMessages` (which only ever calls `source.query`), so this
 * function has no way to write to chat.db.
 */
export function runExport(deps: RunExportDeps): void {
  const {
    copySourceDatabase,
    openReadOnlySource,
    extractRecentMessages,
    createDestinationDb,
    insertChat,
    insertHandle,
    insertMessage,
  } = deps;

  copySourceDatabase();
  const source = openReadOnlySource(LOCAL_CHAT_DB_COPY_PATH);
  const since = getThreeMonthsAgo();

  const { chats, handles, messages } = extractRecentMessages(source, since);

  const destination = createDestinationDb(DESTINATION_DB_PATH);
  for (const chat of chats) {
    insertChat(destination, chat);
  }
  for (const handle of handles) {
    insertHandle(destination, handle);
  }
  for (const message of messages) {
    insertMessage(destination, message);
  }

  const sentAts = messages.map((m) => m.sent_at).sort();
  const earliest = sentAts[0] ?? "n/a";
  const latest = sentAts[sentAts.length - 1] ?? "n/a";

  console.log("Export complete:");
  console.log(`  Chats:    ${chats.length}`);
  console.log(`  Handles:  ${handles.length}`);
  console.log(`  Messages: ${messages.length}`);
  console.log(`  Date range covered: ${earliest} to ${latest}`);
}

function main(): void {
  try {
    runExport({
      copySourceDatabase,
      openReadOnlySource,
      extractRecentMessages,
      createDestinationDb,
      insertChat,
      insertHandle,
      insertMessage,
    });
  } catch (err) {
    console.error("Export failed:", err instanceof Error ? err.message : err);
    console.error(
      "Note: createDestinationDb drops and recreates tables on every run, " +
        "so a failed run partway through simply leaves a partial export in " +
        "place in data/imessages_export.db. This is a one-time tool with no " +
        "rollback logic; just re-run `npm run export` once the problem is fixed."
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
