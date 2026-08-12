const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { readUserFile, writeUserFile } = require('../src/db');
const pipeline = require('../src/services/pipeline');
const stepRunner = require('../src/services/stepRunner');

const TEST_EMAIL = 'incremental-progress-test@example.com';

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

// Different delays per character (A fast, B slow) so the test can prove two
// things at once: (1) both calls actually run CONCURRENTLY — B's call
// starts immediately, not after A finishes — and (2) each item persists the
// moment IT lands, independent of array order. This matches app-demo.html:
// whichever image finishes first is shown first, instead of the app
// blocking on the slowest item before showing anything.
class SlowProvider {
  async startConversation() {
    return 'conv-1';
  }
  async generatePortrait(conversationRef, character) {
    await delay(character.name === 'A' ? 60 : 400);
    return { mimeType: 'image/png', data: `img-for-${character.name}` };
  }
}

test('portraits land independently as each finishes, not sequentially / not all at once', async () => {
  cleanup();
  const project = pipeline.newProject({ title: 'T', bookText: 'text' });
  project.status = 'CHARACTERS_GENERATED';
  project.characters = [
    { name: 'A', prompt: 'p', portraitReady: false }, // fast (~80ms)
    { name: 'B', prompt: 'p', portraitReady: false }, // slow (~250ms)
  ];
  writeUserFile(TEST_EMAIL, { name: 'Test', email: TEST_EMAIL, projects: [project] });

  // runStep's own returned promise resolves right after the fast, sync
  // "claim" phase — NOT after generation finishes (that continues in the
  // background so the HTTP request returns immediately; see stepRunner's
  // comment on `runStep`). So we don't await it for timing — we poll the
  // persisted file instead, same as a real polling frontend would.
  await stepRunner.runStep(TEST_EMAIL, project.id, 'PORTRAITS', { provider: new SlowProvider() });

  // Comfortably after A's delay but well before B's: A should already be
  // ready, B should not. If the two calls were still sequential (old
  // behavior), B wouldn't even have STARTED yet at this point — this window
  // specifically rules that out. Margins are wide on purpose since node
  // --test runs files in parallel and timer jitter under load is real.
  await delay(200);
  const midway = readProject(project.id);
  assert.equal(midway.characters[0].portraitReady, true, 'fast item (A) should have landed already');
  assert.equal(midway.characters[1].portraitReady, false, 'slow item (B) should still be in progress');
  assert.equal(midway.stepState, 'RUNNING', 'step should still be running overall');

  await delay(400);
  const finished = readProject(project.id);
  assert.equal(finished.characters[1].portraitReady, true);
  assert.equal(finished.stepState, 'IDLE');
  assert.equal(finished.status, 'PORTRAITS_GENERATED');

  cleanup();
});
