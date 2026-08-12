const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../../../frontend/helpers');

test('currentStep returns STYLE for a freshly created project', () => {
  assert.equal(h.currentStep({ status: 'CREATED' }), 'STYLE');
});

test('currentStep returns null once DONE', () => {
  assert.equal(h.currentStep({ status: 'DONE' }), null);
});

test('currentStep tracks each intermediate status correctly', () => {
  assert.equal(h.currentStep({ status: 'STYLE_SET' }), 'CHARACTERS');
  assert.equal(h.currentStep({ status: 'CHARACTERS_GENERATED' }), 'PORTRAITS');
  assert.equal(h.currentStep({ status: 'PORTRAITS_GENERATED' }), 'CHAPTERS');
  assert.equal(h.currentStep({ status: 'CHAPTERS_GENERATED' }), 'ILLUSTRATIONS');
});

test('overallStatusLabel: Draft / In progress / Done', () => {
  assert.equal(h.overallStatusLabel({ status: 'CREATED' }), 'Draft');
  assert.equal(h.overallStatusLabel({ status: 'CHARACTERS_GENERATED' }), 'In progress');
  assert.equal(h.overallStatusLabel({ status: 'DONE' }), 'Done');
});

test('stepClass marks earlier steps done and the active one current', () => {
  const p = { status: 'CHARACTERS_GENERATED', stepState: 'IDLE' };
  assert.equal(h.stepClass(p, 'STYLE'), 'done');
  assert.equal(h.stepClass(p, 'CHARACTERS'), 'done');
  assert.equal(h.stepClass(p, 'PORTRAITS'), 'current');
  assert.equal(h.stepClass(p, 'CHAPTERS'), '');
});

test('stepClass shows error when the current step has a lastError', () => {
  const p = { status: 'STYLE_SET', stepState: 'IDLE', lastError: 'Gemini 429' };
  assert.equal(h.stepClass(p, 'CHARACTERS'), 'error');
});

test('stepClass shows error (not "current") when the running step is stale', () => {
  const p = { status: 'STYLE_SET', stepState: 'RUNNING', isStale: true };
  assert.equal(h.stepClass(p, 'CHARACTERS'), 'error');
});

test('stepClass shows plain "current" when running and not stale', () => {
  const p = { status: 'STYLE_SET', stepState: 'RUNNING', isStale: false };
  assert.equal(h.stepClass(p, 'CHARACTERS'), 'current');
});

test('isValidEmail rejects obviously malformed input', () => {
  assert.equal(h.isValidEmail('not-an-email'), false);
  assert.equal(h.isValidEmail(''), false);
  assert.equal(h.isValidEmail('a@b'), false);
});

test('isValidEmail accepts a normal address', () => {
  assert.equal(h.isValidEmail('vy@example.com'), true);
});
