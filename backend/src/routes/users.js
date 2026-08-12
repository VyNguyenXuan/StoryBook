const express = require('express');
const { readUserFile, writeUserFile, withUserLock } = require('../db');

const router = express.Router();

// POST /users  { name, email }  -> create if new, else just "log in"
router.post('/', async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email || !String(email).includes('@')) {
    return res.status(400).json({ error: 'name and a valid email are required' });
  }
  const result = await withUserLock(email, () => {
    let userData = readUserFile(email);
    if (!userData) {
      userData = { name, email: email.toLowerCase().trim(), projects: [] };
    } else {
      userData.name = name; // allow name to be updated on re-login
    }
    writeUserFile(email, userData);
    return userData;
  });
  res.json({ name: result.name, email: result.email, projectCount: result.projects.length });
});

module.exports = router;
