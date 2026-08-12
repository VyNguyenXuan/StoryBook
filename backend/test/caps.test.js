const test = require('node:test');
const assert = require('node:assert/strict');
const caps = require('../src/services/caps');

test('enforceCharacterCap leaves 2 or fewer characters untouched', () => {
  const result = caps.enforceCharacterCap([{ name: 'A' }, { name: 'B' }]);
  assert.equal(result.items.length, 2);
  assert.equal(result.wasTruncated, false);
});

test('enforceCharacterCap truncates 3+ characters down to 2', () => {
  const result = caps.enforceCharacterCap([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((c) => c.name), ['A', 'B']);
  assert.equal(result.wasTruncated, true);
});

test('enforceChapterCap truncates 2+ chapters down to 1', () => {
  const result = caps.enforceChapterCap([{ name: 'Ch1' }, { name: 'Ch2' }]);
  assert.equal(result.items.length, 1);
  assert.equal(result.wasTruncated, true);
});

test('enforceCap throws on non-array input rather than silently coercing', () => {
  assert.throws(() => caps.enforceCap(null, 2));
  assert.throws(() => caps.enforceCap(undefined, 2));
});

test('caps are exactly 2 characters / 1 chapter, matching §03', () => {
  assert.equal(caps.CHARACTER_CAP, 2);
  assert.equal(caps.CHAPTER_CAP, 1);
});
