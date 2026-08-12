// Pure, DOM-free helpers. Kept separate from app.js on purpose: this file
// has no `document`/`window` references, so it can be required directly by
// node:test in test/frontend/ without a browser or DOM shim. app.js pulls
// these in via a plain <script> tag (both load in the browser, in order).

const STEP_ORDER = ['STYLE', 'CHARACTERS', 'PORTRAITS', 'CHAPTERS', 'ILLUSTRATIONS'];
const STATUS_ORDER = ['CREATED', 'STYLE_SET', 'CHARACTERS_GENERATED', 'PORTRAITS_GENERATED', 'CHAPTERS_GENERATED', 'DONE'];

function statusIndex(status) {
  return STATUS_ORDER.indexOf(status);
}

// Which step is "current" (next to run) for a project, or null if done.
function currentStep(project) {
  const idx = statusIndex(project.status);
  if (idx === -1 || idx === STATUS_ORDER.length - 1) return null;
  return STEP_ORDER[idx];
}

// Maps a project to the coarse pill shown in the project list: Draft /
// In progress / Done. "Draft" = nothing generated yet; "Done" = pipeline
// complete; everything else (including a currently-running or
// just-failed step) counts as "In progress".
function overallStatusLabel(project) {
  if (project.status === 'DONE') return 'Done';
  if (project.status === 'CREATED') return 'Draft';
  return 'In progress';
}

function overallStatusClass(project) {
  if (project.status === 'DONE') return 'pill-done';
  if (project.status === 'CREATED') return 'pill-draft';
  return 'pill-progress';
}

// Per-step class for the 5-segment stepper: done / current / pending.
// A step counts as "done" once the project's status has advanced past it.
function stepClass(project, stepKey) {
  const stepIdx = STEP_ORDER.indexOf(stepKey);
  const projectIdx = statusIndex(project.status);
  if (projectIdx > stepIdx) return 'done';
  if (projectIdx === stepIdx) {
    if (project.stepState === 'RUNNING') return project.isStale ? 'error' : 'current';
    if (project.lastError) return 'error';
    return 'current';
  }
  return '';
}

// Same idea, but for the small 5-tick progress indicator in the list view —
// only needs done/current/pending, no error distinction (list view doesn't
// poll live state).
function miniStepClass(project, stepKey) {
  const stepIdx = STEP_ORDER.indexOf(stepKey);
  const projectIdx = statusIndex(project.status);
  if (projectIdx > stepIdx) return 'done';
  if (projectIdx === stepIdx && project.status !== 'DONE') return 'current';
  return '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Node's CommonJS export path (used by tests) vs plain browser global
// (used by app.js via a normal <script> tag, no bundler/module system).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STEP_ORDER,
    STATUS_ORDER,
    statusIndex,
    currentStep,
    overallStatusLabel,
    overallStatusClass,
    stepClass,
    miniStepClass,
    isValidEmail,
    formatDate,
  };
}
