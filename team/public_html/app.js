// Work Task: the team app. Staff see and fill their own tasks; the manager gives tasks and sees everything.
// No outside libraries. All text from the server is put on screen as text (never as HTML).

const TOKEN_KEY = 'wt.token';
const state = {
  token: load(TOKEN_KEY), user: null, view: 'today', data: null, people: [], closed: false,
  drafts: {}, editing: {}, files: {}, busy: false, prefill: null, newPerson: null,
};
const photoUrls = new Map();

function load(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function save(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } }

// ---------------------------------------------------------------- small helpers

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') n.className = v;
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

let toastTimer = 0;
function toast(text, ms = 3000) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(d) { const x = new Date(d.slice(0, 10) + 'T00:00:00'); return `${DAYS[x.getDay()]} ${x.getDate()} ${MONTHS[x.getMonth()]}`; }
function fmtTime(dt) {
  const [h, m] = dt.slice(11, 16).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

function repeatLabel(t, today) {
  if (t.seq !== null && t.seq !== undefined && t.status === 'open') return t.queued ? 'Coming next' : 'Current step — send an update each day';
  if (t.repeat === 'daily') return t.skipSunday ? 'Every day (Mon–Sat)' : 'Every day';
  if (t.repeat === 'weekly') return `Every ${LONG_DAYS[t.weekday ?? 1]}`;
  if (!t.dueDate) return 'One time';
  const late = today && t.status === 'open' ? daysBetween(t.dueDate, today) : 0;
  return late > 0 ? `By ${fmtDay(t.dueDate)} · ${late} day${late > 1 ? 's' : ''} late` : `By ${fmtDay(t.dueDate)}`;
}
const STATES = [['progress', 'Working on it'], ['stuck', 'Stuck'], ['finished', 'Finished']];
const stateName = (s) => (STATES.find((x) => x[0] === s) || STATES[0])[1];
const stateTag = (s) => el('span', { class: 'tag ' + (s === 'stuck' ? 'red' : s === 'finished' ? 'green' : 'grey') }, stateName(s));

// ---------------------------------------------------------------- talking to the server

// ---------------------------------------------------------------- offline
// Lists are kept on the phone (last copy) so the app opens without internet. Updates and messages sent
// while offline wait in the phone's outbox (IndexedDB, photos included) and go out when the internet is back.

class OfflineError extends Error {}
const READS = new Set(['me', 'my.today', 'team.today', 'tasks.list', 'users.list', 'task.get']);
const cacheKey = (a, body) => 'wt.c.' + a + ':' + JSON.stringify(body || {});
function readCache(a, body) { try { return JSON.parse(localStorage.getItem(cacheKey(a, body)) || 'null'); } catch { return null; } }
function writeCache(a, body, out) { try { localStorage.setItem(cacheKey(a, body), JSON.stringify(out)); } catch { /* phone storage full: still works online */ } }
function clearCache() { try { for (const k of Object.keys(localStorage)) if (k.startsWith('wt.c.')) localStorage.removeItem(k); } catch { /* blocked */ } }

function setOffline(on) {
  if (state.offline === on) return;
  state.offline = on;
  render();
  if (!on) flushOutbox();
}

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('worktask', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function outbox(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', mode);
    const req = fn(tx.objectStore('outbox'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
async function loadOutbox() {
  try { state.outbox = ((await outbox('readonly', (s) => s.getAll())) || []).filter((x) => state.user && x.userId === state.user.id); }
  catch { state.outbox = []; }
}
async function queue(item) {
  await outbox('readwrite', (s) => s.add({ ...item, userId: state.user.id, at: new Date().toISOString() }));
  await loadOutbox();
  render();
}

let flushing = false;
/** Send what waited on this phone, oldest first. Stops at the first "still offline". */
async function flushOutbox() {
  if (flushing || !state.user) return;
  flushing = true;
  let sent = 0;
  try {
    await loadOutbox();
    for (const it of [...state.outbox].sort((x, y) => x.id - y.id)) {
      try {
        if (it.kind === 'update') {
          const twoSteps = it.state === 'finished' && it.needsPhoto && it.files && it.files.length;
          const out = await api('update.save', { taskId: it.taskId, note: it.note, state: twoSteps ? 'progress' : it.state });
          for (const f of it.files || []) { const fd = new FormData(); fd.append('updateId', String(out.update.id)); fd.append('file', f, 'photo.jpg'); await api('photo.add', fd, true); }
          if (twoSteps) await api('update.save', { taskId: it.taskId, note: it.note, state: 'finished' });
        } else if (it.kind === 'comment') await api('comment.add', { taskId: it.taskId, text: it.text });
        await outbox('readwrite', (s) => s.delete(it.id));
        sent++;
      } catch (ex) {
        if (ex instanceof OfflineError) break;
        await outbox('readwrite', (s) => s.delete(it.id)); // refused by the server (e.g. task closed): say so, do not retry forever
        toast(`Could not send "${(it.note || it.text || '').slice(0, 40)}": ${ex.message}`, 8000);
      }
    }
  } finally {
    flushing = false;
    await loadOutbox();
    if (sent) { toast(`✓ ${sent} waiting item${sent > 1 ? 's' : ''} sent`); loadView(); } else render();
  }
}

/** The bar at the top: offline, and / or things waiting to be sent. */
function offlineBar() {
  const n = (state.outbox || []).length;
  if (!state.offline && !n) return null;
  return el('div', { class: 'offline-bar' + (state.offline ? '' : ' waiting') },
    el('span', null, state.offline ? '📴 Offline — showing the last saved copy. What you send is kept on this phone and goes out when you are online.' : ''),
    n ? el('strong', null, ` ⏳ ${n} waiting to send`) : null,
    n && !state.offline ? el('button', { class: 'link', onClick: () => flushOutbox() }, 'Send now') : null);
}

async function api(a, body = {}, form = false) {
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  if (!form) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch('api/?a=' + encodeURIComponent(a), { method: 'POST', headers, body: form ? body : JSON.stringify(body) });
  } catch {
    setOffline(true);
    if (READS.has(a)) { const c = readCache(a, body); if (c) return { ...c, fromCache: true }; }
    throw new OfflineError('You are offline. Try again when the internet is back.');
  }
  setOffline(false);
  let out = null;
  try { out = await res.json(); } catch { out = null; }
  if (res.status === 401 && a !== 'login' && a !== 'password') { signedOut(); throw new Error(out?.error || 'Please sign in.'); }
  if (!out || !out.ok) throw new Error(out?.error || 'Something went wrong. Try again.');
  if (READS.has(a) && !form) writeCache(a, body, out);
  return out;
}

function signedOut() {
  state.token = ''; state.user = null; state.data = null;
  save(TOKEN_KEY, '');
  clearCache();
  render();
}

async function photoUrl(id) {
  if (photoUrls.has(id)) return photoUrls.get(id);
  const res = await fetch('api/?a=photo&id=' + id, { headers: { Authorization: 'Bearer ' + state.token } });
  if (!res.ok) throw new Error('photo');
  const url = URL.createObjectURL(await res.blob());
  photoUrls.set(id, url);
  return url;
}

function thumbs(ids) {
  if (!ids || !ids.length) return null;
  return el('div', { class: 'thumbs' }, ids.map((id) => {
    const img = el('img', { alt: 'Photo', onClick: () => openPhoto(id) });
    photoUrl(id).then((u) => { img.src = u; }).catch(() => { img.alt = 'Photo missing'; });
    return img;
  }));
}

const fileUrls = new Map();
async function taskFileUrl(id) {
  if (fileUrls.has(id)) return fileUrls.get(id);
  const res = await fetch('api/?a=task.file&id=' + id, { headers: { Authorization: 'Bearer ' + state.token } });
  if (!res.ok) throw new Error('file');
  const url = URL.createObjectURL(await res.blob());
  fileUrls.set(id, url);
  return url;
}

/** 📎 Instruction photos / PDFs from the manager. Tap to open. The manager can remove them (✕). */
function taskFiles(t, canRemove = false) {
  if (!t.files || !t.files.length) return null;
  return el('div', { class: 'files' }, el('div', { class: 'small muted' }, '📎 Instructions'), el('div', { class: 'thumbs' }, t.files.map((f) => {
    const open = async () => { try { const u = await taskFileUrl(f.id); if (f.image) { const v = document.getElementById('viewer'); v.replaceChildren(el('img', { src: u, alt: f.name })); v.hidden = false; v.onclick = () => { v.hidden = true; v.replaceChildren(); }; } else window.open(u, '_blank', 'noopener'); } catch { toast('Could not open the file'); } };
    const box = f.image ? el('img', { alt: f.name, title: f.name, onClick: open }) : el('button', { class: 'file-chip', title: f.name, onClick: open }, '📄 ' + (f.name.length > 18 ? f.name.slice(0, 16) + '…' : f.name));
    if (f.image) taskFileUrl(f.id).then((u) => { box.src = u; }).catch(() => {});
    if (!canRemove) return box;
    return el('span', { class: 'file-wrap' }, box, el('button', { class: 'link small', title: 'Remove', onClick: async () => {
      if (!confirm(`Remove ${f.name}?`)) return;
      try { await api('task.file.delete', { id: f.id }); loadView(); } catch (ex) { toast(ex.message, 5000); }
    } }, '✕'));
  })));
}

async function uploadTaskFiles(taskId, files) {
  for (const f of files) {
    const fd = new FormData();
    fd.append('taskId', String(taskId));
    fd.append('file', f.type.startsWith('image/') ? await shrink(f) : f, f.type.startsWith('image/') ? 'photo.jpg' : f.name);
    try { await api('task.file.add', fd, true); } catch (ex) { toast(`${f.name}: ${ex.message}`, 5000); }
  }
}

function openPhoto(id) {
  const v = document.getElementById('viewer');
  const img = el('img', { alt: 'Photo' });
  photoUrl(id).then((u) => { img.src = u; });
  v.replaceChildren(img);
  v.hidden = false;
  v.onclick = () => { v.hidden = true; v.replaceChildren(); };
}

/** Make a phone photo smaller before sending (saves mobile data); the server shrinks again anyway. */
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob || file;
  } catch { return file; }
}

// ---------------------------------------------------------------- loading

async function loadView() {
  const me = state.user;
  state.busy = true;
  try {
    if (state.view === 'today') state.data = await api(me.role === 'admin' ? 'team.today' : 'my.today');
    else if (state.view === 'tasks') state.data = await api('tasks.list', { status: state.closed ? 'closed' : 'open' });
    else if (state.view === 'people') state.data = await api('users.list');
    else if (state.view.startsWith('task:')) {
      state.data = await api('task.get', { id: Number(state.view.slice(5)) });
      if (me.role === 'admin') state.people = (await api('users.list')).users.filter((u) => u.active);
    }
    else if (state.view === 'give' || state.view.startsWith('edit:')) {
      state.people = (await api('users.list')).users.filter((u) => u.active);
      state.data = state.view.startsWith('edit:') ? await api('task.get', { id: Number(state.view.slice(5)) }) : null;
    } else state.data = null;
  } catch (e) {
    toast(e.message, 5000);
  }
  state.busy = false;
  render();
}

function go(view) {
  if (view.startsWith('task:') && !state.view.startsWith('task:') && !state.view.startsWith('edit:')) state.back = state.view;
  state.view = view;
  state.data = null;
  window.scrollTo(0, 0);
  render();
  loadView();
}

// ---------------------------------------------------------------- screens

function render() {
  const root = document.getElementById('app');
  if (!state.token || !state.user) { root.replaceChildren(loginScreen()); return; }
  if (state.user.mustChange || state.view === 'password') { root.replaceChildren(header(), passwordScreen()); return; }
  const bar = offlineBar();
  let body;
  if (!state.data && state.view !== 'settings' && state.view !== 'give' && state.view !== 'suggest') body = el('p', { class: 'muted' }, 'Loading…');
  else if (state.view === 'today') body = state.user.role === 'admin' ? teamToday() : myToday();
  else if (state.view === 'tasks') body = allTasks();
  else if (state.view === 'people') body = peopleScreen();
  else if (state.view === 'settings') body = settingsScreen();
  else if (state.view === 'give' || state.view.startsWith('edit:')) body = taskForm();
  else if (state.view === 'suggest') body = suggestForm();
  else if (state.view.startsWith('task:')) body = taskDetail();
  root.replaceChildren(header(), el('main', { class: 'narrow' }, bar, body));
}

function header() {
  const me = state.user;
  const tab = (v, label) => el('button', { class: state.view === v ? 'on' : '', onClick: () => go(v) }, label);
  return el('header', { class: 'top' }, el('div', { class: 'bar' },
    el('span', { class: 'brand' }, 'Work Task'),
    me.role === 'admin' && !me.mustChange ? el('nav', null, me.owner ? el('a', { class: 'btn', href: 'projects/' }, '📋 My projects') : null,
      tab('today', 'Team today'), tab('tasks', 'Tasks'), tab('people', 'People'), tab('settings', 'Settings')) : null,
    el('button', { class: 'link', onClick: () => go('password') }, me.name),
    el('button', { class: 'link', onClick: signOut }, 'Sign out')));
}

async function signOut() {
  try { await api('logout'); } catch { /* signed out anyway */ }
  signedOut();
}

function loginScreen() {
  const err = el('p', { class: 'err', hidden: true });
  const user = el('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const pass = el('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const btn = el('button', { class: 'primary', type: 'submit' }, 'Sign in');
  return el('main', { class: 'narrow' },
    el('h1', null, 'Work Task'),
    el('p', { class: 'muted' }, 'Sign in with the username and password from your manager.'),
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.hidden = true;
      try {
        const out = await api('login', { username: user.value, password: pass.value });
        state.token = out.token; state.user = out.user;
        save(TOKEN_KEY, out.token);
        state.view = 'today';
        if (out.user.owner && !out.user.mustChange) { location.href = 'projects/'; return; } // straight to your projects
        render();
        if (!out.user.mustChange) loadView();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false; btn.disabled = false;
      }
    } }, el('label', null, 'Username', user), el('label', null, 'Password', pass), err, btn));
}

function passwordScreen() {
  const first = state.user.mustChange;
  const err = el('p', { class: 'err', hidden: true });
  const old = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const n1 = el('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const n2 = el('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  return el('main', { class: 'narrow' },
    el('h1', null, first ? 'Choose your own password' : 'Change password'),
    el('p', { class: 'muted' }, first ? 'Welcome! First choose a password only you know. 8 or more characters.' : '8 or more characters.'),
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (n1.value !== n2.value) { err.textContent = 'The two new passwords are not the same.'; err.hidden = false; return; }
      try {
        const out = await api('password', { old: old.value, new: n1.value });
        state.user = out.user;
        toast('Password changed ✓');
        if (out.user.owner && wantsProjects) { location.href = 'projects/'; return; }
        go('today');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    } },
    el('label', null, first ? 'Password from your manager' : 'Current password', old),
    el('label', null, 'New password', n1), el('label', null, 'New password again', n2), err,
    el('div', { class: 'row' }, el('button', { class: 'primary', type: 'submit' }, 'Save password'),
      first ? null : el('button', { type: 'button', onClick: () => go('today') }, 'Cancel'))));
}

// ---------- staff: my tasks today

function myToday() {
  const d = state.data;
  const sent = d.tasks.filter((t) => t.today).length;
  return [
    el('div', { class: 'row spread' }, el('h1', null, 'My tasks today'), el('button', { onClick: () => go('suggest') }, '💡 Suggest a task')),
    el('p', { class: 'muted small' }, `${fmtDay(d.today)} · ${sent} of ${d.tasks.length} sent · please send by ${d.fillBy}`),
    d.tasks.length ? d.tasks.map((t) => myTask(t, d.today)) : el('div', { class: 'card muted' }, 'No tasks for today. 🎉'),
    d.other.length ? [el('h2', null, 'Coming next / other tasks'), d.other.map((t) => el('div', { class: 'card' },
      el('h3', null, t.title), el('div', { class: 'meta' }, [t.project, repeatLabel(t, d.today)].filter(Boolean).join(' · ')), messageLine(t)))] : null,
    (d.suggestions || []).length ? [el('h2', null, 'My suggestions'), d.suggestions.map((t) => el('div', { class: 'card' },
      el('div', { class: 'row spread' }, el('h3', null, t.title),
        t.status === 'suggested' ? el('span', { class: 'tag amber' }, 'Waiting for a yes') : el('span', { class: 'tag grey' }, 'Not now')),
      t.details ? el('div', { class: 'pre small muted' }, t.details) : null,
      messageLine(t)))] : null,
  ];
}

function myTask(t, today) {
  const waiting = (state.outbox || []).filter((x) => x.kind === 'update' && x.taskId === t.id).pop();
  if (waiting && !state.editing[t.id]) {
    return el('div', { class: 'card waiting' },
      el('div', { class: 'task-head' }, el('h3', null, t.title), el('span', { class: 'tag amber' }, '⏳ Waiting to send')),
      el('div', { class: 'meta' }, [t.project, repeatLabel(t, today)].filter(Boolean).join(' · ')),
      el('div', { class: 'update' }, el('div', { class: 'row small' }, stateTag(waiting.state), (waiting.files || []).length ? el('span', { class: 'muted' }, `📷 ${waiting.files.length}`) : null),
        el('div', { class: 'pre' }, waiting.note),
        el('p', { class: 'muted small' }, 'Kept on this phone. It is sent by itself when the internet is back.')));
  }
  const done = t.today && !state.editing[t.id];
  const late = t.repeat === 'once' && t.dueDate && t.dueDate < today;
  return el('div', { class: 'card' + (done ? ' sent' : late ? ' late' : '') },
    el('div', { class: 'task-head' }, el('h3', null, t.title), done ? el('span', { class: 'tag green' }, '✓ Sent') : null),
    el('div', { class: 'meta' }, [t.project, repeatLabel(t, today)].filter(Boolean).join(' · ')),
    t.details ? el('div', { class: 'pre small muted' }, t.details) : null,
    taskFiles(t),
    t.needsPhoto && t.status === 'open' ? el('div', { class: 'small warn' }, '📷 A photo is needed to finish this task') : null,
    t.last ? el('div', { class: 'last' }, `Last time (${fmtDay(t.last.day)}): `, el('span', { class: 'pre' }, t.last.note)) : null,
    messageLine(t),
    el('div', { class: 'update' }, done ? sentView(t) : updateForm(t)));
}

function sentView(t) {
  const u = t.today;
  return [
    el('div', { class: 'row small' }, el('span', { class: 'ok' }, `Sent ${fmtTime(u.at)}`), stateTag(u.state)),
    el('div', { class: 'pre' }, u.note),
    thumbs(u.photos),
    el('div', { class: 'row' },
      el('button', { onClick: () => { state.editing[t.id] = true; state.drafts[t.id] = { note: u.note, state: u.state }; render(); } }, '✎ Edit'),
      u.photos.length < 5 ? photoPicker(t, true) : null),
  ];
}

function photoPicker(t, direct) {
  const input = el('input', { type: 'file', accept: 'image/*', class: 'hidden-file', multiple: true, onChange: async () => {
    const files = [...input.files].slice(0, 5);
    if (direct) { await uploadPhotos(t.today.id, files); loadView(); return; }
    state.files[t.id] = [...(state.files[t.id] || []), ...files].slice(0, 5);
    render();
  } });
  return el('label', { class: 'btn' }, '📷 Add photo', input);
}

function updateForm(t) {
  const d = (state.drafts[t.id] ||= { note: '', state: 'progress' });
  const err = el('p', { class: 'err small', hidden: true });
  const files = state.files[t.id] || [];
  const btn = el('button', { class: 'primary', onClick: async () => {
    if (!d.note.trim()) { err.textContent = 'Write what you did first.'; err.hidden = false; return; }
    const havePhotos = (t.today && t.today.photos.length) || files.length;
    if (d.state === 'finished' && t.needsPhoto && !havePhotos) { err.textContent = '📷 Add a photo to finish this task.'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      // photo needed to finish: save as "working", add the photos, then mark finished
      const twoSteps = d.state === 'finished' && t.needsPhoto && files.length;
      const out = await api('update.save', { taskId: t.id, note: d.note, state: twoSteps ? 'progress' : d.state });
      if (files.length) await uploadPhotos(out.update.id, files);
      if (twoSteps) await api('update.save', { taskId: t.id, note: d.note, state: 'finished' });
      delete state.drafts[t.id]; delete state.files[t.id]; delete state.editing[t.id];
      toast('Sent ✓');
      loadView();
    } catch (ex) {
      if (ex instanceof OfflineError) { // keep it on the phone; it goes out when online
        const blobs = [];
        for (const f of files) blobs.push(await shrink(f));
        await queue({ kind: 'update', taskId: t.id, note: d.note, state: d.state, needsPhoto: !!t.needsPhoto, files: blobs });
        delete state.drafts[t.id]; delete state.files[t.id]; delete state.editing[t.id];
        toast('📴 Saved on this phone — it will be sent when you are online', 5000);
        render();
        return;
      }
      err.textContent = ex.message; err.hidden = false; btn.disabled = false;
    }
  } }, 'Send');
  return [
    el('textarea', { placeholder: 'What did you do today? (you can tap 🎤 on the keyboard to speak)', value: d.note, onInput: (e) => { d.note = e.target.value; err.hidden = true; } }),
    el('div', { class: 'row', role: 'group', 'aria-label': 'How is it going' }, STATES.map(([k, label]) =>
      el('button', { class: 'chip' + (d.state === k ? ' on ' + k : ''), type: 'button', onClick: () => { d.state = k; render(); } }, label))),
    files.length ? el('div', { class: 'thumbs' }, files.map((f, i) => {
      const img = el('img', { alt: 'New photo (tap to remove)', title: 'Tap to remove', src: URL.createObjectURL(f), onClick: () => { files.splice(i, 1); render(); } });
      return img;
    })) : null,
    err,
    el('div', { class: 'row' }, btn, files.length < 5 ? photoPicker(t, false) : null,
      state.editing[t.id] ? el('button', { onClick: () => { delete state.editing[t.id]; delete state.drafts[t.id]; render(); } }, 'Cancel') : null),
  ];
}

/** The newest message on a task (💬), with a way to answer. "New" when someone else wrote it and I have not seen it. */
function messageLine(t) {
  const m = t.lastMessage;
  const open = () => go('task:' + t.id);
  if (!m) return el('div', { class: 'row small' }, el('button', { class: 'link', onClick: open }, '💬 Send a message'));
  return el('div', { class: 'msg-line' + (t.unread ? ' new' : ''), onClick: open },
    t.unread ? el('span', { class: 'tag red' }, 'New') : null,
    el('strong', null, `💬 ${m.mine ? 'You' : m.by}: `), el('span', { class: 'pre' }, m.text.length > 160 ? m.text.slice(0, 160) + '…' : m.text),
    el('span', { class: 'muted small' }, ` · ${fmtDay(m.at)} ${fmtTime(m.at)}${t.messages > 1 ? ` · ${t.messages} messages` : ''} · reply`));
}

function messagesBlock(taskId, comments) {
  const err = el('p', { class: 'err small', hidden: true });
  const box = el('textarea', { placeholder: state.user.role === 'admin' ? 'Reply or give an instruction…' : 'Ask or reply to your manager…', value: state.drafts['m' + taskId] || '', onInput: (e) => { state.drafts['m' + taskId] = e.target.value; err.hidden = true; } });
  const btn = el('button', { class: 'primary', onClick: async () => {
    if (!box.value.trim()) { err.textContent = 'Write the message first.'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      const out = await api('comment.add', { taskId, text: box.value });
      delete state.drafts['m' + taskId];
      state.data.comments = out.comments;
      toast('Sent ✓');
      render();
    } catch (ex) {
      if (ex instanceof OfflineError) {
        await queue({ kind: 'comment', taskId, text: box.value });
        delete state.drafts['m' + taskId];
        toast('📴 Saved on this phone — it will be sent when you are online', 5000);
        return;
      }
      err.textContent = ex.message; err.hidden = false; btn.disabled = false;
    }
  } }, 'Send message');
  return [
    el('h2', null, '💬 Messages'),
    comments.length ? comments.map((c) => el('div', { class: 'card msg' + (c.mine ? ' mine' : '') },
      el('div', { class: 'row small' }, el('strong', null, c.mine ? 'You' : c.by), el('span', { class: 'muted' }, `${fmtDay(c.at)} ${fmtTime(c.at)}`)),
      el('div', { class: 'pre' }, c.text))) : el('p', { class: 'muted small' }, 'No messages yet.'),
    (state.outbox || []).filter((x) => x.kind === 'comment' && x.taskId === taskId).map((x) => el('div', { class: 'card msg mine' },
      el('div', { class: 'row small' }, el('strong', null, 'You'), el('span', { class: 'tag amber' }, '⏳ Waiting to send')), el('div', { class: 'pre' }, x.text))),
    el('div', { class: 'card stack' }, box, err, el('div', { class: 'row' }, btn)),
  ];
}

function suggestForm() {
  const err = el('p', { class: 'err', hidden: true });
  const title = el('input', { required: true, placeholder: 'Clean the dryer filters every week' });
  const details = el('textarea', { placeholder: 'Why it is needed (optional)' });
  const how = el('select', null, el('option', { value: 'once' }, 'One time'), el('option', { value: 'daily' }, 'Every day'), el('option', { value: 'weekly' }, 'Once a week'));
  const btn = el('button', { class: 'primary', type: 'submit' }, 'Send to my manager');
  return [
    el('h1', null, '💡 Suggest a task'),
    el('p', { class: 'muted' }, 'Your manager says yes or no. If yes, it comes on your list.'),
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.hidden = true;
      try { await api('suggest', { title: title.value, details: details.value, repeat: how.value }); toast('Sent for a yes ✓'); go('today'); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    } }, el('label', null, 'Task', title), el('label', null, 'Details', details), el('label', null, 'How often', how), err,
    el('div', { class: 'row' }, btn, el('button', { type: 'button', onClick: () => go('today') }, 'Cancel'))),
  ];
}

async function uploadPhotos(updateId, files) {
  for (const f of files) {
    const fd = new FormData();
    fd.append('updateId', String(updateId));
    fd.append('file', await shrink(f), 'photo.jpg');
    try { await api('photo.add', fd, true); } catch (ex) { toast(ex.message, 5000); }
  }
}

// ---------- manager: team today

function teamToday() {
  const d = state.data;
  const byPerson = new Map();
  for (const t of d.tasks) { if (!byPerson.has(t.assignee.id)) byPerson.set(t.assignee.id, []); byPerson.get(t.assignee.id).push(t); }
  const people = [...d.people];
  for (const t of d.tasks) if (!people.some((p) => p.id === t.assignee.id)) people.push({ id: t.assignee.id, name: t.assignee.name });
  return [
    el('div', { class: 'row spread' }, el('div', null, el('h1', null, 'Team today'),
      el('p', { class: 'muted small' }, `${fmtDay(d.today)} · updates due by ${d.fillBy}`)),
    el('button', { class: 'primary', onClick: () => go('give') }, '+ Give a task')),
    needsYou(d),
    people.length ? null : el('div', { class: 'card' }, 'No team members yet. ', el('button', { class: 'link', onClick: () => go('people') }, 'Add a person')),
    people.map((p) => {
      const tasks = byPerson.get(p.id) || [];
      const sent = tasks.filter((t) => t.today).length;
      const tag = !tasks.length ? el('span', { class: 'tag grey' }, 'No tasks today')
        : sent === tasks.length ? el('span', { class: 'tag green' }, `✓ ${sent} of ${tasks.length} sent`)
          : el('span', { class: 'tag ' + (d.late ? 'red' : 'amber') }, `${sent} of ${tasks.length} sent`);
      return el('div', { class: 'card person' + (tasks.length && sent < tasks.length && d.late ? ' late' : '') },
        el('div', { class: 'person-head' }, el('h3', null, p.name), tag),
        tasks.map((t) => teamRow(t, d)));
    }),
  ];
}

/** Top of Team today: what is waiting for the manager. */
function needsYou(d) {
  const stuck = d.stuck || []; const unread = d.unread || []; const sugg = d.suggestions || [];
  if (!stuck.length && !unread.length && !sugg.length) return null;
  const row = (t, what) => el('div', { class: 'trow', onClick: () => go('task:' + t.id) },
    el('div', { class: 'row spread' }, el('strong', null, `${t.assignee.name}: ${t.title}`), what),
    t.lastMessage && !t.lastMessage.mine ? el('div', { class: 'note2 small' }, `💬 ${t.lastMessage.text}`)
      : (t.today || t.last) ? el('div', { class: 'note2 small' }, (t.today || t.last).note) : null);
  const answer = async (t, yes) => {
    try {
      if (yes) { await api('task.approve', { id: t.id }); toast(`Added to ${t.assignee.name}'s list ✓`); }
      else {
        const why = prompt(`Not now — tell ${t.assignee.name} why (optional):`, '');
        if (why === null) return;
        await api('task.decline', { id: t.id, reason: why }); toast('Answered');
      }
      loadView();
    } catch (ex) { toast(ex.message, 5000); }
  };
  return el('div', { class: 'card needs' },
    el('h3', null, '⚠︎ Needs you'),
    stuck.map((t) => row(t, el('span', { class: 'tag red' }, 'Stuck'))),
    unread.map((t) => row(t, el('span', { class: 'tag amber' }, `💬 ${t.unread} new`))),
    sugg.map((t) => el('div', { class: 'trow' },
      el('div', null, el('span', { class: 'tag' }, '💡 Suggestion'), ' ', el('strong', null, `${t.assignee.name}: ${t.title}`)),
      el('div', { class: 'meta' }, repeatLabel(t)),
      t.details ? el('div', { class: 'pre small muted' }, t.details) : null,
      el('div', { class: 'row' },
        el('button', { class: 'primary', onClick: () => answer(t, true) }, '✓ Yes, add it'),
        el('button', { onClick: () => answer(t, false) }, 'Not now'),
        el('button', { onClick: () => go('task:' + t.id) }, '💬 Ask first')))));
}

function teamRow(t, d) {
  const u = t.today;
  return el('div', { class: 'trow', onClick: (e) => { if (e.target.tagName !== 'IMG') go('task:' + t.id); } },
    el('div', { class: 'row spread' }, el('strong', null, t.title), el('span', { class: 'meta' }, [t.project, repeatLabel(t, d.today)].filter(Boolean).join(' · '))),
    u ? [el('div', { class: 'row small' }, el('span', { class: 'ok' }, `✓ ${fmtTime(u.at)}`), stateTag(u.state)), el('div', { class: 'note2 pre small' }, u.note), thumbs(u.photos)]
      : el('div', { class: 'small ' + (d.late ? 'err' : 'warn') }, d.late ? '⚠︎ Not filled today' : 'Not filled yet'),
    !u && t.last ? el('div', { class: 'last' }, `Last: ${fmtDay(t.last.day)} — ${t.last.note.slice(0, 120)}`) : null,
    t.messages ? el('div', { class: 'small ' + (t.unread ? 'warn' : 'muted') }, `💬 ${t.messages} message${t.messages > 1 ? 's' : ''}${t.unread ? ` · ${t.unread} new` : ''}`) : null);
}

// ---------- manager: all tasks

function allTasks() {
  const d = state.data;
  const groups = new Map();
  for (const t of d.tasks) { if (!groups.has(t.assignee.name)) groups.set(t.assignee.name, []); groups.get(t.assignee.name).push(t); }
  return [
    el('div', { class: 'row spread' }, el('h1', null, 'Tasks'), el('button', { class: 'primary', onClick: () => go('give') }, '+ Give a task')),
    el('div', { class: 'row' },
      el('button', { class: 'chip' + (!state.closed ? ' on' : ''), onClick: () => { state.closed = false; go('tasks'); } }, 'Open'),
      el('button', { class: 'chip' + (state.closed ? ' on' : ''), onClick: () => { state.closed = true; go('tasks'); } }, 'Done / cancelled')),
    d.tasks.length ? null : el('p', { class: 'muted' }, state.closed ? 'Nothing closed yet.' : 'No open tasks. Give one with “+ Give a task”.'),
    [...groups].map(([name, tasks]) => el('div', { class: 'card' }, el('h3', null, name),
      tasks.map((t) => el('div', { class: 'trow', onClick: () => go('task:' + t.id) },
        el('div', { class: 'row spread' }, el('span', null, t.title), t.status !== 'open' ? el('span', { class: 'tag grey' }, t.status === 'done' ? 'Done' : 'Cancelled') : null),
        el('div', { class: 'meta' }, [t.project, repeatLabel(t), t.today ? 'sent today' : t.last ? `last update ${fmtDay(t.last.day)}` : 'no update yet'].filter(Boolean).join(' · ')))))),
  ];
}

function taskDetail() {
  const { task: t, updates, comments = [] } = state.data;
  const admin = state.user.role === 'admin';
  const setStatus = async (status) => {
    try { await api('task.status', { id: t.id, status }); toast(status === 'open' ? 'Opened again' : status === 'done' ? 'Marked done ✓' : 'Cancelled'); loadView(); } catch (ex) { toast(ex.message, 5000); }
  };
  return [
    el('button', { class: 'link', onClick: () => { if (state.fromProjects && state.user.owner) location.href = 'projects/'; else go(state.back || 'today'); } }, '← Back'),
    el('h1', null, t.title),
    el('p', { class: 'meta' }, [t.assignee.name, t.project, repeatLabel(t), t.status !== 'open' ? (t.status === 'done' ? 'Done' : 'Cancelled') : null].filter(Boolean).join(' · ')),
    t.details ? el('div', { class: 'card pre' }, t.details) : null,
    taskFiles(t, admin),
    t.needsPhoto ? el('p', { class: 'small warn' }, '📷 Photo needed to finish') : null,
    admin && t.status === 'open' ? (() => {
      const input = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, class: 'hidden-file', onChange: async () => {
        await uploadTaskFiles(t.id, [...input.files].slice(0, 10)); toast('Added ✓'); loadView();
      } });
      return el('label', { class: 'btn' }, '📎 Add instruction photo / PDF', input);
    })() : null,
    admin && t.status === 'suggested' ? el('div', { class: 'row' },
      el('span', { class: 'tag' }, `💡 Suggested by ${t.assignee.name}`),
      el('button', { class: 'primary', onClick: async () => { try { await api('task.approve', { id: t.id }); toast('Added ✓'); loadView(); } catch (ex) { toast(ex.message, 5000); } } }, '✓ Yes, add it'),
      el('button', { onClick: async () => { const why = prompt('Not now — why (optional):', ''); if (why === null) return; try { await api('task.decline', { id: t.id, reason: why }); toast('Answered'); loadView(); } catch (ex) { toast(ex.message, 5000); } } }, 'Not now')) : null,
    admin && t.status === 'open' ? moveBox(t) : null,
    admin && t.status !== 'suggested' ? el('div', { class: 'row' },
      el('button', { onClick: () => go('edit:' + t.id) }, '✎ Edit'),
      t.status === 'open' ? el('button', { onClick: () => { state.moving = state.moving === t.id ? 0 : t.id; render(); } }, '↔ Move to…') : null,
      t.status === 'open' ? [el('button', { onClick: () => setStatus('done') }, '✓ Mark done'), el('button', { onClick: () => { if (confirm('Cancel this task?')) setStatus('cancelled'); } }, 'Cancel task')]
        : el('button', { onClick: () => setStatus('open') }, 'Open again')) : null,
    messagesBlock(t.id, comments),
    el('h2', null, 'Updates'),
    updates.length ? updates.map((u) => el('div', { class: 'card' },
      el('div', { class: 'row small' }, el('strong', null, fmtDay(u.day)), el('span', { class: 'muted' }, fmtTime(u.at)), stateTag(u.state),
        u.byId !== t.assignee.id ? el('span', { class: 'muted' }, `by ${u.by}`) : null),
      el('div', { class: 'pre' }, u.note), thumbs(u.photos))) : el('p', { class: 'muted' }, 'No updates yet.'),
  ];
}

/** ↔ Move to…: the people to hand this task to. A step of a given project moves the whole project. */
function moveBox(t) {
  if (state.moving !== t.id) return null;
  const others = state.people.filter((p) => p.id !== t.assignee.id);
  const whole = t.seq !== null && t.seq !== undefined;
  return el('div', { class: 'card stack' },
    el('strong', null, whole ? `Move the whole project "${t.project}" (all its open steps) to:` : `Move "${t.title}" to:`),
    el('p', { class: 'muted small' }, 'Updates so far stay with the task. Both people see a note about the move.'),
    el('div', { class: 'row' }, others.length ? others.map((p) => el('button', { class: 'chip', onClick: async () => {
      try {
        const out = await api('task.move', { id: t.id, toId: p.id });
        state.moving = 0;
        toast(`${out.moved} task${out.moved === 1 ? '' : 's'} moved to ${p.name} ✓`);
        loadView();
      } catch (ex) { toast(ex.message, 5000); }
    } }, p.name)) : el('span', { class: 'muted' }, 'Add another person first (People).'),
    el('button', { class: 'link', onClick: () => { state.moving = 0; render(); } }, 'Cancel')));
}

function taskForm() {
  const editing = state.view.startsWith('edit:');
  if (editing && !state.data) return el('p', { class: 'muted' }, 'Loading…');
  const t = editing ? state.data.task : null;
  const pre = !editing ? (state.prefill || {}) : {};
  const err = el('p', { class: 'err', hidden: true });
  const person = el('select', { required: true }, el('option', { value: '' }, 'Choose a person…'),
    state.people.map((p) => el('option', { value: String(p.id) }, p.name + (p.role === 'admin' ? ' (manager)' : ''))));
  if (t) person.value = String(t.assignee.id);
  else if (state.people.filter((p) => p.role === 'staff').length === 1) person.value = String(state.people.find((p) => p.role === 'staff').id);
  const title = el('input', { value: t ? t.title : pre.title || '', required: true, placeholder: 'Record kiln 3 temperature' });
  const details = el('textarea', { value: t ? t.details : pre.details || '', placeholder: 'Anything they need to know (optional)' });
  const project = el('input', { value: t ? t.project : pre.project || '', placeholder: 'Kiln trial (optional)' });
  const kind = t ? (t.repeat === 'daily' ? (t.skipSunday ? 'daily' : 'daily7') : t.repeat) : 'daily';
  const how = el('select', null,
    el('option', { value: 'daily' }, 'Every day (Mon–Sat)'), el('option', { value: 'daily7' }, 'Every day, Sunday too'),
    el('option', { value: 'weekly' }, 'Once a week'), el('option', { value: 'once' }, 'One time'));
  how.value = kind;
  const weekday = el('select', null, LONG_DAYS.map((n, i) => el('option', { value: String(i) }, n)));
  weekday.value = String(t && t.weekday !== null ? t.weekday : 1);
  const due = el('input', { type: 'date', value: t && t.dueDate ? t.dueDate : '' });
  const needsPhoto = el('input', { type: 'checkbox', checked: t ? t.needsPhoto : false });
  const files = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true });
  const wLabel = el('label', null, 'On', weekday);
  const dLabel = el('label', null, 'By (date, optional)', due);
  const sync = () => { wLabel.hidden = how.value !== 'weekly'; dLabel.hidden = how.value !== 'once'; };
  how.addEventListener('change', sync);
  sync();
  const btn = el('button', { class: 'primary', type: 'submit' }, editing ? 'Save' : 'Give task');
  return [
    el('h1', null, editing ? 'Edit task' : 'Give a task'),
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      err.hidden = true; btn.disabled = true;
      try {
        const out = await api('task.save', {
          id: t ? t.id : 0, assigneeId: Number(person.value), title: title.value, details: details.value, project: project.value,
          repeat: how.value === 'daily7' ? 'daily' : how.value, skipSunday: how.value === 'daily', weekday: Number(weekday.value), dueDate: due.value,
          projectRef: t ? t.projectRef : pre.projectRef, stepRef: t ? t.stepRef : pre.stepRef, needsPhoto: needsPhoto.checked,
        });
        if (files.files.length) await uploadTaskFiles(out.task.id, [...files.files].slice(0, 10));
        const fromProjects = !editing && pre.stepRef && state.user.owner;
        state.prefill = null;
        toast(editing ? 'Saved ✓' : `Given to ${out.task.assignee.name} ✓`);
        if (fromProjects) { setTimeout(() => { location.href = 'projects/'; }, 900); return; }
        go(editing ? 'task:' + out.task.id : 'today');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    } },
    el('label', null, 'Who', person), el('label', null, 'Task', title), el('label', null, 'Details', details),
    el('label', null, 'Project', project), el('label', null, 'How often', how), wLabel, dLabel,
    el('label', { class: 'check' }, needsPhoto, ' 📷 Photo needed to finish'),
    el('label', null, '📎 Instruction photos / PDF (optional)', files), err,
    el('div', { class: 'row' }, btn, el('button', { type: 'button', onClick: () => { state.prefill = null; if (!editing && state.fromProjects && state.user.owner) { location.href = 'projects/'; return; } go(editing ? 'task:' + t.id : 'today'); } }, 'Cancel'))),
  ];
}

// ---------- manager: people

function tempPassword() {
  const words = ['kiln', 'glaze', 'clay', 'tile', 'mould', 'fire', 'slip', 'basin', 'press', 'dryer'];
  const a = new Uint32Array(3);
  crypto.getRandomValues(a);
  return `${words[a[0] % words.length]}-${words[a[1] % words.length]}-${100 + (a[2] % 900)}`;
}

function shareBox(p) {
  const link = location.origin + location.pathname.replace(/[^/]*$/, '');
  const text = `Work Task (daily updates)\nLink: ${link}\nUsername: ${p.username}\nPassword: ${p.password}\nAfter signing in, choose your own password.`;
  return el('div', { class: 'share stack' },
    el('strong', null, `Send this to ${p.name}`),
    el('div', { class: 'pre small' }, text),
    el('div', { class: 'row' },
      el('button', { onClick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied ✓'); } catch { toast('Select the text and copy it'); } } }, '📋 Copy'),
      el('a', { class: 'btn', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp'),
      el('button', { onClick: () => { state.newPerson = null; render(); } }, 'Done')));
}

function peopleScreen() {
  const users = state.data.users;
  const err = el('p', { class: 'err', hidden: true });
  const name = el('input', { required: true, placeholder: 'Suresh Kumar' });
  const username = el('input', { required: true, autocapitalize: 'none', spellcheck: 'false', placeholder: 'suresh' });
  const pass = el('input', { required: true, value: tempPassword() });
  const role = el('select', null, el('option', { value: 'staff' }, 'Staff (sees only own tasks)'), el('option', { value: 'admin' }, 'Manager (sees everything)'));
  name.addEventListener('input', () => { if (!username.dataset.touched) username.value = name.value.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, ''); });
  username.addEventListener('input', () => { username.dataset.touched = '1'; });
  const reset = async (u) => {
    const p = tempPassword();
    if (!confirm(`Give ${u.name} a new temporary password?\nThey will be signed out and must choose their own again.`)) return;
    try { await api('user.reset', { id: u.id, password: p }); state.newPerson = { name: u.name, username: u.username, password: p }; render(); } catch (ex) { toast(ex.message, 5000); }
  };
  const toggle = async (u) => {
    if (u.active && !confirm(`Switch off ${u.name}? They can no longer sign in. Their updates stay.`)) return;
    try { await api('user.active', { id: u.id, active: !u.active }); toast(u.active ? 'Switched off' : 'Switched on'); loadView(); } catch (ex) { toast(ex.message, 5000); }
  };
  const rename = async (u) => {
    const n = prompt('Name', u.name);
    if (!n || n === u.name) return;
    try { await api('user.save', { id: u.id, name: n, role: u.role }); loadView(); } catch (ex) { toast(ex.message, 5000); }
  };
  return [
    el('h1', null, 'People'),
    state.newPerson ? shareBox(state.newPerson) : null,
    users.map((u) => el('div', { class: 'card' },
      el('div', { class: 'row spread' }, el('div', null, el('strong', null, u.name), ' ', el('span', { class: 'muted small' }, '@' + u.username)),
        el('span', { class: 'tag ' + (!u.active ? 'grey' : u.role === 'admin' ? '' : 'green') }, !u.active ? 'Switched off' : u.role === 'admin' ? 'Manager' : 'Staff')),
      el('div', { class: 'meta' }, u.lastLogin ? `Last signed in ${fmtDay(u.lastLogin)} ${fmtTime(u.lastLogin)}` : 'Not signed in yet'),
      u.id === state.user.id ? null : el('div', { class: 'row' },
        el('button', { onClick: () => rename(u) }, '✎ Name'),
        el('button', { onClick: () => reset(u) }, '🔑 New password'),
        el('button', { onClick: () => toggle(u) }, u.active ? 'Switch off' : 'Switch on'),
        u.active ? el('button', { onClick: () => { state.movingAll = state.movingAll === u.id ? 0 : u.id; render(); } }, '↔ Move all tasks to…') : null),
      state.movingAll === u.id ? el('div', { class: 'row' }, el('span', { class: 'small muted' }, `All of ${u.name}'s open tasks go to:`),
        users.filter((x) => x.active && x.id !== u.id).map((x) => el('button', { class: 'chip', onClick: async () => {
          if (!confirm(`Move all of ${u.name}'s open tasks to ${x.name}?`)) return;
          try { const out = await api('tasks.moveAll', { fromId: u.id, toId: x.id }); state.movingAll = 0; toast(`${out.moved} task${out.moved === 1 ? '' : 's'} moved to ${x.name} ✓`); loadView(); }
          catch (ex) { toast(ex.message, 5000); }
        } }, x.name)),
        el('button', { class: 'link', onClick: () => { state.movingAll = 0; render(); } }, 'Cancel')) : null)),
    el('h2', null, 'Add a person'),
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      try {
        const out = await api('user.save', { name: name.value, username: username.value, password: pass.value, role: role.value });
        state.newPerson = { name: out.user.name, username: out.user.username, password: pass.value };
        toast('Added ✓');
        loadView();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    } },
    el('label', null, 'Name', name), el('label', null, 'Username (small letters, no spaces)', username),
    el('label', null, 'First password (they change it when they sign in)', pass), el('label', null, 'Role', role), err,
    el('button', { class: 'primary', type: 'submit' }, 'Add person')),
  ];
}

function settingsScreen() {
  const fill = el('input', { type: 'time', value: '18:00' });
  api('team.today').then((d) => { fill.value = d.fillBy; }).catch(() => {});
  return [
    el('h1', null, 'Settings'),
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      try { await api('settings.save', { fillBy: fill.value }); toast('Saved ✓'); } catch (ex) { toast(ex.message, 5000); }
    } },
    el('label', null, 'Updates are due by (after this, missing ones show red)', fill),
    el('button', { class: 'primary', type: 'submit' }, 'Save')),
  ];
}

// ---------------------------------------------------------------- start

/** From Daily Projects: worktask.in/#new={"title":…,"project":…,"projectRef":…,"stepRef":…} opens "Give a task" filled in. */
function takePrefill() {
  const m = /^#task=(\d+)$/.exec(location.hash); // from Daily Projects: open this team task
  if (m || location.hash.startsWith('#new=')) state.fromProjects = true; // Back / Cancel return to the projects
  if (m) { state.openTask = Number(m[1]); history.replaceState(null, '', location.pathname + location.search); return; }
  if (!location.hash.startsWith('#new=')) return;
  try { const p = JSON.parse(decodeURIComponent(location.hash.slice(5))); if (p && typeof p === 'object') state.prefill = p; } catch { /* ignore */ }
  history.replaceState(null, '', location.pathname + location.search);
}

const wantsProjects = new URLSearchParams(location.search).get('next') === 'projects';

async function start() {
  takePrefill();
  if (wantsProjects) history.replaceState(null, '', location.pathname + location.hash);
  if (!state.token) { render(); return; }
  try {
    state.user = (await api('me')).user; // offline: the copy kept on this phone
  } catch (e) {
    if (state.token) { toast(e.message, 5000); } // offline and never opened here before: keep the sign-in, try again later
    render();
    return;
  }
  await loadOutbox();
  // the owner opens the app on their projects; worktask.in/?team shows the Team pages
  const teamWanted = new URLSearchParams(location.search).has('team');
  if (state.user.owner && !state.user.mustChange && !teamWanted && !state.prefill && !state.openTask) { location.href = 'projects/'; return; }
  if (state.prefill && state.user.role === 'admin' && !state.user.mustChange) { go('give'); return; }
  if (state.openTask && !state.user.mustChange) { const id = state.openTask; state.openTask = 0; go('task:' + id); return; }
  render();
  if (!state.user.mustChange) loadView();
}

window.addEventListener('online', () => { setOffline(false); flushOutbox(); });
window.addEventListener('offline', () => setOffline(true));
setInterval(() => { if ((state.outbox || []).length) flushOutbox(); }, 30000); // weak signal: keep trying

window.addEventListener('hashchange', () => {
  takePrefill();
  if (state.prefill && state.user?.role === 'admin') go('give');
  else if (state.openTask && state.user) { const id = state.openTask; state.openTask = 0; go('task:' + id); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user && !state.user.mustChange && state.view === 'today' && !Object.keys(state.drafts).some((k) => state.drafts[k].note)) loadView();
});
start();
// Installable as an app (Android: Chrome menu → Install app); keeps the screens for fast opening.
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
