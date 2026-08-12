const root = document.getElementById('app');

const state = {
  user: null,        // { name, email } — "session" is just localStorage, no auth per spec §4.1
  view: 'auth',       // auth | list | new | detail
  projects: [],
  currentProject: null,
  pollHandle: null,
  formError: '',
};

// ---- session (client-side only — no password/OAuth per §4.1) ----
function loadSession() {
  const raw = localStorage.getItem('session');
  if (raw) state.user = JSON.parse(raw);
}
function saveSession(user) {
  localStorage.setItem('session', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('session');
}

// ---- API ----
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.code = body.code;
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---- navigation ----
// Every real view change also writes to location.hash, so each screen is a
// genuine browser-history entry (mirroring app-demo.html's navigate() +
// hashchange approach). Without this, the back button has nothing inside
// the app to land on and falls straight through to whatever page was open
// before this one — that's the bug this fixes.
let suppressHashChange = false;

function goTo(view, extra = {}) {
  stopPolling();
  state.view = view;
  Object.assign(state, extra);
  render();
  syncHash();
}

function hashForCurrentView() {
  if (state.view === 'detail' && state.currentProject) return `#/detail/${state.currentProject.id}`;
  if (state.view === 'new') return '#/new';
  if (state.view === 'list') return '#/list';
  return '#/'; // auth — deliberately not deep-linkable, so back never lands a signed-out user mid-app
}

function syncHash() {
  const target = hashForCurrentView();
  if (location.hash === target) return;
  suppressHashChange = true;
  location.hash = target;
  // hashchange fires asynchronously; clear the flag right after so it only
  // suppresses the change WE just made, not a subsequent real back/forward.
  setTimeout(() => { suppressHashChange = false; }, 0);
}

// Fires on browser back/forward (and manual hash edits). Re-derives view
// state from the hash instead of just re-rendering whatever's in memory,
// since back/forward can jump further than one step.
async function handleHashChange() {
  if (suppressHashChange) return;
  if (!state.user) return; // signed out — auth screen ignores in-app history

  const [, view, id] = location.hash.split('/');
  try {
    if (view === 'detail' && id) {
      const project = await api(`/users/${encodeURIComponent(state.user.email)}/projects/${id}`);
      state.currentProject = project;
      state.view = 'detail';
      render();
      if (project.stepState === 'RUNNING') startPolling(id);
    } else if (view === 'new') {
      stopPolling();
      state.view = 'new';
      render();
    } else {
      await loadProjects();
      stopPolling();
      state.view = 'list';
      render();
    }
  } catch (e) {
    // Project no longer exists, or the request failed — land somewhere
    // valid instead of showing a broken detail view.
    await loadProjects();
    goTo('list');
  }
}
window.addEventListener('hashchange', handleHashChange);

// ---- polling: while a step is RUNNING, refresh the project every 2s so the
// UI reflects real completion instead of guessing a timeout client-side.
// This is the resumable/no-stale-spinner requirement from §4.3 — the poll
// just re-reads server truth, it never re-triggers the step itself. ----
function startPolling(projectId) {
  stopPolling();
  state.pollHandle = setInterval(async () => {
    try {
      const project = await api(`/users/${encodeURIComponent(state.user.email)}/projects/${projectId}`);
      state.currentProject = project;
      render();
      if (project.stepState !== 'RUNNING') stopPolling();
    } catch (e) {
      stopPolling();
    }
  }, 2000);
}
function stopPolling() {
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = null;
}

// ---- render dispatch ----
function render() {
  root.innerHTML = '';
  if (state.view === 'auth') return root.appendChild(renderAuth());
  root.appendChild(renderTopbar());
  const main = document.createElement('div');
  main.className = 'container' + (state.view === 'detail' ? ' wide' : '');
  if (state.view === 'list') main.appendChild(renderList());
  if (state.view === 'new') main.appendChild(renderNewProject());
  if (state.view === 'detail') main.appendChild(renderDetail());
  root.appendChild(main);
}

// ==================== AUTH ====================
function renderAuth() {
  const box = el('div', 'auth-box');
  box.innerHTML = `
    <h1>Book Illustrator</h1>
    <label>Name</label>
    <input type="text" id="auth-name" placeholder="Your name">
    <label>Email</label>
    <input type="email" id="auth-email" placeholder="you@example.com">
    <div class="field-error" id="auth-error"></div>
    <button class="btn-primary" id="auth-submit">Continue</button>
  `;
  box.querySelector('#auth-submit').addEventListener('click', async () => {
    const name = box.querySelector('#auth-name').value.trim();
    const email = box.querySelector('#auth-email').value.trim();
    const errEl = box.querySelector('#auth-error');
    if (!name) return (errEl.textContent = 'Name is required.');
    if (!isValidEmail(email)) return (errEl.textContent = 'Enter a valid email address.');
    errEl.textContent = '';
    try {
      await api('/users', { method: 'POST', body: JSON.stringify({ name, email }) });
      state.user = { name, email };
      saveSession(state.user);
      await loadProjects();
      goTo('list');
    } catch (e) {
      errEl.textContent = e.message;
    }
  });
  return box;
}

// ==================== TOPBAR ====================
function renderTopbar() {
  const bar = el('div', 'topbar');
  const title = el('div');
  title.innerHTML = `<strong>Book Illustrator</strong>`;
  title.style.cursor = 'pointer';
  title.addEventListener('click', async () => {
    await loadProjects();
    goTo('list');
  });
  const right = el('div', 'user');
  right.innerHTML = `${escapeHtml(state.user.name)} (${escapeHtml(state.user.email)}) &nbsp; `;
  const signOut = el('button', 'btn-link');
  signOut.textContent = 'Sign out';
  signOut.addEventListener('click', () => {
    clearSession();
    state.user = null;
    state.projects = [];
    state.currentProject = null;
    goTo('auth');
  });
  right.appendChild(signOut);
  bar.appendChild(title);
  bar.appendChild(right);
  return bar;
}

// ==================== PROJECT LIST ====================
async function loadProjects() {
  state.projects = await api(`/users/${encodeURIComponent(state.user.email)}/projects`);
}

function renderList() {
  const wrap = el('div');
  const header = el('div', 'list-header');
  header.innerHTML = `<h1>Your projects</h1>`;
  const newBtn = el('button', 'btn-primary');
  newBtn.style.width = 'auto';
  newBtn.style.margin = '0';
  newBtn.textContent = '+ New project';
  newBtn.addEventListener('click', () => goTo('new'));
  header.appendChild(newBtn);
  wrap.appendChild(header);

  if (state.projects.length === 0) {
    const empty = el('div', 'empty-state');
    empty.innerHTML = `No projects yet — create one to get started.`;
    wrap.appendChild(empty);
    return wrap;
  }

  state.projects.forEach((p) => {
    const card = el('div', 'project-card');
    const left = el('div');
    left.innerHTML = `
      <div class="project-title">${escapeHtml(p.title)}</div>
      <div class="project-meta">Created ${formatDate(p.createdAt)}</div>
      <div class="mini-steps">
        ${STEP_ORDER.map((s) => `<div class="mini-step ${miniStepClass(p, s)}"></div>`).join('')}
      </div>
    `;
    const pill = el('span', `pill ${overallStatusClass(p)}`);
    pill.textContent = overallStatusLabel(p);
    card.appendChild(left);
    card.appendChild(pill);
    card.addEventListener('click', () => openProject(p.id));
    wrap.appendChild(card);
  });
  return wrap;
}

async function openProject(id) {
  const project = await api(`/users/${encodeURIComponent(state.user.email)}/projects/${id}`);
  state.currentProject = project;
  goTo('detail');
  if (project.stepState === 'RUNNING') startPolling(id);
}

// ==================== NEW PROJECT ====================
function renderNewProject() {
  const wrap = el('div');
  wrap.appendChild(renderBackLink());
  wrap.appendChild(el('h1')).textContent = 'New project';
  const box = el('div', 'auth-box');
  box.style.margin = '0';
  box.style.maxWidth = 'none';
  box.innerHTML = `
    <label>Title</label>
    <input type="text" id="np-title" placeholder="e.g. The Wind in the Willows">
    <label>Book text</label>
    <div class="dropzone" id="np-dropzone" tabindex="0" role="button" aria-label="Choose or drop a .txt file">
      <div class="dz-label" id="np-dropzone-label">Click to choose a .txt file, or drag it here</div>
      <div class="dz-hint">Plain text only · used once as context for every step below</div>
    </div>
    <input type="file" id="np-file" accept=".txt" style="display:none;">
    <div class="divider-or">or paste text</div>
    <textarea id="np-text" placeholder="Paste the book's text here..."></textarea>
    <div class="field-error" id="np-error"></div>
    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn-secondary" id="np-cancel">Cancel</button>
      <button class="btn-primary" id="np-submit" style="margin-top:0;">Create project</button>
    </div>
  `;
  wrap.appendChild(box);

  const dropzone = box.querySelector('#np-dropzone');
  const dzLabel = box.querySelector('#np-dropzone-label');
  const fileInput = box.querySelector('#np-file');
  const textArea = box.querySelector('#np-text');

  async function loadFileIntoTextarea(file) {
    if (!file) return;
    if (!/\.txt$/i.test(file.name)) {
      box.querySelector('#np-error').textContent = 'Please use a .txt file.';
      return;
    }
    box.querySelector('#np-error').textContent = '';
    const text = await file.text();
    textArea.value = text;
    dzLabel.textContent = `✓ ${file.name} loaded`;
    dropzone.classList.add('has-file');
  }

  // Click-to-browse.
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', (e) => loadFileIntoTextarea(e.target.files[0]));

  // Real drag-and-drop, since a styled div (unlike a native <input type=file>)
  // needs explicit dragover/drop handlers to accept a dropped file.
  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'dragend'].forEach((evt) =>
    dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover'))
  );
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    loadFileIntoTextarea(file);
  });

  box.querySelector('#np-cancel').addEventListener('click', () => goTo('list'));

  const submitBtn = box.querySelector('#np-submit');
  submitBtn.addEventListener('click', async () => {
    if (submitBtn.disabled) return; // belt-and-suspenders; disabling below should already prevent re-entry
    const title = box.querySelector('#np-title').value.trim();
    const bookText = box.querySelector('#np-text').value.trim();
    const errEl = box.querySelector('#np-error');
    if (!title) return (errEl.textContent = 'Title is required.');
    if (!bookText) return (errEl.textContent = 'Paste the book text or upload a .txt file.');
    errEl.textContent = '';

    // Disable SYNCHRONOUSLY, before the request fires — a disabled button
    // simply doesn't receive further click events, so a fast double-click
    // can't queue a second submit. This is deliberately a lighter guard
    // than the server-side one pipeline steps get (claimStep's attempt-id
    // check): creating a stray duplicate project costs nothing (no Gemini
    // call, easily ignored) — it doesn't need the same server-side
    // enforcement a billed action does.
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';
    try {
      const project = await api(`/users/${encodeURIComponent(state.user.email)}/projects`, {
        method: 'POST',
        body: JSON.stringify({ title, bookText }),
      });
      state.currentProject = project;
      await loadProjects();
      goTo('detail');
    } catch (e) {
      errEl.textContent = e.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create project';
    }
  });

  return wrap;
}

// Shared "← Back to projects" link used by New project and Project detail —
// mirrors app-demo.html's back-link on both of those screens. Reuses the
// same loadProjects-then-goTo('list') flow as the topbar title click so the
// list is fresh instead of possibly stale.
function renderBackLink() {
  const link = el('a', 'back-link');
  link.textContent = '← Back to projects';
  link.addEventListener('click', async () => {
    await loadProjects();
    goTo('list');
  });
  return link;
}

// ==================== PROJECT DETAIL ====================
function renderDetail() {
  const p = state.currentProject;
  const wrap = el('div');
  wrap.appendChild(renderBackLink());

  const header = el('div', 'detail-header');
  header.innerHTML = `<h1>${escapeHtml(p.title)}</h1><div class="project-meta">Created ${formatDate(p.createdAt)}</div>`;
  wrap.appendChild(header);

  const bookBox = el('div', 'book-text-box');
  bookBox.textContent = p.bookText;
  wrap.appendChild(bookBox);

  const stepper = el('div', 'stepper');
  STEP_ORDER.forEach((s) => {
    const pill = el('div', `step-pill ${stepClass(p, s)}`);
    pill.textContent = STEP_LABELS[s];
    stepper.appendChild(pill);
  });
  wrap.appendChild(stepper);

  if (p.style) {
    const section = el('div', 'card-section');
    section.innerHTML = `<h2>Style</h2>`;
    const box = el('div', 'style-box');
    box.textContent = p.style;
    section.appendChild(box);
    wrap.appendChild(section);
  }

  // Action bar renders BEFORE the galleries (matches app-demo.html's order),
  // not after — with real portraits/illustrations building up below it, an
  // after-galleries button would drift further down the page every time an
  // item lands, forcing a scroll to reach it for the next step.
  wrap.appendChild(renderActionBar(p));

  if (p.characters && p.characters.length > 0) {
    wrap.appendChild(renderItemSection('Characters', p.characters, 'portraitReady', 'portraitImage'));
  }

  if (p.chapters && p.chapters.length > 0) {
    wrap.appendChild(renderItemSection('Chapters', p.chapters, 'illustrationReady', 'illustrationImage'));
  }

  return wrap;
}

function renderItemSection(title, items, readyKey, imageKey) {
  const section = el('div', 'card-section');
  section.innerHTML = `<h2>${title}</h2>`;
  const grid = el('div', 'card-grid');
  items.forEach((item) => {
    const card = el('div', 'item-card');
    if (item[readyKey] && item[imageKey]) {
      const img = document.createElement('img');
      img.src = item[imageKey].url; // served from disk via GET /images/... — no base64 data URI
      card.appendChild(img);
    } else {
      const ph = el('div', 'img-placeholder');
      ph.textContent = 'Not generated yet';
      card.appendChild(ph);
    }
    const name = el('div', 'name');
    name.textContent = item.name;
    const prompt = el('div', 'prompt');
    prompt.textContent = item.prompt;
    card.appendChild(name);
    card.appendChild(prompt);
    grid.appendChild(card);
  });
  section.appendChild(grid);
  return section;
}

// The single "run next step" action button + all its states: idle/ready,
// running (names the step, per §4.4's "not a bare spinner"), error+retry,
// and stuck-step recovery.
function renderActionBar(p) {
  const step = currentStep(p);

  if (!step) {
    const bar = el('div', 'action-bar');
    bar.innerHTML = `<strong>All done!</strong> The full pipeline has completed.`;
    return bar;
  }

  // Stuck-step recovery takes priority over the plain error view.
  if (p.stepState === 'RUNNING' && p.isStale) {
    const bar = el('div', 'action-bar error');
    bar.innerHTML = `<div class="stuck-notice">This step (${STEP_LABELS[step]}) appears stuck — it's been running far longer than expected, likely due to a server interruption.</div>`;
    const btn = el('button', 'btn-primary');
    btn.style.width = 'auto';
    btn.textContent = `Recover & retry ${STEP_LABELS[step]}`;
    btn.addEventListener('click', () => retryStep(step));
    bar.appendChild(btn);
    return bar;
  }

  if (p.stepState === 'RUNNING') {
    const bar = el('div', 'action-bar running');
    bar.innerHTML = `<div class="running-label"><span class="spinner"></span>Running ${STEP_LABELS[step]}…</div>`;
    return bar;
  }

  if (p.lastError) {
    const bar = el('div', 'action-bar error');
    bar.innerHTML = `<div class="error-label">${STEP_LABELS[step]} failed: ${escapeHtml(p.lastError)}</div>`;
    const btn = el('button', 'btn-primary');
    btn.style.width = 'auto';
    btn.textContent = `Retry ${STEP_LABELS[step]}`;
    btn.addEventListener('click', () => runStep(step));
    bar.appendChild(btn);
    return bar;
  }

  // Idle, ready to run. STYLE step accepts an optional user-supplied style.
  const bar = el('div', 'action-bar');
  if (step === 'STYLE') {
    const styleInput = el('div', 'style-input');
    styleInput.innerHTML = `<label>Optional: specify an art style</label><input type="text" id="style-override" placeholder="e.g. bold flat-color comic style">`;
    bar.appendChild(styleInput);
  }
  const btn = el('button', 'btn-primary');
  btn.style.width = 'auto';
  btn.textContent = `Run ${STEP_LABELS[step]}`;
  btn.addEventListener('click', () => {
    const styleEl = bar.querySelector('#style-override');
    runStep(step, styleEl ? styleEl.value.trim() : undefined);
  });
  bar.appendChild(btn);
  return bar;
}

async function runStep(stepKey, style) {
  const p = state.currentProject;
  try {
    const updated = await api(
      `/users/${encodeURIComponent(state.user.email)}/projects/${p.id}/steps/${stepKey}/run`,
      { method: 'POST', body: JSON.stringify({ style }) }
    );
    state.currentProject = updated;
    render();
    startPolling(p.id);
  } catch (e) {
    // ALREADY_RUNNING (e.g. a near-simultaneous second click) just means
    // someone else's request already claimed it — refresh and start
    // polling instead of showing a scary error for what isn't one.
    if (e.code === 'ALREADY_RUNNING') {
      const fresh = await api(`/users/${encodeURIComponent(state.user.email)}/projects/${p.id}`);
      state.currentProject = fresh;
      render();
      startPolling(p.id);
      return;
    }
    alert(e.message);
  }
}

async function retryStep(stepKey) {
  const p = state.currentProject;
  try {
    const updated = await api(
      `/users/${encodeURIComponent(state.user.email)}/projects/${p.id}/steps/${stepKey}/retry`,
      { method: 'POST', body: JSON.stringify({}) }
    );
    state.currentProject = updated;
    render();
    startPolling(p.id);
  } catch (e) {
    alert(e.message);
  }
}

// ==================== helpers ====================
const STEP_LABELS = {
  STYLE: 'Style',
  CHARACTERS: 'Characters',
  PORTRAITS: 'Portraits',
  CHAPTERS: 'Chapters',
  ILLUSTRATIONS: 'Illustrations',
};

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

// ==================== boot ====================
(async function init() {
  loadSession();
  if (state.user) {
    try {
      await loadProjects();
      // Restore whatever screen the URL points to (deep link, or a refresh
      // mid-project) instead of always dropping back to the list — this is
      // the other half of "resumable" (§4.3) working with real navigation.
      const [, view, id] = location.hash.split('/');
      if (view === 'detail' && id) {
        try {
          const project = await api(`/users/${encodeURIComponent(state.user.email)}/projects/${id}`);
          state.currentProject = project;
          goTo('detail');
          if (project.stepState === 'RUNNING') startPolling(id);
          return;
        } catch (e) {
          // fall through to list if the linked project doesn't resolve
        }
      } else if (view === 'new') {
        goTo('new');
        return;
      }
      goTo('list');
      return;
    } catch (e) {
      // stored session no longer resolves (e.g. server data was wiped) —
      // fall through to auth rather than getting stuck on a broken list view
      clearSession();
      state.user = null;
    }
  }
  goTo('auth');
})();
