import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { REAL_CHAT_DB_PATH, LOCAL_CHAT_DB_COPY_PATH } from "./config";

/** Seconds between the Unix epoch (1970-01-01) and Apple's Core Data epoch (2001-01-01). */
const APPLE_EPOCH_OFFSET_SECONDS = 978307200;
const NANOSECONDS_PER_SECOND = 1_000_000_000;

/**
 * Converts an Apple Core Data timestamp (nanoseconds since 2001-01-01T00:00:00Z)
 * into a standard JavaScript Date.
 */
export function appleTimestampToDate(appleNs: number): Date {
  const seconds = appleNs / NANOSECONDS_PER_SECOND;
  const unixMillis = (seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000;
  return new Date(unixMillis);
}

/**
 * Converts a standard JavaScript Date into an Apple Core Data timestamp
 * (nanoseconds since 2001-01-01T00:00:00Z).
 */
export function dateToAppleTimestamp(date: Date): number {
  const unixSeconds = date.getTime() / 1000;
  const appleSeconds = unixSeconds - APPLE_EPOCH_OFFSET_SECONDS;
  return appleSeconds * NANOSECONDS_PER_SECOND;
}

/**
 * A read-only handle onto a local SQLite database file. Intentionally exposes
 * only `query`, so nothing downstream can ever issue a write statement
 * (no `.exec()`, `.run()`, `.pragma()`, or access to the raw Database instance).
 */
export class ReadOnlySource {
  private readonly db: InstanceType<typeof Database>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
  }

  query<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(params) as T[];
  }
}

/**
 * Copies the real Messages database (plus its -wal and -shm sidecar files,
 * if present) into the local data directory, overwriting any previous copy.
 * Uses only file copy operations; never opens or modifies the source files.
 */
export function copySourceDatabase(
  sourcePath: string = REAL_CHAT_DB_PATH,
  destPath: string = LOCAL_CHAT_DB_COPY_PATH
): void {
  const destDir = path.dirname(destPath);
  fs.mkdirSync(destDir, { recursive: true });

  fs.copyFileSync(sourcePath, destPath);

  for (const suffix of ["-wal", "-shm"]) {
    const sidecarSource = `${sourcePath}${suffix}`;
    const sidecarDest = `${destPath}${suffix}`;
    if (fs.existsSync(sidecarSource)) {
      fs.copyFileSync(sidecarSource, sidecarDest);
    } else if (fs.existsSync(sidecarDest)) {
      // Remove a stale sidecar from a previous copy so it doesn't get
      // mistakenly replayed against the newly copied main file.
      fs.unlinkSync(sidecarDest);
    }
  }
}

/**
 * Opens the given database file read-only. Refuses to open anything but an
 * existing file, and never issues writes against it.
 */
export function openReadOnlySource(dbPath: string): ReadOnlySource {
  return new ReadOnlySource(dbPath);
}
