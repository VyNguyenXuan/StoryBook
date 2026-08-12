const test = require('node:test');
const assert = require('node:assert/strict');
const pipeline = require('../src/services/pipeline');

test('newProject starts at CREATED / IDLE', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  assert.equal(p.status, 'CREATED');
  assert.equal(p.stepState, 'IDLE');
  assert.equal(p.conversationRef, null);
});

test('claimStep enforces order: cannot skip ahead', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  assert.throws(() => pipeline.claimStep(p, 'CHARACTERS'), (err) => err.code === 'OUT_OF_ORDER');
});

test('claimStep succeeds for the correct next step and flips to RUNNING', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  const step = pipeline.claimStep(p, 'STYLE');
  assert.equal(step.key, 'STYLE');
  assert.equal(p.stepState, 'RUNNING');
  assert.ok(p.stepStartedAt);
});

test('claimStep rejects a second concurrent call for the same step (no duplicate calls)', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  pipeline.claimStep(p, 'STYLE');
  assert.throws(() => pipeline.claimStep(p, 'STYLE'), (err) => err.code === 'ALREADY_RUNNING');
});

test('completeStep advances status and resets stepState', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  pipeline.claimStep(p, 'STYLE');
  pipeline.completeStep(p, 'STYLE', { style: 'watercolour' });
  assert.equal(p.status, 'STYLE_SET');
  assert.equal(p.stepState, 'IDLE');
  assert.equal(p.style, 'watercolour');
});

test('full happy path advances through all five steps to DONE', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });

  pipeline.claimStep(p, 'STYLE');
  pipeline.completeStep(p, 'STYLE', { style: 'watercolour' });

  pipeline.claimStep(p, 'CHARACTERS');
  pipeline.completeStep(p, 'CHARACTERS', {
    characters: [{ name: 'A', prompt: 'p1' }, { name: 'B', prompt: 'p2' }],
  });
  assert.equal(p.characters.length, 2);
  assert.equal(p.characters[0].portraitReady, false);

  pipeline.claimStep(p, 'PORTRAITS');
  // Mirrors the real flow (stepRunner.runIncrementalItemStep): each item is
  // written directly to the project record as it lands (now via imageStore
  // — see imageStore.test.js — but pipeline.js itself doesn't care what
  // shape the image reference is), THEN finishStep closes out the step.
  // pipeline.js never bulk-applies image results — that dead path was
  // removed from completeStep once the incremental flow replaced it.
  p.characters[0].portraitReady = true;
  p.characters[0].portraitImage = { url: '/images/fake/char-0.png' };
  p.characters[1].portraitReady = true;
  p.characters[1].portraitImage = { url: '/images/fake/char-1.png' };
  pipeline.finishStep(p, 'PORTRAITS');
  assert.equal(p.characters[0].portraitReady, true);
  assert.equal(p.characters[1].portraitReady, true);

  pipeline.claimStep(p, 'CHAPTERS');
  pipeline.completeStep(p, 'CHAPTERS', {
    chapters: [{ name: 'Opening', prompt: 'p3', characters: ['A', 'B'] }],
  });

  pipeline.claimStep(p, 'ILLUSTRATIONS');
  p.chapters[0].illustrationReady = true;
  p.chapters[0].illustrationImage = { url: '/images/fake/ch-0.png' };
  pipeline.finishStep(p, 'ILLUSTRATIONS');

  assert.equal(p.status, 'DONE');
  assert.equal(pipeline.nextRunnableStep(p), null);
});

test('caps (2 characters / 1 chapter) are NOT this module\'s job — documented boundary', () => {
  // pipeline.js has no opinion on array length; §03's hard caps must be
  // enforced wherever characters/chapters arrays are built (route or
  // provider layer). That enforcement needs its own test once that layer
  // exists — flagged here so it doesn't get silently forgotten.
  assert.ok(true);
});

test('isStale is false for a freshly claimed step', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  pipeline.claimStep(p, 'STYLE');
  assert.equal(pipeline.isStale(p), false);
});

test('isStale is true once STALE_RUNNING_MS has elapsed', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  pipeline.claimStep(p, 'STYLE');
  p.stepStartedAt = Date.now() - (pipeline.STALE_RUNNING_MS + 1000);
  assert.equal(pipeline.isStale(p), true);
});

test('claimStep on a stale step throws STALE, not ALREADY_RUNNING', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  pipeline.claimStep(p, 'STYLE');
  p.stepStartedAt = Date.now() - (pipeline.STALE_RUNNING_MS + 1000);
  assert.throws(() => pipeline.claimStep(p, 'STYLE'), (err) => err.code === 'STALE');
});

test('clearStaleStep resets state without touching status or generated data', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  p.status = 'STYLE_SET'; // pretend STYLE already completed
  pipeline.claimStep(p, 'CHARACTERS');
  p.stepStartedAt = Date.now() - (pipeline.STALE_RUNNING_MS + 1000);

  pipeline.clearStaleStep(p);

  assert.equal(p.stepState, 'IDLE');
  assert.equal(p.stepStartedAt, null);
  assert.equal(p.status, 'STYLE_SET'); // unchanged — nothing lost
});

test('clearStaleStep refuses to clear a step that is not actually stale', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  pipeline.claimStep(p, 'STYLE'); // fresh, not stale
  assert.throws(() => pipeline.clearStaleStep(p), (err) => err.code === 'NOT_STALE');
});

test('failStep resets stepState for retry, without touching status', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  p.status = 'STYLE_SET';
  pipeline.claimStep(p, 'CHARACTERS');

  pipeline.failStep(p, 'Gemini returned 429');

  assert.equal(p.stepState, 'IDLE');
  assert.equal(p.status, 'STYLE_SET');
  assert.equal(p.lastError, 'Gemini returned 429');

  const step = pipeline.claimStep(p, 'CHARACTERS'); // same step is claimable again
  assert.equal(step.key, 'CHARACTERS');
});

test('claimStep on a DONE project throws DONE', () => {
  const p = pipeline.newProject({ title: 'T', bookText: 'text' });
  p.status = 'DONE';
  assert.throws(() => pipeline.claimStep(p, 'ILLUSTRATIONS'), (err) => err.code === 'DONE');
});
