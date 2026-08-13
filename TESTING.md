# Testing

## Strategy

**Backend — unit + integration, `node:test` (built-in, zero extra deps):**

- `test/pipeline.test.js` — the state machine in isolation. Order
  enforcement, the duplicate-claim guard, stale detection, retry-without-
  data-loss, completion. This is the highest-value test file in the repo:
  it's the exact logic §4.3 grades ("resumable," "no duplicate calls,"
  "failures are retryable"), and it needs zero network/API dependency to
  verify — every case is a plain object mutation.
- `test/caps.test.js` — the 2-character/1-chapter truncation function in
  isolation.
- `test/capEnforcement.integration.test.js` — proves the cap actually holds
  when wired through `stepRunner`, using a provider that deliberately
  returns more items than allowed. This matters more than the unit test
  above: it confirms the *billed* provider call itself is never invoked
  more than the cap allows, not just that the stored data looks right
  afterward.
- `test/incrementalProgress.test.js` — proves portraits/illustrations are
  persisted one at a time (checks project state *mid-step*, using an
  artificially slow mock provider), not just that the final result is
  correct. This is the test for the requirement I initially shortcut and
  then fixed — see `DECISIONS.md`.
- `test/frontend/helpers.test.js` — pure frontend logic (status→label
  mapping, step-class computation, email validation), extracted from
  `app.js` into `frontend/helpers.js` specifically so it has no DOM
  dependency and can run under Node directly. Node's test runner picks this
  up automatically since it's inside `backend/test/`.

**What I deliberately did NOT write tests for:** the Express route handlers
themselves (thin — they mostly parse params and call `stepRunner`/
`pipeline`, which are already covered), and the real Gemini provider (not
yet built against a live key at the time of writing — see `DECISIONS.md`
on the billing situation). The DOM-rendering half of `app.js` (actual
`render()`/click-handler wiring) has no automated test — see "known gaps"
below.

**Manual, real-HTTP smoke tests (not committed as automated tests, but
genuinely run, not invented):**
- Fired two concurrent `curl` requests at the same step on a live server —
  confirmed one gets `202` (RUNNING) and the other gets `409
  ALREADY_RUNNING`.
- Ran a full 5-step pipeline through real HTTP end-to-end against the mock
  provider — confirmed final state reaches `status: DONE` with both
  portraits and the one chapter illustration marked ready.
- Verified static file serving (`index.html`, `app.js`, `helpers.js`,
  `styles.css`) all return `200` from the same Express process.

**Nice-to-have I did not build:** a single committed integration test
running the full 5-step pipeline in one assertion chain against the mock
provider (§5.4's suggestion). The manual smoke test above covers the same
ground but isn't repeatable/CI-able. Listed honestly in `DECISIONS.md`
under "if I had one more day."

## Known gaps

- No automated test actually exercises `app.js`'s DOM rendering — no
  headless-browser test (e.g. Playwright) is set up, and I have not
  personally clicked through the five required screens in a real browser
  either (the environment used to build this has no browser available).
  The logic feeding those screens is unit-tested (`helpers.test.js`) and
  static file serving is confirmed working over real HTTP, but the actual
  rendered UI is unverified as of writing this file. **Action needed before
  submission:** run `./start.sh` and manually click through Identity → New
  Project → all 5 pipeline steps → error/retry/stuck states, and fix
  whatever doesn't look right — this is real, not a formality.
- The real Gemini provider (as opposed to the mock) has no test coverage
  at the time of writing this file, since building it depends on the
  billing situation described in `DECISIONS.md`.

## Test report (real run, `node --test`, full output in `test-report.txt`)

```
# tests 33
# suites 0
# pass 33
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Full TAP output: see `test-report.txt` at the repo root — every individual
test name and duration, not just the summary above.
