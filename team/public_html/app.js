// Work Task: the team app. Staff see and fill their own tasks; the manager gives tasks and sees everything.
// No outside libraries. All text from the server is put on screen as text (never as HTML).

import { addDay, weekdayOf, dueOn, itemKey, diaryRows, fieldChanged, lateValue, afterFlush, boxStillThere, updateSaveBody, redrawHow, projectRowState, aboutShort, projectAboutOf, giveBackShow, keptNotice, noticeHow, pasteWaits, msgBoxSent, redrawAfterSend, taskSaveBody, morningMail, morningOrder, morningSummary, morningTitle, morningLast, mailDate, sentTag, sentTime, followupRows, followupGroups, followupSummary, roundKey, roundPlan, roundMark, parseQuickTask, outlookLine, emailPath, pasteReason } from './logic.js'; // the rules (checked in tests/team-app.test.mjs)

const TOKEN_KEY = 'wt.token';
const state = {
  token: load(TOKEN_KEY), user: null, view: 'today', data: null, people: [], closed: false,
  sel: null, detail: null, mobileDetail: false, menuOpen: false, section: 'today', personFilter: 0, newIds: new Set(), knownIds: new Set(),
  drafts: {}, editing: {}, files: {}, sending: {}, busy: false, prefill: null, newPerson: null,
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

/** The coloured bar at the top, like a new-mail alert: blue = new task / project / message, green = an update. */
let noticeTimer = 0;
let kept = [], held = null; // the refused words on show (they add up), and a notice that waits until they are closed
function notice(kind, title, body, onOpen, opts = {}) {
  let n = document.getElementById('notice');
  if (!n) { n = el('div', { id: 'notice', role: 'status' }); document.body.append(n); }
  const how = noticeHow({ copyOpen: !n.hidden && kept.length > 0, copy: !!opts.copy }); // (the rule: logic.js)
  if (how === 'hold') { held = [kind, title, body, onOpen, opts]; return; } // never over words still to copy
  if (how === 'add') { kept.push({ title, body }); ({ title, body } = keptNotice(kept)); }
  n.className = 'notice ' + (kind === 'update' ? 'green' : kind === 'stuck' ? 'amber' : 'blue');
  n.replaceChildren(
    opts.copy ? el('div', { class: 'notice-main notice-copy' }, el('strong', null, title), body ? el('span', null, body) : null) // (words to copy: not a button)
      : el('button', { class: 'notice-main', onClick: () => { hideNotice(); if (onOpen) onOpen(); } },
        el('strong', null, title), body ? el('span', null, body) : null),
    el('button', { class: 'notice-x', 'aria-label': 'Close', onClick: hideNotice }, '✕'));
  n.hidden = false;
  n.classList.remove('in'); void n.offsetWidth; n.classList.add('in'); // slide in again for each new one
  clearTimeout(noticeTimer);
  if (!opts.stay) noticeTimer = setTimeout(hideNotice, 12000); // (words to copy stay until closed)
}
function hideNotice() {
  const n = document.getElementById('notice'); if (n) n.hidden = true;
  const wasKept = kept.length > 0; kept = [];
  if (wasKept && held) { const h = held; held = null; notice(...h); } // the news that waited behind the words to copy
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
  const by = t.dueDate ? (today && t.status === 'open' && t.dueDate < today ? ` · ⏰ late, was by ${fmtDay(t.dueDate)}` : ` · by ${fmtDay(t.dueDate)}`) : '';
  if (t.seq !== null && t.seq !== undefined && t.status === 'open') return (t.queued ? 'Coming next' : 'Current step — send an update each day') + by;
  if (today && t.startDate && t.startDate > today && t.status === 'open') return `Starts ${fmtDay(t.startDate)}`;
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
class AuthError extends Error {} // signed out (password reset, sign-in too old)
class RetryError extends Error {} // the server had a hiccup: try again later
const READS = new Set(['me', 'my.today', 'team.today', 'tasks.list', 'users.list', 'task.get', 'projects.overview', 'project.team', 'project.mine', 'report.week', 'followup.list', 'people.morning']);
const cacheKey = (a, body) => 'wt.c.' + a + ':' + JSON.stringify(body || {});
function readCache(a, body) { try { return JSON.parse(localStorage.getItem(cacheKey(a, body)) || 'null'); } catch { return null; } }
function writeCache(a, body, out) { try { localStorage.setItem(cacheKey(a, body), JSON.stringify(out)); } catch { /* phone storage full: still works online */ } }
function clearCache() { try { for (const k of Object.keys(localStorage)) if (k.startsWith('wt.c.')) localStorage.removeItem(k); } catch { /* blocked */ } }

function setOffline(on) {
  if (state.offline === on) return;
  state.offline = on;
  refreshBar();
  if (on) return;
  flushOutbox();
  // a screen that had no saved copy: load it now the internet is back
  if (state.user && !state.user.mustChange && !state.data && !state.busy && !['settings', 'give', 'suggest', 'password'].includes(state.view)) loadView();
}

/** Redraw only the offline bar (a whole redraw would wipe what is being typed). */
function refreshBar() {
  const h = document.getElementById('bar');
  if (h) h.replaceChildren(...[offlineBar(), pushBanner()].filter(Boolean)); // (keep the "turn on notifications" banner)
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
    tx.onabort = () => reject(tx.error || new Error('Could not save on this phone.')); // e.g. phone storage full
  });
}
async function loadOutbox() {
  try { state.outbox = ((await outbox('readonly', (s) => s.getAll())) || []).filter((x) => state.user && x.userId === state.user.id); }
  catch { state.outbox = []; }
}
const newClientId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));

async function queue(item) {
  // clientId: the server keeps a message or photo only once, even if a lost reply makes the phone send it again
  // an online send that lost its reply keeps its clientId, so the server sees the repeat
  await outbox('readwrite', (s) => s.add({ ...item, clientId: item.clientId || newClientId(), userId: state.user.id, at: new Date().toISOString() }));
  await loadOutbox();
  refreshBar();
}
// remember how far an item got; only while it is still there (another tab may have sent and removed it)
const keep = (it) => outbox('readwrite', (s) => { s.get(it.id).onsuccess = (e) => { if (e.target.result) s.put(it); }; });
const KEEP_FAIL = 'Could not keep this on the phone. Try again when online.';
const istDay = (at) => new Date(at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Send one waiting item. Each step is remembered, so a cut-off send does not repeat what already went. */
async function sendItem(it, tok) {
  const day = istDay(it.at); // the day it was written, not the day it is sent
  const mine = () => { if (state.token !== tok) throw new AuthError('Signed out.'); }; // never send with the next person's sign-in
  if (it.kind === 'update' && !it.updateId && daysBetween(day, istDay(new Date())) > 2) // the server would save it as today's update
    throw new Error(`This update was written on ${fmtDay(day)}, too long ago to send. Please write it again for today`);
  if (it.kind === 'comment') { await api('comment.add', { taskId: it.taskId, text: it.text, day, clientId: it.clientId }); return; }
  if (it.kind === 'step') { const out = await api('project.addStep', { projectRef: it.projectRef, title: it.title, clientId: it.clientId }); if (out.task) state.knownIds.add(out.task.id); return; }
  if (it.kind === 'suggest') { await api('suggest', { title: it.title, details: it.details, repeat: it.repeat, clientId: it.clientId }); return; }
  if (it.kind === 'update' && !it.updateId) {
    const twoSteps = it.state === 'finished' && it.needsPhoto && it.files && it.files.length && !it.hadPhoto;
    const out = await api('update.save', updateSaveBody({ taskId: it.taskId, note: it.note, state: twoSteps ? 'progress' : it.state, day, writtenAt: it.at, clientId: it.clientId })); // (a resend after a lost answer = the same save)
    it.updateId = out.update.id; it.thenFinish = !!twoSteps && !out.history;
    if (twoSteps) it.note = out.update.note; // keep the earlier person's words (after a move) for the Finished save
    if (out.history === 'merged' || out.history === 'older') { // kept as words only (the task moved on, or a newer update of theirs stays)
      if ((it.files || []).length) toast('The photos of a late update were not added: the task has a newer update now.', 7000);
      it.files = [];
    }
    await keep(it);
  }
  while ((it.files || []).length) { // kind 'update' or 'photos'
    mine();
    const fd = new FormData(); fd.append('updateId', String(it.updateId)); fd.append('file', it.files[0], 'photo.jpg');
    if (it.clientId) fd.append('clientId', `${it.clientId}-p${it.photoNo || 0}`);
    try { await api('photo.add', fd, true); it.files.shift(); it.photoNo = (it.photoNo || 0) + 1; }
    catch (ex) {
      if (ex instanceof OfflineError || ex instanceof AuthError || ex instanceof RetryError) throw ex;
      if (/^Up to \d+ photos/.test(ex.message)) it.files = []; // already full: the photos went before
      else { it.files.shift(); toast(`A photo was not sent: ${ex.message}`, 8000); }
    }
    await keep(it);
  }
  mine();
  if (it.thenFinish) await api('update.save', updateSaveBody({ taskId: it.taskId, note: it.note, day, clientId: it.clientId, finish: true }));
}

let flushP = null;
/** Send what waited on this phone, oldest first. Stops at the first "still offline".
 *  One send at a time: a second call waits for the one already going. */
function flushOutbox() {
  if (flushP) return flushP;
  if (!state.user) return Promise.resolve();
  // two tabs (or the installed app and a browser tab) must not send the same items
  const run = navigator.locks ? navigator.locks.request('wt-outbox', { ifAvailable: true }, (lock) => (lock ? doFlush() : null)) : doFlush();
  flushP = Promise.resolve(run).catch(() => {}).finally(() => { flushP = null; });
  return flushP;
}

/** The task as this screen last saw it (the open task, or the lists). */
const knownTask = (id) => (state.detail && state.detail.task && state.detail.task.id === id ? state.detail.task
  : [...((state.data && state.data.tasks) || []), ...((state.data && state.data.other) || [])].find((x) => x.id === id));

/** A waiting item is given up on: put the text (and photos) back in the box, so nothing written is lost.
 *  An update or a message also shows the whole words in a notice that stays (the task may be moved or closed: no box). */
function giveBack(it, why) {
  if (it.kind === 'comment') { if (!state.drafts['m' + it.taskId]) state.drafts['m' + it.taskId] = it.text; }
  else if (it.kind === 'update' && !it.updateId && !state.drafts[it.taskId]) {
    state.drafts[it.taskId] = { note: it.note, state: it.state }; state.editing[it.taskId] = true;
    if ((it.files || []).length) state.files[it.taskId] = it.files.slice(0, 5);
  }
  else if (it.kind === 'step') { (state.stepDrafts ||= {})[it.projectRef] = it.title; }
  const boxThere = it.kind === 'step' ? myProjects().some((p) => p.ref === it.projectRef) // (taken back or moved: no Add a step box)
    : it.kind === 'suggest' ? false : boxStillThere(knownTask(it.taskId), state.user && state.user.id);
  const show = giveBackShow(it, why, boxThere); // (the rule: logic.js)
  if (show.sticky) notice('stuck', show.title, show.body, null, { stay: true, copy: true });
  else toast(show.text, show.ms);
}

/** What a waiting item belongs to: later items of the same thing wait behind one that keeps failing. */

async function doFlush() {
  if (!state.user) return;
  let sent = 0, gave = 0;
  const uid = state.user.id, tok = state.token;
  const stuck = new Set(); // tasks with an item the server keeps failing on: later items for them wait behind it
  try {
    await loadOutbox();
    for (const it of [...state.outbox].sort((x, y) => x.id - y.id)) {
      if (!state.user || state.user.id !== uid || state.token !== tok || it.userId !== uid) break; // signed out, or someone else signed in
      if (stuck.has(itemKey(it))) continue;
      try {
        await sendItem(it, tok);
        await outbox('readwrite', (s) => s.delete(it.id));
        sent++;
      } catch (ex) {
        if (ex instanceof OfflineError || ex instanceof AuthError) break; // keep it: try again later
        if (ex instanceof RetryError) { // a server error: keep it, but after a few tries let the items behind it go first
          it.tries = (it.tries || 0) + 1;
          if (it.tries >= 20 && Date.now() - new Date(it.at) > 12 * 3600000) { // failing for half a day: give up on it
            await outbox('readwrite', (s) => s.delete(it.id));
            giveBack(it, ex.message); gave++;
            continue;
          }
          await keep(it);
          if (it.tries < 5) break;
          stuck.add(itemKey(it));
          continue;
        }
        await outbox('readwrite', (s) => s.delete(it.id)); // refused by the server (e.g. task closed): say so, do not retry forever
        giveBack(it, ex.message); gave++;
      }
    }
  } finally {
    await loadOutbox();
    if (sent) toast(`✓ ${sent} waiting item${sent > 1 ? 's' : ''} sent`);
    // reload only screens that show the sent items: a reload would wipe a form being typed
    const v = state.sel || state.view, a = document.activeElement;
    const typing = (a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) && document.getElementById('app').contains(a)) || formHasText();
    // (an item given back is redrawn too: its "Waiting to send" card goes, the box with the words comes back)
    const next = state.user && !state.user.mustChange ? afterFlush({ sent, gaveBack: gave, typing, view: v }) : 'bar';
    if (next === 'later') state.reloadLater = true; // reload once they stop typing (next screen, or back to the app)
    if (next === 'reload') loadView(); else refreshBar();
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
  const headers = {}, tok = state.token;
  if (tok) headers.Authorization = 'Bearer ' + tok;
  if (!form) headers['Content-Type'] = 'application/json';
  let res;
  // weak signal (connected, but nothing moves): give up after a while and treat it as offline
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), form ? 60000 : 15000) : 0;
  try {
    res = await fetch('api/?a=' + encodeURIComponent(a), { method: 'POST', headers, body: form ? body : JSON.stringify(body), signal: ac ? ac.signal : undefined });
  } catch {
    clearTimeout(timer);
    setOffline(true);
    if (READS.has(a)) { const c = readCache(a, body); if (c) return { ...c, fromCache: true }; }
    throw new OfflineError('You are offline. Try again when the internet is back.');
  }
  setOffline(false);
  let out = null;
  try { out = await res.json(); } catch { out = null; } finally { clearTimeout(timer); }
  if (res.status === 428) { // must choose their own password first: keep waiting work, show the password screen
    if (state.user && !state.user.mustChange) { state.user.mustChange = true; render(); }
    throw new AuthError(out?.error || 'Choose your own password first.');
  }
  if (res.status === 401 && a !== 'login' && a !== 'password') {
    if (state.token === tok) signedOut(); // an old sign-in's answer must not sign out the person now here
    throw new AuthError(out?.error || 'Please sign in.');
  }
  // a hiccup (server error, too busy, or a page that is not an answer): try again later
  if (res.status >= 500 || res.status === 408 || res.status === 429 || (!out && res.status < 400)) throw new RetryError(out?.error || 'Something went wrong. Try again.');
  if (!out) throw new Error(`The server refused this (${res.status}).`); // e.g. the host's firewall: trying again will not help
  if (!out.ok) throw new Error(out.error || 'Something went wrong. Try again.');
  if (READS.has(a) && !form) writeCache(a, body, out);
  return out;
}

function signedOut() {
  state.token = ''; state.user = null; state.data = null; state.outbox = [];
  // nothing typed or picked carries over to the next person on this phone
  state.drafts = {}; state.files = {}; state.editing = {}; state.sending = {}; state.newPerson = null;
  state.back = ''; state.moving = 0; state.view = 'today'; state.closed = false;
  state.sel = null; state.detail = null; state.mobileDetail = false; state.menuOpen = false; state.section = 'today'; state.personFilter = 0; state.team = null;
  state.pushOn = false; hideNotice();
  state.searchQ = ''; state.searchResults = null; state.stepDrafts = {}; state.reportEnd = ''; state.backTo = null; state.taskMenu = 0;
  state.knownIds.clear(); state.newIds.clear();
  // signed out (also by a password reset): this phone stops getting their notifications, and the icon number goes
  if ('serviceWorker' in navigator && 'PushManager' in window) navigator.serviceWorker.getRegistration().then((r) => r && r.pushManager.getSubscription()).then((sub) => sub && sub.unsubscribe()).catch(() => {});
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
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

let loadSeq = 0;
/** The middle column: Today (team or mine), Tasks, People. */
async function loadList() {
  const me = state.user, view = state.view, n = ++loadSeq;
  if (!me) return;
  state.busy = true; state.reloadLater = false;
  let data = state.data, failed = null;
  try {
    if (view === 'today') {
      data = await api(me.role === 'admin' ? 'team.today' : 'my.today');
      // offline next morning: yesterday's copy must not show yesterday's updates as sent today
      if (data && data.fromCache && data.today !== istDay(new Date())) data = { ...data, stale: true, late: false, tasks: data.tasks.map((t) => ({ ...t, last: t.today || t.last, today: null })) };
      if (me.role === 'admin' && data && data.people) state.team = data; // the people in the menu
    }
    else if (view === 'tasks') data = await api('tasks.list', { status: state.closed ? 'closed' : 'open' });
    else if (view === 'people') { // (each person's pending work and today's morning email: one request; the page still shows without it)
      const [u, m] = await Promise.all([api('users.list'), api('people.morning').catch(() => null)]);
      data = { ...u, morning: m };
    }
    else if (view === 'projects') data = await api('projects.overview');
    else if (view === 'report') data = await api('report.week', state.reportEnd ? { end: state.reportEnd } : {});
    else if (view === 'search') data = { search: true }; // the results come as you type
    else if (view === 'followup') { // (the people: for "Valar: …" in the one-line box and Change person)
      const [f, u] = await Promise.all([api('followup.list'), api('users.list')]);
      data = { ...f, people: u.users.filter((x) => x.active) };
    }
    else data = null;
  } catch (e) { failed = e; }
  if (state.user !== me) { state.busy = false; return; } // signed out meanwhile
  if (n !== loadSeq) return; // a newer load started: this answer is old
  if (state.view !== view) { state.busy = false; if (!state.data) loadList(); return; } // another screen meanwhile (a task opened from People, say)
  state.data = data; state.busy = false;
  if (data && data.fillBy) state.fillBy = data.fillBy; // kept for screens whose list has no time (Tasks, Projects, Search)
  state.loadFailed = !!failed && !data;
  if (failed) toast(failed.message, 5000);
  // T-d: a form being filled in (Give a task) is not wiped: the list is redrawn when they stop
  const a = document.activeElement;
  if (state.sel && formHasText()) { softRender(); return; } // something typed in the open form: only the menu and list are redrawn (or later)
  void a;
  render();
}

let detailSeq = 0;
/** The right column: one task (with its messages and updates), or Give / Edit a task. */
async function loadDetail() {
  const me = state.user, sel = state.sel, n = ++detailSeq;
  if (!me || !sel) return;
  let detail = state.detail, people = state.people, failed = null;
  try {
    if (sel.startsWith('task:')) {
      detail = await api('task.get', { id: Number(sel.slice(5)) });
      const now = istDay(new Date());
      if (detail && detail.fromCache && detail.task && detail.task.today && detail.task.today.day !== now) { // the saved copy is from an earlier day
        detail = { ...detail, task: { ...detail.task, last: detail.task.today, today: null } };
      }
      if (me.role === 'admin') people = (await api('users.list')).users.filter((u) => u.active);
    } else if (sel.startsWith('project:')) {
      detail = await api(me.role === 'admin' ? 'project.team' : 'project.mine', { projectRef: sel.slice(8) });
    } else if (sel === 'give' || sel.startsWith('edit:')) {
      people = (await api('users.list')).users.filter((u) => u.active);
      detail = sel.startsWith('edit:') ? await api('task.get', { id: Number(sel.slice(5)) }) : null;
    } else detail = null;
  } catch (e) { failed = e; }
  if (state.user !== me || n !== detailSeq || state.sel !== sel) return; // signed out, or another task opened meanwhile
  // Give a task is already on screen: redraw only if the people changed (a redraw wipes what is typed)
  const same = sel === 'give' && state.people.length && JSON.stringify(people) === JSON.stringify(state.people);
  state.detail = detail; state.people = people;
  state.detailFailed = !!failed && !detail;
  if (failed) toast(failed.message, 5000);
  if (!same) { if (formHasText()) { state.reloadLater = true; return; } render(); } // (never over something being typed)
}

/** Reload what is on screen (the list, and the open task). */
function loadView() {
  loadList();
  if (state.sel) loadDetail();
}

const LIST_VIEWS = ['today', 'tasks', 'people', 'settings', 'projects', 'report', 'search', 'followup'];

/** go('today' | 'tasks' | 'people' | 'settings') changes the list; anything else ('task:5', 'give', 'edit:5', 'suggest', 'password') opens on the right. */
function go(view) {
  if (!LIST_VIEWS.includes(view)) { openDetail(view); return; }
  dropBack(); // the open task closes: its Back step goes too
  state.fromProjects = false; // (only the task opened from the projects page goes back there)
  state.view = view;
  state.round = null; // (the follow-up round ends when another list is opened)
  state.data = null; state.loadFailed = false;
  state.sel = null; state.detail = null; state.mobileDetail = false; state.menuOpen = false; state.moving = 0;
  render();
  loadList();
}

/** Something is typed (or a file picked) in a form on screen: a redraw now would wipe it. */
function formHasText(root = document.getElementById('app')) {
  if (!root) return false;
  return [...root.querySelectorAll('textarea, input, select')].some((i) => fieldChanged({ // (the rule: logic.js)
    tagName: i.tagName, type: i.type, disabled: i.disabled, readOnly: i.readOnly, value: i.value, checked: i.checked,
    fileCount: i.files ? i.files.length : 0, init: i.dataset.init }));
}

// the phone's Back button closes the open task (or the menu) instead of leaving the app
function pushBack() { if (!history.state || !history.state.wt) history.pushState({ wt: 1 }, ''); }
let ignorePop = false;
/** The open task / menu closed without Back: take its Back step out of the history (the next Back leaves as expected). */
function dropBack() { if (history.state && history.state.wt) { ignorePop = true; history.back(); } }
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; if (state.sel || state.menuOpen) pushBack(); return; } // something opened meanwhile: it gets its Back step
  if (!state.user) return;
  if (state.menuOpen) { state.menuOpen = false; menuRender(); if (state.sel) pushBack(); return; }
  if (state.sel) closeDetail(true);
});

function openDetail(sel) {
  if (sel.startsWith('task:')) state.newIds.delete(Number(sel.slice(5)));
  if (state.sel && state.sel !== sel) state.fromProjects = false;
  // a step opened from its project: Back goes to the project again
  if (state.sel !== sel) state.backTo = sel.startsWith('task:') && state.sel && state.sel.startsWith('project:') ? state.sel : null;
  pushBack();
  state.sel = sel; state.detail = null; state.detailFailed = false; state.moving = 0;
  state.taskMenu = 0; state.diaryDays = 0;
  state.mobileDetail = true; state.menuOpen = false;
  if (state.view === 'people' || state.view === 'settings' || state.view === 'report') { state.view = 'today'; state.data = null; } // these fill the page: show a list again
  render();
  if (!state.data && !state.busy) loadList();
  loadDetail();
}

/** Back (phone) / close: the list again. */
async function closeDetail(fromBackButton = false) {
  if (!fromBackButton && history.state && history.state.wt) { history.back(); return; } // the same as the phone's Back (it comes back here)
  if (state.fromProjects && state.user.owner && (await toProjects())) return;
  if (state.backTo) { const b = state.backTo; state.backTo = null; openDetail(b); return; }
  state.sel = null; state.detail = null; state.mobileDetail = false; state.moving = 0;
  render();
}

// ---------------------------------------------------------------- screens

let lastRender = 0;
function render() {
  const root = document.getElementById('app');
  if (state.token && !state.user && state.retryMe) { // offline (or the server is down) on opening: try again by itself
    root.replaceChildren(el('main', { class: 'narrow' }, brandBig(), el('p', { class: 'muted' }, '📴 Could not reach Work Task. Trying again…')));
    return;
  }
  if (!state.token || !state.user) { root.replaceChildren(loginScreen()); return; }
  if (state.user.mustChange) { root.replaceChildren(passwordScreen()); return; }
  // keep where each column was scrolled (the screen is drawn again after every change)
  const keep = ['list', 'detail'].map((id) => { const n = document.getElementById(id); return n ? n.scrollTop : 0; });
  const sameScreen = lastRender && state.renderKey === `${state.view}|${state.sel}`;
  const wide = isWide();
  root.replaceChildren(el('div', {
    class: layoutClass(wide),
  },
  el('aside', { id: 'menu' }, menuColumn()),
  el('div', { class: 'scrim', onClick: () => { state.menuOpen = false; if (!state.sel) dropBack(); menuRender(); } }),
  el('main', { id: 'list' }, listColumn(wide)),
  wide ? null : el('section', { id: 'detail' }, detailColumn())));
  if (sameScreen) ['list', 'detail'].forEach((id, i) => { const n = document.getElementById(id); if (n) n.scrollTop = keep[i]; });
  state.renderKey = `${state.view}|${state.sel}`; lastRender = Date.now();
  // how each field looked when drawn (so a preset choice or a restored draft is not "typing")
  root.querySelectorAll('input, textarea, select').forEach((x) => { x.dataset.init = x.type === 'checkbox' ? String(x.checked) : x.value; });
  setBadge();
}

const isWide = () => state.view === 'people' || state.view === 'settings' || state.view === 'report';
const layoutClass = (wide) => ['layout', wide ? 'wide' : '', state.mobileDetail && !wide ? 'show-detail' : '', state.menuOpen ? 'menu-open' : ''].filter(Boolean).join(' ');

/** Redraw for a click in the menu or the list: a Give / Edit form half filled in on the right is kept as it is. */
function softRender() {
  const menu = document.getElementById('menu'), list = document.getElementById('list'), detail = document.getElementById('detail');
  const how = redrawHow({ typed: formHasText(), listTyped: formHasText(list) || formHasText(menu), hasDetail: !!detail && !!menu && !!list && !isWide() }); // (the rule: logic.js)
  if (how === 'all') { render(); return; }
  if (how === 'later') { state.reloadLater = true; return; }
  const top = list.scrollTop, wide = isWide();
  const m = el('aside', { id: 'menu' }, menuColumn()), l = el('main', { id: 'list' }, listColumn(wide));
  menu.replaceWith(m); list.replaceWith(l); l.scrollTop = top;
  if (l.parentNode) l.parentNode.className = layoutClass(wide);
  [m, l].forEach((c) => c.querySelectorAll('input, textarea, select').forEach((x) => { x.dataset.init = x.type === 'checkbox' ? String(x.checked) : x.value; }));
  setBadge();
}

/** Open or close the ☰ menu: only the menu and the layout's class change, so a Give / Edit / Add a person form half filled is kept. */
function menuRender() {
  const menu = document.getElementById('menu'), layout = menu && menu.parentNode;
  if (!layout) { render(); return; }
  if (!formHasText(menu)) {
    const m = el('aside', { id: 'menu' }, menuColumn());
    menu.replaceWith(m);
    m.querySelectorAll('input, textarea, select').forEach((x) => { x.dataset.init = x.type === 'checkbox' ? String(x.checked) : x.value; });
  }
  layout.className = layoutClass(isWide());
}

const brandBig = () => el('div', { class: 'brand-big' }, el('img', { src: 'icons/icon-192.png', alt: '', width: 40, height: 40 }), el('h1', null, 'Work Task'));

/** Left column, like the projects menu: the lists, the team (with today's dots), your name. */
function menuColumn() {
  const me = state.user, admin = me.role === 'admin';
  const item = (label, on, onClick, count, extra) => el('li', null, el('button', { class: 'menu-item' + (on ? ' current' : '') + (extra || ''), onClick }, label, count ? el('span', { class: 'count' }, String(count)) : null));
  const d = state.view === 'today' ? state.data : null;
  const parts = [];
  if (admin) {
    const t = state.team;
    const needs = t ? (t.stuck || []).length + (t.unread || []).length + (t.suggestions || []).length : 0;
    parts.push(el('ul', { class: 'menu-list' },
      me.owner ? item('📋 My projects', false, () => toProjects()) : null,
      item('Team today', state.view === 'today' && !state.personFilter, () => { state.personFilter = 0; go('today'); }, needs || null),
      item('🔁 Follow-up', state.view === 'followup', () => go('followup')),
      item('Tasks', state.view === 'tasks' && !state.closed, () => { state.closed = false; go('tasks'); }),
      item('Done / cancelled', state.view === 'tasks' && state.closed, () => { state.closed = true; go('tasks'); }),
      item('📁 Projects', state.view === 'projects', () => go('projects')),
      item('📊 Weekly report', state.view === 'report', () => go('report')),
      item('🔍 Search', state.view === 'search', () => go('search')),
      item('People ↗', false, () => openPeoplePage()), // one People page: on the projects page
      item('Settings', state.view === 'settings', () => go('settings'))),
      el('button', { class: 'primary menu-cta', onClick: () => openDetail('give') }, '+ Give a task'));
    if (t && t.people && t.people.length) {
      parts.push(el('div', { class: 'menu-head' }, 'Team'), el('ul', { class: 'menu-list' }, t.people.map((p) => {
        const tasks = t.tasks.filter((x) => x.assignee.id === p.id);
        const sent = tasks.filter((x) => x.today).length;
        const dot = !tasks.length ? 'grey' : sent === tasks.length ? 'green' : t.late ? 'red' : 'orange';
        return el('li', null, el('button', { class: 'menu-item person' + (state.view === 'today' && state.personFilter === p.id ? ' current' : ''), title: tasks.length ? `${sent} of ${tasks.length} sent today` : 'No tasks today',
          onClick: () => {
            state.personFilter = state.personFilter === p.id ? 0 : p.id;
            if (state.view !== 'today' && !formHasText()) { go('today'); return; }
            state.menuOpen = false;
            if (state.view !== 'today') { state.view = 'today'; state.data = null; state.loadFailed = false; loadList(); } // (a half-filled form on the right stays open)
            if (!state.sel) dropBack();
            softRender();
          } },
        el('span', { class: 'dot ' + dot }), p.name, el('span', { class: 'count' }, tasks.length ? `${sent}/${tasks.length}` : '')));
      })));
    }
  } else {
    const due = d ? d.tasks.filter((x) => !x.today).length : 0;
    parts.push(el('ul', { class: 'menu-list' },
      item('Today', state.view === 'today' && state.section === 'today', () => { state.section = 'today'; go('today'); }, due || null),
      item('Coming next', state.section === 'next', () => { state.section = 'next'; go('today'); }, d && d.other.length ? d.other.length : null),
      item('My suggestions', state.section === 'sugg', () => { state.section = 'sugg'; go('today'); }, d && (d.suggestions || []).length ? d.suggestions.length : null),
      item('🔍 Search', state.view === 'search', () => go('search'))),
      el('button', { class: 'menu-cta', onClick: () => openDetail('suggest') }, '💡 Suggest a task'));
    const projs = myProjects();
    if (projs.length) {
      parts.push(el('div', { class: 'menu-head' }, 'My projects'), el('ul', { class: 'menu-list' }, projs.map((pr) =>
        item(`📁 ${pr.name}`, state.sel === 'project:' + pr.ref, () => openDetail('project:' + pr.ref), pr.real.length || null))));
    }
  }
  return el('div', { class: 'menu-inner' },
    el('div', { class: 'brand' }, el('img', { src: 'icons/icon-192.png', alt: '', width: 26, height: 26 }), 'Work Task'),
    parts,
    el('div', { class: 'menu-sep' }),
    el('ul', { class: 'menu-list menu-bottom' },
      pushState() === 'no' ? null : item('🔔 Notifications', state.sel === 'notify', () => openDetail('notify'), pushState() === 'on' ? 'On' : 'Off'),
      item(`👤 ${me.name}`, state.sel === 'password', () => openDetail('password')),
      item('Sign out', false, signOut)));
}

/** One task as a row in the list (dot · title · what is happening), like a project row. */
function taskRow(t, sub, dot, warn = false) {
  const on = state.sel === 'task:' + t.id;
  return el('li', { class: 'prow' + (on ? ' current' : '') },
    el('button', { class: 'prow-btn', onClick: () => openDetail('task:' + t.id) },
      el('span', { class: 'dot ' + dot }),
      el('span', { class: 'prow-text' },
        el('span', { class: 'prow-name' }, t.title, state.newIds.has(t.id) ? el('span', { class: 'tag amber new-tag' }, 'New') : null,
          t.unread ? el('span', { class: 'unread-dot', title: `${t.unread} new message(s)` }) : null),
        el('span', { class: 'prow-next' + (warn ? ' warn' : '') }, sub))));
}

/** Middle column: the list (or, for People and Settings, the whole page). */
function listColumn(wide) {
  const me = state.user, admin = me.role === 'admin';
  const titles = { today: admin ? 'Team today' : { today: 'My tasks today', next: 'Coming next', sugg: 'My suggestions' }[state.section], tasks: state.closed ? 'Done / cancelled' : 'Tasks', people: 'People', settings: 'Settings', projects: 'Projects', report: 'Weekly report', search: 'Search', followup: '🔁 Follow-up' };
  let title = titles[state.view];
  if (admin && state.view === 'today' && state.personFilter && state.team) { const p = state.team.people.find((x) => x.id === state.personFilter); if (p) title = p.name; }
  const head = el('div', { class: 'list-head' },
    el('button', { class: 'icon menu-btn', 'aria-label': 'Menu', onClick: () => { state.menuOpen = true; pushBack(); menuRender(); } }, '☰'),
    el('h2', null, title),
    state.view === 'settings' ? null : el('button', { class: 'icon', title: 'Get latest', 'aria-label': 'Refresh', onClick: () => loadView() }, '↻'));
  const bar = el('div', { id: 'bar' }, offlineBar(), pushBanner());
  if (state.view === 'settings') return el('div', { class: 'col-inner' }, head, bar, el('div', { class: 'wide-inner' }, settingsScreen()));
  if (!state.data) {
    return el('div', { class: 'col-inner' }, head, bar, el('p', { class: 'list-note' }, state.loadFailed ? ['No saved copy on this phone yet. ', el('button', { class: 'link', onClick: () => loadView() }, 'Try again')] : 'Loading…'));
  }
  if (wide) return el('div', { class: 'col-inner' }, head, bar, el('div', { class: 'wide-inner' }, state.view === 'report' ? reportScreen() : peopleScreen()));
  let body;
  if (state.view === 'search') body = searchList();
  else if (state.view === 'projects') body = projectsList();
  else if (state.view === 'tasks') body = tasksList();
  else if (state.view === 'followup') body = followupList();
  else body = admin ? teamList() : myList();
  return el('div', { class: 'col-inner' }, head, bar, body);
}

const sec = (label, extra) => el('div', { class: 'list-sec' }, el('span', null, label), extra || null);

/** Staff: today's tasks, coming next, or suggestions (the menu picks which). */
function myList() {
  const d = state.data;
  const sent = d.tasks.filter((t) => t.today).length;
  const outboxFor = (t) => (state.outbox || []).some((x) => (x.kind === 'update' || x.kind === 'photos') && x.taskId === t.id);
  if (state.section === 'next') {
    return [sec(`${d.other.length} coming next`), el('ul', { class: 'list-body' }, d.other.map((t) => taskRow(t, [t.project, repeatLabel(t, d.today)].filter(Boolean).join(' · '), 'grey'))),
      d.other.length ? null : el('p', { class: 'list-note' }, 'Nothing coming next.')];
  }
  if (state.section === 'sugg') {
    const list = d.suggestions || [];
    return [sec(`${list.length} suggestion${list.length === 1 ? '' : 's'}`),
      el('ul', { class: 'list-body' }, list.map((t) => taskRow(t, t.status === 'suggested' ? 'Waiting for a yes' : 'Not now' + (t.lastMessage ? ` — ${t.lastMessage.text}` : ''), t.status === 'suggested' ? 'orange' : 'grey'))),
      list.length ? null : el('p', { class: 'list-note' }, 'No suggestions yet. Tap 💡 Suggest a task in the menu.')];
  }
  const projs = myProjects();
  return [
    d.stale ? el('div', { class: 'list-banner' }, `📴 Saved copy from ${fmtDay(d.today)} — today's updates are not shown yet.`) : null,
    projs.length ? [sec('📁 My projects'), el('ul', { class: 'list-body' }, projs.map(projectRow))] : null,
    sec(`${fmtDay(d.today)} · ${sent} of ${d.tasks.length} sent`, el('span', { class: 'tag' }, `by ${d.fillBy}`)),
    el('ul', { class: 'list-body' }, d.tasks.map((t) => {
      const waiting = outboxFor(t);
      const late = t.repeat === 'once' && t.dueDate && t.dueDate < d.today;
      const sub = waiting ? '⏳ Waiting to send' : t.today ? `✓ Sent ${fmtTime(t.today.at)}${t.today.state === 'stuck' ? ' · stuck' : t.today.state === 'finished' ? ' · finished' : ''}`
        : [t.project, repeatLabel(t, d.today)].filter(Boolean).join(' · ') || 'Send today\'s update';
      return taskRow(t, sub, t.today ? 'green' : waiting ? 'orange' : late ? 'red' : 'orange', late && !t.today);
    })),
    d.tasks.length ? null : el('p', { class: 'list-note' }, 'No tasks for today. 🎉'),
  ];
}

/** Staff: the projects given to me, each with its open steps in order (the current one first). */
function myProjects() {
  const d = state.data;
  if (!d || !state.user || state.user.role === 'admin') return [];
  const by = new Map();
  for (const t of [...(d.tasks || []), ...(d.other || [])]) {
    if (!t.projectRef || t.seq === null || t.seq === undefined || t.status !== 'open') continue;
    if (!by.has(t.projectRef)) by.set(t.projectRef, { ref: t.projectRef, name: t.project || 'Project', steps: [] });
    by.get(t.projectRef).steps.push(t);
  }
  return [...by.values()].map((pr) => {
    pr.steps.sort((a, b) => a.seq - b.seq || a.id - b.id);
    pr.real = pr.steps.filter((t) => !t.stepRef.endsWith(':whole')); // the "whole project" task when there are no steps yet
    pr.current = pr.steps.find((t) => !t.queued) || pr.steps[0];
    return pr;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function projectRow(pr) {
  const c = pr.current, n = pr.real.length;
  const sub = !n ? 'No steps yet — add your steps' : `${n} step${n > 1 ? 's' : ''} to do · now: ${c.title}${c.today ? ' · ✓ sent today' : ''}`;
  return el('li', { class: 'prow' + (state.sel === 'project:' + pr.ref ? ' current' : '') },
    el('button', { class: 'prow-btn', onClick: () => openDetail('project:' + pr.ref) },
      el('span', { class: 'dot ' + (c && c.today ? 'green' : 'orange') }),
      el('span', { class: 'prow-text' }, el('span', { class: 'prow-name' }, '📁 ' + pr.name), el('span', { class: 'prow-next' }, sub))));
}

/** Staff: one project — its steps in order, today's update on the current one, and adding a step. */
function projectPage(pr, done = []) {
  const doneList = done.length ? [sec(`✓ ${done.length} done`), el('ul', { class: 'list-body' }, done.map((t, i) => taskRow(t, `Step ${i + 1} · done ${t.doneAt ? fmtDay(t.doneAt) : ''}`, 'green')))] : null;
  if (!pr) return [el('p', { class: 'muted' }, !state.data ? 'Loading…' : done.length ? 'All your steps are done ✓. Your manager decides what comes next.' : 'This project is not on your list any more.'), doneList];
  const sent = (t) => t.today ? `✓ Sent ${fmtTime(t.today.at)}` : 'Send today\'s update';
  const k = done.length; // the steps already done count in the numbers
  return [
    doneList,
    el('p', { class: 'muted' }, pr.real.length
      ? 'Do the steps in order. Every day, open the current step and send what you did. Found more work? Add a step below.'
      : 'No steps yet. Add the steps you will do, in order. Until then, send your daily update on the whole project.'),
    !pr.real.length ? el('ul', { class: 'list-body' }, pr.steps.map((t) => taskRow(t, sent(t), t.today ? 'green' : 'orange'))) : null,
    pr.real.length ? [k ? sec('To do') : null, el('ol', { class: 'list-body steps-list' }, pr.real.map((t, i) => taskRow(t,
      t === pr.current ? `Step ${k + i + 1} · current · ${sent(t)}` : `Step ${k + i + 1} · next${t.fromStaff ? ' · added by you' : ''}`,
      t === pr.current ? (t.today ? 'green' : 'orange') : 'grey')))] : null,
    waitingSteps(pr.ref),
    addStepForm(pr.ref),
  ];
}

/** Steps added offline, still on the phone. */
function waitingSteps(ref) {
  const w = (state.outbox || []).filter((x) => x.kind === 'step' && x.projectRef === ref);
  return w.length ? el('ul', { class: 'list-body' }, w.map((x) => el('li', { class: 'prow' }, el('div', { class: 'prow-btn' }, el('span', { class: 'dot grey' }),
    el('span', { class: 'prow-text' }, el('span', { class: 'prow-name' }, x.title), el('span', { class: 'prow-next' }, '⏳ Waiting to send')))))) : null;
}

function addStepForm(ref) {
  const inp = el('input', { placeholder: 'e.g. Order the spare servo motor', maxlength: '300', 'aria-label': 'New step', value: (state.stepDrafts || {})[ref] || '',
    onInput: (e) => { (state.stepDrafts ||= {})[ref] = e.target.value; } }); // kept across redraws until added
  const btn = el('button', { class: 'primary', type: 'submit' }, '+ Add step');
  return el('form', {
    class: 'card stack',
    onSubmit: async (e) => {
      e.preventDefault();
      const title = inp.value.trim();
      if (!title) { inp.focus(); return; }
      btn.disabled = true;
      const ids = (state.stepCid ||= {});
      if (!ids[ref] || ids[ref].title !== title) ids[ref] = { id: newClientId(), title }; // a retry of the same step: the same id
      const clientId = ids[ref].id;
      try {
        await api('project.addStep', { projectRef: ref, title, clientId });
        delete state.stepCid[ref]; if (state.stepDrafts) delete state.stepDrafts[ref];
        toast('➕ Step added. Your manager sees it in the project too.');
        inp.value = ''; inp.blur();
        render(); // (the box is empty again: the list below may redraw)
        await loadList();
      } catch (ex) {
        if (ex instanceof OfflineError) {
          try { await queue({ kind: 'step', projectRef: ref, title, clientId }); delete state.stepCid[ref]; if (state.stepDrafts) delete state.stepDrafts[ref]; inp.value = ''; toast('📴 Saved on this phone — it will be added when you are online', 5000); render(); return; }
          catch { /* could not keep it */ }
        }
        toast(ex.message, 6000); btn.disabled = false;
      }
    },
  }, el('label', null, 'Add a step', inp), btn);
}

/** Manager, top of Team today: today in one look — updates in, who has not sent, who is stuck (and for how long). */
function teamSummary(d) {
  if (d.stale || !d.tasks.length) return null;
  const due = d.tasks.filter((t) => t.dueToday || t.today);
  const sent = due.filter((t) => t.today).length;
  const missing = [...new Set(due.filter((t) => !t.today && t.dueToday).map((t) => t.assignee.name))];
  const since = d.stuckSince || {};
  const stuck = (d.stuck || []).map((t) => { const days = since[t.id] ? daysBetween(since[t.id], d.today) : 0; return `${t.assignee.name}${days ? ` (${days} day${days > 1 ? 's' : ''})` : ''}`; });
  const quiet = (d.people || []).filter((p) => d.tasks.some((t) => t.assignee.id === p.id) && p.lastUpdate && daysBetween(p.lastUpdate, d.today) >= 2)
    .map((p) => `${p.name} (${daysBetween(p.lastUpdate, d.today)} days)`);
  const all = sent === due.length;
  return el('div', { class: 'summary ' + (all ? 'good' : d.late ? 'bad' : '') },
    el('strong', null, all ? `✓ All ${due.length} updates in today` : `📊 ${sent} of ${due.length} updates in today`),
    missing.length && !all ? el('span', null, `${d.late ? '⚠️ ' : ''}Not yet: ${missing.join(', ')}`) : null,
    stuck.length ? el('span', null, `Stuck: ${stuck.join(', ')}`) : null,
    quiet.length ? el('span', null, `No update for: ${quiet.join(', ')}`) : null);
}

/** Manager: every given project — who, how far, the step they are on, the last update. */
function projectsList() {
  const list = state.data.projects || [];
  if (!list.length) return el('p', { class: 'list-note' }, 'No projects given to the team yet. Give one from your projects page (👥 Give project).');
  const ago = (day) => !day ? 'no update yet' : day === state.data.today ? 'updated today' : `last update ${fmtDay(day)}`;
  return el('ul', { class: 'list-body' }, list.map((p) => {
    const total = p.open + p.done;
    const { dot, now } = projectRowState(p); // (a project given as one task, no steps yet, is live work: the rule is in logic.js)
    const sub = [p.people.join(', '), total ? `${p.done} of ${total} done` : 'no steps yet', now, ago(p.lastUpdate),
      p.staffSteps ? `${p.staffSteps} step${p.staffSteps > 1 ? 's' : ''} added by them` : ''].filter(Boolean).join(' · ');
    return el('li', { class: 'prow' + (state.sel === 'project:' + p.ref ? ' current' : '') },
      el('button', { class: 'prow-btn', onClick: () => openDetail('project:' + p.ref) },
        el('span', { class: 'dot ' + dot }),
        el('span', { class: 'prow-text' }, el('span', { class: 'prow-name' }, '📁 ' + p.name, p.stuck ? el('span', { class: 'tag red new-tag' }, 'Stuck') : null),
          p.projectAbout ? el('span', { class: 'prow-about' }, aboutShort(p.projectAbout)) : null, el('span', { class: 'prow-next' }, sub))));
  }));
}

/** Manager: one given project — progress, the steps in order (done ones ticked), who added each step. */
function adminProjectPage(all) {
  if (!state.detail) {
    return el('p', { class: 'muted' }, state.detailFailed ? ['Could not open this project. ', el('button', { class: 'link', onClick: () => loadDetail() }, 'Try again')] : 'Loading…');
  }
  const steps = all.filter((t) => !t.stepRef.endsWith(':whole'));
  const done = steps.filter((t) => t.status === 'done'), open = all.filter((t) => t.status === 'open');
  const cur = open.find((t) => !t.queued);
  const people = [...new Set(open.map((t) => t.assignee.name))];
  const days = all.map((t) => (t.today || t.last || {}).day).filter(Boolean).sort();
  const last = days[days.length - 1];
  const who = (t) => t.createdBy === t.assignee.id ? ` · added by ${t.assignee.name}` : '';
  const total = done.length + open.filter((t) => !t.stepRef.endsWith(':whole')).length;
  return [
    el('div', { class: 'card' },
      el('div', { class: 'row spread' }, el('strong', null, people.length ? `👥 ${people.join(', ')}` : 'Not given now'), el('span', { class: 'tag ' + (open.some((t) => t.stuck) ? 'red' : 'grey') }, open.some((t) => t.stuck) ? 'Stuck' : total ? `${done.length} of ${total} done` : 'No steps yet')),
      total ? el('div', { class: 'progress' }, (() => { const b = el('span'); b.style.width = `${Math.round((done.length / total) * 100)}%`; return b; })()) : null,
      el('p', { class: 'meta' }, last ? (last === state.detail.today ? 'Last update: today' : `Last update: ${fmtDay(last)} (${daysBetween(last, state.detail.today)} days ago)`) : 'No update yet')),
    done.length ? [sec(`✓ ${done.length} done`), el('ul', { class: 'list-body' }, done.map((t, i) => taskRow(t, `Step ${i + 1} · done ${t.doneAt ? fmtDay(t.doneAt) : ''}${who(t)}`, 'green')))] : null,
    open.length ? [sec('To do'), el('ol', { class: 'list-body' }, open.map((t, i) => taskRow(t,
      (t.stepRef.endsWith(':whole') ? 'The whole project (no steps yet)' : `Step ${done.length + i + 1}`) + (t === cur ? ` · current · ${t.today ? '✓ sent today' : 'no update today'}` : ' · next') + who(t)
        + (t.dueDate ? ` · by ${fmtDay(t.dueDate)}` : ''),
      t.stuck ? 'red' : t === cur ? (t.today ? 'green' : 'orange') : 'grey', t.stuck)))] : el('p', { class: 'list-note' }, 'Nothing open on this project.'),
    el('p', { class: 'meta' }, 'Add, tick or change steps on your projects page; the person’s list follows by itself.'),
  ];
}

/** Search: tasks, messages and updates (staff: only their own). Results come as you type. */
let searchTimer = 0, searchSeq = 0;
function searchList() {
  const results = el('div', { id: 'search-results' }, searchResults());
  const inp = el('input', { type: 'search', placeholder: 'Search tasks, messages, updates…', value: state.searchQ || '', 'aria-label': 'Search',
    onInput: (e) => {
      state.searchQ = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const q = state.searchQ.trim(), n = ++searchSeq;
        if (q.length < 2) { state.searchResults = null; results.replaceChildren(searchResults()); return; }
        try { const out = await api('search', { q }); if (n === searchSeq) { state.searchResults = out.results; results.replaceChildren(searchResults()); } }
        catch (ex) { if (n === searchSeq) results.replaceChildren(el('p', { class: 'list-note' }, ex.message)); }
      }, 350);
    } });
  setTimeout(() => { if (state.view === 'search' && !state.sel && document.contains(inp) && !('ontouchstart' in window)) inp.focus(); }, 0);
  return [el('div', { class: 'search-box' }, inp), results];
}
function searchResults() {
  const r = state.searchResults;
  if (!r) return el('p', { class: 'list-note' }, 'Type 2 or more letters.');
  if (!r.length) return el('p', { class: 'list-note' }, 'Nothing found.');
  const icon = { task: '📋', message: '💬', update: '📝' };
  return el('ul', { class: 'list-body' }, r.map((x) => el('li', { class: 'prow' },
    el('button', { class: 'prow-btn', onClick: () => openDetail('task:' + x.taskId) },
      el('span', { class: 'prow-text' }, el('span', { class: 'prow-name' }, `${icon[x.kind] || ''} ${x.title}`),
        el('span', { class: 'prow-next' }, `${x.who} · ${fmtDay(x.at)} — ${x.text}`))))));
}

/** Manager: the week for each person — days they sent, days they missed, stuck, finished. */
function reportScreen() {
  const d = state.data;
  if (!d.people) return el('p', { class: 'muted' }, 'Loading…');
  const move = (n) => { state.reportEnd = addDay(d.end, n * 7); if (state.reportEnd >= d.today) state.reportEnd = ''; state.data = null; render(); loadList(); };
  return [
    el('div', { class: 'row spread report-nav' },
      el('button', { onClick: () => move(-1) }, '‹ Week before'),
      el('strong', null, `${fmtDay(d.from)} – ${fmtDay(d.end)}`),
      el('button', { disabled: d.end >= d.today, onClick: () => move(1) }, 'Next week ›')),
    d.people.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'report' },
      el('thead', null, el('tr', null, ['Person', 'Days sent', 'Missed', 'Updates', 'Stuck', 'Finished', 'Steps added'].map((h) => el('th', null, h)))),
      el('tbody', null, d.people.map((p) => el('tr', null,
        el('td', null, el('strong', null, p.name)),
        el('td', { class: p.sentDays >= p.workDays ? 'ok' : '' }, p.workDays ? `${p.sentDays} of ${p.workDays}` : '—'),
        el('td', { class: p.missed.length ? 'err' : '' }, p.missed.length ? p.missed.map((x) => fmtDay(x).slice(0, 6)).join(', ') : '—'),
        el('td', null, String(p.updates)), el('td', { class: p.stuck ? 'err' : '' }, String(p.stuck)),
        el('td', null, String(p.finished)), el('td', null, String(p.stepsAdded))))))) : el('p', { class: 'muted' }, 'No team members yet.'),
    el('p', { class: 'meta' }, 'Days sent: days with at least one update, out of the days they had work. Missed: days with work and no update.'),
  ];
}

/** Manager on another page: keep the "Needs you" number in the menu fresh. */
let teamCountBusy = false;
async function refreshTeamCount() {
  if (teamCountBusy || !state.user || state.user.role !== 'admin' || state.view === 'today') return;
  teamCountBusy = true;
  try {
    const tt = await api('team.today');
    if (tt.fromCache || !state.user) return;
    const n = (x) => x ? (x.stuck || []).length + (x.unread || []).length + (x.suggestions || []).length : -1;
    const changed = n(tt) !== n(state.team);
    state.team = tt;
    const a = document.activeElement;
    if (changed && !((a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)) || formHasText())) render();
  } catch { /* next time */ } finally { teamCountBusy = false; }
}

/** Manager: what needs you, then each person's tasks today (the menu can show one person only). */
function teamList() {
  outlookConnected(); // asked once per page load, so 📧 Morning email knows by the time it is pressed
  const d = state.data;
  const stuck = d.stuck || [], unread = d.unread || [], sugg = d.suggestions || [];
  const filt = state.personFilter;
  const people = [...d.people];
  for (const t of d.tasks) if (!people.some((p) => p.id === t.assignee.id)) people.push({ id: t.assignee.id, name: t.assignee.name });
  const shown = people.filter((p) => !filt || p.id === filt);
  const row = (t) => {
    const u = t.today;
    const sub = u ? `✓ ${fmtTime(u.at)}${u.state === 'stuck' ? ' · stuck' : u.state === 'finished' ? ' · finished' : ''} — ${u.note}` : t.queued ? 'Coming next' : d.late ? 'Not filled today' : 'Not filled yet';
    const lateBy = t.status === 'open' && t.dueDate && t.dueDate < d.today; // past its "by" date
    const dot = t.stuck || lateBy ? 'red' : u ? 'green' : d.late ? 'red' : 'orange';
    return taskRow(t, (lateBy ? `⏰ Late (by ${fmtDay(t.dueDate)}) · ` : '') + sub, dot, (!u && d.late) || lateBy);
  };
  const needs = filt ? [] : [...stuck.map((t) => [t, `Stuck — ${(t.today || t.last || {}).note || ''}`, 'red']),
    ...unread.map((t) => [t, `💬 ${t.unread} new — ${t.lastMessage ? t.lastMessage.text : ''}`, 'orange']),
    ...sugg.map((t) => [t, `💡 Suggestion — tap to say yes or no`, 'orange'])];
  return [
    d.stale ? el('div', { class: 'list-banner' }, `📴 Saved copy from ${fmtDay(d.today)} — today's updates are not shown yet.`) : null,
    filt ? null : teamSummary(d),
    needs.length ? [sec('⚠︎ Needs you', el('span', { class: 'tag amber' }, String(needs.length))),
      el('ul', { class: 'list-body' }, needs.map(([t, sub, dot]) => {
        const r = taskRow(t, `${t.assignee.name}: ${sub}`, dot, dot === 'red');
        return r;
      }))] : null,
    people.length ? null : el('p', { class: 'list-note' }, 'No team members yet. ', el('button', { class: 'link', onClick: () => openPeoplePage() }, 'Add a person')),
    shown.map((p) => {
      const tasks = d.tasks.filter((t) => t.assignee.id === p.id);
      const sent = tasks.filter((t) => t.today).length;
      const tag = !tasks.length ? el('span', { class: 'tag grey' }, 'No tasks today')
        : el('span', { class: 'tag ' + (sent === tasks.length ? 'green' : d.late ? 'red' : 'amber') }, `${sent} of ${tasks.length} sent`);
      return [sec(p.name, tag), el('ul', { class: 'list-body' }, tasks.map(row)),
        el('p', { class: 'list-note' }, el('button', { class: 'chip', onClick: () => morningEmail(p) }, '📧 Morning email'), sentMark(p, istDay(new Date())))];
    }),
    filt ? el('p', { class: 'list-note' }, el('button', { class: 'link', onClick: () => { state.personFilter = 0; softRender(); } }, '← Show everyone')) : null,
  ];
}

/** Manager: all open (or closed) tasks, by person. */
function tasksList() {
  const d = state.data;
  const groups = new Map();
  for (const t of d.tasks) { if (!groups.has(t.assignee.name)) groups.set(t.assignee.name, []); groups.get(t.assignee.name).push(t); }
  return [
    el('div', { class: 'list-tools' },
      el('div', { class: 'segmented' },
        el('button', { class: 'seg' + (!state.closed ? ' on' : ''), onClick: () => { state.closed = false; go('tasks'); } }, 'Open'),
        el('button', { class: 'seg' + (state.closed ? ' on' : ''), onClick: () => { state.closed = true; go('tasks'); } }, 'Done / cancelled'))),
    d.tasks.length ? null : el('p', { class: 'list-note' }, state.closed ? 'Nothing closed yet.' : 'No open tasks. Give one with “+ Give a task”.'),
    [...groups].map(([name, tasks]) => [sec(name, el('span', { class: 'tag grey' }, String(tasks.length))),
      el('ul', { class: 'list-body' }, tasks.map((t) => taskRow(t,
        [t.status !== 'open' ? (t.status === 'done' ? 'Done' : 'Cancelled') : null, t.project, repeatLabel(t), t.today ? 'sent today' : t.last ? `last ${fmtDay(t.last.day)}` : 'no update yet'].filter(Boolean).join(' · '),
        t.status !== 'open' ? 'grey' : t.stuck ? 'red' : t.today ? 'green' : 'orange')))]),
  ];
}

/** Right column: the open task (or a form); empty when nothing is picked. */
function detailColumn() {
  const sel = state.sel;
  if (!sel) {
    return el('div', { class: 'empty' }, el('p', null, 'Pick a task on the left.'),
      state.user.role === 'admin' ? el('p', null, el('button', { class: 'link', onClick: () => openDetail('give') }, '+ Give a task')) : null);
  }
  let title = '', body, about = ''; // about: the project's short description, in grey under the title
  if (sel === 'give') { title = 'Give a task'; body = state.people.length ? [quickBox(state.people), taskForm()] : el('p', { class: 'muted' }, 'Loading…'); }
  else if (sel.startsWith('edit:')) { title = 'Edit task'; body = state.detail && state.people.length ? taskForm() : el('p', { class: 'muted' }, 'Loading…'); }
  else if (sel === 'suggest') { title = '💡 Suggest a task'; body = suggestForm(); }
  else if (sel === 'password') { title = 'Change password'; body = passwordScreen(); }
  else if (sel === 'notify') { title = '🔔 Notifications'; body = notifyPage(); }
  else if (sel.startsWith('project:')) {
    const pr = myProjects().find((x) => x.ref === sel.slice(8)), all = (state.detail && state.detail.tasks) || [];
    title = '📁 ' + (pr ? pr.name : (all[all.length - 1] && all[all.length - 1].project) || 'Project');
    about = projectAboutOf([...(pr ? pr.steps : []), ...[...all].reverse()]);
    body = state.user.role === 'admin' ? adminProjectPage(all) : projectPage(pr, all.filter((t) => t.status === 'done' && !t.stepRef.endsWith(':whole')));
  }
  else if (sel.startsWith('task:')) {
    title = state.detail && state.detail.task ? state.detail.task.title : '';
    about = state.detail && state.detail.task ? projectAboutOf([state.detail.task]) : '';
    body = state.detail ? (state.user.role === 'admin' ? taskDetail() : myTaskDetail())
      : state.detailFailed ? el('p', { class: 'muted' }, 'Could not open this task. ', el('button', { class: 'link', onClick: () => loadDetail() }, 'Try again'))
        : el('p', { class: 'muted' }, 'Loading…');
  }
  return el('div', { class: 'detail-inner' },
    el('div', { class: 'detail-top' },
      el('button', { class: 'icon back', 'aria-label': 'Back', onClick: () => closeDetail() }, '←'),
      el('h2', { class: 'detail-title' }, title),
      sel.startsWith('task:') && state.user.role === 'admin' && state.detail && state.detail.task ? taskActions(state.detail.task) : null),
    about ? el('p', { class: 'project-about' }, (sel.startsWith('task:') ? '📁 ' : '') + about) : null,
    body);
}

/** Staff: one task — what to send today (or what was sent), messages, and earlier updates. */
function myTaskDetail() {
  const { task: t, updates = [], comments = [] } = state.detail;
  const today = (state.data && !state.data.stale && state.data.today) || istDay(new Date());
  return [
    taskChips(t, today, false),
    t.details ? el('div', { class: 'task-details pre' }, t.details) : null,
    taskFiles(t),
    todayCard(t, today),
    messagesBlock(t.id, comments),
    t.status === 'suggested' || (t.status !== 'open' && !updates.length) ? null : taskDiary(t, updates, today, true),
  ];
}

/** Staff: today's update for this task (write it, or what was sent), or what waits on the phone. */
function todayCard(t, today) {
  const waiting = (state.outbox || []).filter((x) => (x.kind === 'update' || x.kind === 'photos') && x.taskId === t.id).pop();
  const head = (extra) => el('div', { class: 'row spread small' }, el('strong', null, "Today's update"), extra);
  if (waiting && !state.editing[t.id]) {
    return el('div', { class: 'card waiting' }, head(el('span', { class: 'tag amber' }, '⏳ Waiting to send')),
      el('div', { class: 'row small' }, stateTag(waiting.state), (waiting.files || []).length ? el('span', { class: 'muted' }, `📷 ${waiting.files.length}`) : null),
      el('div', { class: 'pre' }, waiting.note),
      el('p', { class: 'muted small' }, 'Kept on this phone. It is sent by itself when the internet is back.'));
  }
  if (t.status !== 'open' && !t.today) return null;
  const done = t.today && !state.editing[t.id];
  return el('div', { class: 'card' + (done ? ' sent' : '') },
    head(null),
    done ? sentView(t) : updateForm(t));
}

const LATE_HM = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

/** One line of small chips about a task: who, project, how often, its date, the photo rule, closed. */
function taskChips(t, today, admin) {
  const c = (text, cls = '') => el('span', { class: 'info-chip static' + cls }, text);
  const late = t.status === 'open' && t.dueDate && t.dueDate < today;
  const how = t.seq !== null && t.seq !== undefined ? (t.queued ? 'Coming next' : 'Current step')
    : t.startDate && t.startDate > today ? `Starts ${fmtDay(t.startDate)}`
      : t.repeat === 'daily' ? (t.skipSunday ? 'Every day (Mon–Sat)' : 'Every day') : t.repeat === 'weekly' ? `Every ${LONG_DAYS[t.weekday ?? 1]}` : 'One time';
  return el('div', { class: 'info-chips' },
    admin ? c(`👤 ${t.assignee.name}`, ' team') : null,
    t.project ? c(`📁 ${t.project}`) : null,
    c(how),
    t.dueDate ? c(late ? `⏰ Late — was by ${fmtDay(t.dueDate)}` : `By ${fmtDay(t.dueDate)}`, late ? ' bad' : '') : null,
    t.needsPhoto ? c('📷 Photo to finish') : null,
    t.status === 'done' ? c('✓ Done', ' good') : t.status === 'cancelled' ? c('Cancelled', ' bad') : t.status === 'suggested' ? c('💡 Suggestion') : t.today ? c('✓ Sent today', ' good') : null);
}

/** What's happening on this task, day by day: every update with its time; Sunday = Off; a due day with nothing = No progress. */
function taskDiary(t, updates, today, staff) {
  const n = state.diaryDays || 14;
  const fillBy = (state.data && state.data.fillBy) || state.fillBy || '18:00';
  const { rows, more } = diaryRows(t, updates, today, { staff, n, fillBy, nowHm: LATE_HM() }); // (the rules: logic.js)
  const items = rows.map(({ day, kind, ups }) => {
    const wd = weekdayOf(day);
    const content = kind === 'ups' ? ups.map((u) => el('div', { class: 'diary-entry' },
      el('div', { class: 'diary-line' }, el('span', { class: 'diary-icon' }, u.state === 'stuck' ? '⚠️' : u.state === 'finished' ? '✅' : '📝'),
        el('div', { class: 'diary-text' }, el('strong', null, (staff && u.byId === state.user.id ? 'You' : u.by) + ' '),
          u.state !== 'progress' ? [stateTag(u.state), ' '] : null, el('span', { class: 'pre' }, u.note), thumbs(u.photos))),
      el('span', { class: 'diary-time' }, fmtTime(u.at))))
      : kind === 'off' ? el('span', { class: 'day-tag off' }, 'Off')
        : kind === 'wait' ? el('span', { class: 'day-tag wait' }, 'Waiting for today\'s update')
          : [el('span', { class: 'day-tag miss' }, 'No progress'), el('span', { class: 'muted small' }, ' no update')];
    return el('li', { class: 'diary-day' },
      el('div', { class: 'diary-date' }, el('strong', null, day === today ? 'Today' : LONG_DAYS[wd]), el('span', { class: 'muted small' }, day === today ? fmtDay(day) : fmtDay(day).slice(4))),
      el('div', { class: 'diary-items' }, content));
  });
  return [
    el('h2', null, staff ? '📅 Earlier days' : "📅 What's happening"),
    items.length ? el('ul', { class: 'diary-days' }, items) : el('p', { class: 'muted small' }, 'Nothing yet.'),
    more ? el('button', { class: 'link small', onClick: () => { state.diaryDays = n + 14; render(); } }, 'Show older days') : null,
  ];
}

/** Manager, next to the task's title: Mark done, and ⋯ for the rest. */
function taskActions(t) {
  if (t.status === 'suggested') return null;
  const setStatus = async (status) => {
    try { await api('task.status', { id: t.id, status }); toast(status === 'open' ? 'Opened again' : status === 'done' ? 'Marked done ✓' : 'Cancelled'); loadView(); } catch (ex) { toast(ex.message, 5000); }
  };
  if (t.status !== 'open') return el('span', { class: 'nav-pn' }, el('button', { class: 'btn', onClick: () => setStatus('open') }, 'Open again'));
  return el('span', { class: 'nav-pn' },
    el('button', { class: 'btn', onClick: () => setStatus('done') }, '✓ Mark done'),
    el('button', { class: 'btn icon-btn' + (state.taskMenu === t.id ? ' on' : ''), 'aria-label': 'More actions', title: 'Edit, move, instructions, cancel', onClick: () => { state.taskMenu = state.taskMenu === t.id ? 0 : t.id; render(); } }, '⋯'));
}

/** The ⋯ menu of a task (manager). */
function taskMenu(t) {
  if (state.taskMenu !== t.id || t.status !== 'open') return null;
  const close = () => { state.taskMenu = 0; };
  const input = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, class: 'hidden-file', onChange: async () => {
    close(); render();
    await uploadTaskFiles(t.id, [...input.files].slice(0, 10)); toast('Added ✓'); loadView();
  } });
  return el('div', { class: 'proj-menu', role: 'menu' },
    el('button', { class: 'menu-row', onClick: () => { close(); go('edit:' + t.id); } }, '✎ Edit task'),
    el('button', { class: 'menu-row', onClick: () => { close(); state.moving = t.id; render(); } }, '↔ Move to another person…'),
    el('label', { class: 'menu-row' }, '📎 Add instruction photo / PDF', input),
    t.seq !== null && t.seq !== undefined ? null : el('button', { class: 'menu-row danger', onClick: async () => {
      close();
      if (!confirm('Cancel this task?')) { render(); return; }
      try { await api('task.status', { id: t.id, status: 'cancelled' }); toast('Cancelled'); loadView(); } catch (ex) { toast(ex.message, 5000); }
    } }, '✖ Cancel task'));
}

async function signOut() {
  const n = (state.outbox || []).length;
  if (n && !confirm(`${n} item${n > 1 ? 's are' : ' is'} not sent yet. They go out when you sign in again on this phone. Sign out anyway?`)) return;
  await pushOff().catch(() => {}); // the next person on this phone must not get their messages
  try { await api('logout'); } catch { /* signed out anyway */ }
  state.prefill = null; state.openTask = 0;
  try { localStorage.removeItem('dp.snapshot'); } catch { /* blocked */ } // the owner's projects copy (changes not sent yet are kept)
  signedOut();
}

/** The owner goes to their projects, but only once nothing waits to be sent: the waiting bar is only on these pages. */
async function toProjects() {
  if ((state.outbox || []).length) await flushOutbox();
  if ((state.outbox || []).length) { toast('⏳ Something is still waiting to send. It goes by itself when the internet is back.', 6000); return false; }
  location.href = 'projects/';
  return true;
}

function loginScreen() {
  const err = el('p', { class: 'err', hidden: true });
  const user = el('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const pass = el('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const btn = el('button', { class: 'primary', type: 'submit' }, 'Sign in');
  return el('main', { class: 'narrow' },
    brandBig(),
    el('p', { class: 'muted' }, 'Sign in with the username and password from your manager.'),
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.hidden = true;
      try {
        const out = await api('login', { username: user.value, password: pass.value });
        state.token = out.token; state.user = out.user;
        save(TOKEN_KEY, out.token);
        state.view = 'today';
        await loadOutbox();
        const ready = !out.user.mustChange, teamWanted = new URLSearchParams(location.search).has('team');
        // straight to your projects, unless a Give to team / task link is waiting
        if (out.user.owner && ready && !teamWanted && !state.prefill && !state.openTask && await toProjects()) return;
        flushOutbox();
        if (ready) syncPush();
        if (ready && state.prefill && out.user.role === 'admin') { go('give'); return; }
        if (ready && state.openTask) { const id = state.openTask; state.openTask = 0; go('task:' + id); return; }
        render();
        if (ready) loadView();
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
  return el(first ? 'main' : 'div', { class: first ? 'narrow' : '' },
    first ? brandBig() : null,
    first ? el('h1', null, 'Choose your own password') : null,
    el('p', { class: 'muted' }, first ? 'Welcome! First choose a password only you know. 8 or more characters.' : '8 or more characters.'),
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (n1.value !== n2.value) { err.textContent = 'The two new passwords are not the same.'; err.hidden = false; return; }
      try {
        const out = await api('password', { old: old.value, new: n1.value });
        state.user = out.user;
        toast('Password changed ✓');
        flushOutbox(); // work that waited for the new password goes out now
        syncPush(); // other phones were signed out (and their notifications stopped): this one links itself again
        if (out.user.owner && wantsProjects && await toProjects()) return;
        // a Give to team / task link that waited for the new password
        if (state.prefill && out.user.role === 'admin') { go('give'); return; }
        state.prefill = null;
        if (state.openTask) { const id = state.openTask; state.openTask = 0; go('task:' + id); return; }
        go('today');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    } },
    el('label', null, first ? 'Password from your manager' : 'Current password', old),
    el('label', null, 'New password', n1), el('label', null, 'New password again', n2), err,
    el('div', { class: 'row' }, el('button', { class: 'primary', type: 'submit' }, 'Save password'),
      first ? null : el('button', { type: 'button', onClick: () => closeDetail() }, 'Cancel'))));
}

// ---------- staff: my tasks today

function myToday() {
  const d = state.data;
  const sent = d.tasks.filter((t) => t.today).length;
  return [
    el('div', { class: 'row spread' }, el('h1', null, 'My tasks today'), el('button', { onClick: () => go('suggest') }, '💡 Suggest a task')),
    d.stale ? el('p', { class: 'small warn' }, `📴 Saved copy from ${fmtDay(d.today)} — today's updates are not shown yet.`)
      : el('p', { class: 'muted small' }, `${fmtDay(d.today)} · ${sent} of ${d.tasks.length} sent · please send by ${d.fillBy}`),
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
  const waiting = (state.outbox || []).filter((x) => (x.kind === 'update' || x.kind === 'photos') && x.taskId === t.id).pop();
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
  const input = el('input', { type: 'file', accept: 'image/*', class: 'hidden-file', multiple: true, onChange: () => { const files = [...input.files].slice(0, 5); input.value = ''; addTaskPhotos(t, files, direct); } });
  return el('label', { class: 'btn' }, '📷 Add photo', input);
}

/** Photos for my update: straight onto today's sent update (direct), or kept for the next Send. Also used by Ctrl+V. */
async function addTaskPhotos(t, files, direct) {
    if (direct) {
      const cid = newClientId(); // the same id online and in the outbox: a photo whose reply was lost is not kept twice
      const left = await uploadPhotos(t.today.id, files, cid);
      if (left.length) { // offline: keep the photos on the phone
        const blobs = [];
        for (const f of left) blobs.push(await shrink(f));
        try {
          await queue({ kind: 'photos', taskId: t.id, updateId: t.today.id, note: t.today.note, state: t.today.state, files: blobs, clientId: cid, photoNo: files.length - left.length });
        } catch { toast(KEEP_FAIL, 6000); return; }
        toast('📴 Saved on this phone — it will be sent when you are online', 5000);
        render();
        return;
      }
      loadView();
      return;
    }
    state.files[t.id] = [...(state.files[t.id] || []), ...files].slice(0, 5);
    render();
}

function updateForm(t) {
  const d = (state.drafts[t.id] ||= { note: '', state: 'progress' });
  const err = el('p', { class: 'err small', hidden: true });
  const files = state.files[t.id] || [];
  const btn = el('button', { class: 'primary', disabled: !!state.sending[t.id], onClick: async () => {
    if (state.sending[t.id]) return; // already going (the screen was redrawn meanwhile)
    if (!d.note.trim()) { err.textContent = 'Write what you did first.'; err.hidden = false; return; }
    const havePhotos = (t.today && t.today.photos.length) || files.length || d.photosSent;
    if (d.state === 'finished' && t.needsPhoto && !havePhotos) { err.textContent = '📷 Add a photo to finish this task.'; err.hidden = false; return; }
    btn.disabled = true; state.sending[t.id] = true;
    // photo needed to finish: save as "working", add the photos, then mark finished.
    // Not when today's update already has a photo: "working" would open a finished task again.
    const hadPhoto = !!((t.today && t.today.photos && t.today.photos.length) || d.photosSent);
    const twoSteps = d.state === 'finished' && t.needsPhoto && files.length && !hadPhoto;
    const cid = newClientId(); // the same id online and in the outbox: a photo whose reply was lost is not kept twice
    let updateId = 0; // set once the update itself is on the server
    try {
      const out = await api('update.save', updateSaveBody({ taskId: t.id, note: d.note, state: twoSteps ? 'progress' : d.state, clientId: cid })); // (a timed-out save then queued is the same save)
      updateId = out.update.id;
      if (twoSteps) d.note = out.update.note; // after a move the server put the earlier person's words above: keep them for the Finished save
      const left = files.length ? await uploadPhotos(updateId, files, cid) : [];
      if (left.length) throw Object.assign(new OfflineError('offline'), { left, sentPhotos: files.length - left.length });
      if (files.length) { files.length = 0; delete state.files[t.id]; d.photosSent = true; } // the photos went: a second Send only repeats the last step
      if (twoSteps) await api('update.save', updateSaveBody({ taskId: t.id, note: d.note, clientId: cid, finish: true }));
      delete state.drafts[t.id]; delete state.files[t.id]; delete state.editing[t.id];
      toast('Sent ✓');
      if (document.contains(btn) || !formHasText()) render(); // the empty box at once (a box still holding the sent words would count as "typing" and hold back the reload)
      else state.reloadLater = true; // another form was opened and typed in meanwhile: never wipe it
      loadView();
    } catch (ex) {
      if (ex instanceof OfflineError) { // keep it on the phone; it goes out when online
        const blobs = [];
        for (const f of updateId ? ex.left || [] : files) blobs.push(await shrink(f));
        // only what did not go yet: the photos left, then "finished"
        try {
          await queue(updateId ? { kind: 'photos', taskId: t.id, updateId, note: d.note, state: d.state, thenFinish: !!twoSteps, files: blobs, clientId: cid, photoNo: ex.sentPhotos || 0 }
            : { kind: 'update', taskId: t.id, note: d.note, state: d.state, needsPhoto: !!t.needsPhoto, hadPhoto, files: blobs, clientId: cid });
        } catch { // could not keep it on the phone (storage full or blocked): the text stays in the box
          delete state.sending[t.id];
          render(); toast(KEEP_FAIL, 6000);
          return;
        }
        delete state.drafts[t.id]; delete state.files[t.id]; delete state.editing[t.id];
        delete state.sending[t.id];
        toast('📴 Saved on this phone — it will be sent when you are online', 5000);
        render();
        return;
      }
      err.textContent = ex.message; err.hidden = false; btn.disabled = false;
    } finally {
      delete state.sending[t.id];
      if (!document.contains(btn)) { // redrawn while sending: the new Send button was drawn greyed out
        if (!err.hidden) toast(err.textContent, 6000);
        if (redrawAfterSend({ view: state.view, sel: state.sel, taskId: t.id })) { if (!formHasText()) render(); else state.reloadLater = true; } // (never over a form typed in meanwhile; the rule: logic.js)
      }
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
  const key = 'm' + taskId;
  const btn = el('button', { class: 'primary', disabled: !!state.sending[key], onClick: async () => {
    if (state.sending[key]) return; // already going (the screen was redrawn meanwhile)
    if (!box.value.trim()) { err.textContent = 'Write the message first.'; err.hidden = false; return; }
    btn.disabled = true; state.sending[key] = true;
    const text = box.value;
    // the same id online, in the outbox, and on a retry of the same words: a message whose reply was lost is not kept twice
    const ids = (state.msgCid ||= {});
    if (!ids[key] || ids[key].text !== text) ids[key] = { id: newClientId(), text };
    const cid = ids[key].id;
    try {
      const out = await api('comment.add', { taskId, text, clientId: cid });
      delete state.msgCid[key];
      delete state.drafts['m' + taskId]; delete state.sending[key]; // before the redraw, so the new button is not greyed out
      toast('Sent ✓');
      // only if this task is still open on screen (the user may have gone to another one)
      if (state.sel === 'task:' + taskId && state.detail && state.detail.task && state.detail.task.id === taskId) { state.detail.comments = out.comments; render(); }
    } catch (ex) {
      if (ex instanceof OfflineError) {
        try { await queue({ kind: 'comment', taskId, text, clientId: cid }); delete state.msgCid[key]; }
        catch { delete state.sending[key]; render(); toast(KEEP_FAIL, 6000); return; } // the text stays in the box
        delete state.drafts['m' + taskId]; delete state.sending[key]; // empty the box, so a second tap does not send it twice
        toast('📴 Saved on this phone — it will be sent when you are online', 5000);
        render();
        return;
      }
      err.textContent = ex.message; err.hidden = false; btn.disabled = false;
    } finally {
      delete state.sending[key];
      if (!document.contains(btn)) { // redrawn while sending: the new button was drawn greyed out
        if (!err.hidden) toast(err.textContent, 6000);
        if (state.sel === 'task:' + taskId) render();
      }
    }
  } }, 'Send message');
  return [
    el('h2', null, '💬 Messages'),
    comments.length ? comments.map((c) => el('div', { class: 'card msg' + (c.mine ? ' mine' : '') },
      el('div', { class: 'row small' }, el('strong', null, c.mine ? 'You' : c.by), el('span', { class: 'muted' }, `${fmtDay(c.at)} ${fmtTime(c.at)}${c.editedAt ? ' · edited' : ''}`),
        c.mine && !c.text.startsWith('↔ Moved') ? el('span', { class: 'msg-acts' },
          el('button', { class: 'link', title: 'Change', onClick: () => editMessage(taskId, c) }, '✎'),
          el('button', { class: 'link', title: 'Delete', onClick: () => deleteMessage(taskId, c) }, '🗑')) : null),
      c.photo ? msgPhoto(c.id) : null,
      c.text ? el('div', { class: 'pre' }, c.text) : null)) : el('p', { class: 'muted small' }, 'No messages yet.'),
    (state.outbox || []).filter((x) => x.kind === 'comment' && x.taskId === taskId).map((x) => el('div', { class: 'card msg mine' },
      el('div', { class: 'row small' }, el('strong', null, 'You'), el('span', { class: 'tag amber' }, '⏳ Waiting to send')), el('div', { class: 'pre' }, x.text))),
    el('div', { class: 'card stack' }, box, err, el('div', { class: 'row' }, btn, msgPhotoButton(taskId, box, key))),
  ];
}

const msgPhotoUrls = new Map();
function msgPhoto(id) {
  const img = el('img', { alt: 'Photo', class: 'msg-photo', onClick: () => { if (img.src) { const v = document.getElementById('viewer'); v.replaceChildren(el('img', { src: img.src, alt: '' })); v.hidden = false; v.onclick = () => { v.hidden = true; }; } } });
  const set = (u) => { img.src = u; };
  if (msgPhotoUrls.has(id)) set(msgPhotoUrls.get(id));
  else fetch('api/?a=comment.photo&id=' + id, { headers: { Authorization: 'Bearer ' + state.token } })
    .then((r) => { if (!r.ok) throw new Error('photo'); return r.blob(); })
    .then((b) => { const u = URL.createObjectURL(b); msgPhotoUrls.set(id, u); set(u); })
    .catch(() => { img.alt = 'Photo missing'; });
  return el('div', { class: 'thumbs' }, img);
}
/** 📷 in the messages: the photo goes with what is typed in the box (if anything). Needs the internet. */
function msgPhotoButton(taskId, box, key) {
  const input = el('input', { type: 'file', accept: 'image/*', class: 'hidden-file', onChange: () => { const f = input.files[0]; input.value = ''; if (f) sendMsgPhoto(taskId, f, box.value || '', box); } });
  return el('label', { class: 'btn', title: 'Send a photo' }, '📷 Photo', input);
}
async function sendMsgPhoto(taskId, f, text, box) {
  const key = 'm' + taskId;
  if (state.offline) { toast('Photos in messages need the internet. Try again when online.', 5000); return; }
  state.sending[key] = true;
  toast('Sending photo…');
  const fd = new FormData();
  fd.append('taskId', String(taskId)); fd.append('text', text); fd.append('clientId', newClientId()); fd.append('file', f, 'photo.jpg');
  let sent = false;
  try {
    const out = await api('comment.photo', fd, true);
    sent = true;
    delete state.drafts[key];
    toast('Sent ✓');
    if (state.sel === 'task:' + taskId && state.detail) state.detail.comments = out.comments;
  } catch (ex) { toast(ex instanceof OfflineError ? 'Photos in messages need the internet. Try again when online.' : ex.message, 6000); }
  finally {
    delete state.sending[key];
    // the box still holds just the words that went: empty it, so it is not "typing" and a second tap cannot send them twice (the rule: logic.js)
    if (sent && box && document.contains(box) && msgBoxSent(box.value, text)) { box.value = ''; box.dataset.init = ''; }
    if (!formHasText()) render(); else state.reloadLater = true; // (a form opened meanwhile is not wiped)
  }
}

// Ctrl+V on an open task: in the message box = a photo message; otherwise staff add it to today's update, the manager as an instruction file
document.addEventListener('paste', (e) => {
  if (e.defaultPrevented || !state.user || !state.sel || !state.sel.startsWith('task:') || !state.detail || !state.detail.task) return;
  const files = [...((e.clipboardData && e.clipboardData.files) || [])];
  if (!files.length) return; // plain text: pasted as usual
  if ((e.clipboardData.getData('text/plain') || '').trim()) return; // text with a picture of it (cells from Excel, Word): the text
  e.preventDefault();
  const t = state.detail.task;
  const images = files.filter((f) => f.type.startsWith('image/'));
  const inMessages = e.target && e.target.tagName === 'TEXTAREA' && /^(Reply|Ask)/.test(e.target.placeholder || ''); // the message box
  if (inMessages) {
    if (!images.length) { toast('Only photos can go in a message. Ask your manager to add other files to the task.', 5000); return; }
    sendMsgPhoto(t.id, images[0], e.target.value || '', e.target);
    return;
  }
  if (state.user.role === 'admin') { toast('📎 Adding to the task…'); uploadTaskFiles(t.id, files.slice(0, 10)).then(() => { toast('📎 Added ✓'); loadDetail(); }).catch((ex) => toast(ex.message, 6000)); return; }
  if (!images.length) { toast('Only photos can be added to an update.', 5000); return; }
  if (t.status !== 'open' && !t.today) { toast('This task is closed.', 4000); return; }
  if (pasteWaits(state.outbox, t.id, !!state.editing[t.id])) { toast('Wait until your update is sent, then add the photo.', 5000); return; } // (no box to put it in)
  addTaskPhotos(t, images.slice(0, 5), !!(t.today && !state.editing[t.id]));
  toast('📷 Pasted into your update');
});
async function editMessage(taskId, c) {
  const text = prompt('Change your message:', c.text);
  if (text === null || text.trim() === c.text.trim()) return;
  try { const out = await api('comment.edit', { id: c.id, text }); if (state.detail) state.detail.comments = out.comments; render(); toast('Changed ✓'); }
  catch (ex) { toast(ex.message, 5000); }
}
async function deleteMessage(taskId, c) {
  if (!confirm('Delete this message?')) return;
  try { const out = await api('comment.delete', { id: c.id }); if (state.detail) state.detail.comments = out.comments; render(); toast('Deleted'); }
  catch (ex) { toast(ex.message, 5000); }
}

function suggestForm() {
  const err = el('p', { class: 'err', hidden: true });
  const title = el('input', { required: true, placeholder: 'Clean the dryer filters every week' });
  const details = el('textarea', { placeholder: 'Why it is needed (optional)' });
  const formId = newClientId(); // a retry of this form sends the same id: kept once
  const how = el('select', null, el('option', { value: 'once' }, 'One time'), el('option', { value: 'daily' }, 'Every day'), el('option', { value: 'weekly' }, 'Once a week'));
  const btn = el('button', { class: 'primary', type: 'submit' }, 'Send to my manager');
  return [
    el('h1', null, '💡 Suggest a task'),
    el('p', { class: 'muted' }, 'Your manager says yes or no. If yes, it comes on your list.'),
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.hidden = true;
      const item = { title: title.value, details: details.value, repeat: how.value, clientId: formId };
      try { await api('suggest', item); toast('Sent for a yes ✓'); state.section = 'sugg'; go('today'); }
      catch (ex) {
        if (ex instanceof OfflineError) { // kept on the phone, sent when online
          try { await queue({ kind: 'suggest', ...item }); toast('📴 Saved on this phone — it will be sent when you are online', 5000); state.section = 'sugg'; go('today'); return; }
          catch { /* could not keep it: say so below */ }
        }
        err.textContent = ex.message; err.hidden = false; btn.disabled = false;
      }
    } }, el('label', null, 'Task', title), el('label', null, 'Details', details), el('label', null, 'How often', how), err,
    el('div', { class: 'row' }, btn, el('button', { type: 'button', onClick: () => go('today') }, 'Cancel'))),
  ];
}

/** Returns the photos not sent because the internet (or the server) dropped, so they can be kept on the phone. */
async function uploadPhotos(updateId, files, cid) {
  for (let i = 0; i < files.length; i++) {
    const fd = new FormData();
    fd.append('updateId', String(updateId));
    fd.append('file', await shrink(files[i]), 'photo.jpg');
    if (cid) fd.append('clientId', `${cid}-p${i}`); // the outbox goes on from the same number, so a repeat is kept once
    try { await api('photo.add', fd, true); } catch (ex) {
      if (ex instanceof OfflineError || ex instanceof RetryError) return files.slice(i);
      toast(ex.message, 5000);
    }
  }
  return [];
}

// ---------- manager: 🔁 Follow-up (every task given out, worst first), the daily round, and work in one line

/** The Follow-up list: the one-line box, the top line, then each person's tasks (red, orange, grey, green). The rule: logic.js. */
function followupList() {
  const d = state.data;
  const rows = followupRows(d.rows, d.today);
  if (state.round) return roundScreen(d);
  return [
    el('div', { class: 'fu-quick' }, quickBox(d.people || [])),
    el('div', { class: 'fu-top' }, el('span', { class: 'muted' }, followupSummary(rows, d.today)),
      rows.length ? el('button', { class: 'primary', onClick: startRound }, '▶ Start round (2 min)') : null),
    rows.length ? followupGroups(rows).map((g) => [sec(g.person.name), el('ul', { class: 'list-body' }, g.rows.map(followRow))])
      : el('p', { class: 'list-note' }, 'Nothing given out right now.'),
  ];
}

/** One row: dot · title · the reason, and the buttons under it. */
function followRow(r) {
  const open = r.kind === 'project' ? 'project:' + r.projectRef : 'task:' + r.taskId;
  return el('li', { class: 'prow fu-row' + (state.sel === open ? ' current' : '') },
    el('button', { class: 'prow-btn', onClick: () => openDetail(open) },
      el('span', { class: 'dot ' + r.colour }),
      el('span', { class: 'prow-text' },
        el('span', { class: 'prow-name' }, (r.kind === 'project' ? '📁 ' : '') + r.title, r.stuck ? el('span', { class: 'tag red new-tag' }, 'Stuck') : null),
        r.step ? el('span', { class: 'prow-about' }, 'Now: ' + r.step) : null,
        el('span', { class: 'prow-next' + (r.colour === 'red' ? ' warn' : '') }, r.reason))),
    el('div', { class: 'fu-btns' },
      el('button', { class: 'chip', onClick: async () => { if (await chaseTask(r)) loadList(); } }, '🔔 Chase'),
      el('button', { class: 'chip', onClick: async () => { if (await closeFollow(r)) loadList(); } }, '✓ Done'),
      r.kind === 'project' // (the projects page hands out projects: never taken back here)
        ? [el('button', { class: 'chip', onClick: () => openDetail('project:' + r.projectRef) }, '📁 Open project'), el('span', { class: 'muted small' }, 'Take back on your projects page')]
        : el('button', { class: 'chip', onClick: () => takeBack(r) }, '↩ Take back')));
}

/** 🔔 Chase: the person gets a phone alert and a message on the task. true = done. */
async function chaseTask(r) {
  try {
    await api('task.chase', { id: r.taskId });
    toast(`🔔 Chased — ${r.person.name} gets an alert`);
    return true;
  } catch (ex) { toast(ex.message, 5000); return false; }
}

/** ✓ Done: the manager's Mark done (a project step: the same close as on the task page, so Daily Projects follows). true = done. */
async function closeFollow(r) {
  if (!confirm(r.kind === 'project' ? `Mark the step "${r.step || r.title}" done?` : `Mark "${r.title}" done?`)) return false;
  try { await api('task.status', { id: r.taskId, status: 'done' }); toast('Marked done ✓'); return true; } catch (ex) { toast(ex.message, 5000); return false; }
}

/** ↩ Take back: a plain task is cancelled from their list (the same cancel as the task's ⋯ menu). */
async function takeBack(r) {
  if (!confirm(`Take "${r.title}" back from ${r.person.name}'s list? It will be cancelled.`)) return;
  try { await api('task.status', { id: r.taskId, status: 'cancelled' }); toast('Taken back ✓'); loadList(); } catch (ex) { toast(ex.message, 5000); }
}

// the round: what was looked at today is kept on this device, so a round stopped half way goes on from there
const roundStoreKey = () => 'wt.round.' + state.user.id;
function roundLoad() { try { return JSON.parse(load(roundStoreKey()) || 'null'); } catch { return null; } }
const roundStore = (s) => save(roundStoreKey(), JSON.stringify(s));

function startRound() {
  state.round = { rows: followupRows(state.data.rows, state.data.today), saved: roundLoad(), changing: false }; // (the order stays as it was at the start)
  render();
}

/** ▶ The round: one item at a time, worst first, with a thin progress bar; at the end what was done. */
function roundScreen(d) {
  const R = state.round, today = d.today;
  const plan = roundPlan(R.rows, R.saved, today); // (the rule: logic.js)
  const s = plan.saved;
  const bar = (part) => el('div', { class: 'progress' }, (() => { const b = el('span'); b.style.width = `${Math.round(part * 100)}%`; return b; })());
  const stop = () => { state.round = null; loadList(); };
  const head = el('div', { class: 'row spread' }, el('strong', null, '🔁 Daily follow-up round'), el('button', { class: 'link', onClick: stop }, 'Stop'));
  if (!plan.queue.length) {
    return el('div', { class: 'card stack fu-round' }, head, bar(1), el('h2', null, 'All followed up ✓'),
      el('p', { class: 'muted' }, `${s.chased} chased · ${s.changed} changed · ${s.closed} closed`),
      el('button', { class: 'primary', onClick: stop }, 'Back to the list'));
  }
  const r = plan.queue[0];
  const mark = (what) => { R.saved = roundMark(R.saved, roundKey(r), what, today); roundStore(R.saved); R.changing = false; render(); };
  const others = (d.people || []).filter((p) => p.role !== 'admin' && p.id !== r.person.id);
  return el('div', { class: 'card stack fu-round' }, head,
    bar((plan.pos - 1) / plan.total),
    el('p', { class: 'muted small' }, `Item ${plan.pos} of ${plan.total}`),
    el('h2', null, (r.kind === 'project' ? '📁 ' : '') + r.title),
    r.step ? el('p', { class: 'muted small' }, 'Now: ' + r.step) : null,
    el('p', null, el('span', { class: 'dot ' + r.colour }), ` ${r.person.name} · ${r.reason}`),
    el('p', { class: 'muted small' }, r.lastUpdate ? `Last update: ${fmtDay(r.lastUpdate.day)} — ${r.lastUpdate.note || ''}` : 'No update yet'),
    R.changing ? el('div', { class: 'stack' },
      el('strong', null, r.kind === 'project' ? 'Move the whole project (all its open steps) to:' : 'Give it to:'),
      el('div', { class: 'row' }, others.length ? others.map((p) => el('button', { class: 'chip', onClick: async () => {
        try { await api('task.move', { id: r.taskId, toId: p.id }); toast(`Moved to ${p.name} ✓`); mark('changed'); } catch (ex) { toast(ex.message, 5000); }
      } }, p.name)) : el('span', { class: 'muted' }, 'Add another person first (People).'))) : null,
    el('div', { class: 'fu-btns' },
      el('button', { class: 'primary', onClick: () => mark('ok') }, '👍 OK'),
      el('button', { class: 'chip', onClick: async () => { if (await chaseTask(r)) mark('chased'); } }, '🔔 Chase'),
      el('button', { class: 'chip' + (R.changing ? ' on' : ''), onClick: () => { R.changing = !R.changing; render(); } }, '👤 Change person'),
      el('button', { class: 'chip', onClick: async () => { if (await closeFollow(r)) mark('closed'); } }, '✕ Close')));
}

/**
 * Hand out work in one line: "Valar: send kiln photos by Friday" (or 🎤 say it). A preview card, then ✓ Give it
 * (a one-time task with that by-date) or ✎ Change (the full Give a task form, filled in). The rule: parseQuickTask in logic.js.
 */
function quickBox(people) {
  const q = state.quick || (state.quick = { text: '', sig: '', cid: '' });
  const today = (state.data && state.data.today) || istDay(new Date());
  const box = el('input', { type: 'text', class: 'fu-in', value: q.text, placeholder: 'Valar: send kiln photos by Friday', 'aria-label': 'Hand out work in one line', enterkeyhint: 'done' });
  const card = el('div', { class: 'fu-preview' });
  const show = () => {
    q.text = box.value;
    if (!box.value.trim()) { card.replaceChildren(); return; }
    const r = parseQuickTask(box.value, people, today);
    if (r.error) { card.replaceChildren(el('p', { class: 'err' }, r.error)); return; }
    const sig = JSON.stringify([r.person.id, r.title, r.dueDate]);
    if (q.sig !== sig) { q.sig = sig; q.cid = newClientId(); } // one id per preview: a second tap gives the task once
    const give = el('button', { class: 'primary', onClick: async () => {
      give.disabled = true;
      try {
        const out = await api('task.save', taskSaveBody({ assigneeId: r.person.id, title: r.title, details: '', project: '', repeat: 'once', skipSunday: true, dueDate: r.dueDate }, q.cid));
        state.quick = null; box.value = ''; box.dataset.init = ''; card.replaceChildren(); // (an empty box is not "typing")
        notice('update', `Given to ${out.task.assignee.name} ✓`, r.title + (r.dueDate ? ` · by ${fmtDay(r.dueDate)}` : ''), () => openDetail('task:' + out.task.id));
        if (state.view === 'followup' || state.view === 'today' || state.view === 'tasks') loadList();
      } catch (ex) { toast(ex.message, 5000); give.disabled = false; }
    } }, '✓ Give it');
    card.replaceChildren(el('div', { class: 'card stack' },
      el('div', null, el('span', { class: 'muted small' }, 'Task: '), el('strong', null, r.title)),
      el('div', null, el('span', { class: 'muted small' }, 'Person: '), r.person.name),
      el('div', null, el('span', { class: 'muted small' }, 'By: '), r.dueDate ? fmtDay(r.dueDate) : 'No by-date (one time)'),
      el('div', { class: 'row' }, give, el('button', { type: 'button', onClick: () => {
        state.prefill = { title: r.title, assigneeId: r.person.id, repeat: 'once', dueDate: r.dueDate };
        state.quick = null;
        openDetail('give');
      } }, '✎ Change'))));
  };
  box.addEventListener('input', show);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); show(); } });
  // 🎤 only where the browser can listen; when it stops, its words go into the box
  const Listen = window.SpeechRecognition || window.webkitSpeechRecognition;
  let mic = null;
  if (Listen) {
    mic = el('button', { type: 'button', class: 'chip', title: 'Say it', 'aria-label': 'Say it', onClick: () => {
      const rec = new Listen();
      rec.lang = 'en-IN'; rec.interimResults = false; rec.maxAlternatives = 1;
      let heard = '';
      rec.onresult = (e) => { heard = [...e.results].map((x) => x[0].transcript).join(' ').trim(); };
      rec.onerror = (e) => { if (e.error === 'not-allowed') toast('Allow the microphone to speak the task', 5000); };
      rec.onend = () => { mic.classList.remove('on'); if (heard) { box.value = heard; show(); box.focus(); } };
      try { rec.start(); mic.classList.add('on'); } catch { /* already listening */ }
    } }, '🎤');
  }
  show();
  return el('div', { class: 'fu-box' }, el('div', { class: 'fu-line' }, box, mic), card);
}

/** The one People page is on the projects page (each person's work, the morning email and their sign-in). */
function openPeoplePage() { location.href = 'projects/#people'; }

// ---------- manager: team today

function teamToday() {
  outlookConnected(); // asked once per page load, so 📧 Morning email knows by the time it is pressed
  const d = state.data;
  const byPerson = new Map();
  for (const t of d.tasks) { if (!byPerson.has(t.assignee.id)) byPerson.set(t.assignee.id, []); byPerson.get(t.assignee.id).push(t); }
  const people = [...d.people];
  for (const t of d.tasks) if (!people.some((p) => p.id === t.assignee.id)) people.push({ id: t.assignee.id, name: t.assignee.name });
  return [
    el('div', { class: 'row spread' }, el('div', null, el('h1', null, 'Team today'),
      d.stale ? el('p', { class: 'small warn' }, `📴 Saved copy from ${fmtDay(d.today)} — today's updates are not shown yet.`)
        : el('p', { class: 'muted small' }, `${fmtDay(d.today)} · updates due by ${d.fillBy}`)),
    el('button', { class: 'primary', onClick: () => go('give') }, '+ Give a task')),
    needsYou(d),
    people.length ? null : el('div', { class: 'card' }, 'No team members yet. ', el('button', { class: 'link', onClick: () => openPeoplePage() }, 'Add a person')),
    people.map((p) => {
      const tasks = byPerson.get(p.id) || [];
      const sent = tasks.filter((t) => t.today).length;
      const tag = !tasks.length ? el('span', { class: 'tag grey' }, 'No tasks today')
        : sent === tasks.length ? el('span', { class: 'tag green' }, `✓ ${sent} of ${tasks.length} sent`)
          : el('span', { class: 'tag ' + (d.late ? 'red' : 'amber') }, `${sent} of ${tasks.length} sent`);
      return el('div', { class: 'card person' + (tasks.length && sent < tasks.length && d.late ? ' late' : '') },
        el('div', { class: 'person-head' }, el('h3', null, p.name), tag),
        tasks.map((t) => teamRow(t, d)),
        el('div', { class: 'row' }, el('button', { class: 'chip', onClick: () => morningEmail(p) }, '📧 Morning email'), sentMark(p, istDay(new Date()))));
    }),
  ];
}

/**
 * Is the owner's Outlook connected (for the "no paste" morning email)? Asked once per page load (outlook.status, owner
 * only), kept in memory; Settings' Outlook card keeps it up to date. false until the answer comes.
 */
let outlookOn = null; // null: not asked; a promise while asking; then true / false
function outlookConnected() {
  if (outlookOn === null && state.user && state.user.owner) {
    outlookOn = api('outlook.status').then((d) => { outlookOn = !!(d.outlook && d.outlook.connected); }, () => { outlookOn = false; });
  }
  return outlookOn === true;
}

/**
 * 📧 Morning email. "No paste": with the owner's Outlook connected and the person's email saved, the finished email
 * (table inside, To and Subject filled) goes straight into Outlook Drafts (outlook.compose, never sent) and opens in a new
 * tab — you check it and press Send. Otherwise (or if that fails): copy the table (Ctrl+V in the email), then open the
 * email with To and Subject filled, and say why in one short line.
 * The copy and the new tab are started at once, in the tap itself (browsers only allow them straight after a tap).
 */
async function morningEmail(p) {
  const ready = api('morning.mail', { userId: p.id }).then((out) => ({ out, mail: morningMail({ person: out.person, manager: out.manager, items: out.items, today: out.today }) }));
  const connected = outlookConnected();
  const tryDraft = connected && (p.email === undefined || emailPath({ connected, email: p.email }) === 'draft');
  let copied = false;
  const copying = (async () => {
    try {
      if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('no table copy');
      const blob = (type, key) => ready.then(({ mail }) => new Blob([mail[key]], { type }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob('text/html', 'html'), 'text/plain': blob('text/plain', 'text') })]);
      copied = true;
    } catch { /* table copy not allowed here: plain words below */ }
  })();
  const tab = tryDraft ? window.open('about:blank', '_blank') : null; // opened now, inside the tap (a tab opened later is blocked)
  await copying;
  let got;
  try { got = await ready; } catch (ex) { if (tab) tab.close(); toast(ex.message, 5000); return; }
  const { out, mail } = got;
  const email = out.person.email || '';
  let why = '';
  if (tryDraft && emailPath({ connected, email }) === 'draft') {
    try {
      const r = await api('outlook.compose', { to: email, subject: mail.subject, html: mail.html });
      markSent(p.id, out.today); // the same sent mark as the paste way
      if (tab) { try { tab.opener = null; } catch { /* fine */ } tab.location.href = r.webLink; } else window.open(r.webLink, '_blank', 'noopener');
      notice('msg', 'Draft ready in Outlook — check it and press Send.', null, null, {});
      return;
    } catch (ex) { why = pasteReason({ connected, email, name: out.person.name, error: ex.message }); }
  } else if (!email || (state.user && state.user.owner)) why = pasteReason({ connected, email, name: out.person.name }) || '';
  if (tab) tab.close();
  markSent(p.id, out.today); // (on the server, so every device shows it; the email opens even if this fails)
  if (!copied) try { await navigator.clipboard.writeText(mail.text); copied = true; } catch { /* not allowed either */ }
  el('a', { href: 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(mail.subject) }).click(); // Outlook opens
  const lead = why ? why + ' — ' : '';
  const noEmail = email ? null : 'Then add it on the People page.';
  if (copied) notice('msg', lead + (lead ? 'table copied, paste it with ⌘ Cmd+V (Ctrl+V), then Send.' : 'Table copied — press Ctrl+V in the email, then Send.'), noEmail, null, { stay: !email });
  else notice('msg', lead + 'Could not copy. Select these words, copy them into the email, then Send.', mail.text, null, { copy: true, stay: true });
}

/** The manager pressed 📧 Morning email: save the time on the server; if that fails, show the mark on this device anyway. */
function markSent(userId, today) {
  const show = (at) => {
    state.sentLocal = { ...(state.sentLocal || {}), [userId]: at };
    softRender();
  };
  api('morning.sent', { userId }).then((r) => show(r.sentAt), () => show(today + ' ' + new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })));
}

/** When the morning email to this person was last sent (the server's time, or this device's own when the server could not be told). */
const sentAtOf = (id, serverAt) => { const mine = (state.sentLocal || {})[id] || ''; return mine > (serverAt || '') ? mine : serverAt || null; };

/** Team today: a small '✓ 9:05' next to the 📧 Morning email button once sent today. */
function sentMark(p, today) {
  const t = sentTime(sentAtOf(p.id, p.morningSentAt), today);
  return t ? el('span', { class: 'm-sent small', title: 'Morning email sent today' }, ' ✓ ' + t) : null;
}

/** People page: one staff person's pending work, as in the morning email (the same items, order and summary). */
function morningCard(mp, today) {
  const list = morningOrder(mp.items);
  if (!list.length) return el('p', { class: 'muted small' }, 'No pending work today.');
  const open = (x) => (x.projectRef ? openDetail('project:' + x.projectRef) : x.taskId ? openDetail('task:' + x.taskId) : null);
  const line = (cls, words) => el('div', { class: 'm-line ' + cls }, words);
  return [
    el('p', { class: 'muted small' }, morningSummary(list)),
    el('table', { class: 'mtable' },
      el('thead', null, el('tr', null, el('th', { class: 'm-no' }, '#'), el('th', null, 'Work'), el('th', { class: 'm-last' }, 'Last update'))),
      el('tbody', null, list.map((x, i) => el('tr', { class: x.taskId || x.projectRef ? 'm-open' : null, onClick: () => open(x) },
        el('td', { class: 'm-no' }, String(i + 1)),
        el('td', null, el('b', null, morningTitle(x)),
          x.kind === 'project' && x.about ? line('m-about', aboutShort(x.about)) : null,
          x.lateSince ? line('m-late', `Late since ${mailDate(x.lateSince)}`) : null,
          x.stuck ? line('m-stuck', 'Stuck') : null,
          x.now ? line('m-grey', `Now: ${x.now}`) : null,
          x.repeat ? line('m-grey', x.repeat) : null),
        el('td', { class: 'm-last muted' }, morningLast(x)))))),
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
  const { task: t, updates, comments = [] } = state.detail;
  const admin = state.user.role === 'admin';

  const today = (state.data && !state.data.stale && !state.data.fromCache && state.data.today) || istDay(new Date());
  return [
    admin ? taskMenu(t) : null,
    taskChips(t, today, admin),
    t.details ? el('div', { class: 'task-details pre' }, t.details) : null,
    taskFiles(t, admin),
    admin && t.status === 'suggested' ? el('div', { class: 'row' },
      el('span', { class: 'tag' }, `💡 Suggested by ${t.assignee.name}`),
      el('button', { class: 'primary', onClick: async () => { try { await api('task.approve', { id: t.id }); toast('Added ✓'); loadView(); } catch (ex) { toast(ex.message, 5000); } } }, '✓ Yes, add it'),
      el('button', { onClick: async () => { const why = prompt('Not now — why (optional):', ''); if (why === null) return; try { await api('task.decline', { id: t.id, reason: why }); toast('Answered'); loadView(); } catch (ex) { toast(ex.message, 5000); } } }, 'Not now')) : null,
    admin && t.status === 'open' ? moveBox(t) : null,
    messagesBlock(t.id, comments),
    t.status === 'suggested' || t.declined ? null : taskDiary(t, updates, today, false),
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
  const editing = (state.sel || '').startsWith('edit:');
  if (editing && !state.detail) return el('p', { class: 'muted' }, 'Loading…');
  const t = editing ? state.detail.task : null;
  const pre = !editing ? (state.prefill || {}) : {};
  const err = el('p', { class: 'err', hidden: true });
  const person = el('select', { required: true }, el('option', { value: '' }, 'Choose a person…'),
    state.people.map((p) => el('option', { value: String(p.id) }, p.name + (p.role === 'admin' ? ' (manager)' : ''))));
  // a person who was switched off: keep them, so a small change does not force choosing someone else
  if (t && !state.people.some((p) => p.id === t.assignee.id)) person.append(el('option', { value: String(t.assignee.id) }, t.assignee.name + ' (switched off)'));
  if (t) person.value = String(t.assignee.id);
  else if (pre.assigneeId && state.people.some((p) => p.id === pre.assigneeId)) person.value = String(pre.assigneeId); // (✎ Change from the one-line box)
  else if (state.people.filter((p) => p.role === 'staff').length === 1) person.value = String(state.people.find((p) => p.role === 'staff').id);
  const title = el('input', { value: t ? t.title : pre.title || '', required: true, placeholder: 'Record kiln 3 temperature' });
  const details = el('textarea', { value: t ? t.details : pre.details || '', placeholder: 'Anything they need to know (optional)' });
  const project = el('input', { value: t ? t.project : pre.project || '', placeholder: 'Kiln trial (optional)' });
  const kind = t ? (t.repeat === 'daily' ? (t.skipSunday ? 'daily' : 'daily7') : t.repeat) : pre.repeat === 'once' ? 'once' : 'daily';
  const how = el('select', null,
    el('option', { value: 'daily' }, 'Every day (Mon–Sat)'), el('option', { value: 'daily7' }, 'Every day, Sunday too'),
    el('option', { value: 'weekly' }, 'Once a week'), el('option', { value: 'once' }, 'One time'));
  how.value = kind;
  const weekday = el('select', null, LONG_DAYS.map((n, i) => el('option', { value: String(i) }, n)));
  weekday.value = String(t && t.weekday !== null ? t.weekday : 1);
  const due = el('input', { type: 'date', value: t && t.dueDate ? t.dueDate : pre.dueDate || '' });
  const todayIs = (state.data && state.data.today) || istDay(new Date());
  const start = el('input', { type: 'date', min: todayIs, value: t && t.startDate && t.startDate > todayIs ? t.startDate : '' });
  const needsPhoto = el('input', { type: 'checkbox', checked: t ? t.needsPhoto : false });
  const files = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true });
  const wLabel = el('label', null, 'On', weekday);
  const dLabel = el('label', null, 'By (date, optional)', due);
  const sync = () => { wLabel.hidden = how.value !== 'weekly'; dLabel.hidden = how.value !== 'once'; };
  how.addEventListener('change', sync);
  sync();
  const btn = el('button', { class: 'primary', type: 'submit' }, editing ? 'Save' : 'Give task');
  const formId = editing ? '' : newClientId(); // one per form: a second tap after a lost answer gives the task once
  return [
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      err.hidden = true; btn.disabled = true;
      try {
        const out = await api('task.save', taskSaveBody({
          id: t ? t.id : 0, assigneeId: Number(person.value), title: title.value, details: details.value, project: project.value,
          repeat: how.value === 'daily7' ? 'daily' : how.value, skipSunday: how.value === 'daily' || (how.value === 'once' && (!t || t.skipSunday)), weekday: Number(weekday.value), dueDate: due.value,
          projectRef: t ? t.projectRef : pre.projectRef, stepRef: t ? t.stepRef : pre.stepRef, needsPhoto: needsPhoto.checked, startDate: start.value || (t && t.startDate && t.startDate > todayIs ? todayIs : ''),
        }, formId));
        if (files.files.length) await uploadTaskFiles(out.task.id, [...files.files].slice(0, 10));
        const fromProjects = !editing && pre.stepRef && state.user.owner;
        state.prefill = null;
        toast(editing ? 'Saved ✓' : `Given to ${out.task.assignee.name} ✓`);
        if (fromProjects) { setTimeout(async () => { if (!(await toProjects())) go('today'); }, 900); return; }
        openDetail('task:' + out.task.id); loadList();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    } },
    el('label', null, 'Who', person), el('label', null, 'Task', title), el('label', null, 'Details', details),
    el('label', null, 'Project', project), el('label', null, 'How often', how), wLabel, dLabel,
    el('label', null, 'Start on (optional — empty = today)', start),
    el('label', { class: 'check' }, needsPhoto, ' 📷 Photo needed to finish'),
    el('label', null, '📎 Instruction photos / PDF (optional)', files), err,
    el('div', { class: 'row' }, btn, el('button', { type: 'button', onClick: async () => { state.prefill = null; if (!editing && state.fromProjects && state.user.owner && await toProjects()) return; if (editing) openDetail('task:' + t.id); else closeDetail(); } }, 'Cancel'))),
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
  outlookConnected(); // asked once per page load, so 📧 Morning email knows by the time it is pressed
  const users = state.data.users;
  const err = el('p', { class: 'err', hidden: true });
  const name = el('input', { required: true, placeholder: 'Suresh Kumar' });
  const username = el('input', { required: true, autocapitalize: 'none', spellcheck: 'false', placeholder: 'suresh' });
  const pass = el('input', { required: true, value: tempPassword() });
  const role = el('select', null, el('option', { value: 'staff' }, 'Staff (sees only own tasks)'), el('option', { value: 'admin' }, 'Manager (sees everything)'));
  const email = el('input', { type: 'email', maxlength: 120, autocapitalize: 'none', spellcheck: 'false', placeholder: 'suresh@company.com' });
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
  const setEmail = async (u) => {
    const v = prompt(`${u.name}'s email (for the morning email). Leave empty for none.`, u.email || '');
    if (v === null || v.trim() === (u.email || '')) return;
    try { await api('user.save', { id: u.id, name: u.name, role: u.role, email: v.trim() }); toast('Email saved ✓'); loadView(); } catch (ex) { toast(ex.message, 5000); }
  };
  // the morning email: each active staff person's pending work and whether it went today (from people.morning)
  const morning = state.data.morning, today = istDay(new Date()); // (this device's day: a saved copy from yesterday shows not sent)
  const mpOf = (u) => (morning && u.active && u.role === 'staff' ? morning.people.find((x) => x.id === u.id) : null);
  const sentOf = (mp) => sentAtOf(mp.id, mp.sentAt);
  const sentCount = morning ? morning.people.filter((mp) => sentTime(sentOf(mp), today)).length : 0;
  const head = (u, mp) => {
    if (!mp) return [el('div', { class: 'row spread' }, el('div', null, el('strong', null, u.name), ' ', el('span', { class: 'muted small' }, '@' + u.username)),
      el('span', { class: 'tag ' + (!u.active ? 'grey' : u.role === 'admin' ? '' : 'green') }, !u.active ? 'Switched off' : u.role === 'admin' ? 'Manager' : 'Staff')),
    el('div', { class: 'meta' }, u.lastLogin ? `Last signed in ${fmtDay(u.lastLogin)} ${fmtTime(u.lastLogin)}` : 'Not signed in yet', u.email ? ` · 📧 ${u.email}` : '')];
    const at = sentOf(mp), sent = !!sentTime(at, today);
    return [el('div', { class: 'row spread m-head' },
      el('div', { class: 'm-who' }, el('strong', null, u.name), ' ', el('span', { class: 'muted small' }, '@' + u.username), ' ',
        u.email ? el('span', { class: 'muted small' }, u.email) : el('button', { class: 'link small', onClick: () => setEmail(u) }, 'no email — add one')),
      el('span', { class: 'tag ' + (sent ? 'green' : 'amber') }, (sent ? '✓ ' : '') + sentTag(at, today))),
    el('div', { class: 'meta' }, u.lastLogin ? `Last signed in ${fmtDay(u.lastLogin)} ${fmtTime(u.lastLogin)}` : 'Not signed in yet'),
    el('div', { class: 'row' }, el('button', { class: 'chip', onClick: () => morningEmail(u) }, sent ? '📧 Send again' : '📧 Morning email')),
    morningCard(mp, today)];
  };
  return [
    el('h1', null, 'People'),
    morning ? el('p', { class: 'muted' }, `Morning emails today: ${sentCount} of ${morning.people.length} sent`) : null,
    state.newPerson ? shareBox(state.newPerson) : null,
    users.map((u) => el('div', { class: 'card' },
      head(u, mpOf(u)),
      u.id === state.user.id ? null : el('div', { class: 'row' },
        el('button', { onClick: () => rename(u) }, '✎ Name'),
        el('button', { onClick: () => setEmail(u) }, '📧 Email'),
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
        const out = await api('user.save', { name: name.value, username: username.value, password: pass.value, role: role.value, email: email.value.trim() });
        state.newPerson = { name: out.user.name, username: out.user.username, password: pass.value };
        toast('Added ✓');
        loadView();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    } },
    el('label', null, 'Name', name), el('label', null, 'Username (small letters, no spaces)', username),
    el('label', null, 'First password (they change it when they sign in)', pass), el('label', null, 'Role', role),
    el('label', null, 'Email (optional, for the morning email)', email), err,
    el('button', { class: 'primary', type: 'submit' }, 'Add person')),
  ];
}

function settingsScreen() {
  const fill = el('input', { type: 'time', value: state.fillBy || '18:00' });
  // the saved time, if it came after drawing: only into an untouched box, and as its "drawn" value (not typing)
  api('team.today').then((d) => { if (!d.fillBy) return; state.fillBy = d.fillBy; if (lateValue(fill.value, fill.dataset.init, d.fillBy) === d.fillBy) { fill.value = d.fillBy; fill.dataset.init = d.fillBy; } }).catch(() => {});
  return [
    el('h1', null, 'Settings'),
    el('form', { class: 'card stack', onSubmit: async (e) => {
      e.preventDefault();
      try { await api('settings.save', { fillBy: fill.value }); toast('Saved ✓'); } catch (ex) { toast(ex.message, 5000); }
    } },
    el('label', null, 'Updates are due by (after this, missing ones show red)', fill),
    el('button', { class: 'primary', type: 'submit' }, 'Save')),
    state.user && state.user.owner ? outlookCard() : null,
  ];
}

/**
 * Settings → 📧 Outlook (only the owner of the projects): connect Outlook once; then every new email in its Inbox
 * becomes an item in the Daily Projects 📥 Inbox. The client secret is typed here and saved on the server only:
 * it is never sent back (the box stays empty; only "saved ✓ (ends …ab12)" shows).
 */
function outlookCard() {
  const clientId = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' });
  const tenantId = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' });
  const secret = el('input', { type: 'password', autocomplete: 'new-password', spellcheck: 'false', placeholder: 'Client secret Value' });
  const secretSaved = el('span', { class: 'muted small' });
  const redirect = el('code', { class: 'ol-redirect' });
  const line = el('p', { class: 'small ol-status' }, 'Loading…');
  const connectBtn = el('button', { type: 'button', class: 'primary' }, 'Connect Outlook');
  const checkBtn = el('button', { type: 'button' }, 'Check now');
  const offBtn = el('button', { type: 'button' }, 'Disconnect');
  const show = (o) => {
    if (!o) return;
    // only into an untouched box (never the secret: it never comes back from the server)
    if (!clientId.value) clientId.value = o.clientId || '';
    if (!tenantId.value) tenantId.value = o.tenantId || '';
    secretSaved.textContent = o.secretEnd ? `saved ✓ (ends …${o.secretEnd})` : 'not saved yet';
    redirect.textContent = o.redirectUri || '';
    line.textContent = outlookLine(o, o.today);
    line.classList.toggle('bad', !!o.error);
    checkBtn.hidden = offBtn.hidden = !o.connected;
    connectBtn.textContent = o.connected ? 'Connect again' : 'Connect Outlook';
    outlookOn = !!o.connected; // the 📧 Morning email buttons follow (no-paste draft)
  };
  const run = async (b, a, body, after) => {
    b.disabled = true;
    try { const out = await api(a, body); show(out.outlook); if (after) after(out); } catch (ex) { toast(ex.message, 6000); } finally { b.disabled = false; }
  };
  api('outlook.status').then((d) => show(d.outlook)).catch((ex) => { line.textContent = ex.message; });
  const saveBtn = el('button', { type: 'submit' }, 'Save');
  connectBtn.addEventListener('click', () => run(connectBtn, 'outlook.connect', {}, (out) => { if (out.url) location.href = out.url; }));
  checkBtn.addEventListener('click', () => run(checkBtn, 'outlook.check', {}, () => toast('Checked ✓')));
  offBtn.addEventListener('click', () => { if (confirm('Disconnect Outlook? New emails stop coming to your Inbox.')) run(offBtn, 'outlook.disconnect', {}, () => toast('Disconnected')); });
  return el('form', { class: 'card stack ol-card', onSubmit: (e) => {
    e.preventDefault();
    run(saveBtn, 'outlook.save', { clientId: clientId.value.trim(), tenantId: tenantId.value.trim(), secret: secret.value.trim() }, () => { secret.value = ''; toast('Saved ✓'); });
  } },
  el('h2', null, '📧 Outlook'),
  el('p', { class: 'muted small' }, 'Every new email in your Outlook Inbox comes to your Daily Projects 📥 Inbox (replies join the same item). Set up once in Azure (App registrations): register this Redirect URI (type Web), add the delegated permissions offline_access, User.Read and Mail.ReadWrite (it only reads your emails; it never sends any), make a client secret.'),
  el('label', null, 'Redirect URI to register', redirect),
  el('label', null, 'Application (client) ID', clientId),
  el('label', null, 'Directory (tenant) ID', tenantId),
  el('label', null, 'Client secret ', secretSaved, secret),
  saveBtn,
  line,
  el('div', { class: 'row' }, connectBtn, checkBtn, offBtn));
}

// ---------------------------------------------------------------- start

/** From Daily Projects: worktask.in/#new={"title":…,"project":…,"projectRef":…,"stepRef":…} opens "Give a task" filled in. */
function takePrefill() {
  const o = /^#open=(\d+)$/.exec(location.hash); // from a phone notification: open this task here
  if (o) { state.openTask = Number(o[1]); state.fromProjects = false; history.replaceState(null, '', location.pathname + location.search); return; }
  const m = /^#task=(\d+)$/.exec(location.hash); // from Daily Projects: open this team task
  state.fromProjects = !!m || location.hash.startsWith('#new='); // Back / Cancel return to the projects
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
    if (state.token) { state.retryMe = true; toast(e.message, 5000); } // offline and never opened here before: keep the sign-in, try again later
    render();
    return;
  }
  await loadOutbox();
  if (!state.user.mustChange) syncPush();
  // the owner opens the app on their projects; worktask.in/?team shows the Team pages
  const teamWanted = new URLSearchParams(location.search).has('team');
  if (state.user.owner && !state.user.mustChange && !teamWanted && !state.prefill && !state.openTask && await toProjects()) return;
  if (state.prefill && state.user.role === 'admin' && !state.user.mustChange) { go('give'); return; }
  if (state.openTask && !state.user.mustChange) { const id = state.openTask; state.openTask = 0; go('task:' + id); return; }
  render();
  if (!state.user.mustChange) loadView();
}

// ---------------------------------------------------------------- new tasks arrive by themselves (like new mail)

let liveBusy = false;
const listOf = (d) => [...((d && d.tasks) || []), ...((d && d.other) || []), ...((d && d.suggestions) || [])];
/** Every 20 seconds while the app is open: anything new? New tasks get a "New" mark and a message at the bottom. */
async function liveCheck(quiet = false) {
  if (liveBusy || !state.user || state.user.mustChange || document.visibilityState !== 'visible' || state.busy) return;
  refreshTeamCount();
  if (state.view !== 'today' && state.view !== 'tasks') return;
  const admin = state.user.role === 'admin';
  const action = state.view === 'today' ? (admin ? 'team.today' : 'my.today') : 'tasks.list';
  const body = state.view === 'tasks' ? { status: state.closed ? 'closed' : 'open' } : {};
  const view = state.view, me = state.user, closed = state.closed;
  liveBusy = true;
  try {
    const out = await api(action, body);
    if (out.fromCache || state.user !== me || state.view !== view || state.closed !== closed) return;
    const same = (a, b) => JSON.stringify(a, (k, v) => (k === 'time' ? undefined : v)) === JSON.stringify(b, (k, v) => (k === 'time' ? undefined : v));
    if (state.data && same(out, state.data)) return;
    const had = new Set(listOf(state.data).map((t) => t.id));
    const madeAfter = (t) => !admin || !state.lastLook || Date.parse(String(t.createdAt).replace(' ', 'T') + '+05:30') > state.lastLook - 60000;
    // new to this screen — but not what this person made themselves (an offline step that just went out, a suggestion, a project they gave)
    const fresh = state.data && view === 'today' ? listOf(out).filter((t) => !had.has(t.id) && !state.knownIds.has(t.id) && t.createdBy !== state.user.id && madeAfter(t)) : [];
    state.lastLook = Date.now();
    for (const t of fresh) state.newIds.add(t.id);
    if (!quiet && Date.now() - (state.pushAt || 0) > 30000) tellNews(fresh, out, state.data); // a notification just said it: not twice
    const a = document.activeElement;
    state.data = out; // kept now (shown with the next redraw), so the same news is never told twice
    if (admin && out.people) state.team = out;
    if ((a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) && document.getElementById('app').contains(a)) || formHasText()) { state.reloadLater = true; return; } // typing: show it after
    render();
    if (state.sel && (state.sel.startsWith('task:') || state.sel.startsWith('project:'))) loadDetail(); // new messages / steps on the open page too
  } catch { /* try again next time */ } finally { liveBusy = false; }
}
setInterval(() => liveCheck(), 20000);
window.addEventListener('focus', () => liveCheck());

/** What is new since the last look, as the coloured bar: new tasks / a project / new steps (blue), or the team's updates (green). */
function tellNews(fresh, out, before) {
  if (fresh.length) {
    const steps = fresh.filter((t) => t.projectRef && t.seq !== null && t.seq !== undefined);
    const one = steps.length === fresh.length && new Set(steps.map((t) => t.projectRef)).size === 1;
    const names = fresh.map((t) => t.title).slice(0, 3).join(' · ');
    if (one) {
      const p = steps[0].project || 'a project';
      const had = listOf(before).some((t) => t.projectRef === steps[0].projectRef);
      notice('task', had ? (steps.length === 1 ? `➕ New step in ${p}` : `➕ ${steps.length} new steps in ${p}`) : `📁 New project for you: ${p}`, names,
        () => openDetail(state.user.role === 'admin' ? 'task:' + steps[0].id : 'project:' + steps[0].projectRef));
    } else if (state.user.role === 'admin' && fresh.every((t) => t.status === 'suggested')) {
      notice('msg', fresh.length === 1 ? `💡 ${fresh[0].assignee.name} suggests a task` : `💡 ${fresh.length} new suggestions`, names, () => openDetail('task:' + fresh[0].id));
    } else notice('task', state.user.role === 'admin' ? (fresh.length === 1 ? '📥 New task' : `📥 ${fresh.length} new tasks`) : (fresh.length === 1 ? '📥 New task for you' : `📥 ${fresh.length} new tasks`), names, () => openDetail('task:' + fresh[0].id));
    return;
  }
  if (state.user.role !== 'admin' || !before) return;
  const was = new Map(listOf(before).map((t) => [t.id, t.today ? t.today.at : null]));
  const sent = listOf(out).filter((t) => t.today && was.has(t.id) && was.get(t.id) !== t.today.at && t.today.byId !== state.user.id);
  if (!sent.length) return;
  const t = sent[0], u = t.today;
  const head = sent.length > 1 ? `✓ ${sent.length} new updates` : u.state === 'stuck' ? `⚠️ ${u.by} is stuck` : u.state === 'finished' ? `✅ ${u.by} finished a task` : `✓ ${u.by} sent an update`;
  notice(u.state === 'stuck' && sent.length === 1 ? 'stuck' : 'update', head, `${t.title}: ${u.note}`, () => openDetail('task:' + t.id));
}

// ---------------------------------------------------------------- phone notifications (Web Push)

const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
/** 'on' | 'default' (not asked yet) | 'denied' (blocked) | 'granted' (allowed, not linked yet) | 'ios' (add to Home Screen first) | 'no' */
function pushState() {
  if (!pushOk()) return isIOS() ? 'ios' : 'no';
  if (Notification.permission === 'granted') return state.pushOn ? 'on' : 'granted';
  return Notification.permission;
}
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Link this phone to the signed-in person on the server (asks nothing: permission was given before). */
async function subscribePush() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('The app is still loading. Try again in a moment.')), 8000))]);
  const { key } = await api('push.key');
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options && sub.options.applicationServerKey && toB64u(sub.options.applicationServerKey) !== key) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
  await api('push.subscribe', sub.toJSON());
  state.pushOn = true;
}
const pushOffKey = () => 'wt.pushOff.' + (state.user ? state.user.id : 0);
async function syncPush() {
  if (!pushOk() || Notification.permission !== 'granted' || !state.user) return;
  try { if (localStorage.getItem(pushOffKey())) return; } catch { /* blocked */ } // turned off here by this person: stays off
  try { await subscribePush(); if (!formHasText()) render(); } catch { /* offline: next time */ }
}
async function turnOnPush() {
  if (!pushOk()) return;
  try { localStorage.removeItem(pushOffKey()); } catch { /* blocked */ }
  const p = await Notification.requestPermission();
  if (p !== 'granted') { softRender(); if (p === 'denied') openDetail('notify'); return; }
  try {
    await subscribePush();
    notice('task', '🔔 Notifications are on', 'New tasks, new project steps and messages will come to this phone, like email.');
  } catch (e) { toast('Could not turn on notifications: ' + e.message, 6000); }
  softRender(); // (a half-filled Give / Edit form is kept)
}
async function pushOff() {
  if (!pushOk()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) { await api('push.unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  state.pushOn = false;
}

/** At the top of the list, once: "turn on notifications". */
function pushBanner() {
  const s = pushState();
  if (s !== 'default' && s !== 'granted') return null;
  try { if (Number(localStorage.getItem('wt.pushLater') || 0) > Date.now() || localStorage.getItem(pushOffKey())) return null; } catch { /* blocked */ }
  return el('div', { class: 'push-banner' },
    el('span', null, '🔔 Get a message on this phone when a new task or update comes — like email.'),
    el('span', { class: 'row' },
      el('button', { class: 'primary', onClick: () => turnOnPush() }, 'Turn on'),
      el('button', { class: 'link', onClick: () => { try { localStorage.setItem('wt.pushLater', String(Date.now() + 3 * 86400000)); } catch { /* blocked */ } softRender(); } }, 'Later')));
}

function notifyPage() {
  const s = pushState(), admin = state.user.role === 'admin';
  const what = admin
    ? ['An update from your team (and when someone is Stuck or Finished)', 'A message or a suggestion from your team']
    : ['A new task, or a whole project given to you', 'A new step added to your project', 'A message from your manager'];
  const parts = [el('p', null, 'You get a message on this phone, like new email, for:'), el('ul', null, what.map((w) => el('li', null, w)))];
  if (s === 'on') {
    parts.push(el('p', { class: 'ok' }, '✓ On for this phone.'), el('div', { class: 'row' },
      el('button', { onClick: async () => { try { await api('push.test'); toast('🔔 Test sent. It comes in a few seconds.'); } catch (e) { toast(e.message, 5000); } } }, 'Send me a test'),
      el('button', { onClick: async () => { await pushOff(); try { localStorage.setItem(pushOffKey(), '1'); } catch { /* blocked */ } render(); toast('Notifications are off for this phone.'); } }, 'Turn off')));
  } else if (s === 'default' || s === 'granted') {
    parts.push(el('button', { class: 'primary', onClick: () => turnOnPush() }, '🔔 Turn on notifications'));
  } else if (s === 'denied') {
    parts.push(el('p', { class: 'warn' }, 'Notifications are blocked for Work Task on this phone. To allow them:'),
      el('ol', null,
        el('li', null, 'Installed app: press and hold the Work Task icon → App info → Notifications → turn on.'),
        el('li', null, 'In Chrome: tap ⋮ → Settings → Site settings → Notifications → worktask.in → Allow.'),
        el('li', null, 'Come back here and open this page again.')));
  } else if (s === 'ios') {
    parts.push(el('p', { class: 'warn' }, 'On iPhone, notifications work only from the Home Screen app:'),
      el('ol', null,
        el('li', null, 'Open worktask.in in Safari.'),
        el('li', null, 'Tap Share → Add to Home Screen.'),
        el('li', null, 'Open Work Task from the Home Screen and turn notifications on here.')));
  }
  return el('div', { class: 'card stack' }, parts);
}

// a notification arrived while the app is open, or one was tapped
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (!state.user || state.user.mustChange) {
      const id = d.type === 'open' && /^#open=(\d+)$/.exec(d.hash || '');
      if (id) state.openTask = Number(id[1]); // opened after sign-in / the new password
      return;
    }
    if (d.type === 'push') {
      const m = d.msg || {}, id = /#open=(\d+)/.exec(m.url || '');
      state.pushAt = Date.now();
      if (document.visibilityState === 'visible') notice(m.kind, m.title || 'Work Task', m.body || '', id ? () => openDetail('task:' + id[1]) : () => go('today'));
      liveCheck(true);
      const a = document.activeElement, typing = (a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)) || formHasText();
      if (id && state.sel === 'task:' + id[1] && !typing) loadDetail();
    } else if (d.type === 'new-version') {
      codeStamp = 'old'; checkNewVersion(); // the page runs an old copy: offer the reload
    } else if (d.type === 'open') {
      const id = /^#open=(\d+)$/.exec(d.hash || '');
      if (id) openDetail('task:' + id[1]); else go('today');
    }
  });
}

/** The number on the app icon (Android, installed app): tasks still to send today. */
function setBadge() {
  if (state.user && state.user.role === 'admin' && navigator.clearAppBadge && document.visibilityState === 'visible') { navigator.clearAppBadge().catch(() => {}); return; }
  if (!state.user || state.user.role === 'admin' || state.view !== 'today' || !state.data || !navigator.setAppBadge) return;
  const n = (state.data.tasks || []).filter((t) => !t.today).length;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

function retryStart() { if (state.token && !state.user && state.retryMe) { state.retryMe = false; start(); } }
window.addEventListener('online', () => { setOffline(false); flushOutbox(); retryStart(); });
setInterval(retryStart, 15000);
window.addEventListener('offline', () => setOffline(true));
setInterval(() => { if ((state.outbox || []).length) flushOutbox(); }, 30000); // weak signal: keep trying

window.addEventListener('hashchange', () => {
  takePrefill();
  if (state.prefill && state.user?.role === 'admin') go('give');
  else if (state.openTask && state.user) { const id = state.openTask; state.openTask = 0; go('task:' + id); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.user || state.user.mustChange) return;
  const v = state.view;
  if (formHasText()) { state.reloadLater = true; return; } // back from the camera or another app: keep what was typed or picked
  if (state.reloadLater && (v === 'today' || v === 'tasks')) { loadView(); return; } // items were sent while they typed
  if (v === 'today' && !Object.keys(state.drafts).some((k) => state.drafts[k].note)) loadView();
});
start();
// Installable as an app (Android: Chrome menu → Install app); keeps the screens for fast opening.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------------------------------------------------------------- a new version was uploaded while this page stayed open
// Offer a reload (a page left open could otherwise run old code for days). Checked every 5 minutes and when coming back.
let codeStamp = null;
async function checkNewVersion() {
  try {
    // version.txt is written by every upload (tools/deploy-worktask.sh): a different one = a new version
    // the first one comes the same way as the page's code (offline: the copy kept with it); later ones always from the server
    const r = await fetch(codeStamp === null ? 'version.txt' : `version.txt?check=${Date.now()}`, codeStamp === null ? {} : { cache: 'no-store' });
    const stamp = r.ok ? (await r.text()).trim() : '';
    if (!stamp) return;
    if (codeStamp === null) { codeStamp = stamp; return; }
    if (stamp !== codeStamp && !document.getElementById('update-ready')) {
      const b = document.createElement('button');
      b.id = 'update-ready'; b.className = 'update-ready'; b.type = 'button';
      b.textContent = '✨ New version ready — tap to reload';
      b.addEventListener('click', () => location.reload());
      document.body.append(b);
    }
  } catch { /* offline: next time */ }
}
checkNewVersion();
setInterval(checkNewVersion, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkNewVersion(); });
