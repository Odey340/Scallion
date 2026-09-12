import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ReadOnlySource, openReadOnlySource } from "./sourceDb";

/** Absolute path to the top-level Contacts database on this Mac. Read-only source of truth. */
export const REAL_ADDRESS_BOOK_PATH: string = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "AddressBook",
  "AddressBook-v22.abcddb"
);

/** Directory that holds one AddressBook-v22.abcddb per synced account. */
export const ADDRESS_BOOK_SOURCES_DIR: string = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "AddressBook",
  "Sources"
);

/** Directory that local working copies of Contacts databases are written to. */
export const LOCAL_ADDRESS_BOOK_COPY_DIR: string = path.join(__dirname, "..", "data");

const ADDRESS_BOOK_FILENAME = "AddressBook-v22.abcddb";

/**
 * Locates every macOS Contacts database on this machine: the top-level
 * AddressBook-v22.abcddb (if present), plus one per synced account under
 * Sources/<uuid>/AddressBook-v22.abcddb. Only ever checks for existence;
 * never opens or reads any of them.
 */
export function findAddressBookDatabases(): string[] {
  const found: string[] = [];

  if (fs.existsSync(REAL_ADDRESS_BOOK_PATH)) {
    found.push(REAL_ADDRESS_BOOK_PATH);
  }

  if (fs.existsSync(ADDRESS_BOOK_SOURCES_DIR)) {
    const sourceDirs = fs.readdirSync(ADDRESS_BOOK_SOURCES_DIR, { withFileTypes: true });
    for (const entry of sourceDirs) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(ADDRESS_BOOK_SOURCES_DIR, entry.name, ADDRESS_BOOK_FILENAME);
      if (fs.existsSync(candidate)) {
        found.push(candidate);
      }
    }
  }

  return found;
}

/**
 * Copies each given Contacts database (plus its -wal and -shm sidecar files,
 * if present) into the local data directory, using distinct filenames
 * (addressbook-0.abcddb, addressbook-1.abcddb, ...). Uses only file copy
 * operations; never opens or modifies the source files. Returns the paths
 * of the copies that were made, in the same order as `paths`.
 */
export function copyAddressBookDatabases(
  paths: string[],
  destDir: string = LOCAL_ADDRESS_BOOK_COPY_DIR
): string[] {
  fs.mkdirSync(destDir, { recursive: true });

  const destPaths: string[] = [];

  paths.forEach((sourcePath, index) => {
    const destPath = path.join(destDir, `addressbook-${index}.abcddb`);
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

    destPaths.push(destPath);
  });

  return destPaths;
}

/** One person's contact card, as resolved from the Contacts database. */
export interface ContactRecord {
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
  phoneNumbers: string[];
  emails: string[];
}

/**
 * Table and column names for the AddressBook schema. This schema is
 * undocumented by Apple and has shifted between macOS versions, so these
 * are a starting guess, not a guarantee — if `readContactsFromDb` comes back
 * empty on a real machine, run `sqlite3 <copy> ".schema ZABCDRECORD"` and
 * update the names here.
 */
const SCHEMA = {
  recordTable: "ZABCDRECORD",
  recordId: "Z_PK",
  firstName: "ZFIRSTNAME",
  lastName: "ZLASTNAME",
  organization: "ZORGANIZATION",
  phoneTable: "ZABCDPHONENUMBER",
  phoneOwner: "ZOWNER",
  phoneNumber: "ZFULLNUMBER",
  emailTable: "ZABCDEMAILADDRESS",
  emailOwner: "ZOWNER",
  emailAddress: "ZADDRESS",
};

interface ContactRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
}

interface PhoneRow {
  owner: number;
  number: string | null;
}

interface EmailRow {
  owner: number;
  address: string | null;
}

/**
 * Opens the given Contacts database copy read-only and builds one
 * ContactRecord per person, joining the contact table with its phone number
 * and email tables.
 */
export function readContactsFromDb(dbPath: string): ContactRecord[] {
  const source = openReadOnlySource(dbPath);
  return readContactsFromSource(source);
}

function readContactsFromSource(source: ReadOnlySource): ContactRecord[] {
  const contactRows = source.query<ContactRow>(
    `SELECT
       ${SCHEMA.recordId} AS id,
       ${SCHEMA.firstName} AS firstName,
       ${SCHEMA.lastName} AS lastName,
       ${SCHEMA.organization} AS organization
     FROM ${SCHEMA.recordTable}`
  );

  const phoneRows = source.query<PhoneRow>(
    `SELECT
       ${SCHEMA.phoneOwner} AS owner,
       ${SCHEMA.phoneNumber} AS number
     FROM ${SCHEMA.phoneTable}`
  );

  const emailRows = source.query<EmailRow>(
    `SELECT
       ${SCHEMA.emailOwner} AS owner,
       ${SCHEMA.emailAddress} AS address
     FROM ${SCHEMA.emailTable}`
  );

  const phonesByOwner = new Map<number, string[]>();
  for (const row of phoneRows) {
    if (!row.number) continue;
    const list = phonesByOwner.get(row.owner) ?? [];
    list.push(row.number);
    phonesByOwner.set(row.owner, list);
  }

  const emailsByOwner = new Map<number, string[]>();
  for (const row of emailRows) {
    if (!row.address) continue;
    const list = emailsByOwner.get(row.owner) ?? [];
    list.push(row.address);
    emailsByOwner.set(row.owner, list);
  }

  return contactRows.map((row) => ({
    firstName: row.firstName,
    lastName: row.lastName,
    organization: row.organization,
    phoneNumbers: phonesByOwner.get(row.id) ?? [],
    emails: emailsByOwner.get(row.id) ?? [],
  }));
}

/**
 * Strips every non-digit character from a phone number, then keeps only the
 * last 10 digits, normalizing away a leading country code like +1.
 */
export function normalizePhone(raw: string): string {
  const digitsOnly = raw.replace(/\D/g, "");
  return digitsOnly.slice(-10);
}

/**
 * Trims whitespace and lowercases an email address for comparison.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Builds a lookup from normalized phone number or email to a display name,
 * indexing every phone number and email on every record. The display name
 * is `${firstName} ${lastName}`.trim(), falling back to `organization` when
 * both name fields are empty; a record with no name or organization to show
 * contributes no entries.
 */
export function buildContactIndex(records: ContactRecord[]): Map<string, string> {
  const index = new Map<string, string>();

  for (const record of records) {
    const fullName = `${record.firstName ?? ""} ${record.lastName ?? ""}`.trim();
    const displayName = fullName || record.organization || null;
    if (!displayName) continue;

    for (const phone of record.phoneNumbers) {
      index.set(normalizePhone(phone), displayName);
    }
    for (const email of record.emails) {
      index.set(normalizeEmail(email), displayName);
    }
  }

  return index;
}

/**
 * Resolves an identifier (phone number or email, in any format) to a display
 * name using the given index. Tries the identifier normalized as a phone
 * number first, then as an email; returns null if neither matches.
 */
export function resolveContactName(index: Map<string, string>, identifier: string): string | null {
  const byPhone = index.get(normalizePhone(identifier));
  if (byPhone !== undefined) return byPhone;

  const byEmail = index.get(normalizeEmail(identifier));
  if (byEmail !== undefined) return byEmail;

  return null;
}
