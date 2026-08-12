const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { readUserFile, writeUserFile } = require('../src/db');
const pipeline = require('../src/services/pipeline');
const stepRunner = require('../src/services/stepRunner');

const TEST_EMAIL = 'cap-enforcement-test@example.com';

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

// Polls the stored project until its step finishes (stepState back to IDLE)
// or a timeout elapses — same shape as how a real frontend would poll
// GET /projects/:id after firing a step.
async function waitForStepToFinish(projectId, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const userData = readUserFile(TEST_EMAIL);
    const project = userData.projects.find((p) => p.id === projectId);
    if (project.stepState !== 'RUNNING') return project;
    await delay(intervalMs);
  }
  throw new Error('Timed out waiting for step to finish');
}

// A provider that deliberately misbehaves — returns 3 characters and 2
// chapters, both over cap — to prove enforcement happens regardless of what
// the model (mock or real) hands back.
class MisbehavingProvider {
  async startConversation() {
    return 'conv-1';
  }
  async generateCharacters() {
    return {
      characters: [
        { name: 'A', prompt: 'p' },
        { name: 'B', prompt: 'p' },
        { name: 'C', prompt: 'p' }, // over the 2-character cap
      ],
    };
  }
  async generatePortrait(conversationRef, character) {
    this.portraitCallCount = (this.portraitCallCount || 0) + 1;
    return { mimeType: 'image/png', data: 'x' };
  }
  async generateChapters() {
    return {
      chapters: [
        { name: 'Ch1', prompt: 'p' },
        { name: 'Ch2', prompt: 'p' }, // over the 1-chapter cap
      ],
    };
  }
  async generateIllustration(conversationRef, chapter) {
    this.illustrationCallCount = (this.illustrationCallCount || 0) + 1;
    return { mimeType: 'image/png', data: 'x' };
  }
  async generateStyle() {
    return { style: 'test style' };
  }
}

test('CHARACTERS step truncates an over-cap provider response to 2, and flags lastWarning', async () => {
  cleanup();
  const project = pipeline.newProject({ title: 'T', bookText: 'text' });
  project.status = 'STYLE_SET'; // pretend STYLE already ran
  writeUserFile(TEST_EMAIL, { name: 'Test', email: TEST_EMAIL, projects: [project] });

  const provider = new MisbehavingProvider();
  await stepRunner.runStep(TEST_EMAIL, project.id, 'CHARACTERS', { provider });

  const finished = await waitForStepToFinish(project.id);
  assert.equal(finished.characters.length, 2, 'characters array must be capped at 2');
  assert.deepEqual(finished.characters.map((c) => c.name), ['A', 'B']);
  assert.match(finished.lastWarning, /CHARACTERS.*dropped/);

  cleanup();
});

test('PORTRAITS step only requests images for the capped character list, not the raw provider output', async () => {
  cleanup();
  const project = pipeline.newProject({ title: 'T', bookText: 'text' });
  project.status = 'CHARACTERS_GENERATED';
  // Simulate 3 characters somehow ending up stored (e.g. hypothetical past
  // bug, or manual data edit) — PORTRAITS must still only bill for 2.
  project.characters = [
    { name: 'A', prompt: 'p', portraitReady: false },
    { name: 'B', prompt: 'p', portraitReady: false },
    { name: 'C', prompt: 'p', portraitReady: false },
  ];
  writeUserFile(TEST_EMAIL, { name: 'Test', email: TEST_EMAIL, projects: [project] });

  const provider = new MisbehavingProvider();
  await stepRunner.runStep(TEST_EMAIL, project.id, 'PORTRAITS', { provider });
  await waitForStepToFinish(project.id);

  assert.equal(
    provider.portraitCallCount,
    2,
    'the billed provider call must never be asked to generate more than the cap, regardless of stored data'
  );

  cleanup();
});

test('CHAPTERS step truncates an over-cap provider response to 1', async () => {
  cleanup();
  const project = pipeline.newProject({ title: 'T', bookText: 'text' });
  project.status = 'PORTRAITS_GENERATED';
  writeUserFile(TEST_EMAIL, { name: 'Test', email: TEST_EMAIL, projects: [project] });

  const provider = new MisbehavingProvider();
  await stepRunner.runStep(TEST_EMAIL, project.id, 'CHAPTERS', { provider });
  const finished = await waitForStepToFinish(project.id);

  assert.equal(finished.chapters.length, 1, 'chapters array must be capped at 1');

  cleanup();
});
