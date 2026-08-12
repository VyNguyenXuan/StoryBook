const fs = require('fs');
const path = require('path');

// MUST run before requiring routes/projects.js: that module reads
// process.env.GEMINI_PROVIDER at the top of the file, once, the moment
// it's required — so if this loader ran after that require (as it
// originally did), GEMINI_PROVIDER would still be empty at the moment the
// provider gets chosen, and it would silently fall back to mock every time
// regardless of what's actually in .env.
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const express = require('express');
const usersRouter = require('./routes/users');
const projectsRouter = require('./routes/projects');

const app = express();
app.use(express.json({ limit: '5mb' })); // book text can be sizeable

app.use('/users', usersRouter);
app.use('/users/:email/projects', projectsRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

// Serve generated images from disk — spec §5.2: "served through your own
// API. No S3, no blob storage, no CDN." Matches imageStore.js's URL shape
// (/images/<email>/<projectId>/<filename>) exactly.
app.use('/images', express.static(path.join(__dirname, '..', 'data', 'images')));

// Serve the frontend as static files from the same process/port — avoids
// needing a second server, a build step, or docker-compose for something
// this small. §5.5's "one command starts the stack" stays literally true.
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
}

module.exports = app;
