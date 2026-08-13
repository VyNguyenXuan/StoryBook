# Project context for AI assistants

Book Illustration Pipeline — turns a book's text into character portraits
and chapter illustrations via the Gemini API, following the 5-step
pipeline (Style → Characters → Portraits → Chapters → Illustrations) from
Google's reference notebook.

## Stack

- Backend: Node.js + Express, no framework beyond that.
- Frontend: plain HTML/CSS/JS, no build step, no framework.
- Storage: JSON files on disk, one per user, atomic write-temp-then-rename,
  in-process per-user lock. No database — see DECISIONS.md for why.
- Tests: `node:test` (built-in), zero extra test framework dependency.

## Commands

- `./start.sh` — installs deps if needed, starts the server on :3001.
- `./test.sh` — runs the full backend + frontend-logic test suite.

## How the pipeline works

- A project moves through `status`: CREATED → STYLE_SET →
  CHARACTERS_GENERATED → PORTRAITS_GENERATED → CHAPTERS_GENERATED → DONE.
- `stepState` (IDLE | RUNNING) is separate from `status` — it answers "is
  something in flight right now," which a single enum can't express.
- `stepRunner.js` claims a step (locked, fast) before running the slow,
  possibly-billed provider call (unlocked). Two concurrent requests for the
  same step can't both pass the claim check.
- A step stuck in RUNNING past `STALE_RUNNING_MS` is considered dead and
  can be retried — no manual data editing.

## Working style

- Don't default to agreeing. If a proposed approach has a real cost,
  a simpler alternative, or contradicts something already decided in
  DECISIONS.md, say so — directly, with reasoning, before implementing.
- Silent compliance on a bad call costs more than a 30-second pushback.

## Hard constraints — do not relax these

- **2 characters / 1 chapter caps are hard requirements**, enforced
  server-side in `caps.js`, at two points: once when the model result comes
  back, again defensively right before the billed image call. These bound
  API cost.
- **Never re-send the book's full text on every step.** It's uploaded once
  via the Files API and referenced by URI (`conversationRef`) from then on.
- **Never auto-retry a Gemini call in a loop.** Retries are user-triggered
  only.
- Adults-only character restriction from the reference notebook stays —
  don't relax it.

## Providers

- `providers/mockProvider.js` — free, fast, same response shape as the real
  provider. Default for all dev/test work.
- `providers/geminiProvider.js` — real Gemini calls (REST, not the Python/JS
  SDK). Switch via `GEMINI_PROVIDER=real` in `.env`, requires
  `GEMINI_API_KEY`. **Env changes require a server restart** — it's read
  once at process start in `server.js`, not on every request.
- If you change one provider's interface, mirror the change in the other —
  they must stay swappable with a one-line change in `routes/projects.js`.

## Known-uncertain areas (flag before trusting)

- `geminiProvider.js`'s REST shape for the Files API and multi-turn
  `contents` chaining was written without being able to reach
  ai.google.dev from the dev sandbox — see the file's own header comment.
  Verify against a real key before relying on it; don't assume it's correct
  just because it's committed.
- Files API resumable uploads use `https://generativelanguage.googleapis.com/upload/v1beta`,
  not the plain `v1beta` base — this was a real bug once (see DECISIONS.md).

## Where to look first

- `DECISIONS.md` — real trade-offs, including places AI output was wrong
  and got overridden. 
- `TESTING.md` — what's tested, what isn't, and why.
