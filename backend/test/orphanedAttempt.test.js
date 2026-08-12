const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { readUserFile, writeUserFile } = require('../src/db');
const pipeline = require('../src/services/pipeline');
const stepRunner = require('../src/services/stepRunner');

const TEST_EMAIL = 'orphaned-attempt-test@example.com';

function userFilePath() {
  return path.join(__dirname, '..', 'data', 'users', `${encodeURIComponent(TEST_EMAIL)}.json`);
}
function cleanup() {
  const p = userFilePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function readProject(projectId) {
  const userData = readUserFile(TEST_EMAIL);
  return userData.projects.find((p) => p.id === projectId);
}
async function waitUntil(predicate, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(intervalMs);
  }
  throw new Error('waitUntil timed out');
}

// A provider whose generateStyle() call hangs until manually released —
// simulates a real network call that's still technically alive (not
// actually dead), which is the exact scenario a fixed timeout can't
// distinguish from a truly-crashed call. This is precisely why the guard
// has to be an attempt-token check, not just a longer timeout.
class DeferredProvider {
  constructor(label) {
    this.label = label;
    this._release = null;
  }
  async startConversation() {
    return `conv-${this.label}`;
  }
  generateStyle() {
    return new Promise((resolve) => {
      this._release = resolve;
    });
  }
  release(style) {
    if (this._release) this._release({ style });
  }
}

const FastProvider = {
  async startConversation() {
    return 'conv-fast';
  },
  async generateStyle() {
    return { style: 'NEW STYLE (from the recovered attempt)' };
  },
};

test('an orphaned attempt, resolving after a stale-retry has already succeeded, does not overwrite the new result', async () => {
  cleanup();
  const project = pipeline.newProject({ title: 'T', bookText: 'text' });
  writeUserFile(TEST_EMAIL, { name: 'Test', email: TEST_EMAIL, projects: [project] });

  // --- Attempt 1: starts, but its provider call hangs indefinitely ---
  const oldProvider = new DeferredProvider('old');
  await stepRunner.runStep(TEST_EMAIL, project.id, 'STYLE', { provider: oldProvider });

  let inFlight = readProject(project.id);
  assert.equal(inFlight.stepState, 'RUNNING');
  const oldAttemptId = inFlight.stepAttemptId;

  // --- Simulate it going stale (server "died" from the outside world's
  // point of view — but in THIS process, oldProvider's promise is still
  // very much alive and will resolve later) ---
  const userData = readUserFile(TEST_EMAIL);
  const p = userData.projects.find((x) => x.id === project.id);
  p.stepStartedAt = Date.now() - (pipeline.STALE_RUNNING_MS + 1000);
  writeUserFile(TEST_EMAIL, userData);

  // --- User hits "recover & retry": clears the stale flag, then re-runs
  // the SAME step with a fast provider that succeeds immediately ---
  await stepRunner.retryStaleStep(TEST_EMAIL, project.id);
  await stepRunner.runStep(TEST_EMAIL, project.id, 'STYLE', { provider: FastProvider });

  await waitUntil(() => readProject(project.id).status === 'STYLE_SET');
  const afterRecovery = readProject(project.id);
  assert.equal(afterRecovery.style, 'NEW STYLE (from the recovered attempt)');
  assert.notEqual(afterRecovery.stepAttemptId, oldAttemptId, 'a fresh attempt id must have been issued');
  const newAttemptId = afterRecovery.stepAttemptId;

  // --- NOW the original, long-abandoned call finally resolves. Without the
  // attempt-token guard, this would silently overwrite the correct style
  // that the recovered attempt already persisted. ---
  oldProvider.release('OLD STYLE (must be discarded, not applied)');
  await delay(150); // give the orphaned promise's .catch/write chain a moment to run, if it were going to

  const final = readProject(project.id);
  assert.equal(
    final.style,
    'NEW STYLE (from the recovered attempt)',
    'the orphaned attempt must NOT have overwritten the recovered attempt\'s result'
  );
  assert.equal(final.status, 'STYLE_SET');
  assert.equal(final.stepAttemptId, newAttemptId, 'attempt id must be unchanged by the orphaned call');

  cleanup();
});

test('an orphaned attempt that FAILS after being superseded does not mark the new attempt as failed', async () => {
  cleanup();
  const project = pipeline.newProject({ title: 'T', bookText: 'text' });
  writeUserFile(TEST_EMAIL, { name: 'Test', email: TEST_EMAIL, projects: [project] });

  class RejectingDeferredProvider extends DeferredProvider {
    generateStyle() {
      return new Promise((_, reject) => {
        this._release = reject;
      });
    }
    reject(err) {
      if (this._release) this._release(err);
    }
  }

  const oldProvider = new RejectingDeferredProvider('old');
  await stepRunner.runStep(TEST_EMAIL, project.id, 'STYLE', { provider: oldProvider });

  const userData = readUserFile(TEST_EMAIL);
  const p = userData.projects.find((x) => x.id === project.id);
  p.stepStartedAt = Date.now() - (pipeline.STALE_RUNNING_MS + 1000);
  writeUserFile(TEST_EMAIL, userData);

  await stepRunner.retryStaleStep(TEST_EMAIL, project.id);
  await stepRunner.runStep(TEST_EMAIL, project.id, 'STYLE', { provider: FastProvider });
  await waitUntil(() => readProject(project.id).status === 'STYLE_SET');

  // The old attempt finally errors out — must not retroactively mark the
  // now-successful step as failed.
  oldProvider.reject(new Error('old attempt: connection reset'));
  await delay(150);

  const final = readProject(project.id);
  assert.equal(final.status, 'STYLE_SET', 'a successful newer attempt must not be reverted to failed by an orphaned rejection');
  assert.equal(final.lastError, null);

  cleanup();
});
