import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, afterEach } from "vitest";
import {
  readContactsFromDb,
  normalizePhone,
  normalizeEmail,
  buildContactIndex,
  resolveContactName,
  ContactRecord,
} from "./contactsDb";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contactsdb-test-"));
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
 * Builds a fixture AddressBook-shaped SQLite database with three contacts:
 * one with only a phone, one with only an email, and one with both.
 */
function buildFixtureDb(dir: string): string {
  const dbPath = path.join(dir, "fixture.abcddb");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE ZABCDRECORD (
      Z_PK INTEGER PRIMARY KEY,
      ZFIRSTNAME TEXT,
      ZLASTNAME TEXT,
      ZORGANIZATION TEXT
    );
    CREATE TABLE ZABCDPHONENUMBER (
      Z_PK INTEGER PRIMARY KEY,
      ZOWNER INTEGER,
      ZFULLNUMBER TEXT
    );
    CREATE TABLE ZABCDEMAILADDRESS (
      Z_PK INTEGER PRIMARY KEY,
      ZOWNER INTEGER,
      ZADDRESS TEXT
    );
  `);

  db.prepare(
    "INSERT INTO ZABCDRECORD (Z_PK, ZFIRSTNAME, ZLASTNAME, ZORGANIZATION) VALUES (?, ?, ?, ?)"
  ).run(1, "Ada", "Lovelace", null);
  db.prepare(
    "INSERT INTO ZABCDRECORD (Z_PK, ZFIRSTNAME, ZLASTNAME, ZORGANIZATION) VALUES (?, ?, ?, ?)"
  ).run(2, "Grace", "Hopper", null);
  db.prepare(
    "INSERT INTO ZABCDRECORD (Z_PK, ZFIRSTNAME, ZLASTNAME, ZORGANIZATION) VALUES (?, ?, ?, ?)"
  ).run(3, "Ida", "Tarbell", null);

  // Ada: phone only
  db.prepare("INSERT INTO ZABCDPHONENUMBER (Z_PK, ZOWNER, ZFULLNUMBER) VALUES (?, ?, ?)").run(
    1,
    1,
    "+1 (555) 123-4567"
  );

  // Grace: email only
  db.prepare("INSERT INTO ZABCDEMAILADDRESS (Z_PK, ZOWNER, ZADDRESS) VALUES (?, ?, ?)").run(
    1,
    2,
    "Grace.Hopper@Navy.mil"
  );

  // Ida: phone and email
  db.prepare("INSERT INTO ZABCDPHONENUMBER (Z_PK, ZOWNER, ZFULLNUMBER) VALUES (?, ?, ?)").run(
    2,
    3,
    "555-987-6543"
  );
  db.prepare("INSERT INTO ZABCDEMAILADDRESS (Z_PK, ZOWNER, ZADDRESS) VALUES (?, ?, ?)").run(
    2,
    3,
    "ida@example.com"
  );

  db.close();
  return dbPath;
}

describe("readContactsFromDb", () => {
  it("parses contacts, phone numbers, and emails into ContactRecord[]", () => {
    const dir = makeTempDir();
    const dbPath = buildFixtureDb(dir);

    const records = readContactsFromDb(dbPath);

    expect(records).toEqual<ContactRecord[]>([
      {
        firstName: "Ada",
        lastName: "Lovelace",
        organization: null,
        phoneNumbers: ["+1 (555) 123-4567"],
        emails: [],
      },
      {
        firstName: "Grace",
        lastName: "Hopper",
        organization: null,
        phoneNumbers: [],
        emails: ["Grace.Hopper@Navy.mil"],
      },
      {
        firstName: "Ida",
        lastName: "Tarbell",
        organization: null,
        phoneNumbers: ["555-987-6543"],
        emails: ["ida@example.com"],
      },
    ]);
  });
});

describe("normalizePhone", () => {
  it("normalizes differently formatted versions of the same number to the same 10 digits", () => {
    const variants = [
      "+1 (555) 123-4567",
      "15551234567",
      "555.123.4567",
      "555 123 4567",
      "(555)123-4567",
    ];

    for (const variant of variants) {
      expect(normalizePhone(variant)).toBe("5551234567");
    }
  });
});

describe("normalizeEmail", () => {
  it("trims whitespace and lowercases", () => {
    expect(normalizeEmail("  Grace.Hopper@Navy.mil  ")).toBe("grace.hopper@navy.mil");
    expect(normalizeEmail("ADA@EXAMPLE.COM")).toBe("ada@example.com");
  });
});

describe("buildContactIndex / resolveContactName", () => {
  const records: ContactRecord[] = [
    {
      firstName: "Ada",
      lastName: "Lovelace",
      organization: null,
      phoneNumbers: ["+1 (555) 123-4567"],
      emails: [],
    },
    {
      firstName: "Grace",
      lastName: "Hopper",
      organization: null,
      phoneNumbers: [],
      emails: ["Grace.Hopper@Navy.mil"],
    },
    {
      firstName: null,
      lastName: null,
      organization: "Acme Corp",
      phoneNumbers: ["555-000-1111"],
      emails: [],
    },
    {
      firstName: null,
      lastName: null,
      organization: null,
      phoneNumbers: ["555-222-3333"],
      emails: [],
    },
  ];

  it("resolves a phone number stored in a different format", () => {
    const index = buildContactIndex(records);
    expect(resolveContactName(index, "5551234567")).toBe("Ada Lovelace");
    expect(resolveContactName(index, "(555) 123-4567")).toBe("Ada Lovelace");
  });

  it("resolves an email stored in a different case", () => {
    const index = buildContactIndex(records);
    expect(resolveContactName(index, "grace.hopper@navy.mil")).toBe("Grace Hopper");
  });

  it("falls back to organization when there is no name", () => {
    const index = buildContactIndex(records);
    expect(resolveContactName(index, "555-000-1111")).toBe("Acme Corp");
  });

  it("skips a record with no name and no organization", () => {
    const index = buildContactIndex(records);
    expect(resolveContactName(index, "555-222-3333")).toBeNull();
  });

  it("returns null for a completely unknown identifier", () => {
    const index = buildContactIndex(records);
    expect(resolveContactName(index, "999-999-9999")).toBeNull();
    expect(resolveContactName(index, "nobody@nowhere.com")).toBeNull();
  });
});
