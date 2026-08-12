const { readUserFile, writeUserFile, withUserLock } = require('../db');
const pipeline = require('./pipeline');
const caps = require('./caps');
const imageStore = require('./imageStore');

function findProject(userData, projectId) {
  return userData.projects.find((p) => p.id === projectId) || null;
}
async function runStep(email, projectId, stepKey, { provider, userSuppliedStyle } = {}) {
  // --- Phase 1: claim the step (locked, fast) ---
  const claim = await withUserLock(email, () => {
    const userData = readUserFile(email);
    if (!userData) throw Object.assign(new Error('User not found'), { code: 'NOT_FOUND' });
    const project = findProject(userData, projectId);
    if (!project) throw Object.assign(new Error('Project not found'), { code: 'NOT_FOUND' });

    const step = pipeline.claimStep(project, stepKey); // throws ALREADY_RUNNING / OUT_OF_ORDER / STALE / DONE
    writeUserFile(email, userData);
    return { step, project: { ...project } };
  });

  const attemptId = claim.project.stepAttemptId;

  // --- Phase 2: do the (possibly slow, possibly billed) work, unlocked ---
  runProviderCall(email, projectId, stepKey, claim.step, provider, userSuppliedStyle, attemptId).catch(() => {
  });

  return { status: 'started', project: claim.project };
}

// Returns true if `attemptId` is still the current attempt for this step,
// re-checked against the freshest project state (not whatever was true when
// the async call started). False means a stale-step retry has since claimed
// a NEW attempt at this same step — this call's result is orphaned and must
// be discarded rather than applied, or it would silently clobber whatever
// the newer attempt is doing (including a result it already succeeded at).
function isCurrentAttempt(project, attemptId) {
  return !!project && project.stepAttemptId === attemptId;
}

async function runProviderCall(email, projectId, stepKey, step, provider, userSuppliedStyle, attemptId) {
  try {
    const userDataBefore = readUserFile(email);
    const projectBefore = findProject(userDataBefore, projectId);
    let conversationRef = projectBefore.conversationRef;

    // Send the book content once, on the very first call for this project,
    // per §4.3's "send book content once, reuse across steps" — every step
    // after this reuses the same conversationRef instead of re-sending text.
    if (!conversationRef) {
      conversationRef = await provider.startConversation(projectBefore.bookText);
    }

    let result;
    let wasTruncated = false;

    if (stepKey === 'STYLE') {
      result = await provider.generateStyle(conversationRef, userSuppliedStyle);
      await applyBulkResult(email, projectId, stepKey, result, wasTruncated, conversationRef, attemptId);
      return;

    } else if (stepKey === 'CHARACTERS') {
      result = await provider.generateCharacters(conversationRef);
      const capped = caps.enforceCharacterCap(result.characters);
      result = { ...result, characters: capped.items };
      wasTruncated = capped.wasTruncated;
      await applyBulkResult(email, projectId, stepKey, result, wasTruncated, conversationRef, attemptId);
      return;

    } else if (stepKey === 'PORTRAITS') {
      const capped = caps.enforceCharacterCap(projectBefore.characters);
      await runIncrementalItemStep(email, projectId, stepKey, capped.items, conversationRef, attemptId, (item) =>
        provider.generatePortrait(conversationRef, item)
      );
      return;

    } else if (stepKey === 'CHAPTERS') {
      result = await provider.generateChapters(conversationRef);
      const capped = caps.enforceChapterCap(result.chapters);
      result = { ...result, chapters: capped.items };
      wasTruncated = capped.wasTruncated;
      await applyBulkResult(email, projectId, stepKey, result, wasTruncated, conversationRef, attemptId);
      return;

    } else if (stepKey === 'ILLUSTRATIONS') {
      const capped = caps.enforceChapterCap(projectBefore.chapters);
      await runIncrementalItemStep(email, projectId, stepKey, capped.items, conversationRef, attemptId, (item) =>
        provider.generateIllustration(conversationRef, item)
      );
      return;
    }
  } catch (err) {
    // A real failure (network error, 429, whatever) — NOT a stale timeout.
    // Reset stepState so the same step can be retried, per §4.3's
    // "failed step leaves the project usable" rule. We deliberately do NOT
    // auto-retry here — the spec is explicit that retries are
    // user-triggered only, to keep cost/rate-limit behaviour predictable.
    await withUserLock(email, () => {
      const userData = readUserFile(email);
      const project = findProject(userData, projectId);
      if (project && isCurrentAttempt(project, attemptId)) {
        pipeline.failStep(project, err.message || String(err));
        writeUserFile(email, userData);
      }
      // else: this attempt was already superseded by a stale-retry — an old,
      // now-irrelevant failure must not overwrite whatever the new attempt
      // is doing (including a result it may have already succeeded at).
    });
  }
}

// Clears a stuck (stale) step so it can be claimed again. Separate from
// runStep on purpose — this only flips state, it never itself calls the
// provider; the frontend calls this THEN calls runStep for the same step.
async function retryStaleStep(email, projectId) {
  return withUserLock(email, () => {
    const userData = readUserFile(email);
    if (!userData) throw Object.assign(new Error('User not found'), { code: 'NOT_FOUND' });
    const project = findProject(userData, projectId);
    if (!project) throw Object.assign(new Error('Project not found'), { code: 'NOT_FOUND' });
    pipeline.clearStaleStep(project); // throws NOT_STALE if it isn't actually stale
    writeUserFile(email, userData);
    return project;
  });
}

// Used by STYLE/CHARACTERS/CHAPTERS — one provider call, one write.
async function applyBulkResult(email, projectId, stepKey, result, wasTruncated, conversationRef, attemptId) {
  await withUserLock(email, () => {
    const userData = readUserFile(email);
    const project = findProject(userData, projectId);
    if (!isCurrentAttempt(project, attemptId)) return; // orphaned — a newer attempt has since taken over
    project.conversationRef = conversationRef;
    pipeline.completeStep(project, stepKey, result);
    project.lastWarning = wasTruncated
      ? `${stepKey}: model returned more items than the cap allows; extra items were dropped before any billed call.`
      : null;
    writeUserFile(email, userData);
  });
}

// Maps an item-level step to where its results land on the project record.
const ITEM_STEP_CONFIG = {
  PORTRAITS: { arrayKey: 'characters', readyKey: 'portraitReady', imageKey: 'portraitImage' },
  ILLUSTRATIONS: { arrayKey: 'chapters', readyKey: 'illustrationReady', imageKey: 'illustrationImage' },
};

async function runIncrementalItemStep(email, projectId, stepKey, items, conversationRef, attemptId, generateFn) {
  const config = ITEM_STEP_CONFIG[stepKey];

  const persistOne = async (index, image) => {
    await withUserLock(email, () => {
      const userData = readUserFile(email);
      const project = findProject(userData, projectId);
      if (!isCurrentAttempt(project, attemptId)) return; // orphaned — discard BEFORE writing any file to disk

      // Write the actual image bytes to disk here, inside the lock and only
      // after confirming this is still the current attempt — otherwise an
      // orphaned attempt could win a race against a newer one and silently
      // overwrite the file behind an already-published URL, even though the
      // JSON record itself would still (correctly) point to the newer
      // attempt's data. The provider never touches file paths; that's
      // deliberately kept out of providers/ so mock and real stay identical
      // in shape.
      const filename = `${stepKey.toLowerCase()}-${index}`;
      const imageRef = imageStore.saveImage(email, projectId, filename, image);

      project.conversationRef = conversationRef;
      project[config.arrayKey][index][config.readyKey] = true;
      project[config.arrayKey][index][config.imageKey] = imageRef; // { url, mimeType } — no base64 in the JSON record
      // Reset the stale-detection clock on every real chunk of progress —
      // a multi-item step taking a while shouldn't be flagged stuck just
      // because the *step* started a while ago, as long as items are
      // actively landing.
      project.stepStartedAt = Date.now();
      writeUserFile(email, userData);
    });
  };

  // Promise.allSettled (not Promise.all) so one item failing doesn't cancel
  // or hide the others — every item still gets its own chance to land and
  // persist independently before we decide the step's overall outcome.
  const results = await Promise.allSettled(
    items.map(async (item, index) => {
      const image = await generateFn(item);
      await persistOne(index, image);
    })
  );

  const firstFailure = results.find((r) => r.status === 'rejected');
  if (firstFailure) {
    throw firstFailure.reason instanceof Error
      ? firstFailure.reason
      : new Error(String(firstFailure.reason));
  }

  await withUserLock(email, () => {
    const userData = readUserFile(email);
    const project = findProject(userData, projectId);
    if (!isCurrentAttempt(project, attemptId)) return; // orphaned — discard
    pipeline.finishStep(project, stepKey);
    project.lastWarning = null;
    writeUserFile(email, userData);
  });
}

module.exports = { runStep, retryStaleStep };
