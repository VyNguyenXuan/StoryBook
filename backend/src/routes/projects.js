const express = require('express');
const { readUserFile, writeUserFile, withUserLock } = require('../db');
const pipeline = require('../services/pipeline');
const stepRunner = require('../services/stepRunner');
const { MockGeminiProvider } = require('../providers/mockProvider');
const { GeminiProvider } = require('../providers/geminiProvider');

const router = express.Router({ mergeParams: true });

// GEMINI_PROVIDER=real switches to actual billed Gemini calls; anything
// else (including unset) stays on the free mock. This is the only place
// that decides — every other module just calls whatever `provider` it's
// handed, so swapping providers never touches pipeline/stepRunner logic.
const provider =
  process.env.GEMINI_PROVIDER === 'real' ? new GeminiProvider() : new MockGeminiProvider();

function requireUser(req, res) {
  const email = req.params.email;
  const userData = readUserFile(email);
  if (!userData) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  return userData;
}

// GET /users/:email/projects
router.get('/', (req, res) => {
  const userData = requireUser(req, res);
  if (!userData) return;
  res.json(userData.projects.map(summarize));
});

// POST /users/:email/projects  { title, bookText }
router.post('/', async (req, res) => {
  const { title, bookText } = req.body || {};
  if (!title || !bookText) {
    return res.status(400).json({ error: 'title and bookText are required' });
  }
  const project = await withUserLock(req.params.email, () => {
    const userData = readUserFile(req.params.email);
    if (!userData) return null;
    const p = pipeline.newProject({ title, bookText });
    userData.projects.unshift(p);
    writeUserFile(req.params.email, userData);
    return p;
  });
  if (!project) return res.status(404).json({ error: 'User not found' });
  res.status(201).json(project);
});

// GET /users/:email/projects/:id
router.get('/:id', (req, res) => {
  const userData = requireUser(req, res);
  if (!userData) return;
  const project = userData.projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ ...project, isStale: pipeline.isStale(project) });
});

// POST /users/:email/projects/:id/steps/:stepKey/run  { style? }
// Fires the next step. Returns immediately with in-flight state; poll
// GET /:id to see it land. Duplicate/second-tab requests hit the
// ALREADY_RUNNING branch and get the current state back — no second
// provider call happens.
router.post('/:id/steps/:stepKey/run', async (req, res) => {
  const { email, id, stepKey } = req.params;
  const { style } = req.body || {};
  try {
    const result = await stepRunner.runStep(email, id, stepKey, {
      provider,
      userSuppliedStyle: style,
    });
    res.status(202).json(result.project);
  } catch (err) {
    handlePipelineError(res, err);
  }
});

// POST /users/:email/projects/:id/steps/:stepKey/retry
// Clears a stale (stuck) step, then immediately re-runs it. Two calls
// under the hood, but one request from the frontend's point of view.
router.post('/:id/steps/:stepKey/retry', async (req, res) => {
  const { email, id, stepKey } = req.params;
  const { style } = req.body || {};
  try {
    await stepRunner.retryStaleStep(email, id);
    const result = await stepRunner.runStep(email, id, stepKey, {
      provider,
      userSuppliedStyle: style,
    });
    res.status(202).json(result.project);
  } catch (err) {
    handlePipelineError(res, err);
  }
});

function handlePipelineError(res, err) {
  const known = ['ALREADY_RUNNING', 'OUT_OF_ORDER', 'STALE', 'DONE', 'NOT_STALE', 'NOT_FOUND'];
  if (known.includes(err.code)) {
    const status = err.code === 'NOT_FOUND' ? 404 : 409;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
}

function summarize(p) {
  return {
    id: p.id,
    title: p.title,
    createdAt: p.createdAt,
    status: p.status,
    stepState: p.stepState,
  };
}

module.exports = router;
