const fs = require('fs');
const path = require('path');
const IMAGES_DIR = path.join(__dirname, '..', '..', 'data', 'images');

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

function extensionFor(mimeType) {
  return EXT_BY_MIME[mimeType] || '.png';
}

function safeSegment(email) {
  return String(email).toLowerCase().trim().replace(/[^a-z0-9._-]/g, '_');
}

function projectImagesDir(email, projectId) {
  return path.join(IMAGES_DIR, safeSegment(email), projectId);
}

// Decodes a base64 image payload (as returned by any provider — mock or
// real, same shape) and writes it to disk under this project's own
// directory. Returns a { url, mimeType } reference — NOT the image bytes —
// which is what actually gets stored on the character/chapter record from
// here on. `filename` should be stable and deterministic (e.g.
// "portrait-0.png") so a retry of the same slot simply overwrites the old
// file rather than accumulating orphaned ones.
function saveImage(email, projectId, filename, { mimeType, data }) {
  const dir = projectImagesDir(email, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = extensionFor(mimeType);
  const finalName = filename.endsWith(ext) ? filename : `${filename}${ext}`;
  const filePath = path.join(dir, finalName);
  fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

  const safeEmail = safeSegment(email);
  return {
    url: `/images/${safeEmail}/${projectId}/${finalName}`,
    mimeType,
  };
}

// Removes a project's entire image directory — used when a step is retried
// from scratch and old files for that project would otherwise just sit
// there unused (not currently wired in anywhere that deletes whole
// projects, since the app has no project-delete feature yet; kept as a
// small utility rather than adding delete support that isn't asked for).
function deleteProjectImages(email, projectId) {
  const dir = projectImagesDir(email, projectId);
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { saveImage, deleteProjectImages, IMAGES_DIR };
