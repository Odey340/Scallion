# imessage-analyzer-exporter

A one-time, read-only export of the last 3 months of iMessage/SMS history
(chats, handles, messages) from the local Messages app database into a
separate SQLite file for downstream use.

## Full Disk Access requirement

macOS blocks access to `~/Library/Messages/chat.db` unless the terminal
you're running from has **Full Disk Access**. Without it, `copySourceDatabase`
will fail to read the source file.

To grant it:

1. Open **System Settings → Privacy & Security → Full Disk Access**.
2. Click the **+** button and add the terminal app you run this from (e.g.
   Terminal.app, iTerm, or your IDE's integrated terminal).
3. Make sure the toggle next to it is enabled.
4. Restart the terminal app for the permission to take effect.

## Running the export

```bash
npm install
npm run export
```

This builds the TypeScript sources and runs the compiled entry point
(`dist/index.js`), which:

1. Copies the real `chat.db` (and its `-wal`/`-shm` sidecars) into
   `data/chat-copy.db`.
2. Opens that local copy read-only and extracts every chat, handle, and
   message involved in a message sent in the last 3 months.
3. Writes the results into `data/imessages_export.db`, dropping and
   recreating its tables first.
4. Prints a summary: the number of chats, handles, and messages written, and
   the date range covered.

The real `~/Library/Messages/chat.db` is only ever read from, never written
to — the tool only reaches it through a plain file copy and a read-only
database handle.

If the export fails partway through, it logs a clear error and exits with a
non-zero status. Because `createDestinationDb` drops and recreates all tables
on every run, there's no partial-write cleanup: a failed run just leaves a
partial (or previous) export in `data/imessages_export.db`, and re-running
`npm run export` once the problem is fixed will overwrite it. This is
considered acceptable for a one-time tool.

## Analyze

```bash
npm run analyze
```

Run this **after** `npm run export`. It reads `data/imessages_export.db` —
the file the export step wrote — computes decline, balance, and
responsiveness metrics for each 1:1 conversation, and prints a ranked console
report of the contacts most worth reaching out to: percent decline versus
their normal baseline, baseline vs. recent message counts, how balanced the
conversation is, and average historical reply time (or "no clear reply
pattern" if there isn't enough evidence). If no contact currently meets the
decline threshold, it says so explicitly instead of printing an empty list.

`npm run analyze` only ever opens `data/imessages_export.db`, and only in
read-only mode — it never touches `data/chat-copy.db` or the real Messages
database, and it never creates, alters, or writes to any database table. The
report is console output only; nothing is written to disk.

Where possible, each recommended contact's phone number or email is also
resolved against your local Contacts app data, so the report can print a
name (e.g. `Jane Smith (+15551234567)`) instead of just the raw identifier.
This only ever reads local copies of your Contacts database(s) — the same
copy-then-read-only-open pattern used for Messages — and never touches the
real AddressBook database. If an identifier doesn't resolve to a name, that
simply means that person isn't in your Contacts (or no Contacts database
could be read at all); the report falls back to printing the identifier on
its own and continues without error.

The recommendations are a starting point for your own judgment, not a
verdict on any relationship.

## ⚠️ `data/` contains real personal message content

The `data/` directory is listed in `.gitignore` and **must never be
committed**. It holds a raw copy of your Messages database and the exported
SQLite file, both of which contain real, personal message text. Before
sharing this repo, running `git add -A`, or opening a PR, double check that
nothing under `data/` is staged (`git status`).
