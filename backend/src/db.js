const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'users');

// One JSON file per user (keyed by lowercased email)
function userFilePath(email) {
  const safe = email.toLowerCase().trim();
  return path.join(DATA_DIR, `${encodeURIComponent(safe)}.json`);
}

// Atomic write: write to a temp file, then rename over the target.
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

const userLocks = new Map();

function withUserLock(email, fn) {
  const key = email.toLowerCase().trim();
  const prev = userLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  userLocks.set(key, next.catch(() => {})); // keep chain alive past rejections
  return next;
}

module.exports = { readUserFile, writeUserFile, withUserLock };
