const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'users');

// One JSON file per user (keyed by lowercased email) — isolates state per
// user on disk, per spec §5.2.
function userFilePath(email) {
  const safe = email.toLowerCase().trim();
  return path.join(DATA_DIR, `${encodeURIComponent(safe)}.json`);
}

// Atomic write: write to a temp file, then rename over the target. A crash
// mid-write leaves either the old file intact or the new one fully written —
// never a half-written, corrupt JSON file. This is the concrete answer to
// "safe against concurrent or overlapping writes" from §5.2.
function writeUserFile(email, data) {
  const target = userFilePath(email);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
}

function readUserFile(email) {
  const target = userFilePath(email);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    throw new Error(`Corrupt user data file for ${email}: ${e.message}`);
  }
}

// ---- per-user in-process lock ----
// Atomic file rename protects against corruption, but NOT against two
// concurrent requests both reading stepState=IDLE before either has written
// RUNNING back (a classic check-then-act race). Two async request handlers
// can interleave between an `await` and the next line even in a
// single-threaded Node process. This lock serializes all read-modify-write
// sequences for a given user so that race can't happen.
//
// Stated limitation for DECISIONS.md: this lock is in-memory and
// per-process. It does NOT protect against two separate server instances
// writing the same user file. Accepted gap at this scope (single local
// process) — the reason a real DB with row-level locking would be the
// obvious next step if this ever needed to scale horizontally.
const userLocks = new Map(); // email -> promise chain tail

function withUserLock(email, fn) {
  const key = email.toLowerCase().trim();
  const prev = userLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn); // run fn regardless of prior success/failure
  userLocks.set(key, next.catch(() => {})); // keep chain alive past rejections
  return next;
}

module.exports = { readUserFile, writeUserFile, withUserLock };
