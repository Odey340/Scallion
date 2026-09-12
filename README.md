# Scallion lane kit

`CLAUDE.md` sits at the repo root so every teammate's Claude Code loads it automatically. Each teammate clones this repo, opens Claude Code in the root, and pastes the kickoff prompt from their lane file in `docs/lanes/`.

```
CLAUDE.md              shared context, auto-loaded by Claude Code
docs/contracts.md      the interfaces between lanes; change only by agreement
docs/lanes/A.md        MATLAB engine
docs/lanes/B.md        social engine
docs/lanes/C.md        product
docs/lanes/D.md        platform, labs intake, sponsors
docs/log/<lane>.md     append ten lines at the end of every session
fixtures/              redacted samples only
media/                 20-second screen recordings as features land
```

## How to start a teammate who has no context (five minutes)

1. `git clone`, open Claude Code in the repo root. Do not explain the project by voice; the files do it.
2. Paste the **kickoff prompt** from `docs/lanes/<lane>.md`. It makes the agent read the four files and restate the lane in ten lines before touching code. Read that restatement; if it is wrong, fix the lane file, not the agent.
3. The kickoff prompt ends in plan mode for the first task. Approve the plan, then let it build.
4. Give the agent real inputs immediately: your own WhatsApp export, your redacted lab PDF, the API key. Agents drift when they have to invent data.
5. At the end of every session: "Append the session log to docs/log/<lane>.md: done, blocked, next, contract changes needed." Commit it. The next session starts with the **session-restart prompt**.

## Rules that keep four agents from colliding

- One lane per directory; the agent never edits another lane's directory. Cross-lane needs go through `docs/contracts.md` and a Discord message.
- A contract change is a commit prefixed `[contract]`; everyone pulls and re-reads before continuing.
- Build against the contract with fixtures when the other side is not there yet; leave `TODO(<lane>)`.
- Pull before push; small commits with a lane prefix; no force pushes; no PHI in the repo.
- Gates are team events: H6, H10, H19, H27. At each one, every lane posts "pass / fail / what I need" in Discord.

## Prompting habits that matter this weekend

- Ask the agent to restate before it builds. Ten lines of "what I produce, what I consume, next three tasks, next gate" catches misreadings in thirty seconds.
- Use plan mode for anything that touches a contract or a gate. Skip it for a component or a parser.
- Point at the source of truth by path (`docs/contracts.md` section 1), not by description.
- When the agent proposes a number, a formula or a label, make it cite where it came from (a contract file, an export, a paper in `CLAUDE.md`). Numbers with no source do not ship.
- If the agent starts building another lane's thing, stop it and say "that is Lane X; build against the contract with a stub."
