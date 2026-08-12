const { v4: uuid } = require('uuid');

// Mirrors the reference demo's STEPS array — same status vocabulary, so the
// contract is easy to sanity-check against app-demo.html by eye.
const STEPS = [
  { key: 'STYLE', label: 'Style', status: 'STYLE_SET' },
  { key: 'CHARACTERS', label: 'Characters', status: 'CHARACTERS_GENERATED' },
  { key: 'PORTRAITS', label: 'Portraits', status: 'PORTRAITS_GENERATED' },
  { key: 'CHAPTERS', label: 'Chapters', status: 'CHAPTERS_GENERATED' },
  { key: 'ILLUSTRATIONS', label: 'Illustrations', status: 'DONE' },
];
const STATUS_ORDER = ['CREATED', ...STEPS.map((s) => s.status)];

function statusIndex(status) {
  return STATUS_ORDER.indexOf(status);
}

function stepForKey(stepKey) {
  const step = STEPS.find((s) => s.key === stepKey);
  if (!step) throw new Error(`Unknown step: ${stepKey}`);
  return step;
}

// A step is only runnable if it's exactly the next one in sequence. This is
// the server-side version of what the spec's §4.3 "can't run before previous
// steps succeeded" requires — the demo enforces this only via which button
// happens to render, which is not enforcement at all from an API's
// perspective (nothing stops a direct fetch to a later step).
function nextRunnableStep(project) {
  const idx = statusIndex(project.status);
  if (idx === STATUS_ORDER.length - 1) return null; // DONE
  return STEPS[idx];
}

// How long a step can sit in RUNNING before we treat it as abandoned (server
// died mid-call, process was killed, etc.) and let the user retry. Set well
// above real Gemini latency (spec says 10-30s+, longer for images) so we
// never flag a step that's merely slow as "stuck".
const STALE_RUNNING_MS = 90_000;

function isStale(project) {
  return (
    project.stepState === 'RUNNING' &&
    project.stepStartedAt &&
    Date.now() - project.stepStartedAt > STALE_RUNNING_MS
  );
}

function newProject({ title, bookText }) {
  return {
    id: uuid(),
    title,
    bookText,
    createdAt: Date.now(),
    status: 'CREATED',
    style: null,
    characters: [],
    chapters: [],
    stepState: 'IDLE',
    stepStartedAt: null,
    // Bumped to a fresh id every time claimStep() succeeds. Lets an async
    // provider call, once it finally resolves/rejects, tell "I'm still the
    // current attempt" apart from "a stale-step retry has since superseded
    // me" — see stepRunner.js for why this matters.
    stepAttemptId: null,
    lastError: null,
    lastWarning: null,
    // Set once, on first Gemini call, and reused for every later step —
    // this is the handle for "send book content once" (§4.3). What it holds
    // (e.g. a chat/interaction id) is provider-specific, so the pipeline
    // layer treats it as an opaque token.
    conversationRef: null,
  };
}

// Attempts to claim a step for execution. Returns the step to run, or throws
// a typed error the route layer can turn into the right HTTP status:
//   - ALREADY_RUNNING (409): a call for this exact step is already in
//     flight — this is the no-duplicate-calls guard from §4.3. The route
//     layer should NOT call the provider in this case; it just returns the
//     current in-flight state.
//   - OUT_OF_ORDER (409): caller asked for a step that isn't the next one.
//   - STALE (409): the step is marked RUNNING but has been for too long;
//     caller should hit the retry endpoint instead, which clears it first.
//   - DONE (409): nothing left to run.
// This function ONLY flips stepState to RUNNING — it does not call any
// Gemini provider. That keeps this module testable with zero network/API
// dependency, per §5.4.
function claimStep(project, requestedStepKey) {
  const next = nextRunnableStep(project);
  if (!next) {
    const err = new Error('Pipeline already complete.');
    err.code = 'DONE';
    throw err;
  }
  if (requestedStepKey !== next.key) {
    const err = new Error(
      `Step ${requestedStepKey} requested but ${next.key} is next.`
    );
    err.code = 'OUT_OF_ORDER';
    throw err;
  }
  if (project.stepState === 'RUNNING') {
    if (isStale(project)) {
      const err = new Error(
        `Step ${next.key} is stuck (running since ${new Date(
          project.stepStartedAt
        ).toISOString()}). Retry it explicitly.`
      );
      err.code = 'STALE';
      throw err;
    }
    const err = new Error(`Step ${next.key} is already in progress.`);
    err.code = 'ALREADY_RUNNING';
    throw err;
  }

  // Clear any leftover error/warning from a previous attempt at this step —
  // otherwise a successful retry would still show a stale error banner.
  project.lastError = null;
  project.lastWarning = null;

  // A fresh attempt id invalidates any still-in-flight promise from a PRIOR
  // attempt at this step (e.g. one that got stale-recovered past). When that
  // old call eventually settles, stepRunner checks its captured attemptId
  // against project.stepAttemptId and discards the result if they no longer
  // match, instead of clobbering whatever this new attempt does.
  project.stepAttemptId = uuid();

  project.stepState = 'RUNNING';
  project.stepStartedAt = Date.now();
  return next;
}

// Clears a stuck step so the *same* step can be claimed again. Deliberately
// does NOT touch project.status — nothing generated before this step is
// lost, matching the demo's "retryStuckStep" behaviour and the spec's
// "failed step leaves the project usable" rule.
function clearStaleStep(project) {
  if (!isStale(project)) {
    const err = new Error('Step is not stale — nothing to clear.');
    err.code = 'NOT_STALE';
    throw err;
  }
  project.stepState = 'IDLE';
  project.stepStartedAt = null;
}

// Applies a successfully-completed step's result to the project and advances
// status. Used by STYLE/CHARACTERS/CHAPTERS, where the provider returns
// everything at once. PORTRAITS/ILLUSTRATIONS do NOT go through here — their
// items are persisted incrementally as each one lands (stepRunner.js), so by
// the time their step closes out, the data's already in place; see
// finishStep below for that path.
function completeStep(project, stepKey, result) {
  const step = stepForKey(stepKey);
  if (stepKey === 'STYLE') {
    project.style = result.style;
  } else if (stepKey === 'CHARACTERS') {
    project.characters = result.characters.map((c) => ({
      ...c,
      portraitReady: false,
    }));
  } else if (stepKey === 'CHAPTERS') {
    project.chapters = result.chapters.map((c) => ({
      ...c,
      illustrationReady: false,
    }));
  }
  project.status = step.status;
  project.stepState = 'IDLE';
  project.stepStartedAt = null;
}

// Advances status/stepState only, WITHOUT touching characters/chapters data.
// Used by PORTRAITS/ILLUSTRATIONS, where each item is persisted incrementally
// as it completes (see stepRunner.js) — by the time this runs, the data is
// already in place; this just closes out the step.
function finishStep(project, stepKey) {
  const step = stepForKey(stepKey);
  project.status = step.status;
  project.stepState = 'IDLE';
  project.stepStartedAt = null;
}

// Marks a real (non-stale) failure: the provider call threw. Keeps status
// unchanged (nothing before this step is affected) but resets stepState so
// the SAME step becomes claimable again on retry — this is what makes
// "failed step leaves project usable, retry that step only" (§4.3) true.
function failStep(project, errorMessage) {
  project.stepState = 'IDLE';
  project.stepStartedAt = null;
  project.lastError = errorMessage;
}

module.exports = {
  STEPS,
  STATUS_ORDER,
  statusIndex,
  nextRunnableStep,
  isStale,
  STALE_RUNNING_MS,
  newProject,
  claimStep,
  clearStaleStep,
  completeStep,
  finishStep,
  failStep,
};
