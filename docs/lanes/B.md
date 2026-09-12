# Lane B: Social engine

**Mission.** Turn a person's own messaging metadata into a social-connection signal: who they exchange messages with, how reciprocal it is, who is drifting, and whether they sit in the Lubben at-risk band. Content is parsed in the browser and thrown away; only hashed events leave the device. This is the headline feature of the Healthcare pitch and the thing no other team will have.

**You produce:** the `social/` TypeScript package (API in `docs/contracts.md` section 2), the Gmail OAuth ingest in `web/src/ingest/gmail.ts`, the WhatsApp/SMS/chat.db parsers, `POST /events` payloads, and the privacy card copy.
**You consume:** D's `POST /events`, `GET /circle/summary` and the `contact_events` table (contract sections 2-3); C renders what you compute.

## Setup (H0-1)

- [ ] Google Cloud project; enable the Gmail API; OAuth consent screen in Testing; add all four teammates as test users; web client ID for the Vercel domain and localhost. Scope: `https://www.googleapis.com/auth/gmail.metadata` only.
- [ ] `social/` package scaffold (tsconfig strict, vitest); `fixtures/whatsapp_sample.txt` (synthetic, 90 days, 12 contacts, iOS and Android line formats) and `fixtures/gmail_metadata_sample.json` (synthetic).
- [ ] Everyone exports their top five WhatsApp chats ("Export chat > Without media") for their own testing; nothing raw goes in the repo.

## Block 1 (H1-6): first real events. Gate H6.

- [ ] `parseWhatsApp` for both line formats; keeps timestamp, sender, direction, length bucket; hashes with sha256(handle + user salt); drops text immediately. Tests on the fixture.
- [ ] Gmail ingest: `messages.list` by `labelIds` (INBOX, SENT) with pagination, then `messages.get?format=metadata&metadataHeaders=From,To,Cc,Date,In-Reply-To`. The metadata scope does not allow the `q` parameter, so filter dates client-side. `parseGmailHeaders` maps From/To against the user's own address to direction; threads via In-Reply-To.
- **Gate H6:** the Gmail flow returns headers for one teammate on the web build; WhatsApp parser tests pass.

## Block 2 (H6-12): the metrics

- [ ] `computeMetrics`: active ties (two-way within 7 days), close ties (4+ exchange days in 30), initiation share (thread gap 6 h), reply latency mine/theirs, churn (1 - Jaccard of consecutive 30-day active sets), silence (longest run of zero two-way days).
- [ ] `heatmap`: 52 x 7 days, level 0-3 by distinct people that day.
- [ ] `lsnsProxy`: items 1 and 4 from active ties, 2 and 5 from close ties, 3 and 6 from the two onboarding answers; LSNS-6 bucket scoring (0,1,2,3-4,5-8,9+ -> 0..5); at risk when total < 12. Return `fromMessaging: 4, fromUser: 2` so C can print the honest label.
- [ ] `POST /events` upload from the browser after parsing (batch of hashed events); handshake with D on the payload.
- [ ] Sleep shift 6-10 am.

## Block 3 (H12-19): the nudge engine. Gate H19.

- [ ] `recurrence`: per contact, inter-event gaps -> median and MAD; overdue when `daysSince > max(7, median + 2*MAD)`; rank by closeness x overdue ratio; one nudge per day with text like "You and Maria usually talk every 6 days. It's been 15." (names are resolved on the device from the local hash map; the package only ever sees hashes).
- [ ] Feedback: `"we talked in person"` and `"not now"` widen that contact's threshold; persist in local storage; expose `applyFeedback`.
- [ ] `alerts`: distancing when active ties fall 30%+ vs the previous window or `lsns.atRisk`; active on the reverse.
- [ ] Keep the stream interface generic so a second stream can plug in later without changes; do not build any second stream now.
- **Gate H19:** one real inbox (a consented teammate) end to end on a phone: OAuth -> parse -> upload -> `/circle/summary` -> heatmap and nudge on screen.

## Block 4 (H19-27): second source, privacy controls. Freeze H27.

- [ ] SMS: `parseSmsBackupXml` ("SMS Backup & Restore" export). iMessage: a 20-line script in `tools/imessage_export.py` reading `~/Library/Messages/chat.db` (sqlite) to the event JSON; `parseImessageRows`.
- [ ] Per-contact "forget" and one-tap delete-all (local map + `DELETE /events` if D adds it; otherwise a `[contract]` request).
- [ ] Privacy card copy for onboarding and the demo close: metadata only, never content; parsed in your browser; hashed before it leaves the device; per-contact forget; delete-all; no third party.
- [ ] Stretch only if everything above is done: Android notification listener (Expo dev-client native module). First on the cut list.

## Block 5 (H27-37)

- [ ] Devpost text for the social layer: the seven metrics, the Lubben mapping and its label, the hazard-ratio-to-years line with Holt-Lunstad 2015, the privacy guarantees, the citations table.
- [ ] Prepare the Q&A answers: "isn't this surveillance?", "messaging is not friendship", "how do you get years from a hazard ratio?".

## Your cut order

Android notification listener -> iMessage script -> family/friend tagging (score LSNS combined) -> second inbox in the demo.

## Kickoff prompt (paste into Claude Code in the repo root)

```
Read CLAUDE.md, docs/contracts.md, docs/lanes/B.md and docs/log/B.md. You are the Lane B agent (social engine). Restate in ten lines: what this lane produces, what it consumes, the Block 1 tasks in order, and what the H6 gate requires. Then plan Block 1 task one (parseWhatsApp for both line formats, hashing, tests on fixtures/whatsapp_sample.txt) in plan mode and ask me only the questions that change the design. Message content must never be stored or logged; if you find yourself keeping text past the parser, stop and say so.
```

## Session-restart prompt

```
Read docs/log/B.md and docs/contracts.md. Continue Lane B from the "next" line of the last log entry. Restate the next gate and the next task in three lines, then proceed.
```
