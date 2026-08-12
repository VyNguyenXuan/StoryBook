const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const imageStore = require('../src/services/imageStore');

const TEST_EMAIL = 'imagestore-test@example.com';
const TEST_PROJECT_ID = 'proj-abc-123';

// A valid 1x1 PNG, base64-encoded — small enough to inline, real enough
// that decoding it round-trips correctly.
const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function cleanup() {
  imageStore.deleteProjectImages(TEST_EMAIL, TEST_PROJECT_ID);
}

test('saveImage writes real bytes to disk and returns a url, not the data itself', () => {
  cleanup();
  const ref = imageStore.saveImage(TEST_EMAIL, TEST_PROJECT_ID, 'portraits-0', {
    mimeType: 'image/png',
    data: ONE_PX_PNG_BASE64,
  });

  assert.equal(typeof ref.url, 'string');
  assert.equal(ref.mimeType, 'image/png');
  assert.equal('data' in ref, false, 'the returned reference must not carry the base64 payload itself');
  assert.match(ref.url, /^\/images\//);
  assert.match(ref.url, new RegExp(`/${TEST_PROJECT_ID}/portraits-0\\.png$`));
  assert.equal(
    ref.url.includes('%'),
    false,
    'url must not be percent-encoded — express.static decodes incoming request paths, so an encoded folder name would never match the real one on disk (this exact bug shipped once already)'
  );

  cleanup();
});

test('saveImage actually writes decodable bytes matching the input', () => {
  cleanup();
  const ref = imageStore.saveImage(TEST_EMAIL, TEST_PROJECT_ID, 'portraits-0', {
    mimeType: 'image/png',
    data: ONE_PX_PNG_BASE64,
  });

  // Reconstruct the real file path from the url the same way server.js's
  // static middleware would resolve it, and confirm the bytes are correct.
  const relative = ref.url.replace(/^\/images\//, '');
  const filePath = path.join(imageStore.IMAGES_DIR, relative);
  assert.equal(fs.existsSync(filePath), true);
  const onDisk = fs.readFileSync(filePath).toString('base64');
  assert.equal(onDisk, ONE_PX_PNG_BASE64);

  cleanup();
});

test('saveImage picks the correct extension per mime type', () => {
  cleanup();
  const png = imageStore.saveImage(TEST_EMAIL, TEST_PROJECT_ID, 'a', { mimeType: 'image/png', data: ONE_PX_PNG_BASE64 });
  const jpg = imageStore.saveImage(TEST_EMAIL, TEST_PROJECT_ID, 'b', { mimeType: 'image/jpeg', data: ONE_PX_PNG_BASE64 });
  assert.match(png.url, /\.png$/);
  assert.match(jpg.url, /\.jpg$/);
  cleanup();
});

test('saveImage with the same filename overwrites rather than accumulating files (retry behavior)', () => {
  cleanup();
  const ref1 = imageStore.saveImage(TEST_EMAIL, TEST_PROJECT_ID, 'portraits-0', {
    mimeType: 'image/png',
    data: ONE_PX_PNG_BASE64,
  });
  const dir = path.dirname(path.join(imageStore.IMAGES_DIR, ref1.url.replace(/^\/images\//, '')));
  imageStore.saveImage(TEST_EMAIL, TEST_PROJECT_ID, 'portraits-0', {
    mimeType: 'image/png',
    data: ONE_PX_PNG_BASE64,
  });
  const filesAfter = fs.readdirSync(dir);
  assert.equal(filesAfter.filter((f) => f.startsWith('portraits-0')).length, 1, 'a retry must overwrite, not duplicate');
  cleanup();
});

test('deleteProjectImages removes the whole project directory without throwing if it never existed', () => {
  cleanup(); // must not throw even though nothing exists yet
  imageStore.saveImage(TEST_EMAIL, TEST_PROJECT_ID, 'x', { mimeType: 'image/png', data: ONE_PX_PNG_BASE64 });
  imageStore.deleteProjectImages(TEST_EMAIL, TEST_PROJECT_ID);
  const dir = path.dirname(
    path.join(imageStore.IMAGES_DIR, TEST_EMAIL.replace(/[^a-z0-9._-]/g, '_'), TEST_PROJECT_ID, 'x.png')
  );
  assert.equal(fs.existsSync(dir), false);
});
