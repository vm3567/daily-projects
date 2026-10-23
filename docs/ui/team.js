// The team pages of the one app: what a manager sees — Team today, 🔁 Follow-up (the round, work in one line),
// Tasks, 📁 Projects, 📊 Weekly report, 🔍 Search, People (another manager; the owner has the projects' People page),
// Settings, a task's page (Mark done, Move, Edit, instructions, Yes / Not now to a suggestion), Give a task and
// 🔔 Notifications. In the owner's design (the same layout, lists and blocks as Daily Projects), using the same task
// page pieces as the staff view (ui/workparts.js) and Work Task's rules (logic.js, passed in as `rules`).
// The owner opens it from "👥 Team" in Daily Projects (and goes back with "📋 My projects"); another manager gets only this.

import { h, morph, errLine } from './dom.js';
import { createOutbox } from './staffbox.js';
import { fmtDay, fmtTime, LONG_DAYS, stateTag, newClientId, istDay, daysBetween, repeatLabel, block, sec, taskRow, chipsFor, makePics, photosRow, filesBlock, diaryBlock, messagesBlock, phoneBack } from './workparts.js';

const KEEP_FAIL = 'Could not keep this on the phone. Try again when online.';
const OFFLINE_KEPT = '📴 Saved on this phone — it will be sent when you are online';
const WIDE = ['report', 'people', 'settings']; // pages that fill the screen (no page on the right)
/** Work Task's colours as the owner's dots (red, yellow, green, grey). */
const dotOf = (c) => (c === 'orange' ? 'yellow' : c);
/** Work Task's tag colours as the owner's tags. */
const tagOf = (c) => ({ green: 'done-tag', red: 'late', amber: 'remind', grey: 'waiting' })[c] || '';
/** The owner's progress bar, filled to a part (0–1); the width is set through the style object (the page's safety rules). */
function progressBar(part, key) {
  const fill = h('div', { class: 'progress-fill', key });
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, part)) * 100)}%`;
  return h('div', { class: 'progress-bar' }, fill);
}

/** A temporary first password: three easy words and a number. */
export function tempPassword() {
  const words = ['kiln', 'glaze', 'clay', 'tile', 'mould', 'fire', 'slip', 'basin', 'press', 'dryer'];
  const a = new Uint32Array(3);
  crypto.getRandomValues(a);
  return `${words[a[0] % words.length]}-${words[a[1] % words.length]}-${100 + (a[2] % 900)}`;
}

/**
 * The team pages. opts: { root, api, rules, user, toast, signOut, photo(kind, id), viewer(url, name, isImage), box, lock,
 *   shrink, push, ask: { prompt, confirm }, copy(text), toProjects() (the owner: back to My projects),
 *   openPeople() (the owner: the projects' People page), signIn link (`appLink`) }.
 * Returns { state, render, go, open, act, view, start }.
 */
export function createTeam(opts) {
  const { root, api, rules, toast = () => {}, signOut = () => {} } = opts;
  const onAuth = opts.onAuth || (() => signOut());
  const photo = opts.photo || (() => Promise.reject(new Error('photo')));
  const shrink = opts.shrink || (async (f) => f);
  const viewer = opts.viewer || (() => {});
  const ask = opts.ask || { prompt: (q, v) => prompt(q, v), confirm: (q) => confirm(q) };
  const push = opts.push || null;
  const copy = opts.copy || ((text) => (typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('copy'))));
  const owner = !!(opts.user && opts.user.owner);
  const state = {
    user: opts.user, view: 'today', closed: false, data: null, loadFailed: '', team: null, personFilter: 0,
    sel: null, detail: null, detailFailed: '', people: [], mobile: 'list', menuOpen: false,
    msgDrafts: {}, sending: {}, outbox: [], offline: false, notices: [], news: [], diaryDays: 14,
    round: null, quick: null, prefill: null, giveCid: null, moving: 0, taskMenu: 0, movingAll: 0, newPerson: null,
    searchQ: '', searchResults: null, newIds: new Set(), knownIds: new Set(), sentLocal: {}, reportEnd: '', fillBy: '', signedOut: false,
    outlook: null, // the owner's Outlook (null: not asked; true / false)
  };
  const ids = { msg: {}, photo: {} };
  let loadSeq = 0, detailSeq = 0, searchTimer = 0, searchSeq = 0, liveBusy = false, outlookAsk = null;
  const today = () => (state.data && !state.data.stale && !state.data.fromCache && state.data.today) || istDay();
  const fail = (e) => { if (e.auth) { onAuth(e); return ''; } return e.message; };
  const say = (e) => { const m = fail(e); if (m) toast(m, 5000); };
  const kept = (title, body) => { state.notices.push({ title, body }); render(); }; // words to copy: stays until closed
  const news = (title, body, sel) => { state.news = [{ title, body, sel }]; render(); };
  const listOf = (d) => [...((d && d.tasks) || []), ...((d && d.other) || []), ...((d && d.suggestions) || [])];

  const pic = makePics(photo, () => render());
  const photos = (kind, list) => photosRow(pic, viewer, kind, list);

  const ob = createOutbox({
    box: opts.box, api, rules, lock: opts.lock, toast,
    userId: () => state.user.id, signedIn: () => !state.signedOut,
    older: (k) => kept(k.title, k.body),
    giveBack: (it, why) => {
      const back = it.kind === 'comment' && !state.msgDrafts[it.taskId]; // (other words typed in the box meanwhile stay)
      if (back) state.msgDrafts[it.taskId] = it.text;
      const show = rules.giveBackShow(it, why, back);
      if (show.sticky) kept(show.title, show.body); else toast(show.text, show.ms);
    },
  });
  async function refreshOutbox() { state.outbox = await ob.list(); render(); }
  async function flush() {
    const r = await ob.flush();
    await refreshOutbox();
    if (r.sent) toast(`✓ ${r.sent} waiting item${r.sent > 1 ? 's' : ''} sent`);
    if (r.sent || r.gave) reload();
    return r;
  }
  function setOffline(off) {
    if (state.offline === off) return;
    state.offline = off;
    render();
    if (!off && state.outbox.length) flush();
  }

  // ---------------------------------------------------------------- loading

  async function load() {
    const view = state.view, n = ++loadSeq;
    let data = null, failed = '';
    try {
      if (view === 'today') {
        data = await api('team.today');
        // offline next morning: yesterday's copy must not show yesterday's updates as sent today
        if (data && data.fromCache && data.today !== istDay()) data = { ...data, stale: true, late: false, tasks: data.tasks.map((t) => ({ ...t, last: t.today || t.last, today: null })) };
        if (data && data.people) state.team = data; // the people in the menu
      } else if (view === 'tasks') data = await api('tasks.list', { status: state.closed ? 'closed' : 'open' });
      else if (view === 'people') { const [u, m] = await Promise.all([api('users.list'), api('people.morning').catch(() => null)]); data = { ...u, morning: m }; }
      else if (view === 'projects') data = await api('projects.overview');
      else if (view === 'report') data = await api('report.week', state.reportEnd ? { end: state.reportEnd } : {});
      else if (view === 'search') data = { search: true }; // the results come as you type
      else if (view === 'followup') { const [f, u] = await Promise.all([api('followup.list'), api('users.list')]); data = { ...f, people: u.users.filter((x) => x.active) }; }
      else if (view === 'settings') data = { settings: true };
    } catch (e) { failed = fail(e); if (e.auth) return; }
    if (n !== loadSeq || state.view !== view) return; // a newer load, or another page meanwhile
    state.data = data; state.loadFailed = data ? '' : failed || '';
    if (data && data.fillBy) state.fillBy = data.fillBy;
    if (failed && data) toast(failed, 5000);
    render();
  }
  async function loadDetail() {
    const sel = state.sel, n = ++detailSeq;
    if (!sel) return;
    let detail = null, failed = '', people = state.people;
    try {
      if (sel.startsWith('task:')) {
        detail = await api('task.get', { id: Number(sel.slice(5)) });
        const t = detail && detail.task;
        if (detail.fromCache && t && t.today && t.today.day !== istDay()) detail = { ...detail, task: { ...t, last: t.today, today: null } }; // the saved copy is from an earlier day
        people = (await api('users.list')).users.filter((u) => u.active);
      } else if (sel.startsWith('project:')) detail = await api('project.team', { projectRef: sel.slice(8) });
      else if (sel === 'give' || sel.startsWith('edit:')) {
        people = (await api('users.list')).users.filter((u) => u.active);
        detail = sel.startsWith('edit:') ? await api('task.get', { id: Number(sel.slice(5)) }) : null;
      } else return;
    } catch (e) { failed = fail(e); if (e.auth) return; }
    if (n !== detailSeq || state.sel !== sel) return; // another page was opened meanwhile
    state.detail = detail; state.detailFailed = detail ? '' : failed; state.people = people;
    render();
  }
  function reload() { load(); if (state.sel) loadDetail(); }

  /** A list on the left: Team today, Follow-up, Tasks, Projects, Weekly report, Search, People, Settings. */
  function go(view) {
    const keepForm = formTyped(); // a half-filled Give / Edit form stays open on the right (on a phone: the list shows)
    state.view = view; state.round = null; state.data = null; state.loadFailed = '';
    if (!keepForm) { state.sel = null; state.detail = null; }
    state.mobile = 'list'; state.menuOpen = false; state.moving = 0; state.taskMenu = 0;
    if (view === 'settings') { state.settingsForm = null; if (state.olForm && !state.olForm.secret) state.olForm = null; } // asked again on each visit
    render(); load();
  }
  /** Something typed in the Give / Edit form that is open now. */
  function formTyped() {
    const f = state.giveForm, sel = state.sel || '';
    return !!(f && f.key === sel && (sel === 'give' || sel.startsWith('edit:')) && (f.title.trim() || f.details.trim() || (f.files && f.files.length)));
  }
  /** A page on the right: 'task:5', 'project:<ref>', 'give', 'edit:5', 'password', 'notify'. */
  function open(sel) {
    if (sel.startsWith('task:')) state.newIds.delete(Number(sel.slice(5)));
    state.backTo = sel.startsWith('task:') && state.sel && state.sel.startsWith('project:') ? state.sel : null; // a step opened from its project: Back goes there
    state.sel = sel; state.detail = null; state.detailFailed = ''; state.moving = 0; state.taskMenu = 0; state.diaryDays = 14;
    state.mobile = 'detail'; state.menuOpen = false;
    if (WIDE.includes(state.view)) { state.view = 'today'; state.data = null; } // those fill the page: show a list again
    render();
    if (!state.data) load();
    loadDetail();
  }
  function back() {
    if (state.backTo) { const b = state.backTo; state.backTo = null; open(b); return; }
    if (state.fromProjects && toProjects()) return;
    state.sel = null; state.detail = null; state.mobile = 'list'; render();
  }
  const toProjects = () => { if (!opts.toProjects) return false; state.fromProjects = false; opts.toProjects(); return true; };

  async function start({ sel = null, prefill = null, fromProjects = false } = {}) {
    state.prefill = prefill; state.fromProjects = fromProjects;
    render();
    await refreshOutbox();
    if (state.outbox.length) flush();
    if (sel) open(sel); else load();
    if (sel) load();
    if (push) push.sync().then(render, () => {});
  }

  // ---------------------------------------------------------------- actions

  async function setStatus(t, status) {
    try { await api('task.status', { id: t.id, status }); toast(status === 'open' ? 'Opened again' : status === 'done' ? 'Marked done ✓' : 'Cancelled'); reload(); return ''; }
    catch (e) { say(e); return e.message; }
  }
  async function answerSuggestion(t, yes) {
    try {
      if (yes) { await api('task.approve', { id: t.id }); toast(`Added to ${t.assignee.name}'s list ✓`); }
      else {
        const why = ask.prompt(`Not now — tell ${t.assignee.name} why (optional):`, '');
        if (why === null || why === undefined) return '';
        await api('task.decline', { id: t.id, reason: why }); toast('Answered');
      }
      reload(); return '';
    } catch (e) { say(e); return e.message; }
  }
  async function move(t, p) {
    try {
      const out = await api('task.move', { id: t.id, toId: p.id });
      state.moving = 0;
      toast(`${out.moved} task${out.moved === 1 ? '' : 's'} moved to ${p.name} ✓`);
      reload(); return '';
    } catch (e) { say(e); return e.message; }
  }
  async function addFiles(taskId, files) {
    for (const f of files) {
      const fd = new FormData();
      const img = String(f.type || '').startsWith('image/');
      fd.append('taskId', String(taskId)); fd.append('file', img ? await shrink(f) : f, img ? 'photo.jpg' : f.name);
      try { await api('task.file.add', fd, true); } catch (e) { toast(`${f.name}: ${e.message}`, 5000); }
    }
  }
  async function removeFile(f) {
    if (!ask.confirm(`Remove ${f.name}?`)) return;
    try { await api('task.file.delete', { id: f.id }); reload(); } catch (e) { say(e); }
  }
  async function openFile(f) {
    try { viewer(await photo('task.file', f.id), f.name, !!f.image); } catch { toast('Could not open the file', 4000); }
  }

  async function sendMessage(taskId) {
    const key = 'm' + taskId;
    const text = state.msgDrafts[taskId] || '';
    if (!text.trim()) return 'Write the message first.';
    if (state.sending[key]) return '';
    if (!ids.msg[taskId] || ids.msg[taskId].text !== text) ids.msg[taskId] = { id: newClientId(), text }; // a retry: kept once
    const clientId = ids.msg[taskId].id;
    const typedOn = () => { const more = rules.msgBoxLeft(state.msgDrafts[taskId], text); if (more) state.msgDrafts[taskId] = more; else delete state.msgDrafts[taskId]; };
    state.sending[key] = true; render();
    try {
      const out = await api('comment.add', { taskId, text, clientId });
      delete ids.msg[taskId]; typedOn();
      if (state.detail && state.detail.task && state.detail.task.id === taskId && out.comments) state.detail.comments = out.comments;
      toast('Sent ✓');
      return '';
    } catch (e) {
      if (e.offline) {
        try { await ob.queue({ kind: 'comment', taskId, text, clientId }); } catch { return KEEP_FAIL; }
        delete ids.msg[taskId]; typedOn(); await refreshOutbox(); toast(OFFLINE_KEPT, 5000);
        return '';
      }
      return fail(e);
    } finally { delete state.sending[key]; render(); }
  }
  async function sendMessagePhoto(taskId, file) {
    if (state.offline) return 'Photos in messages need the internet. Try again when online.';
    const text = state.msgDrafts[taskId] || '';
    const sig = JSON.stringify([text, file.name, file.size, file.type]);
    if (!ids.photo[taskId] || ids.photo[taskId].sig !== sig) ids.photo[taskId] = { id: newClientId(), sig };
    toast('Sending photo…');
    try {
      const fd = new FormData();
      fd.append('taskId', String(taskId)); fd.append('text', text); fd.append('clientId', ids.photo[taskId].id); fd.append('file', await shrink(file), 'photo.jpg');
      const out = await api('comment.photo', fd, true);
      delete ids.photo[taskId];
      if (text) { const more = rules.msgBoxLeft(state.msgDrafts[taskId], text); if (more) state.msgDrafts[taskId] = more; else delete state.msgDrafts[taskId]; }
      if (state.detail && state.detail.task && state.detail.task.id === taskId && out.comments) state.detail.comments = out.comments;
      toast('Sent ✓'); render();
      return '';
    } catch (e) { return e.offline ? 'Photos in messages need the internet. Try again when online.' : fail(e); }
  }
  // the task page open now (another one may be opened while an answer is on its way: never show its messages there)
  const openTaskId = () => (state.detail && state.detail.task ? state.detail.task.id : null);
  async function editMessage(c) {
    const text = ask.prompt('Change your message:', c.text);
    if (text === null || text === undefined || text.trim() === String(c.text || '').trim()) return;
    try { const tid = openTaskId(); const out = await api('comment.edit', { id: c.id, text }); if (openTaskId() === tid && tid) state.detail.comments = out.comments; render(); toast('Changed ✓'); } catch (e) { say(e); }
  }
  async function deleteMessage(c) {
    if (!ask.confirm('Delete this message?')) return;
    try { const tid = openTaskId(); const out = await api('comment.delete', { id: c.id }); if (openTaskId() === tid && tid) state.detail.comments = out.comments; render(); toast('Deleted'); } catch (e) { say(e); }
  }

  /** Give a task (or save a change). The id is kept for the same words, so a second tap after a lost answer gives it once. */
  async function saveTask(fields, files = []) {
    const editing = !!fields.id;
    if (!fields.assigneeId) return 'Choose who will do it.';
    if (!String(fields.title || '').trim()) return 'Write the task.';
    if (state.givingNow) return ''; // a second tap while it is being given (its files would go twice)
    const formId = editing ? '' : (state.giveCid = rules.giveId(state.giveCid, fields, newClientId)).id;
    state.givingNow = true;
    try {
      const out = await api('task.save', rules.taskSaveBody(fields, formId));
      state.giveCid = null;
      if (files.length) await addFiles(out.task.id, files.slice(0, 10));
      const fromProjects = !editing && state.prefill && state.prefill.stepRef && owner;
      state.prefill = null; state.giveForm = null;
      toast(editing ? 'Saved ✓' : `Given to ${out.task.assignee.name} ✓`);
      if (fromProjects && toProjects()) return '';
      open('task:' + out.task.id); load();
      return '';
    } catch (e) { return fail(e); } finally { state.givingNow = false; }
  }

  /** Work in one line ("Valar: send kiln photos by Friday"): the rule is parseQuickTask (logic.js). */
  async function giveQuick(r) {
    const q = state.quick;
    const sent = q.text.trim();
    try {
      const out = await api('task.save', rules.taskSaveBody({ assigneeId: r.person.id, title: r.title, details: '', project: '', repeat: 'once', skipSunday: true, dueDate: r.dueDate }, q.cid));
      if (state.quick && state.quick.text.trim() === sent) state.quick = null; // (typed on meanwhile: the new words stay)
      news(`Given to ${out.task.assignee.name} ✓`, r.title + (r.dueDate ? ` · by ${fmtDay(r.dueDate)}` : ''), 'task:' + out.task.id);
      if (['followup', 'today', 'tasks'].includes(state.view)) load();
      return '';
    } catch (e) { return fail(e); }
  }

  async function chase(r) {
    try { await api('task.chase', { id: r.taskId }); toast(`🔔 Chased — ${r.person.name} gets an alert`); return true; } catch (e) { say(e); return false; }
  }
  async function closeFollow(r) {
    if (!ask.confirm(r.kind === 'project' ? `Mark the step "${r.step || r.title}" done?` : `Mark "${r.title}" done?`)) return false;
    try { await api('task.status', { id: r.taskId, status: 'done' }); toast('Marked done ✓'); return true; } catch (e) { say(e); return false; }
  }
  async function takeBack(r) {
    if (!ask.confirm(`Take "${r.title}" back from ${r.person.name}'s list? It will be cancelled.`)) return;
    try { await api('task.status', { id: r.taskId, status: 'cancelled' }); toast('Taken back ✓'); load(); } catch (e) { say(e); }
  }

  // the round: what was looked at today is kept on this device, so a round stopped half way goes on from there
  const roundKey = () => 'wt.round.' + state.user.id;
  const roundLoad = () => { try { return JSON.parse(localStorage.getItem(roundKey()) || 'null'); } catch { return null; } };
  const roundStore = (s) => { try { localStorage.setItem(roundKey(), JSON.stringify(s)); } catch { /* blocked */ } };
  function startRound() { state.round = { rows: rules.followupRows(state.data.rows, state.data.today), saved: roundLoad(), changing: false }; render(); }

  /** The owner's Outlook: asked once (the "no paste" morning email goes into Drafts when it is connected). */
  function outlookConnected() {
    if (owner && state.outlook === null && !outlookAsk) outlookAsk = api('outlook.status').then((d) => { state.outlook = !!(d.outlook && d.outlook.connected); }, () => { outlookAsk = null; });
    return state.outlook === true;
  }
  const sentAtOf = (id, serverAt) => { const mine = state.sentLocal[id] || ''; return mine > (serverAt || '') ? mine : serverAt || null; };
  function markSent(userId, day) {
    const show = (at) => { state.sentLocal = { ...state.sentLocal, [userId]: at }; render(); };
    api('morning.sent', { userId }).then((r) => show(r.sentAt), () => show(day + ' ' + new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })));
  }
  /**
   * 📧 Morning email. With the owner's Outlook connected and the person's email saved, the finished email goes into
   * Outlook Drafts (never sent) and opens; otherwise the table is copied and the email opens (paste, then Send).
   * The copy and the new tab start in the tap itself (browsers only allow them straight after a tap).
   */
  async function morningEmail(p) {
    const ready = api('morning.mail', { userId: p.id }).then((out) => ({ out, mail: rules.morningMail({ person: out.person, manager: out.manager, items: out.items, today: out.today }) }));
    const connected = outlookConnected();
    const tryDraft = connected && (p.email === undefined || rules.emailPath({ connected, email: p.email }) === 'draft');
    let copied = false;
    const copying = (async () => {
      try {
        if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('no table copy');
        const blob = (type, key) => ready.then(({ mail }) => new Blob([mail[key]], { type }));
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob('text/html', 'html'), 'text/plain': blob('text/plain', 'text') })]);
        copied = true;
      } catch { /* table copy not allowed here: plain words below */ }
    })();
    const tab = tryDraft ? window.open('about:blank', '_blank') : null; // opened now, inside the tap
    await copying;
    let got;
    try { got = await ready; } catch (e) { if (tab) tab.close(); say(e); return; }
    const { out, mail } = got;
    const email = out.person.email || '';
    let why = '';
    if (tryDraft && rules.emailPath({ connected, email }) === 'draft') {
      try {
        const r = await api('outlook.compose', { to: email, subject: mail.subject, html: mail.html });
        markSent(p.id, out.today);
        if (tab) { try { tab.opener = null; } catch { /* fine */ } tab.location.href = r.webLink; } else window.open(r.webLink, '_blank', 'noopener');
        news('Draft ready in Outlook — check it and press Send.', '', null);
        return;
      } catch (e) { why = rules.pasteReason({ connected, email, name: out.person.name, error: e.message }); }
    } else if (!email || owner) why = rules.pasteReason({ connected, email, name: out.person.name }) || '';
    if (tab) tab.close();
    markSent(p.id, out.today);
    if (!copied) try { await navigator.clipboard.writeText(mail.text); copied = true; } catch { /* not allowed either */ }
    const a = document.createElement('a');
    a.href = 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(mail.subject);
    a.click(); // Outlook opens
    const lead = why ? why + ' — ' : '';
    if (copied) news(lead + (lead ? 'table copied, paste it with ⌘ Cmd+V (Ctrl+V), then Send.' : 'Table copied — press Ctrl+V in the email, then Send.'), email ? '' : 'Then add their email on the People page.', null);
    else kept(lead + 'Could not copy. Select these words, copy them into the email, then Send.', mail.text);
  }

  // People (another manager; the owner has the projects' People page)
  async function addPerson(f) {
    try {
      const out = await api('user.save', { name: f.name, username: f.username, password: f.password, role: f.role, email: (f.email || '').trim() });
      state.newPerson = { name: out.user.name, username: out.user.username, password: f.password };
      state.personForm = null;
      toast('Added ✓'); load(); return '';
    } catch (e) { return fail(e); }
  }
  async function resetPassword(u) {
    const p = tempPassword();
    if (!ask.confirm(`Give ${u.name} a new temporary password?\nThey will be signed out and must choose their own again.`)) return;
    try { await api('user.reset', { id: u.id, password: p }); state.newPerson = { name: u.name, username: u.username, password: p }; render(); } catch (e) { say(e); }
  }
  async function switchPerson(u) {
    if (u.active && !ask.confirm(`Switch off ${u.name}? They can no longer sign in. Their updates stay.`)) return;
    try { await api('user.active', { id: u.id, active: !u.active }); toast(u.active ? 'Switched off' : 'Switched on'); load(); } catch (e) { say(e); }
  }
  async function editPerson(u, field) {
    const v = field === 'name' ? ask.prompt('Name', u.name) : ask.prompt(`${u.name}'s email (for the morning email). Leave empty for none.`, u.email || '');
    if (v === null || v === undefined || v.trim() === String(field === 'name' ? u.name : u.email || '')) return;
    if (field === 'name' && !v.trim()) return;
    try { await api('user.save', { id: u.id, name: field === 'name' ? v.trim() : u.name, role: u.role, ...(field === 'email' ? { email: v.trim() } : {}) }); toast('Saved ✓'); load(); } catch (e) { say(e); }
  }
  async function moveAll(u, x) {
    if (!ask.confirm(`Move all of ${u.name}'s open tasks to ${x.name}?`)) return;
    try { const out = await api('tasks.moveAll', { fromId: u.id, toId: x.id }); state.movingAll = 0; toast(`${out.moved} task${out.moved === 1 ? '' : 's'} moved to ${x.name} ✓`); load(); } catch (e) { say(e); }
  }
  async function changePassword(oldPw, newPw, again) {
    if (newPw !== again) return 'The two new passwords are not the same.';
    try { await api('password', { old: oldPw, new: newPw }); toast('Password changed ✓'); back(); return ''; } catch (e) { return e.message; }
  }

  /** 🔍 Search tasks, messages and updates. */
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

  /** Every 20 s while open: new suggestions or tasks, and the team's new updates, as a bar to open. */
  // my messages on the open task not seen yet: look at it again, so their ticks turn blue once read (✓✓)
  function seenCheck() {
    const d = state.detail;
    if (d && d.task && state.sel === 'task:' + d.task.id && (d.comments || []).some((c) => c.mine && Array.isArray(c.seenBy) && !c.seenBy.length && c.kind !== 'move' && c.kind !== 'chase')) loadDetail();
  }
  async function liveCheck() {
    seenCheck();
    if (liveBusy || !state.data || (state.view !== 'today' && state.view !== 'tasks')) return;
    liveBusy = true;
    const view = state.view, closed = state.closed;
    try {
      const out = view === 'today' ? await api('team.today') : await api('tasks.list', { status: closed ? 'closed' : 'open' });
      if (out.fromCache || state.view !== view || state.closed !== closed) return;
      if (JSON.stringify(out) === JSON.stringify(state.data)) return;
      const before = state.data;
      const had = new Set(listOf(before).map((t) => t.id));
      const fresh = view === 'today' ? listOf(out).filter((t) => !had.has(t.id) && !state.knownIds.has(t.id) && t.createdBy !== state.user.id) : [];
      for (const t of fresh) state.newIds.add(t.id);
      const names = fresh.map((t) => t.title).slice(0, 3).join(' · ');
      if (fresh.length && fresh.every((t) => t.status === 'suggested')) news(fresh.length === 1 ? `💡 ${fresh[0].assignee.name} suggests a task` : `💡 ${fresh.length} new suggestions`, names, 'task:' + fresh[0].id);
      else if (fresh.length) news(fresh.length === 1 ? '📥 New task' : `📥 ${fresh.length} new tasks`, names, 'task:' + fresh[0].id);
      else {
        const was = new Map(listOf(before).map((t) => [t.id, t.today ? t.today.at : null]));
        const sent = listOf(out).filter((t) => t.today && was.has(t.id) && was.get(t.id) !== t.today.at && t.today.byId !== state.user.id);
        if (sent.length) {
          const t = sent[0], u = t.today;
          news(sent.length > 1 ? `✓ ${sent.length} new updates` : u.state === 'stuck' ? `⚠️ ${u.by} is stuck` : u.state === 'finished' ? `✅ ${u.by} finished a task` : `✓ ${u.by} sent an update`, `${t.title}: ${u.note}`, 'task:' + t.id);
        }
      }
      state.data = out;
      if (out.people) state.team = out;
      render();
      if (state.sel && (state.sel.startsWith('task:') || state.sel.startsWith('project:'))) loadDetail();
    } catch { /* next time */ } finally { liveBusy = false; }
  }

  /** Ctrl+V on an open task: in the message box a photo message; anywhere else instruction photos / files. true = taken. */
  function paste({ files = [], text = '', inMessageBox = false }) {
    if (!state.sel || !state.sel.startsWith('task:') || !state.detail || !state.detail.task || !files.length || String(text).trim()) return false;
    const t = state.detail.task;
    const images = files.filter((f) => String(f.type || '').startsWith('image/'));
    if (inMessageBox) {
      if (!images.length) { toast('Only photos can go in a message.', 5000); return true; }
      sendMessagePhoto(t.id, images[0]).then((m) => { if (m) toast(m, 5000); });
      return true;
    }
    toast('📎 Adding to the task…');
    addFiles(t.id, files.slice(0, 10)).then(() => { toast('📎 Added ✓'); loadDetail(); });
    return true;
  }

  async function notifyOn() {
    if (!push) return;
    try { if ((await push.turnOn()) === 'on') news('🔔 Notifications are on', 'Your team\'s updates, Stuck, Finished, messages and suggestions come to this phone.', null); render(); }
    catch (e) { toast('Could not turn on notifications: ' + e.message, 6000); }
  }

  const act = { go, open, back, reload, setStatus, answerSuggestion, move, addFiles, removeFile, openFile, sendMessage, sendMessagePhoto, editMessage, deleteMessage,
    saveTask, giveQuick, chase, closeFollow, takeBack, startRound, morningEmail, addPerson, resetPassword, switchPerson, editPerson, moveAll, changePassword, search, liveCheck, paste, flush, notifyOn, outlookConnected };

  // ---------------------------------------------------------------- screens

  const item = (label, on, onClick, count) => h('li', null,
    h('button', { class: 'menu-item' + (on ? ' current' : ''), onClick }, h('span', null, label), count ? h('span', { class: 'count' }, String(count)) : null));

  function menu() {
    const t = state.team;
    const needs = t ? (t.stuck || []).length + (t.unread || []).length + (t.suggestions || []).length : 0;
    const ps = push ? push.state() : 'no';
    const listOn = (v) => !state.sel && state.view === v;
    // the same menu as the owner's projects page (owner, 23 Oct): the search box on top, then the lists with their
    // counts and the red / yellow / green count under the first, a line, the rest
    const today = (t && t.tasks) || [];
    const dots = { red: 0, yellow: 0, green: 0 };
    for (const x of today) dots[x.today ? 'green' : t.late ? 'red' : 'yellow']++;
    return h('nav', { class: 'menu-inner' },
      h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 28, height: 28 }), h('span', null, owner ? 'Daily Projects' : 'Work Task')),
      h('input', { class: 'search', type: 'search', placeholder: 'Search…', key: 'team-menu-search', 'aria-label': 'Search', value: state.searchQ || '',
        onInput: (e, el) => { if (state.view !== 'search') go('search'); search(el.value); } }),
      h('ul', { class: 'menu-list' },
        opts.toProjects ? item('📋 My projects', false, () => toProjects()) : null,
        item('Team today', listOn('today') && !state.personFilter, () => { state.personFilter = 0; state.boardPage = 1; go('today'); }, t ? String(today.length) : null),
        t ? h('li', { class: 'menu-dots', key: 'dots', title: needs ? `${needs} need you` : '' },
          h('span', { class: 'dot red' }), String(dots.red), ' ', h('span', { class: 'dot yellow' }), String(dots.yellow), ' ', h('span', { class: 'dot green' }), String(dots.green)) : null,
        item('✅ Tasks', listOn('tasks') && !state.closed, () => { state.closed = false; go('tasks'); }),
        item('📂 Projects', listOn('projects'), () => go('projects')),
        item('🔁 Follow-up', listOn('followup'), () => go('followup')),
        h('li', { class: 'menu-sep' }),
        item('Done / cancelled', listOn('tasks') && state.closed, () => { state.closed = true; go('tasks'); }),
        item('📊 Weekly report', listOn('report'), () => go('report')),
        item('People', listOn('people'), () => (opts.openPeople ? opts.openPeople() : go('people'))),
        item('Settings', listOn('settings'), () => go('settings')),
        t && t.people && t.people.length ? [h('li', { class: 'menu-head' }, 'Team'), t.people.map((p) => {
          const tasks = t.tasks.filter((x) => x.assignee.id === p.id);
          const sent = tasks.filter((x) => x.today).length;
          const dot = !tasks.length ? 'grey' : sent === tasks.length ? 'green' : t.late ? 'red' : 'yellow';
          return h('li', { key: 'tp-' + p.id }, h('button', {
            class: 'menu-item' + (state.view === 'today' && state.personFilter === p.id ? ' current' : ''), title: tasks.length ? `${sent} of ${tasks.length} sent today` : 'No tasks today',
            onClick: () => { const pick = state.personFilter === p.id ? 0 : p.id; if (state.view !== 'today') go('today'); state.personFilter = pick; state.boardPage = 1; state.menuOpen = false; render(); },
          }, h('span', null, h('span', { class: 'dot ' + dot }), ' ', p.name), h('span', { class: 'count' }, tasks.length ? `${sent}/${tasks.length}` : '')));
        })] : null,
        h('li', { class: 'menu-sep' }),
        ps === 'no' ? null : item('🔔 Notifications', state.sel === 'notify', () => open('notify'), ps === 'on' ? 'On' : 'Off'),
        item(`👤 ${state.user.name}`, state.sel === 'password', () => open('password')),
        item('Sign out', false, signOut)));
  }

  const rowOf = (t, sub, dot, warn = false) => taskRow({
    key: 't-' + t.id, title: t.title, sub, dot: dotOf(dot), warn, current: state.sel === 'task:' + t.id, onOpen: () => open('task:' + t.id),
    tags: [state.newIds.has(t.id) ? h('span', { class: 'tag high' }, 'New') : null, t.unread ? h('span', { class: 'tag on-step', title: `${t.unread} new message(s)` }, '💬 New') : null],
  });

  /** Once at the top: "turn on notifications" (until done, or Later), as on the staff view. */
  function pushBanner() {
    const s = push ? push.state() : 'no';
    if ((s !== 'default' && s !== 'granted') || state.pushLater) return null;
    try { if (Number(localStorage.getItem('wt.pushLater') || 0) > Date.now() || localStorage.getItem('wt.pushOff.' + state.user.id)) return null; } catch { /* blocked */ }
    return h('div', { class: 'banner stack', key: 'push-banner' },
      h('span', null, '🔔 Get a message on this phone when your team sends an update or a message — like email.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', onClick: notifyOn }, 'Turn on'),
        h('button', { class: 'link', onClick: () => { try { localStorage.setItem('wt.pushLater', String(Date.now() + 3 * 86400000)); } catch { /* blocked */ } state.pushLater = true; render(); } }, 'Later')));
  }

  /** Words that could not be sent (to copy), news to open, and the notifications banner. */
  function bars() {
    const n = state.outbox.length;
    return [
      pushBanner(),
      state.offline || n ? h('div', { class: 'offline-bar', key: 'offline' },
        state.offline ? '📴 Offline — showing the last saved copy. What you send is kept on this phone and goes out when you are online.' : '',
        n ? h('strong', null, ` ⏳ ${n} waiting to send`) : null,
        n && !state.offline ? [' ', h('button', { class: 'link', onClick: () => flush() }, 'Send now')] : null) : null,
      state.notices.map((x, i) => h('div', { class: 'banner stack', key: 'n-' + i },
        h('strong', null, x.title), h('div', { class: 'pre small' }, x.body),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onClick: () => copy(x.body).then(() => toast('Copied ✓'), () => toast('Select the words and copy them.', 4000)) }, 'Copy'),
          h('button', { class: 'btn small', onClick: () => { state.notices.splice(i, 1); render(); } }, 'Close')))),
      state.news.map((x, i) => h('div', { class: 'banner stack', key: 'news-' + i },
        h('strong', null, x.title), x.body ? h('span', { class: 'small muted' }, x.body) : null,
        h('div', { class: 'row' },
          x.sel ? h('button', { class: 'btn primary small', onClick: () => { state.news = []; open(x.sel); } }, 'Open') : null,
          h('button', { class: 'btn small', onClick: () => { state.news = []; render(); } }, 'Close')))),
    ];
  }

  /** Top of Team today, as the owner's progress line: updates in today, who has not sent, who is stuck. */
  function summary(d) {
    if (d.stale || !d.tasks.length) return null;
    const due = d.tasks.filter((t) => t.dueToday || t.today);
    const sent = due.filter((t) => t.today).length;
    const missing = [...new Set(due.filter((t) => !t.today && t.dueToday).map((t) => t.assignee.name))];
    const since = d.stuckSince || {};
    const stuck = (d.stuck || []).map((t) => { const days = since[t.id] ? daysBetween(since[t.id], d.today) : 0; return `${t.assignee.name}${days ? ` (${days} day${days > 1 ? 's' : ''})` : ''}`; });
    const quiet = (d.people || []).filter((p) => d.tasks.some((t) => t.assignee.id === p.id) && p.lastUpdate && daysBetween(p.lastUpdate, d.today) >= 2).map((p) => `${p.name} (${daysBetween(p.lastUpdate, d.today)} days)`);
    const all = sent === due.length;
    const bar = progressBar(due.length ? sent / due.length : 0, 'tf');
    return h('div', { class: 'progress', key: 'team-progress' },
      h('div', { class: 'progress-text' }, h('strong', null, `${sent} of ${due.length}`), all ? ' updates in today — all in! 🎉' : ' updates in today'),
      bar,
      missing.length && !all ? h('div', { class: 'progress-text' + (d.late ? ' warn' : '') }, `${d.late ? '⚠️ ' : ''}Not yet: ${missing.join(', ')}`) : null,
      stuck.length ? h('div', { class: 'progress-text warn' }, `Stuck: ${stuck.join(', ')}`) : null,
      quiet.length ? h('div', { class: 'progress-text' }, `No update for: ${quiet.join(', ')}`) : null);
  }

  function teamList() {
    outlookConnected(); // asked once, so 📧 Morning email knows by the time it is pressed
    const d = state.data;
    const filt = state.personFilter;
    const people = [...(d.people || [])];
    // (everyone with a row of the table: today's tasks, and stuck ones, new messages and suggestions not due today)
    for (const t of [...d.tasks, ...(d.stuck || []), ...(d.unread || []), ...(d.suggestions || [])]) if (!people.some((p) => p.id === t.assignee.id)) people.push({ id: t.assignee.id, name: t.assignee.name });
    const sentMark = (p) => { const tm = rules.sentTime(sentAtOf(p.id, p.morningSentAt), istDay()); return tm ? h('span', { class: 'muted small', title: 'Morning email sent today' }, ' ✓ ' + tm) : null; };
    return [
      d.stale ? h('p', { class: 'empty-list' }, `📴 Saved copy from ${fmtDay(d.today)} — today's updates are not shown yet.`) : null,
      filt ? null : summary(d),
      // (owner, 23 Oct: no "Needs you" list — stuck, new messages and suggestions are in the table, with their counts)
      people.length ? null : h('p', { class: 'empty-list' }, 'No team members yet. ', h('button', { class: 'link', onClick: () => (opts.openPeople ? opts.openPeople() : go('people')) }, 'Add a person')),
      people.length ? board(d, sentMark) : null,
      filt ? h('p', { class: 'empty-list' }, h('button', { class: 'link', onClick: () => { state.personFilter = 0; state.boardPage = 1; render(); } }, '← Show everyone')) : null,
    ];
  }

  /**
   * Team today as one table (owner, 23 Oct; the rule: logic.js teamBoard): the counts on top (each shows only those),
   * By person | By 📂 project, then every task, red first — its 📂, who, what they wrote today, its status, the last
   * message. A row opens the task on the right. With no task open the table fills the screen.
   */
  function board(d, sentMark) {
    const b = rules.teamBoard(d, { filter: state.boardFilter || '', group: state.boardGroup || 'person', person: state.personFilter || 0, page: state.boardPage || 1 });
    const pick = (k) => () => { state.boardFilter = state.boardFilter === k ? '' : k; state.boardPage = 1; render(); };
    const turn = (n) => () => { state.boardPage = n; render(); };
    const pager = b.pages > 1 ? h('div', { class: 'board-pager row' },
      h('button', { class: 'btn small', disabled: b.page > 1 ? undefined : true, onClick: turn(b.page - 1) }, '‹ Previous'),
      h('span', { class: 'muted small' }, `Page ${b.page} of ${b.pages} · ${b.shown} tasks`),
      h('button', { class: 'btn small', disabled: b.page < b.pages ? undefined : true, onClick: turn(b.page + 1) }, 'Next ›')) : null;
    const chip = (k, label) => h('button', { class: 'chip board-count' + (state.boardFilter === k ? ' on' : ''), 'aria-pressed': String(state.boardFilter === k), onClick: pick(k) }, label);
    const seg = (g, label) => h('button', { class: 'seg' + ((state.boardGroup || 'person') === g ? ' on' : ''), 'aria-pressed': String((state.boardGroup || 'person') === g), onClick: () => { state.boardGroup = g; state.boardPage = 1; render(); } }, label);
    const STATUS = { sent: ['✓ Sent', 'good'], notyet: ['Not yet', d.late ? 'late' : 'waiting'], stuck: ['⚠️ Stuck', 'late'], late: ['⏰ Late', 'late'], sugg: ['💡 Suggestion — yes or no?', 'remind'], notdue: ['Not due today', 'waiting'] };
    const cell = (cls, ...c) => h('td', { class: cls }, ...c);
    const line = (r) => {
      const t = r.t, u = t.today, m = t.lastMessage;
      return h('tr', { key: 'b-' + t.id, class: 'sub-row board-row' + (state.sel === 'task:' + t.id ? ' current' : ''), onClick: () => open('task:' + t.id) },
        cell('', h('span', { class: 'dot ' + dotOf(r.colour) })),
        cell('board-task', h('button', { class: 'link sub-name', type: 'button' }, t.title), ' ', state.boardGroup === 'project' ? null : h('span', { class: 'tag main-tag' }, '📂 ' + r.project), // (by 📂 project: its line says it)
          state.newIds.has(t.id) ? h('span', { class: 'tag high' }, 'New') : null),
        cell('board-who', t.assignee.name),
        cell('board-today col-extra' + (u ? '' : ' muted'), u ? [h('span', { class: 'muted small' }, fmtTime(u.at) + ' '), u.note, (u.photos || []).length ? ` 📷${u.photos.length}` : ''] : '—'),
        cell('board-status', h('span', { class: 'tag ' + STATUS[r.status][1] }, r.status === 'late' ? `⏰ Late (by ${fmtDay(t.dueDate)})` : STATUS[r.status][0])),
        cell('board-msg col-extra' + (m ? '' : ' muted'), m ? [r.msg ? h('span', { class: 'tag on-step' }, '💬 New') : null, ` ${m.mine ? 'You' : m.by}: ${m.text || '📷'}`] : '—'));
    };
    const head = (g) => h('tr', { key: 'g-' + g.name, class: 'board-group' }, h('td', { colspan: '6' },
      h('strong', null, (state.boardGroup === 'project' ? '📂 ' : '') + g.name), ' ',
      g.all ? h('span', { class: 'tag ' + tagOf(g.sent === g.all ? 'green' : d.late ? 'red' : 'amber') }, `${g.sent} of ${g.all} sent`) : null,
      g.person ? [' ', h('button', { class: 'chip', onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); morningEmail(g.person); } }, '📧 Morning email'), sentMark(g.person)] : null));
    return [
      h('div', { class: 'board-counts row' }, chip('sent', `✓ Sent ${b.counts.sent}`), chip('notyet', `⏳ Not yet ${b.counts.notyet}`), chip('stuck', `⚠️ Stuck ${b.counts.stuck}`),
        chip('late', `⏰ Late ${b.counts.late}`), chip('msg', `💬 New messages ${b.counts.msg}`), b.counts.sugg || state.boardFilter === 'sugg' ? chip('sugg', `💡 Suggestions ${b.counts.sugg}`) : null),
      h('div', { class: 'segmented board-group-by', role: 'group', 'aria-label': 'Group the table' }, seg('person', 'By person'), seg('project', 'By 📂 project')),
      !b.total ? h('p', { class: 'empty-list' }, 'No tasks today.') : !b.groups.length ? h('p', { class: 'empty-list' }, 'None of these. ', h('button', { class: 'link', onClick: pick(state.boardFilter) }, 'Show all')) :
        h('table', { class: 'sub-table board-table' },
          h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Task'), h('th', null, 'Person'), h('th', { class: 'col-extra' }, 'Today'), h('th', null, 'Status'), h('th', { class: 'col-extra' }, 'Last message'))),
          h('tbody', null, b.groups.map((g) => [head(g), g.rows.map(line)]))),
      pager, // 20 tasks a page
    ];
  }

  function followRow(r) {
    const sel = r.kind === 'project' ? 'project:' + r.projectRef : 'task:' + r.taskId;
    return h('li', { key: 'fu-' + r.kind + (r.taskId || r.projectRef), class: 'prow' + (state.sel === sel ? ' current' : '') },
      h('span', { class: 'quick-tick-space', 'aria-hidden': 'true' }),
      h('div', { class: 'prow-text' },
        h('button', { class: 'prow-btn', onClick: () => open(sel) },
          h('span', { class: 'dot ' + dotOf(r.colour) }),
          h('span', { class: 'prow-text' },
            h('span', { class: 'prow-name' }, (r.kind === 'project' ? '📁 ' : '') + r.title, r.stuck ? h('span', { class: 'tag late' }, 'Stuck') : null),
            r.step ? h('span', { class: 'prow-next' }, 'Now: ' + r.step) : null,
            h('span', { class: 'prow-next' + (r.colour === 'red' ? ' warn' : '') }, r.reason))),
        h('div', { class: 'row staff-pad' },
          h('button', { class: 'chip', onClick: async () => { if (await chase(r)) load(); } }, '🔔 Chase'),
          h('button', { class: 'chip', onClick: async () => { if (await closeFollow(r)) load(); } }, '✓ Done'),
          r.kind === 'project'
            ? [h('button', { class: 'chip', onClick: () => open('project:' + r.projectRef) }, '📁 Open project'), h('span', { class: 'muted small' }, 'Take back on your projects page')]
            : h('button', { class: 'chip', onClick: () => takeBack(r) }, '↩ Take back'))));
  }

  /** 🎤 only where the browser can listen; when it stops, its words go into the one-line box. */
  const listen = () => (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
  function sayIt() {
    const Listen = listen();
    if (!Listen || state.listening) return;
    const rec = new Listen();
    rec.lang = 'en-IN'; rec.interimResults = false; rec.maxAlternatives = 1;
    let heard = '';
    rec.onresult = (e) => { heard = [...e.results].map((x) => x[0].transcript).join(' ').trim(); };
    rec.onerror = (e) => { if (e.error === 'not-allowed') toast('Allow the microphone to speak the task', 5000); };
    rec.onend = () => { state.listening = false; if (heard) (state.quick || (state.quick = { text: '', sig: '', cid: '' })).text = heard; render(); };
    try { rec.start(); state.listening = true; render(); } catch { /* already listening */ }
  }

  /** Work in one line: the box, then a preview card with ✓ Give it / ✎ Change. */
  function quickBox(people) {
    const q = state.quick || (state.quick = { text: '', sig: '', cid: '' });
    const err = errLine('qerr');
    const r = q.text.trim() ? rules.parseQuickTask(q.text, people, today()) : null;
    if (r && !r.error) { const sig = JSON.stringify([r.person.id, r.title, r.dueDate]); if (q.sig !== sig) { q.sig = sig; q.cid = newClientId(); } } // one id per preview: a second tap gives it once
    return h('div', { class: 'stack staff-pad', key: 'quick' },
      h('div', { class: 'row quick-line' },
        h('input', { key: 'quick-in', class: 'search', placeholder: 'Valar: send kiln photos by Friday', 'aria-label': 'Hand out work in one line', enterkeyhint: 'done', value: q.text, onInput: (e, el) => { q.text = el.value; render(); } }),
        listen() ? h('button', { class: 'chip' + (state.listening ? ' on' : ''), title: 'Say it', 'aria-label': 'Say it', onClick: sayIt }, '🎤') : null),
      !r ? null : r.error ? h('p', { class: 'warn', key: 'qerr2' }, r.error) : h('div', { class: 'banner stack', key: 'qcard' },
        h('div', null, h('span', { class: 'muted small' }, 'Task: '), h('strong', null, r.title)),
        h('div', null, h('span', { class: 'muted small' }, 'Person: '), r.person.name),
        h('div', null, h('span', { class: 'muted small' }, 'By: '), r.dueDate ? fmtDay(r.dueDate) : 'No by-date (one time)'),
        err,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary small', onClick: () => giveQuick(r).then((m) => { err.say(m); }) }, '✓ Give it'),
          h('button', { class: 'btn small', onClick: () => { state.prefill = { title: r.title, assigneeId: r.person.id, repeat: 'once', dueDate: r.dueDate }; state.quick = null; open('give'); } }, '✎ Change'))));
  }

  function roundScreen(d) {
    const R = state.round, td = d.today;
    const plan = rules.roundPlan(R.rows, R.saved, td);
    const s = plan.saved;
    const barOf = (part) => progressBar(part, 'rf');
    const stop = () => { state.round = null; load(); };
    const head = h('div', { class: 'row' }, h('strong', null, '🔁 Daily follow-up round'), h('button', { class: 'link', onClick: stop }, 'Stop'));
    if (!plan.queue.length) {
      return h('div', { class: 'banner stack' }, head, barOf(1), h('h3', null, 'All followed up ✓'),
        h('p', { class: 'muted' }, `${s.chased} chased · ${s.changed} changed · ${s.closed} closed`),
        h('button', { class: 'btn primary small', onClick: stop }, 'Back to the list'));
    }
    const r = plan.queue[0];
    const mark = (what) => { R.saved = rules.roundMark(R.saved, rules.roundKey(r), what, td); roundStore(R.saved); R.changing = false; render(); };
    const others = (d.people || []).filter((p) => p.role !== 'admin' && p.id !== r.person.id);
    return h('div', { class: 'banner stack' }, head,
      barOf((plan.pos - 1) / plan.total),
      h('p', { class: 'muted small' }, `Item ${plan.pos} of ${plan.total}`),
      h('h3', null, (r.kind === 'project' ? '📁 ' : '') + r.title),
      r.step ? h('p', { class: 'muted small' }, 'Now: ' + r.step) : null,
      h('p', null, h('span', { class: 'dot ' + dotOf(r.colour) }), ` ${r.person.name} · ${r.reason}`),
      h('p', { class: 'muted small' }, r.lastUpdate ? `Last update: ${fmtDay(r.lastUpdate.day)} — ${r.lastUpdate.note || ''}` : 'No update yet'),
      R.changing ? h('div', { class: 'stack' },
        h('strong', null, r.kind === 'project' ? 'Move the whole project (all its open steps) to:' : 'Give it to:'),
        h('div', { class: 'row' }, others.length ? others.map((p) => h('button', { class: 'chip', onClick: async () => {
          try { await api('task.move', { id: r.taskId, toId: p.id }); toast(`Moved to ${p.name} ✓`); mark('changed'); } catch (e) { say(e); }
        } }, p.name)) : h('span', { class: 'muted' }, 'Add another person first (People).'))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', onClick: () => mark('ok') }, '👍 OK'),
        h('button', { class: 'chip', onClick: async () => { if (await chase(r)) mark('chased'); } }, '🔔 Chase'),
        h('button', { class: 'chip', onClick: () => { R.changing = !R.changing; render(); } }, '👤 Change person'),
        h('button', { class: 'chip', onClick: async () => { if (await closeFollow(r)) mark('closed'); } }, '✕ Close')));
  }

  function followupList() {
    const d = state.data;
    if (state.round) return roundScreen(d);
    const rows = rules.followupRows(d.rows, d.today);
    return [
      quickBox(d.people || []),
      h('div', { class: 'progress' }, h('div', { class: 'progress-row' },
        h('div', { class: 'progress-text' }, rules.followupSummary(rows, d.today)),
        rows.length ? h('button', { class: 'btn primary small', onClick: startRound }, '▶ Start round (2 min)') : null)),
      rows.length ? rules.followupGroups(rows).map((g) => [sec(g.person.name), h('ul', { class: 'plist' }, g.rows.map(followRow))])
        : h('p', { class: 'empty-list' }, 'Nothing given out right now.'),
    ];
  }

  function tasksList() {
    const d = state.data;
    const groups = new Map();
    for (const t of d.tasks) { if (!groups.has(t.assignee.name)) groups.set(t.assignee.name, []); groups.get(t.assignee.name).push(t); }
    const seg = (on, label, closed) => h('button', { class: 'seg' + (on ? ' on' : ''), 'aria-pressed': String(on), onClick: () => { state.closed = closed; go('tasks'); } }, label);
    return [
      h('div', { class: 'list-tools' }, h('div', { class: 'segmented', role: 'group', 'aria-label': 'Which tasks' }, seg(!state.closed, 'Open', false), seg(state.closed, 'Done / cancelled', true))),
      d.tasks.length ? null : h('p', { class: 'empty-list' }, state.closed ? 'Nothing closed yet.' : 'No open tasks. Give one with “+ Give a task”.'),
      [...groups].map(([name, tasks]) => [sec(name, h('span', { class: 'tag waiting' }, String(tasks.length))),
        h('ul', { class: 'plist' }, tasks.map((t) => rowOf(t,
          [t.status !== 'open' ? (t.status === 'done' ? 'Done' : 'Cancelled') : null, t.project, repeatLabel(t), t.today ? 'sent today' : t.last ? `last ${fmtDay(t.last.day)}` : 'no update yet'].filter(Boolean).join(' · '),
          t.status !== 'open' ? 'grey' : t.stuck ? 'red' : t.today ? 'green' : 'yellow')))]),
    ];
  }

  function projectsList() {
    const list = state.data.projects || [];
    if (!list.length) return h('p', { class: 'empty-list' }, 'No projects given to the team yet. Give one from your projects page (👥 Give project).');
    const ago = (day) => !day ? 'no update yet' : day === state.data.today ? 'updated today' : `last update ${fmtDay(day)}`;
    return h('ul', { class: 'plist' }, list.map((p) => {
      const total = p.open + p.done;
      const { dot, now } = rules.projectRowState(p);
      const sub = [p.people.join(', '), total ? `${p.done} of ${total} done` : 'no steps yet', now, ago(p.lastUpdate), p.staffSteps ? `${p.staffSteps} step${p.staffSteps > 1 ? 's' : ''} added by them` : ''].filter(Boolean).join(' · ');
      return taskRow({ key: 'p-' + p.ref, title: '📁 ' + p.name, sub: (p.projectAbout ? rules.aboutShort(p.projectAbout) + ' · ' : '') + sub, dot: dotOf(dot),
        current: state.sel === 'project:' + p.ref, tags: p.stuck ? h('span', { class: 'tag late' }, 'Stuck') : null, onOpen: () => open('project:' + p.ref) });
    }));
  }

  function projectPage() {
    const all = (state.detail && state.detail.tasks) || [];
    const steps = all.filter((t) => !String(t.stepRef).endsWith(':whole'));
    const done = steps.filter((t) => t.status === 'done'), openSteps = all.filter((t) => t.status === 'open');
    const cur = openSteps.find((t) => !t.queued);
    const people = [...new Set(openSteps.map((t) => t.assignee.name))];
    const days = all.map((t) => (t.today || t.last || {}).day).filter(Boolean).sort();
    const last = days[days.length - 1];
    const who = (t) => (t.createdBy === t.assignee.id ? ` · added by ${t.assignee.name}` : '');
    const total = done.length + openSteps.filter((t) => !String(t.stepRef).endsWith(':whole')).length;
    const stuck = openSteps.some((t) => t.stuck);
    const bar = progressBar(total ? done.length / total : 0, 'pp');
    return [
      h('div', { class: 'progress' },
        h('div', { class: 'progress-text' }, h('strong', null, people.length ? `👥 ${people.join(', ')}` : 'Not given now'), ' ',
          h('span', { class: 'tag ' + (stuck ? 'late' : 'waiting') }, stuck ? 'Stuck' : total ? `${done.length} of ${total} done` : 'No steps yet')),
        total ? bar : null,
        h('div', { class: 'progress-text' }, last ? (last === state.detail.today ? 'Last update: today' : `Last update: ${fmtDay(last)} (${daysBetween(last, state.detail.today)} days ago)`) : 'No update yet')),
      done.length ? block(`✓ ${done.length} done`, h('ul', { class: 'plist' }, done.map((t, i) => rowOf(t, `Step ${i + 1} · done ${t.doneAt ? fmtDay(t.doneAt) : ''}${who(t)}`, 'green')))) : null,
      openSteps.length ? block('To do', h('ul', { class: 'plist' }, openSteps.map((t, i) => rowOf(t,
        (String(t.stepRef).endsWith(':whole') ? 'The whole project (no steps yet)' : `Step ${done.length + i + 1}`) + (t === cur ? ` · current · ${t.today ? '✓ sent today' : 'no update today'}` : ' · next') + who(t) + (t.dueDate ? ` · by ${fmtDay(t.dueDate)}` : ''),
        t.stuck ? 'red' : t === cur ? (t.today ? 'green' : 'yellow') : 'grey', t.stuck)))) : h('p', { class: 'muted' }, 'Nothing open on this project.'),
      h('p', { class: 'muted small' }, owner ? 'Add, tick or change steps on your projects page; the person’s list follows by itself.' : 'Steps are added and changed on the owner’s projects page; the person’s list follows by itself.'),
    ];
  }

  function searchList() {
    const r = state.searchResults;
    const icon = { task: '📋', message: '💬', update: '📝' };
    return [h('div', { class: 'search-box' }, h('input', { class: 'search', type: 'search', key: 'team-search', placeholder: 'Search tasks, messages, updates…', 'aria-label': 'Search', value: state.searchQ, onInput: (e, el) => search(el.value) })),
      !r ? h('p', { class: 'empty-list' }, 'Type 2 or more letters.') : r.error ? h('p', { class: 'empty-list' }, r.error) : !r.length ? h('p', { class: 'empty-list' }, 'Nothing found.')
        : h('ul', { class: 'plist' }, r.map((x, i) => taskRow({ key: 'sr-' + i, title: `${icon[x.kind] || ''} ${x.title}`, sub: `${x.who} · ${fmtDay(x.at)} — ${x.text}`, onOpen: () => open('task:' + x.taskId) })))];
  }

  function reportPage() {
    const d = state.data;
    if (!d.people) return h('p', { class: 'muted' }, 'Loading…');
    const moveWeek = (n) => { state.reportEnd = rules.addDay(d.end, n * 7); if (state.reportEnd >= d.today) state.reportEnd = ''; state.data = null; render(); load(); };
    return h('div', { class: 'report' },
      h('div', { class: 'report-controls' },
        h('button', { class: 'btn small', onClick: () => moveWeek(-1) }, '‹ Week before'),
        h('strong', null, `${fmtDay(d.from)} – ${fmtDay(d.end)}`),
        h('button', { class: 'btn small', disabled: d.end >= d.today ? true : undefined, onClick: () => moveWeek(1) }, 'Next week ›')),
      d.people.length ? h('table', { class: 'wt-table' },
        h('thead', null, h('tr', null, ['Person', 'Days sent', 'Missed', 'Updates', 'Stuck', 'Finished', 'Steps added'].map((x) => h('th', null, x)))),
        h('tbody', null, d.people.map((p) => h('tr', { key: 'rp-' + p.name },
          h('td', null, h('strong', null, p.name)),
          h('td', { class: p.sentDays >= p.workDays ? 'ok' : '' }, p.workDays ? `${p.sentDays} of ${p.workDays}` : '—'),
          h('td', { class: p.missed.length ? 'warn' : '' }, p.missed.length ? p.missed.map((x) => fmtDay(x)).join(', ') : '—'),
          h('td', null, String(p.updates)), h('td', { class: p.stuck ? 'warn' : '' }, String(p.stuck)),
          h('td', null, String(p.finished)), h('td', null, String(p.stepsAdded)))))) : h('p', { class: 'muted' }, 'No team members yet.'),
      h('p', { class: 'muted small' }, 'Days sent: days with at least one update, out of the days they had work. Missed: days with work and no update.'));
  }

  function peoplePage() {
    outlookConnected();
    const users = state.data.users || [];
    const morning = state.data.morning, td = istDay();
    const mpOf = (u) => (morning && u.active && u.role === 'staff' ? morning.people.find((x) => x.id === u.id) : null);
    const sentCount = morning ? morning.people.filter((mp) => rules.sentTime(sentAtOf(mp.id, mp.sentAt), td)).length : 0;
    const f = (state.personForm ||= { name: '', username: '', password: tempPassword(), role: 'staff', email: '', touched: false });
    const err = errLine('perr');
    const share = state.newPerson ? (() => {
      const p = state.newPerson;
      const text = `Work Task (daily updates)\nLink: ${opts.appLink || location.origin + '/'}\nUsername: ${p.username}\nPassword: ${p.password}\nAfter signing in, choose your own password.`;
      return block(`Send this to ${p.name}`, h('div', { class: 'pre small' }, text), h('div', { class: 'row' },
        h('button', { class: 'btn small', onClick: () => copy(text).then(() => toast('Copied ✓'), () => toast('Select the text and copy it')) }, '📋 Copy'),
        h('a', { class: 'btn small', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp'),
        h('button', { class: 'btn small', onClick: () => { state.newPerson = null; render(); } }, 'Done')));
    })() : null;
    const card = (u) => {
      const mp = mpOf(u);
      const at = mp ? sentAtOf(mp.id, mp.sentAt) : null, sent = mp && !!rules.sentTime(at, td);
      const list = mp ? rules.morningOrder(mp.items) : [];
      return h('section', { class: 'block', key: 'u-' + u.id },
        h('div', { class: 'row' }, h('strong', null, u.name), h('span', { class: 'muted small' }, '@' + u.username),
          h('span', { class: 'tag ' + (!u.active ? 'waiting' : mp ? (sent ? 'done-tag' : 'remind') : u.role === 'admin' ? 'on-step' : 'done-tag') },
            !u.active ? 'Switched off' : mp ? (sent ? '✓ ' : '') + rules.sentTag(at, td) : u.role === 'admin' ? 'Manager' : 'Staff')),
        h('div', { class: 'muted small' }, u.lastLogin ? `Last signed in ${fmtDay(u.lastLogin)} ${fmtTime(u.lastLogin)}` : 'Not signed in yet', u.email ? ` · 📧 ${u.email}` : '',
          mp && !u.email && u.id !== state.user.id ? [' · ', h('button', { class: 'link small', onClick: () => editPerson(u, 'email') }, 'no email — add one')] : null),
        mp ? [h('div', { class: 'row' }, h('button', { class: 'chip', onClick: () => morningEmail(u) }, sent ? '📧 Send again' : '📧 Morning email')),
          list.length ? [h('p', { class: 'muted small' }, rules.morningSummary(list)), h('table', { class: 'wt-table morning' },
            h('thead', null, h('tr', null, h('th', { class: 'm-no' }, '#'), h('th', null, 'Work'), h('th', { class: 'm-last' }, 'Last update'))),
            h('tbody', null, list.map((x, i) => h('tr', { class: x.taskId || x.projectRef ? 'wt-open' : null, onClick: () => (x.projectRef ? open('project:' + x.projectRef) : x.taskId ? open('task:' + x.taskId) : null) },
              h('td', null, String(i + 1)),
              h('td', null, h('b', null, rules.morningTitle(x)), x.about ? h('div', { class: 'muted small' }, rules.aboutShort(x.about)) : null, x.lateSince ? h('div', { class: 'warn' }, `Late since ${rules.mailDate(x.lateSince)}`) : null, x.stuck ? h('div', { class: 'warn' }, 'Stuck') : null, x.now ? h('div', { class: 'muted small' }, `Now: ${x.now}`) : null),
              h('td', { class: 'muted' }, rules.morningLast(x))))))] : h('p', { class: 'muted small' }, 'No pending work today.')] : null,
        u.id === state.user.id ? null : h('div', { class: 'row' },
          h('button', { class: 'btn small', onClick: () => editPerson(u, 'name') }, '✎ Name'),
          h('button', { class: 'btn small', onClick: () => editPerson(u, 'email') }, '📧 Email'),
          h('button', { class: 'btn small', onClick: () => resetPassword(u) }, '🔑 New password'),
          h('button', { class: 'btn small', onClick: () => switchPerson(u) }, u.active ? 'Switch off' : 'Switch on'),
          u.active ? h('button', { class: 'btn small', onClick: () => { state.movingAll = state.movingAll === u.id ? 0 : u.id; render(); } }, '↔ Move all tasks to…') : null),
        state.movingAll === u.id ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, `All of ${u.name}'s open tasks go to:`),
          users.filter((x) => x.active && x.id !== u.id).map((x) => h('button', { class: 'chip', onClick: () => moveAll(u, x) }, x.name)),
          h('button', { class: 'link', onClick: () => { state.movingAll = 0; render(); } }, 'Cancel')) : null);
    };
    return h('div', { class: 'report' },
      morning ? h('p', { class: 'muted' }, `Morning emails today: ${sentCount} of ${morning.people.length} sent`) : null,
      share,
      users.map(card),
      block('Add a person', h('div', { class: 'stack' },
        h('label', null, 'Name', h('input', { key: 'np-name', placeholder: 'Suresh Kumar', value: f.name, onInput: (e, el) => { f.name = el.value; if (!f.touched) f.username = el.value.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, ''); render(); } })),
        h('label', null, 'Username (small letters, no spaces)', h('input', { key: 'np-user', autocapitalize: 'none', spellcheck: 'false', placeholder: 'suresh', value: f.username, onInput: (e, el) => { f.username = el.value; f.touched = true; } })),
        h('label', null, 'First password (they change it when they sign in)', h('input', { key: 'np-pass', value: f.password, onInput: (e, el) => { f.password = el.value; } })),
        h('label', null, 'Role', h('select', { key: 'np-role', value: f.role, onChange: (e, el) => { f.role = el.value; } }, h('option', { value: 'staff' }, 'Staff (sees only own tasks)'), h('option', { value: 'admin' }, 'Manager (sees everything)'))),
        h('label', null, 'Email (optional, for the morning email)', h('input', { key: 'np-mail', type: 'email', maxlength: '120', autocapitalize: 'none', spellcheck: 'false', placeholder: 'suresh@company.com', value: f.email, onInput: (e, el) => { f.email = el.value; } })),
        err,
        h('button', { class: 'btn primary small', onClick: () => addPerson(f).then((m) => { err.say(m); }) }, 'Add person'))));
  }

  function settingsPage() {
    const s = (state.settingsForm ||= { fillBy: state.fillBy || '18:00', asked: false });
    if (!s.asked) { s.asked = true; api('team.today').then((d) => { if (d.fillBy && !s.touched) { s.fillBy = d.fillBy; state.fillBy = d.fillBy; render(); } }, () => {}); }
    return h('div', { class: 'report' },
      block('Daily updates', h('div', { class: 'stack' },
        h('label', null, 'Updates are due by (after this, missing ones show red)', h('input', { key: 'fill-by', type: 'time', value: s.fillBy, onInput: (e, el) => { s.fillBy = el.value; s.touched = true; } })),
        h('button', { class: 'btn primary small', onClick: async () => { try { await api('settings.save', { fillBy: s.fillBy }); state.fillBy = s.fillBy; toast('Saved ✓'); } catch (e) { say(e); } } }, 'Save'))),
      owner ? outlookBlock() : null);
  }

  /**
   * 📧 Outlook (only the owner): connect once; every new email in its Inbox comes to the 📥 Inbox of the projects.
   * The client secret is typed here and saved on the server only: it never comes back (only "saved ✓ (ends …ab12)").
   */
  function outlookBlock() {
    const o = (state.olForm ||= { clientId: '', tenantId: '', secret: '', status: null, asked: false, busy: '' });
    if (!o.asked) {
      o.asked = true;
      api('outlook.status').then((d) => { o.status = d.outlook; if (!o.clientId) o.clientId = d.outlook.clientId || ''; if (!o.tenantId) o.tenantId = d.outlook.tenantId || ''; render(); }, (e) => { o.error = e.message; render(); });
    }
    const st = o.status;
    const run = async (name, a, body, after) => {
      o.busy = name; render();
      try { const out = await api(a, body); o.status = out.outlook || o.status; state.outlook = !!(o.status && o.status.connected); if (after) after(out); } catch (e) { toast(e.message, 6000); } finally { o.busy = ''; render(); }
    };
    return block('📧 Outlook', h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Every new email in your Outlook Inbox comes to your Daily Projects 📥 Inbox (replies join the same item). Set up once in Azure (App registrations): register this Redirect URI (type Web), add the delegated permissions offline_access, User.Read and Mail.ReadWrite (it only reads your emails; it never sends any), make a client secret.'),
      h('label', null, 'Redirect URI to register', h('code', null, st ? st.redirectUri || '' : '')),
      h('label', null, 'Application (client) ID', h('input', { key: 'ol-client', autocomplete: 'off', spellcheck: 'false', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', value: o.clientId, onInput: (e, el) => { o.clientId = el.value; } })),
      h('label', null, 'Directory (tenant) ID', h('input', { key: 'ol-tenant', autocomplete: 'off', spellcheck: 'false', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', value: o.tenantId, onInput: (e, el) => { o.tenantId = el.value; } })),
      h('label', null, 'Client secret ', h('span', { class: 'muted small' }, st ? (st.secretEnd ? `saved ✓ (ends …${st.secretEnd})` : 'not saved yet') : ''),
        h('input', { key: 'ol-secret', type: 'password', autocomplete: 'new-password', spellcheck: 'false', placeholder: 'Client secret Value', value: o.secret, onInput: (e, el) => { o.secret = el.value; } })),
      h('div', { class: 'row' }, h('button', { class: 'btn small', disabled: o.busy ? true : undefined, onClick: () => run('save', 'outlook.save', { clientId: o.clientId.trim(), tenantId: o.tenantId.trim(), secret: o.secret.trim() }, () => { o.secret = ''; toast('Saved ✓'); }) }, 'Save')),
      h('p', { class: 'small' + (st && st.error ? ' warn' : '') }, o.error || (st ? rules.outlookLine(st, st.today) : 'Loading…')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', disabled: o.busy ? true : undefined, onClick: () => run('connect', 'outlook.connect', {}, (out) => { if (out.url) location.href = out.url; }) }, st && st.connected ? 'Connect again' : 'Connect Outlook'),
        st && st.connected ? h('button', { class: 'btn small', disabled: o.busy ? true : undefined, onClick: () => run('check', 'outlook.check', {}, () => toast('Checked ✓')) }, 'Check now') : null,
        st && st.connected ? h('button', { class: 'btn small', disabled: o.busy ? true : undefined, onClick: () => { if (ask.confirm('Disconnect Outlook? New emails stop coming to your Inbox.')) run('off', 'outlook.disconnect', {}, () => toast('Disconnected')); } }, 'Disconnect') : null)));
  }

  // ---------------------------------------------------------------- the page on the right

  function taskActions(t) {
    if (t.status === 'suggested') return null;
    if (t.status !== 'open') return h('button', { class: 'btn', onClick: () => setStatus(t, 'open') }, 'Open again');
    return [h('button', { class: 'btn', onClick: () => setStatus(t, 'done') }, 'Finish task'),
      h('button', { class: 'btn icon-btn' + (state.taskMenu === t.id ? ' on' : ''), 'aria-label': 'More actions', title: 'Edit, move, instructions, cancel', onClick: () => { state.taskMenu = state.taskMenu === t.id ? 0 : t.id; render(); } }, '⋯')];
  }

  function taskMenu(t) {
    if (state.taskMenu !== t.id || t.status !== 'open') return null;
    const close = () => { state.taskMenu = 0; };
    return h('div', { class: 'proj-menu', role: 'menu' },
      h('button', { class: 'menu-row', onClick: () => { close(); open('edit:' + t.id); } }, '✎ Edit task'),
      h('button', { class: 'menu-row', onClick: () => { close(); state.moving = t.id; render(); } }, '↔ Move to another person…'),
      h('label', { class: 'menu-row' }, '📎 Add instruction photo / PDF', h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, class: 'visually-hidden',
        onChange: (e, el) => { const files = [...el.files].slice(0, 10); el.value = ''; close(); render(); addFiles(t.id, files).then(() => { toast('Added ✓'); reload(); }); } })),
      t.seq !== null && t.seq !== undefined ? null : h('button', { class: 'menu-row danger', onClick: () => { close(); if (ask.confirm('Cancel this task?')) setStatus(t, 'cancelled'); else render(); } }, '✖ Cancel task'));
  }

  function taskPage() {
    const { task: t, updates = [], comments = [] } = state.detail;
    const td = today();
    const others = state.people.filter((p) => p.id !== (t.assignee && t.assignee.id));
    const whole = t.seq !== null && t.seq !== undefined;
    return [
      taskMenu(t),
      chipsFor(t, td, { who: true }),
      t.details ? h('p', { class: 'pre muted' }, t.details) : null,
      filesBlock(t, { pic, openFile, onRemove: removeFile }),
      t.status === 'suggested' ? h('div', { class: 'banner stack' },
        h('span', null, h('span', { class: 'tag' }, `💡 Suggested by ${t.assignee.name}`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary small', onClick: () => answerSuggestion(t, true) }, '✓ Yes, add it'),
          h('button', { class: 'btn small', onClick: () => answerSuggestion(t, false) }, 'Not now'))) : null,
      t.status === 'open' && state.moving === t.id ? h('div', { class: 'banner stack' },
        h('strong', null, whole ? `Move the whole project "${t.project}" (all its open steps) to:` : `Move "${t.title}" to:`),
        h('span', { class: 'muted small' }, 'Updates so far stay with the task. Both people see a note about the move.'),
        h('div', { class: 'row' }, others.length ? others.map((p) => h('button', { class: 'chip', onClick: () => move(t, p) }, p.name)) : h('span', { class: 'muted' }, 'Add another person first (People).'),
          h('button', { class: 'link', onClick: () => { state.moving = 0; render(); } }, 'Cancel'))) : null,
      messagesBlock({
        taskId: t.id, comments, photos, placeholder: 'Reply or give an instruction…',
        waiting: state.outbox.filter((x) => x.kind === 'comment' && x.taskId === t.id),
        draft: state.msgDrafts[t.id], sending: !!state.sending['m' + t.id],
        onInput: (v) => { state.msgDrafts[t.id] = v; },
        onSend: () => sendMessage(t.id), onPhoto: (f) => sendMessagePhoto(t.id, f), onEdit: editMessage, onDelete: deleteMessage,
      }),
      t.status === 'suggested' || t.declined ? null : diaryBlock({ rules, t, updates, td, staff: false, meId: state.user.id, n: state.diaryDays,
        fillBy: (state.data && state.data.fillBy) || state.fillBy || '18:00', photos, onMore: () => { state.diaryDays += 14; render(); } }),
    ];
  }

  /** Give a task / Edit task: the form keeps what is typed in this view's state (a redraw never wipes it). */
  function taskForm() {
    const editing = (state.sel || '').startsWith('edit:');
    const t = editing ? state.detail && state.detail.task : null;
    if (editing && !t) return h('p', { class: 'muted' }, 'Loading…');
    const key = state.sel;
    if (!state.giveForm || state.giveForm.key !== key) {
      const pre = !editing ? (state.prefill || {}) : {};
      const staffOnly = state.people.filter((p) => p.role === 'staff');
      state.giveForm = {
        key, assigneeId: t ? t.assignee.id : pre.assigneeId && state.people.some((p) => p.id === pre.assigneeId) ? pre.assigneeId : staffOnly.length === 1 ? staffOnly[0].id : 0,
        title: t ? t.title : pre.title || '', details: t ? t.details || '' : pre.details || '', project: t ? t.project || '' : pre.project || '',
        how: t ? (t.repeat === 'daily' ? (t.skipSunday ? 'daily' : 'daily7') : t.repeat) : pre.repeat === 'once' ? 'once' : 'daily',
        weekday: t && t.weekday !== null && t.weekday !== undefined ? t.weekday : 1, dueDate: t ? t.dueDate || '' : pre.dueDate || '',
        startDate: t && t.startDate && t.startDate > today() ? t.startDate : '', needsPhoto: t ? !!t.needsPhoto : false, files: [],
        projectRef: t ? t.projectRef : pre.projectRef, stepRef: t ? t.stepRef : pre.stepRef,
      };
    }
    const f = state.giveForm;
    const err = errLine('gerr');
    const set = (k) => (e, el) => { f[k] = el.type === 'checkbox' ? el.checked : el.value; if (k === 'how') render(); };
    const people = [...state.people];
    if (t && !people.some((p) => p.id === t.assignee.id)) people.push({ id: t.assignee.id, name: t.assignee.name + ' (switched off)' }); // kept, so a small change does not force someone else
    const td = today();
    return [
      !editing ? block('Work in one line', quickBox(state.people)) : null,
      block(editing ? 'Change the task' : 'Give a task', h('div', { class: 'stack' },
        h('label', null, 'Who', h('select', { key: 'g-who', value: String(f.assigneeId || ''), onChange: (e, el) => { f.assigneeId = Number(el.value); } },
          h('option', { value: '' }, 'Choose a person…'), people.map((p) => h('option', { value: String(p.id) }, p.name + (p.role === 'admin' ? ' (manager)' : ''))))),
        h('label', null, 'Task', h('input', { key: 'g-title', placeholder: 'Record kiln 3 temperature', value: f.title, onInput: set('title') })),
        h('label', null, 'Details', h('textarea', { key: 'g-details', placeholder: 'Anything they need to know (optional)', value: f.details, onInput: set('details') })),
        h('label', null, 'Project', h('input', { key: 'g-project', placeholder: 'Kiln trial (optional)', value: f.project, onInput: set('project') })),
        h('label', null, 'How often', h('select', { key: 'g-how', value: f.how, onChange: set('how') },
          h('option', { value: 'daily' }, 'Every day (Mon–Sat)'), h('option', { value: 'daily7' }, 'Every day, Sunday too'), h('option', { value: 'weekly' }, 'Once a week'), h('option', { value: 'once' }, 'One time'))),
        f.how === 'weekly' ? h('label', null, 'On', h('select', { key: 'g-wd', value: String(f.weekday), onChange: (e, el) => { f.weekday = Number(el.value); } }, LONG_DAYS.map((n, i) => h('option', { value: String(i) }, n)))) : null,
        f.how === 'once' ? h('label', null, 'By (date, optional)', h('input', { key: 'g-due', type: 'date', value: f.dueDate, onInput: set('dueDate') })) : null,
        h('label', null, 'Start on (optional — empty = today)', h('input', { key: 'g-start', type: 'date', min: td, value: f.startDate, onInput: set('startDate') })),
        h('label', { class: 'row' }, h('input', { key: 'g-photo', type: 'checkbox', checked: f.needsPhoto ? true : undefined, onChange: set('needsPhoto') }), ' 📷 Photo needed to finish'),
        h('label', null, '📎 Instruction photos / PDF (optional)', h('input', { key: 'g-files', type: 'file', accept: 'image/*,application/pdf', multiple: true, onChange: (e, el) => { f.files = [...el.files]; } })),
        err,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary small', onClick: () => saveTask({
            id: t ? t.id : 0, assigneeId: Number(f.assigneeId), title: f.title, details: f.details, project: f.project,
            repeat: f.how === 'daily7' ? 'daily' : f.how, skipSunday: f.how === 'daily' || (f.how === 'once' && (!t || t.skipSunday)), weekday: Number(f.weekday), dueDate: f.dueDate,
            projectRef: f.projectRef, stepRef: f.stepRef, needsPhoto: !!f.needsPhoto, startDate: f.startDate || (t && t.startDate && t.startDate > td ? td : ''),
          }, f.files).then((m) => { err.say(m); }) }, editing ? 'Save' : 'Give task'),
          h('button', { class: 'btn small', onClick: () => { state.prefill = null; state.giveForm = null; if (editing) open('task:' + t.id); else if (!(state.fromProjects && toProjects())) back(); } }, 'Cancel')))),
    ];
  }

  function passwordPage() {
    const f = (state.pwForm ||= { old: '', nw: '', again: '' });
    const err = errLine('pwerr');
    return h('div', { class: 'block stack' },
      h('label', null, 'Current password', h('input', { key: 'pw-old', type: 'password', autocomplete: 'current-password', value: f.old, onInput: (e, el) => { f.old = el.value; } })),
      h('label', null, 'New password (8 letters or more)', h('input', { key: 'pw-new', type: 'password', autocomplete: 'new-password', value: f.nw, onInput: (e, el) => { f.nw = el.value; } })),
      h('label', null, 'New password again', h('input', { key: 'pw-again', type: 'password', autocomplete: 'new-password', value: f.again, onInput: (e, el) => { f.again = el.value; } })),
      err,
      h('button', { class: 'btn primary small', onClick: () => changePassword(f.old, f.nw, f.again).then((m) => { err.say(m); if (!m) state.pwForm = null; }) }, 'Change password'));
  }

  function notifyPage() {
    const s = push ? push.state() : 'no';
    const parts = [h('p', null, 'You get a message on this phone, like new email, for:'),
      h('ul', null, ['An update from your team (and when someone is Stuck or Finished)', 'A message or a suggestion from your team'].map((w) => h('li', null, w)))];
    if (s === 'on') {
      parts.push(h('p', { class: 'ok' }, '✓ On for this phone.'), h('div', { class: 'row' },
        h('button', { class: 'btn small', onClick: () => push.test().then(() => toast('🔔 Test sent. It comes in a few seconds.'), (e) => toast(e.message, 5000)) }, 'Send me a test'),
        h('button', { class: 'btn small', onClick: async () => { await push.turnOff(); toast('Notifications are off for this phone.'); render(); } }, 'Turn off')));
    } else if (s === 'default' || s === 'granted') parts.push(h('button', { class: 'btn primary small', onClick: notifyOn }, '🔔 Turn on notifications'));
    else if (s === 'denied') {
      parts.push(h('p', { class: 'warn' }, 'Notifications are blocked for Work Task on this phone. To allow them:'),
        h('ol', null, h('li', null, 'Installed app: press and hold the app icon → App info → Notifications → turn on.'), h('li', null, 'In Chrome: tap ⋮ → Settings → Site settings → Notifications → worktask.in → Allow.'), h('li', null, 'Come back here and open this page again.')));
    } else if (s === 'ios') {
      parts.push(h('p', { class: 'warn' }, 'On iPhone, notifications work only from the Home Screen app:'),
        h('ol', null, h('li', null, 'Open worktask.in in Safari.'), h('li', null, 'Tap Share → Add to Home Screen.'), h('li', null, 'Open it from the Home Screen and turn notifications on here.')));
    } else parts.push(h('p', { class: 'muted' }, 'This browser cannot show notifications.'));
    return h('div', { class: 'block stack' }, parts);
  }

  function list() {
    const titles = { today: 'Team today', followup: '🔁 Follow-up', tasks: state.closed ? 'Done / cancelled' : '✅ Tasks', projects: '📂 Projects', report: '📊 Weekly report', search: '🔍 Search', people: 'People', settings: 'Settings' };
    let title = titles[state.view];
    if (state.view === 'today' && state.personFilter && state.team) { const p = state.team.people.find((x) => x.id === state.personFilter); if (p) title = p.name; }
    const head = h('div', { class: 'list-head' },
      h('button', { class: 'icon menu-btn', 'aria-label': 'Menu', onClick: () => { state.menuOpen = true; render(); } }, '☰'),
      h('h2', null, title),
      state.view === 'search' ? null : h('button', { class: 'icon', title: 'Search', 'aria-label': 'Search', onClick: () => go('search') }, '🔍'), // (as on the owner's list; on a phone the menu has no search box)
      state.view === 'settings' ? null : h('button', { class: 'icon', title: 'Get latest', 'aria-label': 'Refresh', onClick: reload }, '↻'));
    if (!state.data) return h('div', { class: 'col-inner' }, head, bars(), h('p', { class: 'empty-list' }, state.loadFailed ? [state.loadFailed === 'You are offline. Try again when the internet is back.' ? 'No saved copy on this phone yet.' : state.loadFailed, ' ', h('button', { class: 'link', onClick: reload }, 'Try again')] : 'Loading…'));
    const body = state.view === 'followup' ? followupList() : state.view === 'tasks' ? tasksList() : state.view === 'projects' ? projectsList()
      : state.view === 'search' ? searchList() : state.view === 'report' ? reportPage() : state.view === 'people' ? peoplePage() : state.view === 'settings' ? settingsPage() : teamList();
    // "+ Give a task" at the top of the list, as the owner's "+ New task"
    const give = ['today', 'tasks', 'followup', 'projects'].includes(state.view) ? h('button', { class: 'btn primary new-project', onClick: () => open('give') }, '+ Give a task') : null;
    return h('div', { class: 'col-inner' }, head, bars(), give, body);
  }

  function detail() {
    const sel = state.sel;
    if (!sel) return h('div', { class: 'empty' }, h('p', null, 'Pick a task on the left.'), h('p', null, h('button', { class: 'link', onClick: () => open('give') }, '+ Give a task')));
    let title = '', body, dot = '', actions = null;
    if (sel === 'give' || sel.startsWith('edit:')) { title = sel === 'give' ? 'Give a task' : 'Edit task'; body = state.people.length ? taskForm() : h('p', { class: 'muted' }, state.detailFailed || 'Loading…'); }
    else if (sel === 'password') { title = 'Change password'; body = passwordPage(); }
    else if (sel === 'notify') { title = '🔔 Notifications'; body = notifyPage(); }
    else if (!state.detail) body = h('p', { class: 'muted' }, state.detailFailed ? [state.detailFailed, ' ', h('button', { class: 'link', onClick: loadDetail }, 'Try again')] : 'Loading…');
    else if (sel.startsWith('task:')) {
      const t = state.detail.task;
      title = t.title; body = taskPage(); actions = taskActions(t);
      dot = t.status !== 'open' ? 'grey' : t.stuck ? 'red' : t.today ? 'green' : 'yellow';
    } else {
      const all = state.detail.tasks || [];
      title = '📁 ' + ((all[all.length - 1] && all[all.length - 1].project) || 'Project');
      body = projectPage();
    }
    const about = state.detail && sel.startsWith('task:') ? rules.projectAboutOf([state.detail.task]) : state.detail && sel.startsWith('project:') ? rules.projectAboutOf([...(state.detail.tasks || [])].reverse()) : '';
    return h('div', { class: 'detail-inner', key: 'detail-' + sel },
      h('div', { class: 'detail-top' }, h('button', { class: 'icon back', 'aria-label': 'Back', onClick: back }, '←'), dot ? h('span', { class: 'dot ' + dot, 'aria-label': dot }) : null, h('h2', null, title), actions ? h('div', { class: 'state-buttons' }, actions) : null), // (the buttons under the title, as on the owner's page)
      about ? h('p', { class: 'muted' }, (sel.startsWith('task:') ? '📁 ' : '') + about) : null,
      body);
  }

  function view() {
    const wide = WIDE.includes(state.view) || (state.view === 'today' && !state.sel && !!state.data); // Team today's table fills the screen until a task is open
    return h('div', { class: ['layout', 'staff', 'team', wide ? 'wide' : '', state.mobile === 'detail' && !wide ? 'show-detail' : '', state.menuOpen ? 'menu-open' : ''].join(' ').replace(/\s+/g, ' ').trim() },
      h('aside', { id: 'menu' }, menu()),
      h('div', { class: 'scrim', onClick: () => { state.menuOpen = false; render(); } }),
      h('main', { id: 'list' }, list()),
      wide ? null : h('section', { id: 'detail' }, detail()));
  }

  // the phone's Back button closes the menu, then the page on the right (never leaves the app)
  const backSync = phoneBack(opts.win !== undefined ? opts.win : (typeof window !== 'undefined' ? window : null),
    () => !state.hidden && (state.menuOpen || (state.mobile === 'detail' && !!state.sel)),
    () => { if (state.menuOpen) { state.menuOpen = false; render(); } else back(); });
  function render() {
    if (!root || state.hidden) return;
    const next = view();
    if (root.firstChild && root.firstChild.classList && root.firstChild.classList.contains('team')) morph(root.firstChild, next);
    else root.replaceChildren(next);
    backSync();
  }

  return { state, render, go, open, act, view, start, setOffline, refreshOutbox };
}
