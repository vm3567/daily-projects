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

async function api(a, body = {}, form = false) {
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  if (!form) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch('api/?a=' + encodeURIComponent(a), { method: 'POST', headers, body: form ? body : JSON.stringify(body) });
  } catch {
    throw new Error('No internet connection. Try again.');
  }
  let out = null;
  try { out = await res.json(); } catch { out = null; }
  if (res.status === 401 && a !== 'login' && a !== 'password') { signedOut(); throw new Error(out?.error || 'Please sign in.'); }
  if (!out || !out.ok) throw new Error(out?.error || 'Something went wrong. Try again.');
  return out;
}

function signedOut() {
  state.token = ''; state.user = null; state.data = null;
  save(TOKEN_KEY, '');
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
    else if (state.view.startsWith('task:')) state.data = await api('task.get', { id: Number(state.view.slice(5)) });
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
  let body;
  if (!state.data && state.view !== 'settings' && state.view !== 'give') body = el('p', { class: 'muted' }, 'Loading…');
  else if (state.view === 'today') body = state.user.role === 'admin' ? teamToday() : myToday();
  else if (state.view === 'tasks') body = allTasks();
  else if (state.view === 'people') body = peopleScreen();
  else if (state.view === 'settings') body = settingsScreen();
  else if (state.view === 'give' || state.view.startsWith('edit:')) body = taskForm();
  else if (state.view.startsWith('task:')) body = taskDetail();
  root.replaceChildren(header(), el('main', { class: 'narrow' }, body));
}

function header() {
  const me = state.user;
  const tab = (v, label) => el('button', { class: state.view === v ? 'on' : '', onClick: () => go(v) }, label);
  return el('header', { class: 'top' }, el('div', { class: 'bar' },
    el('span', { class: 'brand' }, 'Work Task'),
    me.role === 'admin' && !me.mustChange ? el('nav', null, tab('today', 'Today'), tab('tasks', 'Tasks'), tab('people', 'People'), tab('settings', 'Settings')) : null,
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
    el('h1', null, 'My tasks today'),
    el('p', { class: 'muted small' }, `${fmtDay(d.today)} · ${sent} of ${d.tasks.length} sent · please send by ${d.fillBy}`),
    d.tasks.length ? d.tasks.map((t) => myTask(t, d.today)) : el('div', { class: 'card muted' }, 'No tasks for today. 🎉'),
    d.other.length ? [el('h2', null, 'Other tasks (not today)'), d.other.map((t) => el('div', { class: 'card' },
      el('h3', null, t.title), el('div', { class: 'meta' }, [t.project, repeatLabel(t, d.today)].filter(Boolean).join(' · '))))] : null,
  ];
}

function myTask(t, today) {
  const done = t.today && !state.editing[t.id];
  const late = t.repeat === 'once' && t.dueDate && t.dueDate < today;
  return el('div', { class: 'card' + (done ? ' sent' : late ? ' late' : '') },
    el('div', { class: 'task-head' }, el('h3', null, t.title), done ? el('span', { class: 'tag green' }, '✓ Sent') : null),
    el('div', { class: 'meta' }, [t.project, repeatLabel(t, today)].filter(Boolean).join(' · ')),
    t.details ? el('div', { class: 'pre small muted' }, t.details) : null,
    t.last ? el('div', { class: 'last' }, `Last time (${fmtDay(t.last.day)}): `, el('span', { class: 'pre' }, t.last.note)) : null,
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
    btn.disabled = true;
    try {
      const out = await api('update.save', { taskId: t.id, note: d.note, state: d.state });
      if (files.length) await uploadPhotos(out.update.id, files);
      delete state.drafts[t.id]; delete state.files[t.id]; delete state.editing[t.id];
      toast('Sent ✓');
      loadView();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
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

function teamRow(t, d) {
  const u = t.today;
  return el('div', { class: 'trow', onClick: (e) => { if (e.target.tagName !== 'IMG') go('task:' + t.id); } },
    el('div', { class: 'row spread' }, el('strong', null, t.title), el('span', { class: 'meta' }, [t.project, repeatLabel(t, d.today)].filter(Boolean).join(' · '))),
    u ? [el('div', { class: 'row small' }, el('span', { class: 'ok' }, `✓ ${fmtTime(u.at)}`), stateTag(u.state)), el('div', { class: 'note2 pre small' }, u.note), thumbs(u.photos)]
      : el('div', { class: 'small ' + (d.late ? 'err' : 'warn') }, d.late ? '⚠︎ Not filled today' : 'Not filled yet'),
    !u && t.last ? el('div', { class: 'last' }, `Last: ${fmtDay(t.last.day)} — ${t.last.note.slice(0, 120)}`) : null);
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
  const { task: t, updates } = state.data;
  const admin = state.user.role === 'admin';
  const setStatus = async (status) => {
    try { await api('task.status', { id: t.id, status }); toast(status === 'open' ? 'Opened again' : status === 'done' ? 'Marked done ✓' : 'Cancelled'); loadView(); } catch (ex) { toast(ex.message, 5000); }
  };
  return [
    el('button', { class: 'link', onClick: () => go(state.back || 'today') }, '← Back'),
    el('h1', null, t.title),
    el('p', { class: 'meta' }, [t.assignee.name, t.project, repeatLabel(t), t.status !== 'open' ? (t.status === 'done' ? 'Done' : 'Cancelled') : null].filter(Boolean).join(' · ')),
    t.details ? el('div', { class: 'card pre' }, t.details) : null,
    admin ? el('div', { class: 'row' },
      el('button', { onClick: () => go('edit:' + t.id) }, '✎ Edit'),
      t.status === 'open' ? [el('button', { onClick: () => setStatus('done') }, '✓ Mark done'), el('button', { onClick: () => { if (confirm('Cancel this task?')) setStatus('cancelled'); } }, 'Cancel task')]
        : el('button', { onClick: () => setStatus('open') }, 'Open again')) : null,
    el('h2', null, 'Updates'),
    updates.length ? updates.map((u) => el('div', { class: 'card' },
      el('div', { class: 'row small' }, el('strong', null, fmtDay(u.day)), el('span', { class: 'muted' }, fmtTime(u.at)), stateTag(u.state)),
      el('div', { class: 'pre' }, u.note), thumbs(u.photos))) : el('p', { class: 'muted' }, 'No updates yet.'),
  ];
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
          projectRef: t ? t.projectRef : pre.projectRef, stepRef: t ? t.stepRef : pre.stepRef,
        });
        state.prefill = null;
        toast(editing ? 'Saved ✓' : `Given to ${out.task.assignee.name} ✓`);
        go(editing ? 'task:' + out.task.id : 'today');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    } },
    el('label', null, 'Who', person), el('label', null, 'Task', title), el('label', null, 'Details', details),
    el('label', null, 'Project', project), el('label', null, 'How often', how), wLabel, dLabel, err,
    el('div', { class: 'row' }, btn, el('button', { type: 'button', onClick: () => { state.prefill = null; go(editing ? 'task:' + t.id : 'today'); } }, 'Cancel'))),
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
        el('button', { onClick: () => toggle(u) }, u.active ? 'Switch off' : 'Switch on')))),
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
  if (!location.hash.startsWith('#new=')) return;
  try { const p = JSON.parse(decodeURIComponent(location.hash.slice(5))); if (p && typeof p === 'object') state.prefill = p; } catch { /* ignore */ }
  history.replaceState(null, '', location.pathname + location.search);
}

async function start() {
  takePrefill();
  if (!state.token) { render(); return; }
  try {
    state.user = (await api('me')).user;
  } catch (e) {
    if (state.token) { toast(e.message, 5000); } // no connection: keep the sign-in, try again later
    render();
    return;
  }
  if (state.prefill && state.user.role === 'admin' && !state.user.mustChange) { go('give'); return; }
  render();
  if (!state.user.mustChange) loadView();
}

window.addEventListener('hashchange', () => { takePrefill(); if (state.prefill && state.user?.role === 'admin') go('give'); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user && !state.user.mustChange && state.view === 'today' && !Object.keys(state.drafts).some((k) => state.drafts[k].note)) loadView();
});
start();
