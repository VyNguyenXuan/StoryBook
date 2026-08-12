// Hard caps from §03 of the assessment: max 2 characters, max 1 chapter.
// These exist to bound API cost per submission — so enforcement has to sit
// wherever a billed image call could fire, not just in the UI (a direct API
// call, a buggy prompt, or a model that ignores instructions could all
// produce more items than asked for).
const CHARACTER_CAP = 2;
const CHAPTER_CAP = 1;

// Truncates `items` to `cap` length. Returns both the truncated array and
// whether truncation happened, so the caller can decide whether to log/flag
// it (e.g. surfaced in lastWarning) without that decision living in here.
function enforceCap(items, cap) {
  if (!Array.isArray(items)) {
    throw new Error('enforceCap expected an array');
  }
  if (items.length <= cap) {
    return { items, wasTruncated: false };
  }
  return { items: items.slice(0, cap), wasTruncated: true };
}

function enforceCharacterCap(characters) {
  return enforceCap(characters, CHARACTER_CAP);
}

function enforceChapterCap(chapters) {
  return enforceCap(chapters, CHAPTER_CAP);
}

module.exports = { CHARACTER_CAP, CHAPTER_CAP, enforceCap, enforceCharacterCap, enforceChapterCap };
