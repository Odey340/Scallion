import * as os from "os";
import * as path from "path";

/** Absolute path to the real, live Messages database on this Mac. Read-only source of truth. */
export const REAL_CHAT_DB_PATH: string = path.join(
  os.homedir(),
  "Library",
  "Messages",
  "chat.db"
);

/** Absolute path to the local working copy of the Messages database. Safe to read/write. */
export const LOCAL_CHAT_DB_COPY_PATH: string = path.join(
  __dirname,
  "..",
  "data",
  "chat-copy.db"
);

/** Absolute path to the destination export database that `npm run export` writes. */
export const DESTINATION_DB_PATH: string = path.join(
  __dirname,
  "..",
  "data",
  "imessages_export.db"
);

/**
 * Returns a Date exactly 3 months before the current moment.
 */
export function getThreeMonthsAgo(): Date {
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(now.getMonth() - 3);
  return threeMonthsAgo;
}
