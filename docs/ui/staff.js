// The staff view of the one app: a team member signs in on worktask.in and sees only their own Work Task tasks,
// in the same layout as the owner's Daily Projects (menu, list, page on the right).
// Everything goes through the Work Task server, which answers each person with their own tasks only.
// The owner's projects are never asked for here (dp.* is refused for anyone but the owner anyway).
// The rules (the day-by-day history, the update body, what stays in a box after Send, what to show when a waiting
// item is refused) come from Work Task's logic.js, passed in as `rules`, so both apps follow the same rules.
// Sending while offline: ui/staffbox.js (Work Task's own outbox on this site, shared by both apps).

import { h, morph, fmtDay as dayOf } from './dom.js';
import { createOutbox } from './staffbox.js';

// the server's times are India time as "2026-10-22 10:30:00" (as Work Task shows them)
const fmtDay = (d) => (d ? dayOf(String(d).slice(0, 10)) : '');
const fmtTime = (dt) => {
  const [hh, mm] = String(dt || '').slice(11, 16).split(':').map(Number);
  return Number.isFinite(hh) && Number.isFinite(mm) ? `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}` : '';
};
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const STATES = [['progress', 'Working on it'], ['stuck', 'Stuck'], ['finished', 'Finished']];
const stateName = (s) => (STATES.find((x) => x[0] === s) || STATES[0])[1];
// (the owner's tags: Stuck as late, Finished as done, Working on it as waiting)
const stateTag = (s) => h('span', { class: 'tag ' + (s === 'stuck' ? 'late' : s === 'finished' ? 'done-tag' : 'waiting') }, stateName(s));
const newClientId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const nowHm = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const KEEP_FAIL = 'Could not keep this on the phone. Try again when online.';
const OFFLINE_KEPT = '📴 Saved on this phone — it will be sent when you are online';

/** The only server calls the staff view makes (a check in tests/screens.test.mjs holds it to this list). */
export const STAFF_CALLS = ['me', 'my.today', 'task.get', 'project.mine', 'update.save', 'photo.add', 'comment.add', 'comment.edit', 'comment.delete',
  'comment.photo', 'project.addStep', 'suggest', 'search', 'password', 'logout', 'push.key', 'push.subscribe', 'push.unsubscribe', 'push.test'];
/** Lists kept on the phone (the last copy), so the app opens without internet — the same saved copies Work Task keeps. */
const READS = new Set(['me', 'my.today', 'task.get', 'project.mine']);
export const cacheKey = (a, body) => 'wt.c.' + a + ':' + JSON.stringify(body || {});

/**
 * Talks to the Work Task server with the person's own sign-in. Errors carry .offline (no internet, or a weak signal
 * that gives nothing back), .auth (signed out; .mustChange: their first password first), .retry (a server hiccup:
 * try again later), as Work Task's OfflineError / AuthError / RetryError. Offline, a list comes from the saved copy.
 * opts: { cache (localStorage), onNet(online) }.
 */
export function staffApi(token, base = '../api/', opts = {}) {
  const cache = opts.cache !== undefined ? opts.cache : (typeof localStorage !== 'undefined' ? localStorage : null);
  const onNet = opts.onNet || (() => {});
  const read = (a, body) => { try { return cache ? JSON.parse(cache.getItem(cacheKey(a, body)) || 'null') : null; } catch { return null; } };
  const write = (a, body, out) => { try { if (cache) cache.setItem(cacheKey(a, body), JSON.stringify(out)); } catch { /* phone storage full: still works online */ } };
  return async (a, body = {}, form = false) => {
    if (!STAFF_CALLS.includes(a)) throw new Error('Not allowed here.');
    let res;
    // weak signal (connected, but nothing moves): give up after a while and treat it as offline
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), form ? 60000 : 15000) : 0;
    try {
      res = await fetch(`${base}?a=${a}`, { method: 'POST', cache: 'no-store', signal: ac ? ac.signal : undefined, headers: { Authorization: 'Bearer ' + token, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: form ? body : JSON.stringify(body) });
    } catch {
      clearTimeout(timer);
      onNet(false);
      if (READS.has(a)) { const c = read(a, body); if (c) return { ...c, fromCache: true }; }
      throw Object.assign(new Error('You are offline. Try again when the internet is back.'), { offline: true });
    }
    onNet(true);
    let out = null;
    try { out = await res.json(); } catch { out = null; } finally { clearTimeout(timer); }
    if (res.status === 428) throw Object.assign(new Error((out && out.error) || 'Choose your own password first.'), { auth: true, mustChange: true });
    if (res.status === 401 && a !== 'password') throw Object.assign(new Error((out && out.error) || 'Please sign in again.'), { auth: true });
    if (res.status >= 500 || res.status === 408 || res.status === 429 || (!out && res.status < 400)) throw Object.assign(new Error((out && out.error) || 'Something went wrong. Try again.'), { retry: true });
    if (!out) throw new Error(`The server refused this (${res.status}).`); // e.g. the host's firewall: trying again will not help
    if (!out.ok) throw new Error(out.error || 'Something went wrong. Try again.');
    if (READS.has(a) && !form) write(a, body, out);
    return out;
  };
}

/** A phone photo made smaller before it goes (saves mobile data); see-through parts become white, not black. */
export async function shrinkPhoto(file) {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob || file;
  } catch { return file; }
}

/**
 * Phone notifications for the staff view, through Work Task's own service worker (it shows them, at the site root).
 * state(): 'on' | 'default' (not asked yet) | 'denied' | 'granted' (allowed, not linked yet) | 'ios' (Home Screen app first) | 'no'.
 */
export function browserPush(api, userId) {
  const ok = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  const ios = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const offKey = () => 'wt.pushOff.' + userId; // turned off here by this person (the same mark as Work Task)
  const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let on = false;
  const reg = async () => {
    const r = (await navigator.serviceWorker.getRegistration('../')) || await navigator.serviceWorker.register('../sw.js', { scope: '../' });
    if (r.active) return r;
    return new Promise((resolve, reject) => { // a first install: wait until it runs (or give up)
      const w = r.installing || r.waiting;
      const stop = setTimeout(() => reject(new Error('The app is still loading. Try again in a moment.')), 8000);
      if (!w) { clearTimeout(stop); resolve(r); return; }
      w.addEventListener('statechange', () => { if (w.state === 'activated') { clearTimeout(stop); resolve(r); } });
    });
  };
  async function link() {
    const r = await reg();
    const { key } = await api('push.key');
    let sub = await r.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey && toB64u(sub.options.applicationServerKey) !== key) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
    await api('push.subscribe', sub.toJSON());
    on = true;
  }
  return {
    state() {
      if (!ok()) return ios() ? 'ios' : 'no';
      if (Notification.permission === 'granted') return on ? 'on' : 'granted';
      return Notification.permission;
    },
    /** Opening the app: link again by itself when allowed before (never asks; never after "Turn off" here). */
    async sync() {
      if (!ok() || Notification.permission !== 'granted') return;
      try { if (localStorage.getItem(offKey())) return; } catch { /* blocked */ }
      try { await link(); } catch { /* offline: next time */ }
    },
    async turnOn() {
      if (!ok()) return 'no';
      try { localStorage.removeItem(offKey()); } catch { /* blocked */ }
      const p = await Notification.requestPermission();
      if (p !== 'granted') return p;
      await link();
      return 'on';
    },
    async turnOff() {
      if (!ok()) return;
      const r = await navigator.serviceWorker.getRegistration('../');
      const sub = r && await r.pushManager.getSubscription();
      if (sub) { await api('push.unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
      on = false;
      try { localStorage.setItem(offKey(), '1'); } catch { /* blocked */ }
    },
    test: () => api('push.test'),
  };
}

/** "Every day", "By Mon 3 Nov · 2 days late", "Current step — send an update each day" … */
export function repeatLabel(t, today) {
  const by = t.dueDate ? (today && t.status === 'open' && t.dueDate < today ? ` · ⏰ late, was by ${fmtDay(t.dueDate)}` : ` · by ${fmtDay(t.dueDate)}`) : '';
  if (t.seq !== null && t.seq !== undefined && t.status === 'open') return (t.queued ? 'Coming next' : 'Current step — send an update each day') + by;
  if (today && t.startDate && t.startDate > today && t.status === 'open') return `Starts ${fmtDay(t.startDate)}`;
  if (t.repeat === 'daily') return t.skipSunday ? 'Every day (Mon–Sat)' : 'Every day';
  if (t.repeat === 'weekly') return `Every ${LONG_DAYS[t.weekday ?? 1]}`;
  if (!t.dueDate) return 'One time';
  const late = today && t.status === 'open' ? daysBetween(t.dueDate, today) : 0;
  return late > 0 ? `By ${fmtDay(t.dueDate)} · ${late} day${late > 1 ? 's' : ''} late` : `By ${fmtDay(t.dueDate)}`;
}

/** The projects given to me, each with its open steps in order (the current one first). */
export function myProjects(d) {
  if (!d) return [];
  const by = new Map();
  for (const t of [...(d.tasks || []), ...(d.other || [])]) {
    if (!t.projectRef || t.seq === null || t.seq === undefined || t.status !== 'open') continue;
    if (!by.has(t.projectRef)) by.set(t.projectRef, { ref: t.projectRef, name: t.project || 'Project', steps: [] });
    by.get(t.projectRef).steps.push(t);
  }
  return [...by.values()].map((pr) => {
    pr.steps.sort((a, b) => a.seq - b.seq || a.id - b.id);
    pr.real = pr.steps.filter((t) => !String(t.stepRef || '').endsWith(':whole')); // the "whole project" task while there are no steps
    pr.current = pr.steps.find((t) => !t.queued) || pr.steps[0];
    return pr;
  });
}

/**
 * The staff view. opts: { root, api, rules, user, toast, signOut, onAuth(err), photo(kind, id) → Promise<url>,
 *   box (the outbox store), lock, shrink(file) → Promise<blob>, viewer(url, name, isImage), ask: { prompt, confirm },
 *   push (browserPush or a stand-in), copy(text) }.
 * Returns { state, render, load, open, act, view, start }.
 */
export function createStaff(opts) {
  const { root, api, rules, toast = () => {}, signOut = () => {} } = opts;
  const onAuth = opts.onAuth || (() => signOut());
  const photo = opts.photo || (() => Promise.reject(new Error('photo')));
  const shrink = opts.shrink || (async (f) => f);
  const viewer = opts.viewer || (() => {});
  const ask = opts.ask || { prompt: (q, v) => prompt(q, v), confirm: (q) => confirm(q) };
  const push = opts.push || null;
  const copy = opts.copy || ((text) => (typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('copy'))));
  const state = {
    user: opts.user, data: null, loadFailed: '', section: 'today', sel: null, detail: null, detailFailed: '',
    menuOpen: false, mobile: 'list', drafts: {}, editing: {}, files: {}, sending: {}, msgDrafts: {}, stepDrafts: {}, diaryDays: 14,
    offline: false, outbox: [], notices: [], news: [], signedOut: false, pushLater: false,
    searchQ: '', searchResults: null, newIds: new Set(), knownIds: new Set(),
  };
  let searchTimer = 0, searchSeq = 0, liveBusy = false, badge = -1;
  const listOf = (d) => [...((d && d.tasks) || []), ...((d && d.other) || []), ...((d && d.suggestions) || [])];
  const ids = { msg: {}, step: {}, photo: {} }; // the same clientId on a retry of the same words: the server keeps it once
  let detailSeq = 0;
  const today = () => (state.data && !state.data.stale && state.data.today) || istDay();
  const fail = (e) => { if (e.auth) { onAuth(e); return ''; } return e.message; };
  const notice = (title, body) => { state.notices.push({ title, body }); render(); }; // stays until closed, with Copy

  const ob = createOutbox({
    box: opts.box, api, rules, lock: opts.lock, toast,
    userId: () => state.user.id, signedIn: () => !state.signedOut,
    older: (kept) => notice(kept.title, kept.body),
    giveBack,
  });

  /** What is on screen for a task id (the open task, or the lists). */
  const knownTask = (id) => (state.detail && state.detail.task && state.detail.task.id === id ? state.detail.task
    : [...((state.data && state.data.tasks) || []), ...((state.data && state.data.other) || [])].find((x) => x.id === id));

  /** A waiting item is given up on: put the words (and photos) back in their box, so nothing written is lost;
   *  an update or a message also shows the whole words in a notice that stays (the rule: logic.js giveBackShow). */
  function giveBack(it, why) {
    if (it.kind === 'comment') { if (!state.msgDrafts[it.taskId]) state.msgDrafts[it.taskId] = it.text; }
    else if (it.kind === 'update' && !it.updateId && !state.drafts[it.taskId]) {
      state.drafts[it.taskId] = { note: it.note, state: it.state }; state.editing[it.taskId] = true;
      if ((it.files || []).length) state.files[it.taskId] = it.files.slice(0, 5);
    }
    let typing = false; // the Add a step box holds other words being typed: they stay, the old step is only shown to copy
    if (it.kind === 'step') { if (!state.stepDrafts[it.projectRef]) state.stepDrafts[it.projectRef] = it.title; else typing = state.stepDrafts[it.projectRef] !== it.title; }
    const boxThere = it.kind === 'step' ? !typing && myProjects(state.data).some((p) => p.ref === it.projectRef)
      : it.kind === 'suggest' ? false : rules.boxStillThere(knownTask(it.taskId), state.user.id);
    const show = rules.giveBackShow(it, why, boxThere);
    if (show.sticky) notice(show.title, show.body); else toast(show.text, show.ms);
  }

  async function refreshOutbox() { state.outbox = await ob.list(); render(); }
  /** Send what waits on this phone (both apps share it), then show what changed. */
  async function flush() {
    const r = await ob.flush();
    await refreshOutbox();
    if (r.sent) toast(`✓ ${r.sent} waiting item${r.sent > 1 ? 's' : ''} sent`);
    if (r.sent || r.gave) reload(); // (what is being typed lives in this view's state: a reload never wipes it)
    return r;
  }
  /** Keep an item on the phone; false (and the words stay in their box) when the phone cannot keep it. */
  async function keep(item) {
    try { await ob.queue(item); } catch { toast(KEEP_FAIL, 6000); return false; }
    await refreshOutbox();
    toast(OFFLINE_KEPT, 5000);
    return true;
  }
  /** The internet came or went (told by every server call). */
  function setOffline(off) {
    if (state.offline === off) return;
    state.offline = off;
    render();
    if (!off && state.outbox.length) flush();
  }

  async function load() {
    try {
      const d = await api('my.today');
      // a saved copy from an earlier day: today's updates are not in it yet
      state.data = d.fromCache && d.today !== istDay() ? { ...d, stale: true } : d;
      state.loadFailed = '';
    } catch (e) { const m = fail(e); if (!m) return; state.loadFailed = e.offline ? 'No saved copy on this phone yet.' : m; }
    render();
  }
  async function loadDetail() {
    const sel = state.sel, n = ++detailSeq;
    if (!sel || !(sel.startsWith('task:') || sel.startsWith('project:'))) return;
    let detail = null, failed = '';
    try {
      detail = sel.startsWith('task:') ? await api('task.get', { id: Number(sel.slice(5)) }) : await api('project.mine', { projectRef: sel.slice(8) });
      const t = detail && detail.task;
      if (detail.fromCache && t && t.today && t.today.day && t.today.day !== istDay()) detail = { ...detail, task: { ...t, last: t.today, today: null } }; // the saved copy is from an earlier day
    } catch (e) { failed = fail(e) || ''; }
    if (n !== detailSeq || state.sel !== sel) return; // another page was opened meanwhile
    state.detail = detail; state.detailFailed = failed;
    render();
    if (detail && !detail.fromCache && detail.task && detail.task.unread) load(); // opening it marked its messages read (task.get): the list's "New" goes
  }
  function open(sel) {
    if (sel.startsWith('task:')) state.newIds.delete(Number(sel.slice(5))); // seen: no longer "New"
    state.sel = sel; state.detail = null; state.detailFailed = ''; state.mobile = 'detail'; state.menuOpen = false;
    render(); loadDetail();
  }
  function show(section) { state.section = section; state.sel = null; state.mobile = 'list'; state.menuOpen = false; render(); }
  function back() { state.sel = null; state.mobile = 'list'; render(); }
  function reload() { load(); if (state.sel) loadDetail(); }

  /** Opening: the lists (or their saved copies), what waits on the phone, and notifications linked again. */
  async function start() {
    render();
    await Promise.all([load(), refreshOutbox()]);
    if (state.outbox.length) flush();
    if (push) push.sync().then(render, () => {});
  }

  // ---------------------------------------------------------------- actions (each says what happened in plain words)

  async function sendUpdate(t) {
    const d = state.drafts[t.id] || { note: '', state: 'progress' };
    const files = state.files[t.id] || [];
    if (!d.note.trim()) return 'Write what you did first.';
    const hadPhoto = !!(t.today && t.today.photos && t.today.photos.length);
    if (d.state === 'finished' && t.needsPhoto && !hadPhoto && !files.length) return '📷 Add a photo to finish this task.';
    if (state.sending[t.id]) return '';
    state.sending[t.id] = true; render();
    // a photo needed to finish: save as "working", add the photos, then mark finished (as Work Task does)
    const twoSteps = d.state === 'finished' && t.needsPhoto && files.length && !hadPhoto;
    const cid = newClientId(); // the same id online and in the outbox: a save whose answer was lost is kept once
    const sentNote = d.note;
    let updateId = 0, left = files, savedNote = sentNote; // how far it got (what is still to send, if the internet goes)
    const typedOn = () => { // words typed while it was sending stay in the box (the rule: logic.js)
      const more = rules.updateBoxLeft(d.note, sentNote);
      if (more) { state.drafts[t.id] = { note: more, state: d.state }; state.editing[t.id] = true; } else { delete state.drafts[t.id]; delete state.editing[t.id]; }
      delete state.files[t.id];
    };
    try {
      const out = await api('update.save', rules.updateSaveBody({ taskId: t.id, note: sentNote, state: twoSteps ? 'progress' : d.state, clientId: cid }));
      updateId = out.update.id; savedNote = out.update.note;
      for (let i = 0; i < files.length; i++) {
        left = files.slice(i);
        const fd = new FormData();
        fd.append('updateId', String(updateId)); fd.append('file', await shrink(files[i]), 'photo.jpg'); fd.append('clientId', `${cid}-p${i}`);
        try { await api('photo.add', fd, true); } catch (e) { if (e.offline || e.retry) throw Object.assign(e, { offline: true, photoNo: i }); toast(`A photo was not sent: ${e.message}`, 6000); }
      }
      left = [];
      if (twoSteps) await api('update.save', rules.updateSaveBody({ taskId: t.id, note: savedNote, clientId: cid, finish: true }));
      typedOn();
      toast('Sent ✓');
      return '';
    } catch (e) {
      if (e.offline) { // kept on the phone; it goes out when online (only what did not go yet)
        const blobs = [];
        for (const f of updateId ? left : files) blobs.push(await shrink(f));
        const item = updateId
          ? { kind: 'photos', taskId: t.id, updateId, note: savedNote, state: d.state, thenFinish: !!twoSteps, files: blobs, clientId: cid, photoNo: e.photoNo || 0 }
          : { kind: 'update', taskId: t.id, note: sentNote, state: d.state, needsPhoto: !!t.needsPhoto, hadPhoto, files: blobs, clientId: cid };
        if (!(await keep(item))) return KEEP_FAIL; // the words stay in the box
        typedOn();
        return '';
      }
      return fail(e); // the words stay in the box
    } finally {
      delete state.sending[t.id];
      reload();
    }
  }

  async function sendMessage(taskId) {
    const key = 'm' + taskId;
    const text = state.msgDrafts[taskId] || '';
    if (!text.trim()) return 'Write the message first.';
    if (state.sending[key]) return '';
    if (!ids.msg[taskId] || ids.msg[taskId].text !== text) ids.msg[taskId] = { id: newClientId(), text };
    const clientId = ids.msg[taskId].id;
    const typedOn = () => { const more = rules.msgBoxLeft(state.msgDrafts[taskId], text); if (more) state.msgDrafts[taskId] = more; else delete state.msgDrafts[taskId]; };
    state.sending[key] = true; render();
    try {
      const out = await api('comment.add', { taskId, text, clientId });
      delete ids.msg[taskId];
      typedOn(); // words typed meanwhile stay
      if (state.detail && state.detail.task && state.detail.task.id === taskId && out.comments) state.detail.comments = out.comments;
      toast('Sent ✓');
      return '';
    } catch (e) {
      if (e.offline) {
        if (!(await keep({ kind: 'comment', taskId, text, clientId }))) return KEEP_FAIL;
        delete ids.msg[taskId]; typedOn();
        return '';
      }
      return fail(e);
    } finally { delete state.sending[key]; render(); }
  }

  /** 📷 in the messages: the photo goes with what is typed in the box (if anything). Needs the internet. */
  async function sendMessagePhoto(taskId, file) {
    const key = 'm' + taskId;
    if (state.offline) return 'Photos in messages need the internet. Try again when online.';
    const text = state.msgDrafts[taskId] || '';
    const sig = JSON.stringify([text, file.name, file.size, file.type]);
    if (!ids.photo[taskId] || ids.photo[taskId].sig !== sig) ids.photo[taskId] = { id: newClientId(), sig }; // a retry: kept once
    state.sending[key] = true; render();
    toast('Sending photo…');
    try {
      const fd = new FormData();
      fd.append('taskId', String(taskId)); fd.append('text', text); fd.append('clientId', ids.photo[taskId].id); fd.append('file', await shrink(file), 'photo.jpg');
      const out = await api('comment.photo', fd, true);
      delete ids.photo[taskId];
      if (text) { const more = rules.msgBoxLeft(state.msgDrafts[taskId], text); if (more) state.msgDrafts[taskId] = more; else delete state.msgDrafts[taskId]; } // (no words: it is all typed after)
      if (state.detail && state.detail.task && state.detail.task.id === taskId && out.comments) state.detail.comments = out.comments;
      toast('Sent ✓');
      return '';
    } catch (e) {
      return e.offline ? 'Photos in messages need the internet. Try again when online.' : fail(e);
    } finally { delete state.sending[key]; render(); }
  }

  async function editMessage(c) {
    const text = ask.prompt('Change your message:', c.text);
    if (text === null || text === undefined || text.trim() === String(c.text || '').trim()) return '';
    try { const out = await api('comment.edit', { id: c.id, text }); if (state.detail) state.detail.comments = out.comments; render(); toast('Changed ✓'); return ''; }
    catch (e) { const m = fail(e); if (m) toast(m, 5000); return m; }
  }
  async function deleteMessage(c) {
    if (!ask.confirm('Delete this message?')) return '';
    try { const out = await api('comment.delete', { id: c.id }); if (state.detail) state.detail.comments = out.comments; render(); toast('Deleted'); return ''; }
    catch (e) { const m = fail(e); if (m) toast(m, 5000); return m; }
  }

  async function addStep(ref) {
    const title = (state.stepDrafts[ref] || '').trim();
    if (!title) return 'Write the step first.';
    if (!ids.step[ref] || ids.step[ref].title !== title) ids.step[ref] = { id: newClientId(), title };
    const clientId = ids.step[ref].id;
    const typedOn = () => { const more = rules.msgBoxLeft((state.stepDrafts[ref] || '').trim(), title); if (more) state.stepDrafts[ref] = more; else delete state.stepDrafts[ref]; };
    try {
      const out = await api('project.addStep', { projectRef: ref, title, clientId });
      if (out && out.task) state.knownIds.add(out.task.id); // my own step: never told to me as news
      delete ids.step[ref]; typedOn();
      toast('➕ Step added. Your manager sees it in the project too.');
      reload();
      return '';
    } catch (e) {
      if (e.offline) {
        if (!(await keep({ kind: 'step', projectRef: ref, title, clientId }))) return KEEP_FAIL;
        delete ids.step[ref]; typedOn(); render();
        return '';
      }
      return fail(e);
    }
  }

  async function suggest(item) {
    if (!String(item.title || '').trim()) return 'Write the task first.';
    const done = () => { state.sel = null; state.section = 'sugg'; state.mobile = 'list'; load(); };
    try {
      await api('suggest', item);
      toast('Sent for a yes ✓');
      done();
      return '';
    } catch (e) {
      if (e.offline) { if (!(await keep({ kind: 'suggest', ...item }))) return KEEP_FAIL; done(); return ''; }
      return fail(e);
    }
  }

  async function changePassword(oldPw, newPw) {
    try { await api('password', { old: oldPw, new: newPw }); toast('Password changed ✓'); back(); return ''; } catch (e) { return e.message; }
  }

  /** 📎 an instruction photo or PDF from the manager: opened on top (a photo) or in the viewer. */
  async function openFile(f) {
    try { viewer(await photo('task.file', f.id), f.name, !!f.image); return ''; } catch { toast('Could not open the file', 4000); return 'Could not open the file'; }
  }

  async function notifyOn() {
    if (!push) return '';
    try {
      const s = await push.turnOn();
      if (s === 'on') notice('🔔 Notifications are on', 'New tasks, new project steps and messages will come to this phone, like email.');
      render();
      return '';
    } catch (e) { toast('Could not turn on notifications: ' + e.message, 6000); return e.message; }
  }
  async function notifyOff() { if (push) { await push.turnOff(); toast('Notifications are off for this phone.'); render(); } }

  /** 📷 more photos on today's update that was already sent (up to 5 in all). Kept on the phone when offline. */
  async function addPhotos(t, list) {
    const u = t.today;
    if (!u || !list.length) return '';
    const room = Math.max(0, 5 - (u.photos || []).length);
    const files = list.slice(0, room);
    if (!files.length) return 'Up to 5 photos on one update.';
    const cid = newClientId(); // the same id online and in the outbox: a photo whose answer was lost is kept once
    let i = 0;
    for (; i < files.length; i++) {
      const fd = new FormData();
      fd.append('updateId', String(u.id)); fd.append('file', await shrink(files[i]), 'photo.jpg'); fd.append('clientId', `${cid}-p${i}`);
      try { await api('photo.add', fd, true); } catch (e) {
        if (e.offline || e.retry) break;
        if (e.auth) { onAuth(e); return ''; }
        toast(`A photo was not sent: ${e.message}`, 6000);
      }
    }
    if (i < files.length) { // the rest wait on the phone
      const blobs = [];
      for (const f of files.slice(i)) blobs.push(await shrink(f));
      if (!(await keep({ kind: 'photos', taskId: t.id, updateId: u.id, note: u.note, state: u.state, files: blobs, clientId: cid, photoNo: i }))) return KEEP_FAIL;
    } else toast('📷 Added ✓');
    reload();
    return '';
  }

  /** Ctrl+V on an open task: in the message box = a photo message; anywhere else = into today's update. true = taken. */
  function paste({ files = [], text = '', inMessageBox = false }) {
    if (!state.sel || !state.sel.startsWith('task:') || !state.detail || !state.detail.task || !files.length) return false;
    if (String(text).trim()) return false; // text with a picture of it (cells from Excel, Word): the text
    const t = state.detail.task;
    const images = files.filter((f) => String(f.type || '').startsWith('image/'));
    if (inMessageBox) {
      if (!images.length) { toast('Only photos can go in a message. Ask your manager to add other files to the task.', 5000); return true; }
      sendMessagePhoto(t.id, images[0]).then((m) => { if (m) toast(m, 5000); });
      return true;
    }
    if (!images.length) { toast('Only photos can be added to an update.', 5000); return true; }
    if (t.status !== 'open' && !t.today) { toast('This task is closed.', 4000); return true; }
    if (rules.pasteWaits(state.outbox, t.id, !!state.editing[t.id])) { toast('Wait until your update is sent, then add the photo.', 5000); return true; } // (no box to put it in)
    if (t.today && !state.editing[t.id]) addPhotos(t, images.slice(0, 5)).then((m) => { if (m) toast(m, 5000); });
    else { state.files[t.id] = [...(state.files[t.id] || []), ...images].slice(0, 5); render(); }
    toast('📷 Pasted into your update');
    return true;
  }

  /** 🔍 Search my tasks, messages and updates (the server answers with my own only). */
  function search(q) {
    state.searchQ = q;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const words = state.searchQ.trim(), n = ++searchSeq;
      if (words.length < 2) { state.searchResults = null; render(); return; }
      try { const out = await api('search', { q: words }); if (n === searchSeq) { state.searchResults = out.results; render(); } }
      catch (e) { if (n === searchSeq) { state.searchResults = { error: fail(e) || 'Could not search.' }; render(); } }
    }, opts.searchWait ?? 350);
  }

  /** What is new since the last look (new tasks, a new project, new steps): a bar to open it, and "New" on the rows. */
  function tellNews(fresh, before) {
    if (!fresh.length) return;
    const steps = fresh.filter((t) => t.projectRef && t.seq !== null && t.seq !== undefined);
    const names = fresh.map((t) => t.title).slice(0, 3).join(' · ');
    if (steps.length === fresh.length && new Set(steps.map((t) => t.projectRef)).size === 1) {
      const p = steps[0].project || 'a project';
      const had = listOf(before).some((t) => t.projectRef === steps[0].projectRef);
      state.news = [{ title: had ? (steps.length === 1 ? `➕ New step in ${p}` : `➕ ${steps.length} new steps in ${p}`) : `📁 New project for you: ${p}`, body: names, sel: 'project:' + steps[0].projectRef }];
    } else state.news = [{ title: fresh.length === 1 ? '📥 New task for you' : `📥 ${fresh.length} new tasks`, body: names, sel: 'task:' + fresh[0].id }];
  }

  /** Every 20 seconds while the app is open (and when coming back to it): anything new? */
  async function liveCheck() {
    if (liveBusy || !state.data) return;
    liveBusy = true;
    try {
      const out = await api('my.today');
      if (out.fromCache || JSON.stringify(out) === JSON.stringify(state.data)) return;
      const had = new Set(listOf(state.data).map((t) => t.id));
      // new to this screen — but not what this person made themselves (a step they added, a suggestion)
      const fresh = listOf(out).filter((t) => !had.has(t.id) && !state.knownIds.has(t.id) && t.createdBy !== state.user.id);
      for (const t of fresh) state.newIds.add(t.id);
      tellNews(fresh, state.data);
      state.data = out;
      render(); // (what is being typed lives in this view's state: never wiped)
      if (state.sel && (state.sel.startsWith('task:') || state.sel.startsWith('project:'))) loadDetail(); // new messages / steps on the open page too
    } catch { /* try again next time */ } finally { liveBusy = false; }
  }

  const act = { sendUpdate, addPhotos, paste, search, liveCheck, sendMessage, sendMessagePhoto, editMessage, deleteMessage, addStep, suggest, changePassword, openFile, notifyOn, notifyOff, flush, open, show, back, reload };

  // ---------------------------------------------------------------- screens

  const item = (label, on, onClick, count) => h('li', null,
    h('button', { class: 'menu-item' + (on ? ' current' : ''), onClick }, h('span', null, label), count ? h('span', { class: 'count' }, String(count)) : null));
  const waitingFor = (taskId) => state.outbox.filter((x) => (x.kind === 'update' || x.kind === 'photos') && x.taskId === taskId).pop();

  function menu() {
    const d = state.data;
    const due = d ? d.tasks.filter((x) => !x.today).length : 0;
    const projs = myProjects(d);
    const ps = push ? push.state() : 'no';
    return h('nav', { class: 'menu-inner' },
      h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 28, height: 28 }), h('span', null, 'Work Task')),
      h('ul', { class: 'menu-list' },
        item('Today', !state.sel && state.section === 'today', () => show('today'), due || null),
        item('Coming next', !state.sel && state.section === 'next', () => show('next'), d && d.other.length ? d.other.length : null),
        item('My suggestions', !state.sel && state.section === 'sugg', () => show('sugg'), d && (d.suggestions || []).length ? d.suggestions.length : null),
        item('🔍 Search', !state.sel && state.section === 'search', () => show('search')),
        projs.length ? h('li', { class: 'menu-head' }, 'My projects') : null,
        projs.map((pr) => item(`📁 ${pr.name}`, state.sel === 'project:' + pr.ref, () => open('project:' + pr.ref), pr.real.length || null)),
        h('li', { class: 'menu-sep' }),
        item('💡 Suggest a task', state.sel === 'suggest', () => open('suggest')),
        ps === 'no' ? null : item('🔔 Notifications', state.sel === 'notify', () => open('notify'), ps === 'on' ? 'On' : 'Off'),
        item(`👤 ${state.user.name}`, state.sel === 'password', () => open('password')),
        item('Sign out', false, signOut)));
  }

  function row(t, sub, dot, warn = false) {
    return h('li', { key: 't-' + t.id, class: 'prow' + (state.sel === 'task:' + t.id ? ' current' : '') },
      h('span', { class: 'quick-tick-space', 'aria-hidden': 'true' }),
      h('button', { class: 'prow-btn', onClick: () => open('task:' + t.id) },
        h('span', { class: 'dot ' + dot, 'aria-label': dot }),
        h('span', { class: 'prow-text' },
          h('span', { class: 'prow-name' }, t.title, state.newIds.has(t.id) ? h('span', { class: 'tag high' }, 'New') : null, t.unread ? h('span', { class: 'tag on-step', title: `${t.unread} new message(s)` }, '💬 New') : null),
          h('span', { class: 'prow-next' + (warn ? ' warn' : '') }, sub))));
  }

  function projectRow(pr) {
    const now = pr.current ? `Now: ${pr.current.title}${pr.current.today ? ' · ✓ sent today' : ''}` : '';
    return h('li', { key: 'p-' + pr.ref, class: 'prow' + (state.sel === 'project:' + pr.ref ? ' current' : '') },
      h('span', { class: 'quick-tick-space', 'aria-hidden': 'true' }),
      h('button', { class: 'prow-btn', onClick: () => open('project:' + pr.ref) },
        h('span', { class: 'dot ' + (pr.current && pr.current.today ? 'green' : 'red') }),
        h('span', { class: 'prow-text' }, h('span', { class: 'prow-name' }, '📁 ', pr.name), h('span', { class: 'prow-next' }, now))));
  }

  const sec = (label, extra) => h('div', { class: 'list-sec' }, h('span', null, label), extra || null);

  /** Offline, and / or things waiting on this phone. */
  function offlineBar() {
    const n = state.outbox.length;
    if (!state.offline && !n) return null;
    return h('div', { class: 'offline-bar', key: 'offline' },
      state.offline ? '📴 Offline — showing the last saved copy. What you send is kept on this phone and goes out when you are online.' : '',
      n ? h('strong', null, ` ⏳ ${n} waiting to send`) : null,
      n && !state.offline ? [' ', h('button', { class: 'link', onClick: () => flush() }, 'Send now')] : null);
  }

  /** Notices that stay (words that could not be sent): to copy, then close. */
  function notices() {
    return state.notices.map((n, i) => h('div', { class: 'banner stack', key: 'n-' + i },
      h('strong', null, n.title), h('div', { class: 'pre small' }, n.body),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onClick: () => copy(n.body).then(() => toast('Copied ✓'), () => toast('Select the words and copy them.', 4000)) }, 'Copy'),
        h('button', { class: 'btn small', onClick: () => { state.notices.splice(i, 1); render(); } }, 'Close'))));
  }

  /** New work since the last look: tap to open it. */
  function newsBar() {
    return state.news.map((n, i) => h('div', { class: 'banner stack', key: 'news-' + i },
      h('strong', null, n.title), n.body ? h('span', { class: 'small muted' }, n.body) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', onClick: () => { state.news = []; open(n.sel); } }, 'Open'),
        h('button', { class: 'btn small', onClick: () => { state.news = []; render(); } }, 'Close'))));
  }

  /** Once at the top: "turn on notifications" (until done, or Later). */
  function pushBanner() {
    const s = push ? push.state() : 'no';
    if ((s !== 'default' && s !== 'granted') || state.pushLater) return null;
    try { if (Number(localStorage.getItem('wt.pushLater') || 0) > Date.now() || localStorage.getItem('wt.pushOff.' + state.user.id)) return null; } catch { /* blocked */ }
    return h('div', { class: 'banner stack', key: 'push-banner' },
      h('span', null, '🔔 Get a message on this phone when a new task or update comes — like email.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', onClick: notifyOn }, 'Turn on'),
        h('button', { class: 'link', onClick: () => { try { localStorage.setItem('wt.pushLater', String(Date.now() + 3 * 86400000)); } catch { /* blocked */ } state.pushLater = true; render(); } }, 'Later')));
  }

  function list() {
    const d = state.data;
    const title = { today: 'My tasks today', next: 'Coming next', sugg: 'My suggestions', search: 'Search' }[state.section];
    const head = h('div', { class: 'list-head' },
      h('button', { class: 'icon menu-btn', 'aria-label': 'Menu', onClick: () => { state.menuOpen = true; render(); } }, '☰'),
      h('h2', null, title),
      h('button', { class: 'icon', title: 'Get latest', 'aria-label': 'Refresh', onClick: reload }, '↻'));
    const top = [offlineBar(), notices(), newsBar(), pushBanner()];
    if (!d) return h('div', { class: 'col-inner' }, head, top, h('p', { class: 'empty-list' }, state.loadFailed ? [state.loadFailed, ' ', h('button', { class: 'link', onClick: reload }, 'Try again')] : 'Loading…'));
    const td = d.today;
    let body;
    if (state.section === 'search') {
      const r = state.searchResults;
      const icon = { task: '📋', message: '💬', update: '📝' };
      body = [h('div', { class: 'search-box' }, h('input', { class: 'search', type: 'search', key: 'staff-search', placeholder: 'Search tasks, messages, updates…', 'aria-label': 'Search', value: state.searchQ, onInput: (e, el) => search(el.value) })),
        !r ? h('p', { class: 'empty-list' }, 'Type 2 or more letters.') : r.error ? h('p', { class: 'empty-list' }, r.error) : !r.length ? h('p', { class: 'empty-list' }, 'Nothing found.')
          : h('ul', { class: 'plist' }, r.map((x, i) => h('li', { class: 'prow', key: 'sr-' + i },
            h('span', { class: 'quick-tick-space' }),
            h('button', { class: 'prow-btn', onClick: () => open('task:' + x.taskId) },
              h('span', { class: 'prow-text' }, h('span', { class: 'prow-name' }, `${icon[x.kind] || ''} ${x.title}`),
                h('span', { class: 'prow-next' }, `${x.who} · ${fmtDay(x.at)} — ${x.text}`))))))];
    } else if (state.section === 'next') {
      body = [sec(`${d.other.length} coming next`), h('ul', { class: 'plist' }, d.other.map((t) => row(t, [t.project, repeatLabel(t, td)].filter(Boolean).join(' · '), 'grey'))),
        d.other.length ? null : h('p', { class: 'empty-list' }, 'Nothing coming next.')];
    } else if (state.section === 'sugg') {
      const s = d.suggestions || [];
      const waiting = state.outbox.filter((x) => x.kind === 'suggest');
      body = [sec(`${s.length + waiting.length} suggestion${s.length + waiting.length === 1 ? '' : 's'}`),
        h('ul', { class: 'plist' }, s.map((t) => row(t, t.status === 'suggested' ? 'Waiting for a yes' : 'Not now' + (t.lastMessage ? ` — ${t.lastMessage.text}` : ''), t.status === 'suggested' ? 'yellow' : 'grey')),
          waiting.map((x) => h('li', { class: 'prow', key: 'ws-' + x.id }, h('span', { class: 'quick-tick-space' }), h('div', { class: 'prow-btn' }, h('span', { class: 'dot grey' }),
            h('span', { class: 'prow-text' }, h('span', { class: 'prow-name' }, x.title), h('span', { class: 'prow-next' }, '⏳ Waiting to send')))))),
        s.length || waiting.length ? null : h('p', { class: 'empty-list' }, 'No suggestions yet. Tap 💡 Suggest a task in the menu.')];
    } else {
      const sent = d.tasks.filter((t) => t.today).length;
      const projs = myProjects(d);
      body = [
        d.stale ? h('p', { class: 'empty-list' }, `📴 Saved copy from ${fmtDay(d.today)} — today's updates are not shown yet.`) : null,
        projs.length ? [sec('📁 My projects'), h('ul', { class: 'plist' }, projs.map(projectRow))] : null,
        sec(`${fmtDay(td)} · ${sent} of ${d.tasks.length} sent`, h('span', { class: 'tag' }, `by ${d.fillBy}`)),
        h('ul', { class: 'plist' }, d.tasks.map((t) => {
          const waiting = !!waitingFor(t.id);
          const late = t.repeat === 'once' && t.dueDate && t.dueDate < td;
          const sub = waiting ? '⏳ Waiting to send' : t.today ? `✓ Sent ${fmtTime(t.today.at)}${t.today.state === 'stuck' ? ' · stuck' : t.today.state === 'finished' ? ' · finished' : ''}`
            : [t.project, repeatLabel(t, td)].filter(Boolean).join(' · ') || 'Send today\'s update';
          // the same dots as the owner's Today: green = sent today, yellow = written (waits to send), red = not yet
          return row(t, sub, t.today ? 'green' : waiting ? 'yellow' : 'red', late && !t.today && !waiting);
        })),
        d.tasks.length ? null : h('p', { class: 'empty-list' }, 'No tasks for today. 🎉'),
      ];
    }
    return h('div', { class: 'col-inner' }, head, top, body);
  }

  /** A part of the page with its small grey title, as on the owner's project page. */
  const block = (title, ...children) => h('section', { class: 'block' }, h('h3', null, title), ...children);

  function chips(t, td) {
    const c = (text, cls = '') => h('span', { class: 'info-chip static' + cls }, text);
    const late = t.status === 'open' && t.dueDate && t.dueDate < td;
    return h('div', { class: 'info-chips' },
      t.project ? c(`📁 ${t.project}`) : null,
      c(repeatLabel({ ...t, dueDate: null }, td)),
      t.dueDate ? c(late ? `⏰ Late — was by ${fmtDay(t.dueDate)}` : `By ${fmtDay(t.dueDate)}`, late ? ' bad' : '') : null,
      t.needsPhoto ? c('📷 Photo to finish') : null,
      t.status === 'done' ? c('✓ Done', ' good') : t.status === 'cancelled' ? c('Cancelled', ' bad') : t.status === 'suggested' ? c('💡 Suggestion') : t.today ? c('✓ Sent today', ' good') : null);
  }

  /** A picture's address once fetched (with the sign-in), else null and it is fetched (then drawn again). It is drawn
   *  as part of the page, so a redraw keeps it (a picture set on the element afterwards would be taken off again). */
  const pics = new Map(); // kind:id -> address, '' (missing), or 'loading'
  function pic(kind, id) {
    const k = kind + ':' + id, v = pics.get(k);
    if (v !== undefined) return v === 'loading' ? null : v;
    pics.set(k, 'loading');
    photo(kind, id).then((u) => { pics.set(k, u); render(); }, () => { pics.set(k, ''); render(); });
    return null;
  }

  function photos(kind, list) {
    if (!list || !list.length) return null;
    return h('div', { class: 'row' }, list.map((id) => {
      const src = pic(kind, id);
      return h('img', { key: kind + id, alt: src === '' ? 'Photo missing' : 'Photo', class: 'diary-photo', src: src || undefined, onClick: () => { if (src) viewer(src, 'Photo', true); } });
    }));
  }

  /** 📎 Instruction photos / PDFs from the manager. Tap to open. */
  function files(t) {
    if (!t.files || !t.files.length) return null;
    return block('📎 Instructions', h('div', { class: 'row' }, t.files.map((f) => {
      if (!f.image) return h('button', { class: 'chip', key: 'f' + f.id, title: f.name, onClick: () => openFile(f) }, '📄 ' + (f.name.length > 18 ? f.name.slice(0, 16) + '…' : f.name));
      const src = pic('task.file', f.id);
      return h('img', { key: 'f' + f.id, alt: src === '' ? f.name + ' (missing)' : f.name, title: f.name, class: 'diary-photo', src: src || undefined, onClick: () => openFile(f) });
    })));
  }

  function updateCard(t) {
    const waiting = waitingFor(t.id);
    if (waiting && !state.editing[t.id]) { // (the owner's box with the orange "being changed" border)
      return block("Today's update", h('div', { class: 'update-form loose editing' },
        h('div', { class: 'row' }, stateTag(waiting.state), h('span', { class: 'tag remind' }, '⏳ Waiting to send'), (waiting.files || []).length ? h('span', { class: 'muted small' }, `📷 ${waiting.files.length}`) : null),
        h('div', { class: 'pre' }, waiting.note),
        h('span', { class: 'muted small' }, 'Kept on this phone. It is sent by itself when the internet is back.')));
    }
    if (t.status !== 'open' && !t.today) return null;
    const done = t.today && !state.editing[t.id];
    if (done) {
      const u = t.today;
      return block("Today's update", h('div', { class: 'diary-line' },
        h('span', { class: 'diary-icon' }, u.state === 'stuck' ? '⚠️' : u.state === 'finished' ? '✅' : '📝'),
        h('div', { class: 'diary-text' }, h('strong', null, 'You '), u.state !== 'progress' ? [stateTag(u.state), ' '] : null, u.note, photos('photo', u.photos)),
        h('span', { class: 'muted small' }, `Sent ${fmtTime(u.at)}`)),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onClick: () => { state.editing[t.id] = true; state.drafts[t.id] = { note: u.note, state: u.state }; render(); } }, '✎ Edit'),
        (u.photos || []).length < 5 ? h('label', { class: 'btn small' }, '📷 Add photo', h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden',
          onChange: (e, el) => { const f = [...el.files].slice(0, 5); el.value = ''; addPhotos(t, f).then((m) => { if (m) toast(m, 5000); }); } })) : null));
    }
    const d = (state.drafts[t.id] ||= { note: '', state: 'progress' });
    const picked = state.files[t.id] || [];
    const err = h('p', { class: 'warn', key: 'err-' + t.id, hidden: true });
    const say = (m) => { if (m) { err.textContent = m; err.hidden = false; } };
    const pick = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', onChange: (e, el) => { state.files[t.id] = [...picked, ...el.files].slice(0, 5); el.value = ''; render(); } });
    return block("Today's update", h('div', { class: 'update-form loose' + (state.editing[t.id] ? ' editing' : '') },
      t.last ? h('span', { class: 'small muted' }, `Last time (${fmtDay(t.last.day)}): `, h('span', { class: 'pre' }, t.last.note)) : null,
      h('textarea', { key: 'up-' + t.id, placeholder: 'What happened today? (you can tap 🎤 on the keyboard to speak)', value: d.note, onInput: (e, el) => { d.note = el.value; err.hidden = true; } }),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'How is it going' }, STATES.map(([k, label]) =>
        h('button', { class: 'seg' + (d.state === k ? ' on' : ''), type: 'button', 'aria-pressed': String(d.state === k), onClick: () => { d.state = k; render(); } }, label))),
      picked.length ? h('span', { class: 'small muted' }, `📷 ${picked.length} photo${picked.length === 1 ? '' : 's'} ready `, h('button', { class: 'link small', onClick: () => { delete state.files[t.id]; render(); } }, 'Remove')) : null,
      err,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', disabled: state.sending[t.id] ? true : undefined, onClick: () => sendUpdate(t).then(say) }, state.sending[t.id] ? 'Sending…' : 'Send'),
        picked.length < 5 ? h('label', { class: 'btn small' }, '📷 Add photo', pick) : null,
        state.editing[t.id] ? h('button', { class: 'btn small', onClick: () => { delete state.editing[t.id]; delete state.drafts[t.id]; render(); } }, 'Cancel') : null)));
  }

  function messages(taskId, comments) {
    const key = 'm' + taskId;
    const err = h('p', { class: 'warn', key: 'merr-' + taskId, hidden: true });
    const say = (m) => { if (m) { err.textContent = m; err.hidden = false; } };
    const pick = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', onChange: (e, el) => { const f = el.files[0]; el.value = ''; if (f) sendMessagePhoto(taskId, f).then(say); } });
    const waiting = state.outbox.filter((x) => x.kind === 'comment' && x.taskId === taskId);
    return block('💬 Messages', h('div', { class: 'banner team-msgs' },
      comments.length ? comments.map((c) => h('div', { class: 'team-msg' + (c.mine ? ' mine' : ''), key: 'c-' + c.id },
        h('div', { class: 'row small' }, h('strong', null, c.mine ? 'You' : c.by), h('span', { class: 'muted' }, `${fmtDay(c.at)} ${fmtTime(c.at)}${c.editedAt ? ' · edited' : ''}`),
          c.mine && !String(c.text || '').startsWith('↔ Moved') ? h('span', { class: 'msg-acts' },
            h('button', { class: 'link small', title: 'Change', 'aria-label': 'Change this message', onClick: () => editMessage(c) }, '✎'),
            h('button', { class: 'link small', title: 'Delete', 'aria-label': 'Delete this message', onClick: () => deleteMessage(c) }, '✕')) : null),
        c.photo ? photos('comment.photo', [c.id]) : null,
        c.text ? h('div', { class: 'pre' }, c.text) : null)) : (waiting.length ? null : h('span', { class: 'muted small' }, 'No messages yet.')),
      waiting.map((x) => h('div', { class: 'team-msg mine', key: 'wc-' + x.id },
        h('div', { class: 'row small' }, h('strong', null, 'You'), h('span', { class: 'tag remind' }, '⏳ Waiting to send')), h('div', { class: 'pre' }, x.text))),
      h('textarea', { key: 'msg-' + taskId, placeholder: 'Ask or reply to your manager…', value: state.msgDrafts[taskId] || '', onInput: (e, el) => { state.msgDrafts[taskId] = el.value; err.hidden = true; } }),
      err,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', disabled: state.sending[key] ? true : undefined, onClick: () => sendMessage(taskId).then(say) }, 'Send message'),
        h('label', { class: 'btn small', title: 'Send a photo (with the words in the box)' }, '📷 Photo', pick))));
  }

  function diary(t, updates, td) {
    const n = state.diaryDays;
    const { rows, more } = rules.diaryRows(t, updates, td, { staff: true, n, fillBy: (state.data && state.data.fillBy) || '18:00', nowHm: nowHm() });
    return h('section', { class: 'block' },
      h('div', { class: 'diary-head' }, h('h3', null, "📅 What's happening")),
      rows.length ? h('ul', { class: 'diary-days' }, rows.map(({ day, kind, ups }) => h('li', { class: 'diary-day', key: 'd-' + day },
        h('div', { class: 'diary-date' }, day === td ? 'Today' : LONG_DAYS[new Date(day + 'T00:00:00Z').getUTCDay()], h('div', { class: 'muted small' }, fmtDay(day))),
        h('div', { class: 'diary-items' }, kind === 'ups' ? ups.map((u) => h('div', { class: 'diary-line' },
          h('span', { class: 'diary-icon' }, u.state === 'stuck' ? '⚠️' : u.state === 'finished' ? '✅' : '📝'),
          h('div', { class: 'diary-text' }, h('strong', null, (u.byId === state.user.id ? 'You' : u.by) + ' '), u.state !== 'progress' ? [stateTag(u.state), ' '] : null, u.note, photos('photo', u.photos)),
          h('span', { class: 'muted small' }, fmtTime(u.at))))
          : kind === 'off' ? h('span', { class: 'muted' }, 'Off')
            : kind === 'wait' ? h('span', { class: 'diary-none wait' }, 'Waiting for today\'s update')
              : h('span', { class: 'diary-none' }, 'No progress'))))) : h('p', { class: 'muted small' }, 'Nothing yet.'),
      more ? h('button', { class: 'link small', onClick: () => { state.diaryDays = n + 14; render(); } }, 'Show older days') : null);
  }

  function taskPage() {
    const { task: t, updates = [], comments = [] } = state.detail;
    const td = today();
    return [
      chips(t, td),
      t.details ? h('p', { class: 'pre muted' }, t.details) : null,
      files(t),
      updateCard(t),
      messages(t.id, comments),
      t.status === 'suggested' || (t.status !== 'open' && !updates.length) ? null : diary(t, updates, td),
    ];
  }

  function projectPage() {
    const pr = myProjects(state.data).find((x) => x.ref === state.sel.slice(8));
    const done = ((state.detail && state.detail.tasks) || []).filter((t) => t.status === 'done' && !String(t.stepRef || '').endsWith(':whole'));
    const k = done.length;
    const sentSub = (t) => (t.today ? `✓ Sent ${fmtTime(t.today.at)}` : 'Send today\'s update');
    const err = h('p', { class: 'warn', key: 'serr', hidden: true });
    const ref = state.sel.slice(8);
    const waiting = state.outbox.filter((x) => x.kind === 'step' && x.projectRef === ref);
    return [
      done.length ? [sec(`✓ ${done.length} done`), h('ul', { class: 'plist' }, done.map((t, i) => row(t, `Step ${i + 1} · done ${t.doneAt ? fmtDay(t.doneAt) : ''}`, 'green')))] : null,
      !pr ? h('p', { class: 'muted' }, done.length ? 'All your steps are done ✓. Your manager decides what comes next.' : 'This project is not on your list any more.')
        : [h('p', { class: 'muted' }, pr.real.length ? 'Do the steps in order. Every day, open the current step and send what you did. Found more work? Add a step below.'
          : 'No steps yet. Add the steps you will do, in order. Until then, send your daily update on the whole project.'),
        h('ul', { class: 'plist' }, (pr.real.length ? pr.real : pr.steps).map((t, i) => row(t,
          !pr.real.length ? sentSub(t) : t === pr.current ? `Step ${k + i + 1} · current · ${sentSub(t)}` : `Step ${k + i + 1} · next${t.fromStaff ? ' · added by you' : ''}`,
          t === pr.current || !pr.real.length ? (t.today ? 'green' : 'red') : 'grey')),
          waiting.map((x) => h('li', { class: 'prow', key: 'wstep-' + x.id }, h('span', { class: 'quick-tick-space' }), h('div', { class: 'prow-btn' }, h('span', { class: 'dot grey' }),
            h('span', { class: 'prow-text' }, h('span', { class: 'prow-name' }, x.title), h('span', { class: 'prow-next' }, '⏳ Waiting to send')))))),
        h('form', { class: 'add-step', onSubmit: (e) => { e.preventDefault(); addStep(ref).then((m) => { if (m) { err.textContent = m; err.hidden = false; } }); } },
          h('input', { key: 'step-' + ref, placeholder: '+ Add the next step…', 'aria-label': 'Add a step', maxlength: '300', enterkeyhint: 'enter', autocomplete: 'off', value: state.stepDrafts[ref] || '', onInput: (e, el) => { state.stepDrafts[ref] = el.value; err.hidden = true; } })),
        err],
    ];
  }

  function suggestPage() {
    const f = (state.suggestForm ||= { title: '', details: '', repeat: 'once', clientId: newClientId() }); // one id per form: a retry is kept once
    const err = h('p', { class: 'warn', key: 'sgerr', hidden: true });
    return [
      h('p', { class: 'muted' }, 'Your manager says yes or no. If yes, it comes on your list.'),
      h('div', { class: 'block stack' },
        h('label', null, 'Task', h('input', { key: 'sg-title', placeholder: 'Clean the dryer filters every week', value: f.title, onInput: (e, el) => { f.title = el.value; } })),
        h('label', null, 'Details', h('textarea', { key: 'sg-details', placeholder: 'Why it is needed (optional)', value: f.details, onInput: (e, el) => { f.details = el.value; } })),
        h('label', null, 'How often', h('select', { key: 'sg-repeat', value: f.repeat, onChange: (e, el) => { f.repeat = el.value; } },
          h('option', { value: 'once' }, 'One time'), h('option', { value: 'daily' }, 'Every day'), h('option', { value: 'weekly' }, 'Once a week'))),
        err,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary small', onClick: () => suggest({ ...f }).then((m) => { if (m) { err.textContent = m; err.hidden = false; } else state.suggestForm = null; }) }, 'Send to my manager'),
          h('button', { class: 'btn small', onClick: () => { state.suggestForm = null; back(); } }, 'Cancel'))),
    ];
  }

  function passwordPage() {
    const f = (state.pwForm ||= { old: '', nw: '' });
    const err = h('p', { class: 'warn', key: 'pwerr', hidden: true });
    return h('div', { class: 'block stack' },
      h('label', null, 'Current password', h('input', { key: 'pw-old', type: 'password', autocomplete: 'current-password', value: f.old, onInput: (e, el) => { f.old = el.value; } })),
      h('label', null, 'New password (8 letters or more)', h('input', { key: 'pw-new', type: 'password', autocomplete: 'new-password', value: f.nw, onInput: (e, el) => { f.nw = el.value; } })),
      err,
      h('button', { class: 'btn primary small', onClick: () => changePassword(f.old, f.nw).then((m) => { if (m) { err.textContent = m; err.hidden = false; } else state.pwForm = null; }) }, 'Change password'));
  }

  function notifyPage() {
    const s = push ? push.state() : 'no';
    const parts = [h('p', null, 'You get a message on this phone, like new email, for:'),
      h('ul', null, ['A new task, or a whole project given to you', 'A new step added to your project', 'A message from your manager'].map((w) => h('li', null, w)))];
    if (s === 'on') {
      parts.push(h('p', { class: 'ok' }, '✓ On for this phone.'), h('div', { class: 'row' },
        h('button', { class: 'btn small', onClick: () => push.test().then(() => toast('🔔 Test sent. It comes in a few seconds.'), (e) => toast(e.message, 5000)) }, 'Send me a test'),
        h('button', { class: 'btn small', onClick: notifyOff }, 'Turn off')));
    } else if (s === 'default' || s === 'granted') {
      parts.push(h('button', { class: 'btn primary small', onClick: notifyOn }, '🔔 Turn on notifications'));
    } else if (s === 'denied') {
      parts.push(h('p', { class: 'warn' }, 'Notifications are blocked for Work Task on this phone. To allow them:'),
        h('ol', null,
          h('li', null, 'Installed app: press and hold the Work Task icon → App info → Notifications → turn on.'),
          h('li', null, 'In Chrome: tap ⋮ → Settings → Site settings → Notifications → worktask.in → Allow.'),
          h('li', null, 'Come back here and open this page again.')));
    } else if (s === 'ios') {
      parts.push(h('p', { class: 'warn' }, 'On iPhone, notifications work only from the Home Screen app:'),
        h('ol', null, h('li', null, 'Open worktask.in in Safari.'), h('li', null, 'Tap Share → Add to Home Screen.'), h('li', null, 'Open Work Task from the Home Screen and turn notifications on here.')));
    } else parts.push(h('p', { class: 'muted' }, 'This browser cannot show notifications.'));
    return h('div', { class: 'block stack' }, parts);
  }

  function detail() {
    const sel = state.sel;
    if (!sel) return h('div', { class: 'empty' }, h('p', null, 'Pick a task on the left.'));
    let title = '', body, dot = ''; // the dot before the title, as on the owner's task page
    if (sel === 'suggest') { title = '💡 Suggest a task'; body = suggestPage(); }
    else if (sel === 'password') { title = 'Change password'; body = passwordPage(); }
    else if (sel === 'notify') { title = '🔔 Notifications'; body = notifyPage(); }
    else if (!state.detail) body = h('p', { class: 'muted' }, state.detailFailed ? [state.detailFailed, ' ', h('button', { class: 'link', onClick: loadDetail }, 'Try again')] : 'Loading…');
    else if (sel.startsWith('task:')) {
      const t = state.detail.task;
      title = t.title; body = taskPage();
      dot = t.status !== 'open' ? 'grey' : t.today ? 'green' : waitingFor(t.id) ? 'yellow' : 'red';
    }
    else { const pr = myProjects(state.data).find((x) => x.ref === sel.slice(8)); title = '📁 ' + (pr ? pr.name : 'Project'); body = projectPage(); }
    return h('div', { class: 'detail-inner', key: 'detail-' + sel },
      h('div', { class: 'detail-top' }, h('button', { class: 'icon back', 'aria-label': 'Back', onClick: back }, '←'), dot ? h('span', { class: 'dot ' + dot, 'aria-label': dot }) : null, h('h2', null, title)),
      body);
  }

  function view() {
    return h('div', { class: ['layout', 'staff', state.mobile === 'detail' ? 'show-detail' : '', state.menuOpen ? 'menu-open' : ''].join(' ').trim() },
      h('aside', { id: 'menu' }, menu()),
      h('div', { class: 'scrim', onClick: () => { state.menuOpen = false; render(); } }),
      h('main', { id: 'list' }, list()),
      h('section', { id: 'detail' }, detail()));
  }

  /** The number on the app icon (installed app): tasks still to send today. */
  function setBadge() {
    if (!state.data || typeof navigator === 'undefined' || !navigator.setAppBadge) return;
    const n = (state.data.tasks || []).filter((t) => !t.today).length;
    if (n === badge) return;
    badge = n;
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }

  function render() {
    setBadge();
    if (!root) return;
    const next = view();
    if (root.firstChild && root.firstChild.classList && root.firstChild.classList.contains('layout')) morph(root.firstChild, next);
    else root.replaceChildren(next);
  }

  return { state, render, load, open, act, view, start, setOffline, refreshOutbox };
}
