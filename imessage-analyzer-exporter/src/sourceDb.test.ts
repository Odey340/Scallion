import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, afterEach } from "vitest";
import {
  appleTimestampToDate,
  dateToAppleTimestamp,
  openReadOnlySource,
  copySourceDatabase,
} from "./sourceDb";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imessage-export-test-"));
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

describe("appleTimestampToDate / dateToAppleTimestamp", () => {
  it("maps Apple timestamp 0 to the Apple epoch", () => {
    expect(appleTimestampToDate(0).toISOString()).toBe("2001-01-01T00:00:00.000Z");
  });

  it("round trips a known reference value: Apple epoch", () => {
    const date = new Date("2001-01-01T00:00:00.000Z");
    const appleNs = dateToAppleTimestamp(date);
    expect(appleNs).toBe(0);
    expect(appleTimestampToDate(appleNs).toISOString()).toBe(date.toISOString());
  });

  it("round trips a known reference value: 2021-01-01", () => {
    const date = new Date("2021-01-01T00:00:00.000Z");
    const appleNs = dateToAppleTimestamp(date);
    expect(appleTimestampToDate(appleNs).toISOString()).toBe(date.toISOString());
  });

  it("round trips an arbitrary date with sub-second precision", () => {
    const date = new Date("2023-06-15T12:34:56.789Z");
    const appleNs = dateToAppleTimestamp(date);
    expect(appleTimestampToDate(appleNs).toISOString()).toBe(date.toISOString());
  });
});

describe("ReadOnlySource", () => {
  function buildFixtureDb(dir: string): string {
    const fixturePath = path.join(dir, "fixture.db");
    const db = new Database(fixturePath);
    db.exec("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    db.prepare("INSERT INTO widgets (id, name) VALUES (?, ?)").run(1, "alpha");
    db.prepare("INSERT INTO widgets (id, name) VALUES (?, ?)").run(2, "beta");
    db.close();
    return fixturePath;
  }

  it("returns rows matching what was inserted", () => {
    const dir = makeTempDir();
    const fixturePath = buildFixtureDb(dir);

    const source = openReadOnlySource(fixturePath);
    const rows = source.query<{ id: number; name: string }>(
      "SELECT id, name FROM widgets ORDER BY id"
    );

    expect(rows).toEqual([
      { id: 1, name: "alpha" },
      { id: 2, name: "beta" },
    ]);
  });

  it("exposes no run, exec, or pragma keys", () => {
    const dir = makeTempDir();
    const fixturePath = buildFixtureDb(dir);

    const source = openReadOnlySource(fixturePath);

    expect((source as unknown as { run?: unknown }).run).toBeUndefined();
    expect((source as unknown as { exec?: unknown }).exec).toBeUndefined();
    expect((source as unknown as { pragma?: unknown }).pragma).toBeUndefined();
  });

  it("throws a clear error instead of creating a new database for a nonexistent file", () => {
    const dir = makeTempDir();
    const missingPath = path.join(dir, "does-not-exist.db");

    expect(() => openReadOnlySource(missingPath)).toThrow();
    expect(fs.existsSync(missingPath)).toBe(false);
  });
});

describe("copySourceDatabase", () => {
  it("copies a fixture source file (and its sidecars) to the destination", () => {
    const srcDir = makeTempDir();
    const destDir = makeTempDir();

    const sourcePath = path.join(srcDir, "fixture-source.db");
    const destPath = path.join(destDir, "nested", "fixture-copy.db");

    const db = new Database(sourcePath);
    db.exec("CREATE TABLE t (v TEXT)");
    db.prepare("INSERT INTO t (v) VALUES (?)").run("hello");
    db.close();

    fs.writeFileSync(`${sourcePath}-wal`, "wal-contents");
    fs.writeFileSync(`${sourcePath}-shm`, "shm-contents");

    copySourceDatabase(sourcePath, destPath);

    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.existsSync(`${destPath}-wal`)).toBe(true);
    expect(fs.existsSync(`${destPath}-shm`)).toBe(true);
    expect(fs.readFileSync(`${destPath}-wal`, "utf8")).toBe("wal-contents");

    const copy = openReadOnlySource(destPath);
    const rows = copy.query<{ v: string }>("SELECT v FROM t");
    expect(rows).toEqual([{ v: "hello" }]);
  });

  it("does not fail when sidecar files do not exist", () => {
    const srcDir = makeTempDir();
    const destDir = makeTempDir();

    const sourcePath = path.join(srcDir, "fixture-source-no-sidecars.db");
    const destPath = path.join(destDir, "fixture-copy-no-sidecars.db");

    const db = new Database(sourcePath);
    db.exec("CREATE TABLE t (v TEXT)");
    db.close();

    expect(() => copySourceDatabase(sourcePath, destPath)).not.toThrow();
    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.existsSync(`${destPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${destPath}-shm`)).toBe(false);
  });
});
