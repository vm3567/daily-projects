// Daily Projects — main app: start-up, menu, project list, Today box, Diary, Settings, key screen.

import { h, morph, installEvents, fmtDay, fmtLongDay, fmtTime, keyHint, withKey } from './ui/dom.js';
import { renderDetail } from './ui/detail.js';
import { renderPeopleList, renderPerson, peopleByFollowUp } from './ui/people.js';
import { installMentions } from './ui/mention.js';
import { renderDashboard } from './ui/dashboard.js';
import { closeViewer, uploadBlob } from './ui/files.js';
import { Store } from './store.js';
import { GitHubRepo } from './github.js';
import { MockRepo } from './mockrepo.js';
import { device } from './device.js';
import { DATA_OWNER, DATA_REPO, DATA_BRANCH, REFRESH_MS, AI_DAILY_LIMIT, BRIEF_CLAIM_MINUTES, WAIT_RED_DAYS, NO_WORK_NOTE_DAYS } from './config.js';
import { dotColour, nextStep, todayIndia, isSundayIndia, colourCounts, isOverdue, indiaDate, waitingDays, daysWithoutWork, dayScore, greenStreak, addDays, monthOf } from './rules.js';
import { newId, clone, opMonth } from './ops.js';
import * as ai from './ai.js';

const root = document.getElementById('app');
const isMock = new URLSearchParams(location.search).has('mock')
  && ['localhost', '127.0.0.1'].includes(location.hostname);

const saved = device.ui();
const ui = {
  view: saved.view || 'today', // today | all | group:<id> | paused | finished | diary | settings
  selected: saved.selected || null,
  search: '',
  mobile: 'list', // list | detail (phone only)
  menuOpen: false,
  briefFolded: !!saved.briefFolded,
  sort: saved.sort === 'red' ? 'red' : 'mine', // 'mine' = my drag order, 'red' = red first
  adding: false,
  openStep: null,
  showDone: false,
  ai: null,
  brief: { busy: false, error: '' },
  diaryDays: 14,
};

let store = null;
let toastTimer = null;

/** Message at the bottom. With `undo`, it shows an Undo button and stays a little longer. */
function toast(text, ms = 3500, undo = null) {
  const t = document.getElementById('toast');
  const parts = [h('span', null, text)];
  if (undo) parts.push(h('button', { class: 'toast-undo', onClick: () => { t.hidden = true; undo(); } }, 'Undo'));
  t.replaceChildren(...parts); // (replaceChildren would print "null" for an empty slot)
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? Math.max(ms, 6000) : ms);
}

/**
 * Several changes to one project as ONE action with one Undo (e.g. note + tick + next step).
 * `steps` is a list of [type, args]. Returns the ops that were applied, or null.
 */
function actMany(projectId, steps, message) {
  const list = store.view.data.projects;
  const index = list.findIndex((x) => x.id === projectId);
  const before = index >= 0 ? clone(list[index]) : null;
  const ops = [];
  for (const [type, args] of steps) { const op = store.dispatch(type, args); if (op) ops.push(op); }
  if (!ops.length) return null;
  const undo = before ? () => {
    const months = [...new Set(ops.map(opMonth))];
    if (store.dispatch('restoreProject', { project: before, index, undoOpIds: ops.map((o) => o.id), undoMonth: months[0] })) toast('Undone', 1500);
  } : null;
  if (message) toast(message, 5000, undo);
  return ops;
}

/**
 * Do one change to a project and offer Undo. Undo puts the whole project back as it was
 * (dot colour included) and removes that change's line from the history.
 * Returns { op, undo } or null if nothing changed.
 */
function act(type, args, message, ms = 4000) {
  const list = store.view.data.projects;
  const index = list.findIndex((x) => x.id === args.projectId);
  const before = index >= 0 ? clone(list[index]) : null;
  const op = store.dispatch(type, args);
  if (!op) return null;
  const undo = before ? () => {
    if (store.dispatch('restoreProject', { project: before, index, undoOpId: op.id, undoMonth: opMonth(op) })) toast('Undone', 1500);
  } : null;
  if (message) toast(message, ms, undo);
  return { op, undo };
}

function rememberUi() {
  device.setUi({ view: ui.view, selected: ui.selected, briefFolded: ui.briefFolded, sort: ui.sort });
}

const ctx = {
  get store() { return store; },
  ui,
  toast,
  render: () => render(),
  aiSuggest: (p) => runAi(p, 'next'),
  aiSteps: (p) => runSuggest(p),
  goSettings: () => go('settings'),
  draftFollowUp: (p, s) => draftFollowUp(p, s),
  openSummary: () => openSummary(),
  openPerson: (id) => { go('people'); ctx.selectPerson(id); },
  aiBreakdown: (p, goal) => runAi(p, 'breakdown', goal),
  hasAiKey: () => !!(store && aiReady().key),
  toggleOk: (p) => toggleOk(p),
  act: (type, args, message) => act(type, args, message),
  actMany: (projectId, steps, message) => actMany(projectId, steps, message),
  chase: (p, s) => chase(p, s),
  afterTick: (id, where, undo) => afterTick(id, where, undo),
  selectPerson: (id) => { ui.person = id; ui.mobile = 'detail'; render(); const d = document.getElementById('detail'); if (d) d.scrollTop = 0; },
  openProject: (id) => {
    const p = store.view.data.projects.find((x) => x.id === id);
    if (!p) return;
    ui.view = p.state === 'active' ? 'all' : p.state; // 'paused' or 'finished'
    ui.search = '';
    rememberUi();
    select(id);
  },
};

// ---------------------------------------------------------------- AI

/** AI key: the one shared through my private data (newest, same on every device), else one saved only here. */
function aiKeyFor(provider) {
  const shared = store && store.view && store.view.data.secrets && store.view.data.secrets[provider];
  return shared || device.aiKey(provider) || '';
}

/** Keys saved only on this device (from before keys were shared) are uploaded once, so other devices get them. */
function shareLocalKeys() {
  if (!store || !store.canEdit()) return;
  const shared = store.view.data.secrets || {};
  for (const provider of ['claude', 'gemini']) {
    const local = device.aiKey(provider);
    if (local && !shared[provider]) store.dispatch('setAiKey', { provider, key: local }); // never overwrite a shared key
  }
}

function aiReady() {
  const provider = store.view.data.settings.aiProvider || 'claude';
  return { provider, key: aiKeyFor(provider) };
}

/** Count one AI use. Returns false if the daily limit is reached. */
function useAi() {
  const u = store.view.data.aiUsage;
  if (u.date === todayIndia() && u.count >= AI_DAILY_LIMIT) return false;
  return !!store.dispatch('incrementAiUsage', {});
}

async function runAi(p, mode, goal = '') {
  if (mode === 'suggest') { await runSuggest(p); return; }
  const { provider, key } = aiReady();
  if (!key) { ui.ai = { projectId: p.id, mode, state: 'error', error: 'Add an AI key in Settings.' }; render(); return; }
  if (!useAi()) { ui.ai = { projectId: p.id, mode, state: 'error', error: 'Daily AI limit reached — try tomorrow.' }; render(); return; }
  ui.ai = { projectId: p.id, mode, state: 'busy', goal };
  render();
  try {
    const steps = mode === 'breakdown'
      ? await ai.breakIntoSteps(provider, key, p, goal)
      : await ai.suggestNextSteps(provider, key, p);
    ui.ai = { projectId: p.id, mode, state: 'list', steps, picked: steps.map(() => mode === 'breakdown'), goal };
  } catch (e) {
    ui.ai = { projectId: p.id, mode, state: 'error', error: e.message };
  }
  render();
}

function claimIsFresh(b) {
  return b.status === 'pending' && (Date.now() - Date.parse(b.claimedAt)) / 60000 < BRIEF_CLAIM_MINUTES;
}

/** ✨ AI steps: read the project and suggest the next steps, in order. Tries the other AI if one fails. */
async function runSuggest(p) {
  const chosen = store.view.data.settings.aiProvider || 'claude';
  const order = [chosen, chosen === 'claude' ? 'gemini' : 'claude'].filter((x) => aiKeyFor(x));
  if (!order.length) { ui.ai = { projectId: p.id, mode: 'suggest', state: 'nokey' }; render(); return; }
  if (!useAi()) { ui.ai = { projectId: p.id, mode: 'suggest', state: 'error', error: 'Daily AI limit reached — try tomorrow.' }; render(); return; }
  ui.ai = { projectId: p.id, mode: 'suggest', state: 'busy' };
  render();
  let lastError = null;
  for (const provider of order) {
    try {
      const steps = await ai.suggestSteps(provider, aiKeyFor(provider), p);
      ui.ai = { projectId: p.id, mode: 'suggest', state: 'list', steps, picked: steps.map(() => true), provider };
      render();
      return;
    } catch (e) { lastError = e; }
  }
  ui.ai = { projectId: p.id, mode: 'suggest', state: 'error', error: lastError ? lastError.message : 'The AI did not answer.' };
  render();
}

/** Run an AI job with the chosen AI first, the other one if it fails. Counts one AI use. */
async function withAi(job) {
  const chosen = store.view.data.settings.aiProvider || 'claude';
  const order = [chosen, chosen === 'claude' ? 'gemini' : 'claude'].filter((x) => aiKeyFor(x));
  if (!order.length) throw new Error('Add a Claude or Gemini key in Settings first.');
  if (!useAi()) throw new Error('Daily AI limit reached — try tomorrow.');
  let last = null;
  for (const provider of order) {
    try { return await job(provider, aiKeyFor(provider)); } catch (e) { last = e; }
  }
  throw last || new Error('The AI did not answer.');
}

// ---------------------------------------------------------------- message sheet
// A white panel over the page with an editable text, and Copy / WhatsApp / Email buttons.

function openSheet({ title, text, busy = false, error = '', extra = null, subject = 'Update' }) {
  const v = document.getElementById('viewer');
  v.hidden = false;
  v.classList.add('sheet-mode');
  const area = h('textarea', { class: 'sheet-text', rows: 12, 'aria-label': title });
  area.value = text || '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(area.value); toast('Copied ✓ — paste it in WhatsApp or email', 2500); }
    catch { area.select(); document.execCommand && document.execCommand('copy'); toast('Copied ✓', 2000); }
  };
  const wa = () => window.open(`https://wa.me/?text=${encodeURIComponent(area.value)}`, '_blank', 'noopener');
  const mail = () => { location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(area.value)}`; };
  v.replaceChildren(
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-head' }, h('strong', null, title), h('button', { class: 'icon', 'aria-label': 'Close', onClick: closeSheet }, '✕')),
      busy ? h('p', { class: 'muted' }, 'Writing…') : error ? h('p', { class: 'error' }, error) : area,
      busy || error ? null : h('p', { class: 'muted small' }, 'You can change the words before sending.'),
      h('div', { class: 'row sheet-actions' },
        busy || error ? null : h('button', { class: 'btn primary', onClick: copy }, '📋 Copy'),
        busy || error ? null : h('button', { class: 'btn wa', onClick: wa }, 'WhatsApp'),
        busy || error ? null : h('button', { class: 'btn', onClick: mail }, '✉ Email'),
        extra)));
  if (!busy && !error) setTimeout(() => area.focus(), 30);
}

function closeSheet() {
  const v = document.getElementById('viewer');
  v.classList.remove('sheet-mode');
  closeViewer();
}

/** ✍ Draft a follow-up message for a waiting step. */
async function draftFollowUp(p, step) {
  const title = `Message to ${step.waitingOn || 'follow up'}`;
  openSheet({ title, busy: true });
  try {
    const text = await withAi((provider, key) => ai.draftFollowUp(provider, key, { person: step.waitingOn, step, project: p, days: waitingDays(step) }));
    openSheet({
      title, text, subject: step.text,
      extra: h('button', { class: 'btn', title: 'Saves a work note and restarts the waiting count', onClick: () => { chase(p, step); closeSheet(); } }, 'Mark as chased'),
    });
  } catch (e) {
    openSheet({ title, error: e.message });
  }
}

/** 📋 Everything done today, grouped by project, ready to send. */
function todaySummaryText() {
  const { data, history } = store.view;
  const today = todayIndia();
  const events = (history[monthOf(today)] || []).filter((e) => indiaDate(e.at) === today && e.projectId);
  const byProject = new Map();
  const entry = (pid) => { if (!byProject.has(pid)) byProject.set(pid, { done: [], notes: [] }); return byProject.get(pid); };
  for (const e of events) if (e.kind === 'step_ticked') entry(e.projectId).done.push(e.detail);
  for (const p of data.projects) for (const n of p.workNotes) if (indiaDate(n.createdAt) === today) entry(p.id).notes.push(n.text);
  const dateText = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());
  const lines = [`Daily update — ${dateText}`];
  let doneCount = 0;
  const blocks = [];
  for (const [pid, x] of byProject) {
    const p = data.projects.find((q) => q.id === pid);
    if (!p || (!x.done.length && !x.notes.length)) continue;
    doneCount += x.done.length;
    const b = [`• ${p.name}`];
    for (const d of x.done) b.push(`   ✅ ${d}`);
    for (const n of x.notes) b.push(`   📝 ${n}`);
    const ns = p.state === 'active' && nextStep(p, today, { dueOnly: true });
    if (ns) b.push(`   → Next: ${ns.text}`);
    blocks.push(b.join('\n'));
  }
  if (!blocks.length) return `${lines[0]}\n\nNothing recorded yet today.`;
  lines.push(`${doneCount} step${doneCount === 1 ? '' : 's'} done across ${blocks.length} project${blocks.length === 1 ? '' : 's'}.`, '', ...blocks);
  const waiting = peopleByFollowUp(data).filter((x) => x.st.waiting);
  if (waiting.length) lines.push('', `⏳ Waiting on: ${waiting.map((x) => x.person.name).join(', ')}`);
  return lines.join('\n');
}

function openSummary() {
  const text = todaySummaryText();
  const polish = h('button', {
    class: 'btn ai',
    onClick: async () => {
      const current = document.querySelector('.sheet-text');
      const base = current ? current.value : text;
      openSheet({ title: "Today's summary", busy: true });
      try {
        const better = await withAi((provider, key) => ai.polishSummary(provider, key, base));
        openSheet({ title: "Today's summary", text: better, subject: 'Daily update' });
      } catch (e) { openSheet({ title: "Today's summary", text: base, subject: 'Daily update' }); toast(e.message); }
    },
  }, '✨ Shorter with AI');
  openSheet({ title: "Today's summary", text, subject: 'Daily update', extra: polish });
}

function briefKind() {
  return isSundayIndia() ? 'weekly' : 'morning';
}

/** Make today's Morning plan (or Sunday's Weekly review) if no device has made it yet. */
async function makeBrief(force = false) {
  if (!store || !store.base || ui.brief.busy) return;
  if (!force && ui.brief.error) return; // after a failure, only retry when ↻ is tapped (saves AI uses)
  const kind = briefKind();
  const today = todayIndia();
  const b = store.view.data.aiBriefs[kind];
  if (!force && b && b.date === today && (b.status === 'ready' || claimIsFresh(b))) return;
  const { provider, key } = aiReady();
  if (!key) return;
  if (!store.view.data.projects.some((p) => p.state === 'active')) return;
  if (store.view.data.aiUsage.date === today && store.view.data.aiUsage.count >= AI_DAILY_LIMIT) {
    if (force) toast('Daily AI limit reached — try tomorrow.');
    return;
  }
  ui.brief = { busy: true, error: '' };
  render();
  try {
    const claim = store.dispatch('claimBrief', { kind, date: today, force });
    if (!claim) return;
    await store.flush();
    const now = store.view.data.aiBriefs[kind];
    if (!now || now.claimId !== claim.id) return; // another device is making it
    if (!useAi()) return;
    if (kind === 'weekly') await store.loadAllHistory();
    const content = kind === 'weekly'
      ? await ai.weeklyReview(provider, key, store.view.data, store.view.history)
      : await ai.morningPlan(provider, key, store.view.data);
    store.dispatch('setBriefReady', { kind, date: today, content });
  } catch (e) {
    ui.brief.error = e.message;
  } finally {
    ui.brief.busy = false;
    render();
  }
}

// ---------------------------------------------------------------- lists

function groupName(id) {
  const g = store.view.data.groups.find((x) => x.id === id);
  return g ? g.name : '';
}

function matches(p, q) {
  const hay = [p.name, p.notes, ...p.steps.map((s) => `${s.text} ${s.note} ${s.waitingOn}`), ...p.workNotes.map((n) => n.text)]
    .join('\n').toLowerCase();
  return hay.includes(q);
}

function visibleProjects() {
  const all = store.view.data.projects;
  const q = ui.search.trim().toLowerCase();
  if (q) return all.filter((p) => matches(p, q));
  if (ui.view === 'today' || ui.view === 'all') return all.filter((p) => p.state === 'active');
  if (ui.view === 'paused') return all.filter((p) => p.state === 'paused');
  if (ui.view === 'finished') return all.filter((p) => p.state === 'finished');
  if (ui.view.startsWith('group:')) {
    const id = ui.view.slice(6);
    return all.filter((p) => p.groupId === id && p.state === 'active');
  }
  return [];
}

function viewTitle() {
  if (ui.search.trim()) return `Search: "${ui.search.trim()}"`;
  if (ui.view.startsWith('group:')) return groupName(ui.view.slice(6));
  return { today: 'Today', all: 'All projects', paused: 'Paused', finished: 'Finished', diary: 'Diary', settings: 'Settings', people: 'People', dashboard: 'Dashboard' }[ui.view];
}

function go(view) {
  ui.view = view;
  ui.round = null;
  resetRedOrder();
  ui.search = '';
  ui.menuOpen = false;
  ui.mobile = 'list';
  rememberUi();
  render();
}

/** First open of the day turns a red dot yellow. */
function markOpened(id) {
  const p = store && store.view && store.view.data.projects.find((x) => x.id === id);
  if (!p || p.state !== 'active' || p.lastOpenedDate === todayIndia() || dotColour(p) === 'green') return;
  if (store.canEdit()) store.dispatch('markOpened', { projectId: id });
}

/** Save the green score of each of the last 7 days that has none yet (one save, once a day). */
async function recordPastScores() {
  if (!store || !store.base || !store.canEdit()) return;
  const today = todayIndia();
  const saved = store.view.data.dayScores || {};
  const days = [];
  for (let i = 1; i <= 7; i++) { const d = addDays(today, -i); if (!saved[d]) days.push(d); }
  if (!days.length || !store.view.data.projects.length) return;
  const months = [...new Set(days.map(monthOf))].filter((m) => !store.view.history[m] && store.availableMonths().includes(m));
  for (const m of months) await store.loadMonth(m);
  const scores = {};
  for (const d of days) {
    const sc = dayScore(store.view.data, store.view.history, d);
    if (sc.total) scores[d] = sc;
  }
  if (Object.keys(scores).length) store.dispatch('recordScores', { scores });
}

function todayScore() {
  const today = todayIndia();
  const active = store.view.data.projects.filter((p) => p.state === 'active');
  return { green: active.filter((p) => dotColour(p, today) === 'green').length, total: active.length };
}

/** Leaving the app or the tab: save whatever is being typed right now (it is kept on the device until it reaches GitHub). */
function saveTypedText() {
  const el = document.activeElement;
  if (el && (el.nodeName === 'TEXTAREA' || el.nodeName === 'INPUT')) el.dispatchEvent(new Event('change', { bubbles: true }));
  if (store && store.pending.length) store.flush();
}

/** The project in the right column counts as opened, if that column is on screen. */
function markShownOpened() {
  if (!ui.selected || (ui.view === 'people' && !ui.search)) return;
  const detail = document.getElementById('detail');
  if (detail && detail.offsetParent !== null) { markOpened(ui.selected); }
}

/** "OK for today" (or undo it). */
function toggleOk(p) {
  const today = todayIndia();
  if (p.okDate === today) {
    store.dispatch('undoOkForToday', { projectId: p.id });
    return;
  }
  act('okForToday', { projectId: p.id }, `✓ ${p.name}: OK for today`);
}

function select(id) {
  const list = currentList();
  const at = list.findIndex((x) => x.id === id);
  if (at >= 0) ui.listIndex = at; // remembered, so ↓ ↑ keep your place if this row folds away
  if (ui.selected !== id) {
    ui.selected = id;
    ui.openStep = null;
    ui.showDone = false;
    ui.historyLimit = 30;
    ui.notesLimit = 3;
    ui.openParts = {};
    ui.editMeta = false;
    if (ui.ai && ui.ai.projectId !== id) ui.ai = null;
  }
  ui.mobile = 'detail';
  rememberUi();
  markOpened(id);
  render();
  const d = document.getElementById('detail');
  if (d) d.scrollTop = 0;
}

// ---------------------------------------------------------------- menu

function renderMenu() {
  const { data } = store.view;
  const active = data.projects.filter((p) => p.state === 'active');
  const count = (f) => data.projects.filter(f).length;
  const MENU_KEYS = { today: 'T', dashboard: 'B', people: 'P', diary: 'D' };
  const item = (view, label, n, extra) => h('li', { key: 'm-' + view },
    h('button', { class: 'menu-item' + (ui.view === view && !ui.search ? ' current' : ''), onClick: () => go(view) },
      h('span', null, label, MENU_KEYS[view] ? keyHint(MENU_KEYS[view]) : null), n !== undefined ? h('span', { class: 'count' }, String(n)) : null),
    extra || null);
  const today = todayIndia();
  const counts = colourCounts(data, today);

  return h('nav', { class: 'menu-inner' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 28, height: 28 }), h('span', null, 'Daily Projects')),
    h('input', {
      class: 'search', type: 'search', placeholder: withKey('Search…', '/'), value: ui.search, key: 'search-desktop', 'aria-label': 'Search',
      onInput: (e, el) => { ui.search = el.value; render(); },
    }),
    h('ul', { class: 'menu-list' },
      item('today', 'Today', active.length),
      h('li', { class: 'menu-dots', key: 'dots' },
        h('span', { class: 'dot red' }), String(counts.red), ' ',
        h('span', { class: 'dot yellow' }), String(counts.yellow), ' ',
        h('span', { class: 'dot green' }), String(counts.green)),
      item('dashboard', 'Dashboard'),
      item('all', 'All projects', active.length),
      h('li', { class: 'menu-head', key: 'groups-head' }, 'Groups'),
      data.groups.map((g) => item('group:' + g.id, g.name, count((p) => p.groupId === g.id && p.state === 'active'),
        h('button', {
          class: 'icon tiny', title: `Rename or delete "${g.name}"`,
          onClick: () => editGroup(g),
        }, '✎'))),
      h('li', { key: 'add-group' }, h('button', { class: 'menu-item add', onClick: addGroup }, '+ Group')),
      h('li', { class: 'menu-sep', key: 'sep' }),
      item('paused', 'Paused', count((p) => p.state === 'paused')),
      item('finished', 'Finished', count((p) => p.state === 'finished')),
      item('people', 'People', (data.people || []).length),
      item('diary', 'Diary'),
      item('settings', 'Settings')),
    h('button', { class: 'keys-hint', onClick: () => { ui.showKeys = true; ui.menuOpen = false; render(); } }, 'Keyboard shortcuts: press ?'));
}

function addGroup() {
  const name = prompt('Name of the new group:');
  if (name && name.trim()) store.dispatch('addGroup', { groupId: newId(), name: name.trim() });
}

function editGroup(g) {
  const used = store.view.data.projects.some((p) => p.groupId === g.id);
  const name = prompt(`Rename the group "${g.name}".${used ? '' : '\n\nTo delete this empty group, type DELETE.'}`, g.name);
  if (name === null) return;
  if (!used && name.trim() === 'DELETE') {
    if (store.view.data.groups.length <= 1) { toast('You need at least one group.'); return; }
    store.dispatch('deleteGroup', { groupId: g.id });
    if (ui.view === 'group:' + g.id) go('today');
    return;
  }
  if (name.trim() === 'DELETE') { toast('Only an empty group can be deleted. Move its projects first.'); return; }
  store.dispatch('renameGroup', { groupId: g.id, name: name.trim() });
}

// ---------------------------------------------------------------- Today box

function renderBrief() {
  const kind = briefKind();
  const today = todayIndia();
  const b = store.view.data.aiBriefs[kind];
  const title = kind === 'weekly' ? 'Weekly review' : 'Morning plan';
  const ready = b && b.date === today && b.status === 'ready' && b.content;
  const { key } = aiReady();
  if (!key && !ready) return null; // no AI on this device yet: don't take space
  let body;
  if (ui.brief.error && !ui.brief.busy) body = h('p', { class: 'error' }, `${ui.brief.error} Tap ↻ to try again.`);
  else if (ui.brief.busy || (b && b.date === today && claimIsFresh(b))) body = h('p', { class: 'muted' }, 'Making today\'s plan…');
  else if (!ready) {
    body = h('p', { class: 'muted' }, key
      ? 'No plan yet. Tap ↻ to make one.'
      : 'No plan yet — open on a device with an AI key, or add a key in Settings.');
  } else if (kind === 'weekly') {
    const part = (label, list) => (list.length ? h('div', null, h('strong', null, label), h('ul', null, list.map((t) => h('li', null, t)))) : null);
    body = h('div', null, part('What moved', b.content.moved || []), part('What is stuck', b.content.stuck || []), part('What to fix', b.content.fix || []));
  } else {
    const items = b.content.items || [];
    body = items.length
      ? h('ol', null, items.map((it) => h('li', null,
        it.projectId && store.view.data.projects.some((p) => p.id === it.projectId)
          ? h('button', { class: 'link', onClick: () => select(it.projectId) }, it.text)
          : it.text)))
      : h('p', { class: 'muted' }, 'Nothing planned.');
  }
  return h('div', { class: 'brief', key: 'brief' },
    h('div', { class: 'brief-head' },
      h('button', {
        class: 'link brief-toggle', 'aria-expanded': String(!ui.briefFolded),
        onClick: () => { ui.briefFolded = !ui.briefFolded; rememberUi(); render(); },
      }, `${ui.briefFolded ? '▸' : '▾'} ✨ ${title}`),
      key ? h('button', { class: 'icon', title: 'Make again (1 AI use)', onClick: () => makeBrief(true) }, '↻') : null),
    ui.briefFolded ? null : body);
}

// ---------------------------------------------------------------- project list

function projectRow(p, today) {
  const colour = dotColour(p, today);
  const ns = nextStep(p, today); // shown as "Next:"
  const due = nextStep(p, today, { dueOnly: true }); // what the tick box ticks
  const canTick = due && p.state === 'active';
  return h('li', { key: 'p-' + p.id, 'data-id': p.id, class: 'prow' + (ui.selected === p.id ? ' current' : '') },
    canTick
      ? h('input', {
        type: 'checkbox', class: 'quick-tick', key: 'qt-' + p.id + '-' + due.id,
        title: `Tick: ${due.text}`, 'aria-label': `Tick next step of ${p.name}: ${due.text}`,
        onChange: (e, el) => quickTick(p, due, el),
      })
      : p.state === 'active'
        ? h('button', {
          class: 'quick-add', title: 'Add the first step', 'aria-label': `Add a step to ${p.name}`,
          onClick: () => { ui.quickAdd = ui.quickAdd === p.id ? null : p.id; render(); focusKey('qa-' + p.id); },
        }, '+')
        : h('span', { class: 'quick-tick-space', 'aria-hidden': 'true' }),
    h('button', { class: 'prow-btn', onClick: () => select(p.id) },
      h('span', { class: `dot ${colour}`, 'aria-label': colour }),
      h('span', { class: 'prow-text' },
        h('span', { class: 'prow-name' }, p.name,
          p.state !== 'active' ? h('span', { class: 'tag' }, p.state) : null,
          p.priority === 'high' ? h('span', { class: 'tag high' }, 'High') : null),
        h('span', { class: 'prow-next' + (ns ? '' : ' warn') }, ns ? `Next: ${ns.text}` : 'No next step — add one',
          ns && ns.waiting ? waitingTag(ns) : null,
          ns && ns.snoozedUntil && ns.snoozedUntil > today ? h('span', { class: 'tag repeat' }, `↻ from ${fmtDay(ns.snoozedUntil)}`) : null,
          isOverdue(p, today) ? h('span', { class: 'tag late' }, `Overdue · ${fmtDay(p.deadline)}`) : null,
          noWorkTag(p, today)))),
    rowAction(p, due, colour),
    canDrag() ? h('span', { class: 'grip', 'aria-hidden': 'true', title: 'Drag to reorder' }, '⋮⋮') : null,
    ui.quickAdd === p.id ? quickAddForm(p) : null);
}

/** One-tap action on a row that is not green yet: "Chased" for a waiting step, else "✓ OK". */
function rowAction(p, ns, colour) {
  if (p.state !== 'active' || colour === 'green') return null;
  if (ns && ns.waiting) {
    return h('button', { class: 'row-act chase', title: `Followed up${ns.waitingOn ? ' with ' + ns.waitingOn : ''} today`, onClick: () => chase(p, ns) }, 'Chased');
  }
  return h('button', { class: 'row-act', title: 'OK for today (nothing more today)', onClick: () => toggleOk(p) }, '✓ OK');
}

function chase(p, step) {
  act('chased', { projectId: p.id, stepId: step.id }, `Noted: followed up${step.waitingOn ? ' with ' + step.waitingOn : ''}. Waiting count restarted.`);
}

/** After ticking: if the project has no next step left, ask "What's next?" straight away. */
function afterTick(projectId, where, undo = null) {
  const p = store.view.data.projects.find((x) => x.id === projectId);
  if (!p || p.state !== 'active' || nextStep(p, todayIndia(), { dueOnly: true })) return false;
  if (where === 'detail' || (ui.view === 'today' && !ui.search)) {
    // On Today the now-green row folds away, so ask in the project page instead.
    if (ui.selected !== p.id || where !== 'detail') select(p.id);
    focusKey('add-step-' + p.id);
  } else {
    ui.quickAdd = p.id;
    render();
    focusKey('qa-' + p.id);
  }
  toast(`What's next for "${p.name}"? Type it and press Enter.`, 5000, undo);
  return true;
}

/** The small "+ add a step" box that opens under a row with no steps. */
function quickAddForm(p) {
  return h('form', {
    class: 'quick-add-form', key: 'qaf-' + p.id,
    onSubmit: (e) => {
      e.preventDefault();
      const input = e.target.elements.text;
      const text = input.value.trim();
      if (!text) return;
      if (store.dispatch('addStep', { projectId: p.id, stepId: newId(), text })) {
        ui.quickAdd = null;
        toast(`Added to ${p.name}: ${text}`, 3000);
        render();
      }
    },
  },
  h('input', {
    name: 'text', key: 'qa-' + p.id, placeholder: 'First step, then press Enter', autocomplete: 'off',
    enterkeyhint: 'done', 'data-mention': '1',
    // Close when leaving an empty box (Esc leaves the box too).
    onFocusout: (e, el) => setTimeout(() => {
      if (ui.quickAdd === p.id && !el.value.trim() && document.activeElement !== el) { ui.quickAdd = null; render(); }
    }, 200),
  }),
  h('button', { class: 'btn primary small', type: 'submit' }, 'Add'));
}

/** "No real work for 6 days" — so nothing hides behind "OK for today". */
function noWorkTag(p, today) {
  if (p.state !== 'active') return null;
  const d = daysWithoutWork(p, today);
  return d >= NO_WORK_NOTE_DAYS ? h('span', { class: 'tag stale' }, `No real work for ${d} days`) : null;
}

/** "Waiting: Ravi · 4d" — red once it is time to chase. */
function waitingTag(step) {
  const d = waitingDays(step);
  const who = step.waitingOn ? `Waiting: ${step.waitingOn}` : 'Waiting';
  return h('span', { class: 'tag waiting' + (d >= WAIT_RED_DAYS ? ' late' : '') }, d ? `${who} · ${d}d` : who);
}

/** Today screen: people to contact (red, then orange). Tap a name to open their page. */
function followUpRow() {
  const list = peopleByFollowUp(store.view.data).filter((x) => x.st.colour !== 'green');
  if (!list.length) return null;
  return h('div', { class: 'follow-up', key: 'follow-up' },
    h('div', { class: 'follow-up-title' }, 'Follow up today'),
    h('div', { class: 'follow-up-chips' }, list.map(({ person, st }) => h('button', {
      class: 'person-chip', key: 'fu-' + person.id,
      title: st.colour === 'red' ? 'Time to contact' : 'Something open',
      onClick: () => { ui.view = 'people'; ui.search = ''; rememberUi(); ctx.selectPerson(person.id); },
    }, h('span', { class: `dot ${st.colour}` }), `${person.name} (${st.open})`))));
}

function canDrag() {
  return !ui.search && ui.sort === 'mine';
}

/** Tick a project's next step straight from the list. */
function quickTick(p, step, el) {
  el.checked = true;
  const done = act('tickStep', { projectId: p.id, stepId: step.id });
  if (!done) { el.checked = false; return; }
  const after = store.view.data.projects.find((x) => x.id === p.id);
  const next = after && nextStep(after, todayIndia(), { dueOnly: true });
  if (next) toast(`✓ ${step.text}. Next: ${next.text}`, 4500, done.undo);
  else afterTick(p.id, 'list', done.undo);
}

const COLOUR_ORDER = { red: 0, yellow: 1, green: 2, grey: 3 };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/** "Red first": red, then yellow, then green; high priority first within each; else my order. */
let redOrder = null; // fixed "Red first" order, so rows do not jump while you open and tick them

function resetRedOrder() { redOrder = null; }

function sortForView(list, today) {
  if (ui.sort !== 'red' || ui.search) return list;
  const ids = list.map((p) => p.id);
  if (redOrder && redOrder.view === ui.view && ids.length === redOrder.ids.length && ids.every((id) => redOrder.pos.has(id))) {
    return [...list].sort((a, b) => redOrder.pos.get(a.id) - redOrder.pos.get(b.id));
  }
  const sorted = computeRedFirst(list, today);
  redOrder = { view: ui.view, ids: sorted.map((p) => p.id), pos: new Map(sorted.map((p, i) => [p.id, i])) };
  return sorted;
}

function computeRedFirst(list, today) {
  return list
    .map((p, i) => ({ p, i, c: COLOUR_ORDER[dotColour(p, today)], r: PRIORITY_ORDER[p.priority] ?? 1 }))
    .sort((a, b) => a.c - b.c || a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}

function sortSwitch() {
  const opt = (value, label) => h('button', {
    class: 'seg' + (ui.sort === value ? ' on' : ''), 'aria-pressed': String(ui.sort === value),
    onClick: () => { ui.sort = value; resetRedOrder(); rememberUi(); render(); },
  }, label);
  return h('div', { class: 'segmented', role: 'group', 'aria-label': 'Order (key R)' }, opt('mine', 'My order'), opt('red', 'Red first'), keyHint('R'));
}

/** Big "All green" message on Today when every active project is green. */
function celebration() {
  const sc = todayScore();
  if (!sc.total || sc.green < sc.total) return null;
  const n = greenStreak(store.view.data.dayScores || {}, sc);
  return h('div', { class: 'celebrate', key: 'celebrate' },
    h('div', { class: 'celebrate-big' }, `🎉 All ${sc.total} projects green!`),
    h('div', null, n > 1 ? `${n} days in a row. Keep it going!` : 'Every project got your attention today.'),
    h('button', { class: 'link small', onClick: () => go('dashboard') }, 'See your dashboard →'));
}

function streakBadge() {
  const n = greenStreak(store.view.data.dayScores || {}, todayScore());
  return n >= 1 ? h('span', { class: 'streak', title: 'Days in a row with every project green' }, ` · 🔥 ${n} day${n > 1 ? 's' : ''} all green`) : null;
}

/** Last 7 days: how many projects were green each day (today is live). */
function weekBars() {
  const today = todayIndia();
  const saved = store.view.data.dayScores || {};
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(today, -i));
  const wd = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' });
  return h('div', { class: 'week', key: 'week' },
    h('div', { class: 'week-title' }, 'Last 7 days — projects green each day'),
    h('div', { class: 'week-bars' }, days.map((d) => {
      const sc = d === today ? todayScore() : saved[d];
      const pct = sc && sc.total ? Math.round((sc.green / sc.total) * 100) : 0;
      const fill = h('div', { class: 'week-fill' + (pct === 100 ? ' full' : '') });
      fill.style.height = `${Math.max(pct, sc && sc.total ? 4 : 0)}%`; // style object (allowed by the page's safety rules)
      return h('div', { class: 'week-day', key: 'wk-' + d, title: sc ? `${sc.green} of ${sc.total} green` : 'No data' },
        h('div', { class: 'week-bar' }, fill),
        h('div', { class: 'week-num' }, sc && sc.total ? `${sc.green}/${sc.total}` : '–'),
        h('div', { class: 'week-label' + (d === today ? ' today' : '') }, d === today ? 'Today' : wd.format(new Date(d + 'T00:00:00Z'))));
    })));
}

/** "3 of 7 done today" with a thin bar. */
function progressLine(today) {
  const active = store.view.data.projects.filter((p) => p.state === 'active');
  if (!active.length) return null;
  const done = active.filter((p) => dotColour(p, today) === 'green').length;
  const pct = Math.round((done / active.length) * 100);
  const bar = h('div', { class: 'progress-bar' }, h('div', { class: 'progress-fill', key: 'pf' }));
  bar.firstChild.style.width = `${pct}%`; // set through the style object (allowed by the page's safety rules)
  return h('div', { class: 'progress', key: 'progress' },
    h('div', { class: 'progress-row' },
      h('div', { class: 'progress-text' },
        h('strong', null, `${done} of ${active.length}`), done === active.length ? ' done today — all green! 🎉' : ' done today',
        streakBadge()),
      h('div', { class: 'progress-btns' },
        h('button', { class: 'btn small', title: "Everything you did today, ready to send", onClick: openSummary }, '📋 Summary'),
        done < active.length && !ui.round
          ? h('button', { class: 'btn primary small round-start', title: 'One project at a time (key: g)', onClick: startRound }, '▶ Daily round', keyHint('G'))
          : null)),
    bar);
}

function newProjectForm() {
  if (!ui.adding) {
    return h('button', { class: 'btn primary new-project', onClick: () => { ui.adding = true; render(); focusKey('new-name'); } }, '+ New project', keyHint('N'));
  }
  const defaultGroup = ui.view.startsWith('group:') ? ui.view.slice(6) : store.view.data.groups[0]?.id;
  return h('form', {
    class: 'new-form',
    onSubmit: (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const name = f.name.value.trim();
      if (!name) return;
      const projectId = newId();
      if (store.dispatch('createProject', { projectId, name, groupId: f.group.value })) {
        ui.adding = false;
        if (ui.view !== 'today' && ui.view !== 'all' && !ui.view.startsWith('group:')) ui.view = 'today';
        select(projectId);
        focusKey('add-step-' + projectId);
      }
    },
  },
  h('input', { name: 'name', placeholder: 'Project name', key: 'new-name', autocomplete: 'off' }),
  h('select', { name: 'group', value: defaultGroup }, store.view.data.groups.map((g) => h('option', { value: g.id }, g.name))),
  h('button', { class: 'btn primary', type: 'submit' }, 'Add'),
  h('button', { class: 'btn', type: 'button', onClick: () => { ui.adding = false; render(); } }, 'Cancel'));
}

function statusText() {
  const s = store ? store.status : 'loading';
  if (s === 'saving') return h('span', { class: 'status' }, 'Saving…');
  if (s === 'saved') return h('span', { class: 'status ok' }, 'Saved ✓');
  if (s === 'offline') return h('span', { class: 'status bad' }, 'No connection');
  if (s === 'error') return h('span', { class: 'status bad' }, store.message || 'Error');
  if (s === 'auth') return h('span', { class: 'status bad' }, 'Key problem');
  return h('span', { class: 'status' }, 'Loading…');
}

function renderListColumn() {
  const today = todayIndia();
  const head = h('div', { class: 'list-head' },
    h('button', { class: 'icon menu-btn', 'aria-label': 'Menu', onClick: () => { ui.menuOpen = true; render(); } }, '☰'),
    h('h2', null, viewTitle()),
    statusText(),
    h('button', { class: 'icon', title: 'Get latest', 'aria-label': 'Refresh', onClick: () => doRefresh(true) }, '↻'));
  const mobileSearch = h('input', {
    class: 'search mobile-only', type: 'search', placeholder: withKey('Search…', '/'), value: ui.search, key: 'search-mobile', 'aria-label': 'Search',
    onInput: (e, el) => { ui.search = el.value; render(); },
  });

  if (ui.view === 'diary' && !ui.search) return h('div', { class: 'col-inner' }, head, renderDiary());
  if (ui.view === 'settings' && !ui.search) return h('div', { class: 'col-inner' }, head, renderSettings());
  if (ui.view === 'dashboard' && !ui.search) return h('div', { class: 'col-inner' }, head, renderDashboard(ctx));
  if (ui.view === 'people' && !ui.search) return h('div', { class: 'col-inner' }, head, renderPeopleList(ctx));

  const list = sortForView(visibleProjects(), today);
  const showSort = !ui.search && ui.view !== 'paused' && ui.view !== 'finished' && list.length > 1;
  const empty = !list.length ? h('p', { class: 'empty-list' },
    ui.search ? 'Nothing found.' : ui.view === 'paused' ? 'No paused projects.' : ui.view === 'finished' ? 'No finished projects yet.'
      : 'No projects yet. Add your first one with "+ New project".') : null;
  return h('div', { class: 'col-inner' },
    head,
    mobileSearch,
    ui.view === 'today' && !ui.search ? celebration() : null,
    ui.view === 'today' && !ui.search ? progressLine(today) : null,
    ui.view === 'today' && !ui.search ? followUpRow() : null,
    ui.view === 'today' && !ui.search ? renderBrief() : null,
    h('div', { class: 'list-tools' },
      ui.view === 'finished' || ui.view === 'paused' || ui.search ? null : newProjectForm(),
      showSort && !ui.adding ? sortSwitch() : null),
    ...listParts(list, today),
    empty);
}

/** Today: projects not yet green, then a folded "Done today (n)" group. Other views: one list. */
function splitToday(list, today) {
  if (ui.view !== 'today' || ui.search) return { open: list, done: [] };
  return { open: list.filter((p) => dotColour(p, today) !== 'green'), done: list.filter((p) => dotColour(p, today) === 'green') };
}

function listParts(list, today) {
  const { open, done } = splitToday(list, today);
  const parts = [h('ul', { class: 'plist', key: 'plist-' + (ui.search ? 'search' : ui.view) }, open.map((p) => projectRow(p, today)))];
  if (!done.length) return parts;
  if (!open.length) parts.push(h('p', { class: 'all-green', key: 'all-green' }, 'Everything is green for today 🎉'));
  parts.push(h('button', {
    class: 'done-toggle', key: 'done-toggle', 'aria-expanded': String(!!ui.showDoneToday),
    onClick: () => { ui.showDoneToday = !ui.showDoneToday; render(); },
  }, `${ui.showDoneToday ? '▾' : '▸'} Done today (${done.length})`));
  if (ui.showDoneToday) parts.push(h('ul', { class: 'plist-done', key: 'plist-done' }, done.map((p) => projectRow(p, today))));
  return parts;
}

// ---------------------------------------------------------------- Diary

function renderDiary() {
  const { data, history } = store.view;
  const byDay = new Map();
  const add = (date, line) => { if (!byDay.has(date)) byDay.set(date, []); byDay.get(date).push(line); };
  const exists = new Set(data.projects.map((p) => p.id));
  const nameOf = (e) => {
    const p = data.projects.find((x) => x.id === e.projectId);
    return p ? p.name : `${e.projectName || ''} (deleted project)`;
  };
  for (const e of Object.values(history).flat()) {
    if (!['step_ticked', 'paused', 'unpaused', 'finished', 'reopened', 'reviewed'].includes(e.kind)) continue;
    const words = { step_ticked: '✓', paused: 'Paused', unpaused: 'Unpaused', finished: 'Finished', reopened: 'Reopened', reviewed: 'Reviewed — nothing today' }[e.kind];
    add(indiaDate(e.at), { at: e.at, projectId: e.projectId, text: `${words} ${e.kind === 'step_ticked' ? e.detail : ''}`.trim(), name: nameOf(e) });
  }
  // Work notes come from the projects (so edits and deletes show correctly)...
  for (const p of data.projects) {
    for (const n of p.workNotes) {
      const st = n.stepId && p.steps.find((s) => s.id === n.stepId);
      add(indiaDate(n.createdAt), { at: n.createdAt, projectId: p.id, text: `📝 ${n.text}${st ? `  (on: ${st.text})` : ''}`, name: p.name });
    }
  }
  // ...and from history only for deleted projects.
  for (const e of Object.values(history).flat()) {
    if (e.kind === 'note_added' && !exists.has(e.projectId)) {
      add(indiaDate(e.at), { at: e.at, projectId: e.projectId, text: `📝 ${e.detail}`, name: nameOf(e) });
    }
  }
  const days = [...byDay.keys()].sort().reverse();
  const shown = days.slice(0, ui.diaryDays);
  const loaded = new Set(Object.keys(history));
  const older = store.availableMonths().find((m) => !loaded.has(m));
  return h('div', { class: 'diary' },
    weekBars(),
    shown.length ? null : h('p', { class: 'empty-list' }, 'Nothing yet. Ticked steps and work notes will show here.'),
    shown.map((d) => h('section', { class: 'diary-day', key: 'd-' + d },
      h('h3', null, fmtLongDay(d)),
      h('ul', null, byDay.get(d).sort((a, b) => (a.at < b.at ? 1 : -1)).map((l) => h('li', null,
        h('span', { class: 'muted small' }, fmtTime(l.at)), ' ',
        exists.has(l.projectId)
          ? h('button', { class: 'link', onClick: () => { select(l.projectId); } }, l.name)
          : h('span', { class: 'muted' }, l.name),
        ': ', l.text))))),
    days.length > shown.length
      ? h('button', { class: 'btn', onClick: () => { ui.diaryDays += 14; render(); } }, 'Show older days')
      : older ? h('button', { class: 'btn', onClick: () => store.loadMonth(older) }, `Load ${older}`) : null);
}

// ---------------------------------------------------------------- Settings

function keyForm(provider, label, help) {
  const has = !!aiKeyFor(provider);
  return h('form', {
    class: 'setting',
    onSubmit: async (e) => {
      e.preventDefault();
      const input = e.target.elements.key;
      const v = input.value.trim();
      if (!v) return;
      device.setAiKey(provider, v);
      store.dispatch('setAiKey', { provider, key: v }); // shared with all my devices (private data)
      input.value = '';
      toast(`${label} key saved — it now works on all your devices`);
      render();
    },
  },
  h('label', null, `${label} key `, has ? h('span', { class: 'ok' }, '(saved ✓)') : h('span', { class: 'muted' }, '(not set)')),
  h('div', { class: 'row' },
    h('input', { name: 'key', type: 'password', placeholder: has ? 'Paste a new key to replace' : 'Paste key here', autocomplete: 'off', key: 'k-' + provider }),
    h('button', { class: 'btn primary small', type: 'submit' }, 'Save'),
    has ? h('button', {
      class: 'btn small', type: 'button',
      onClick: async () => {
        toast('Testing…');
        try { toast((await ai.testKey(provider, aiKeyFor(provider))) ? `${label} key works ✓` : 'Unclear answer from the AI'); } catch (err) { toast(err.message); }
      },
    }, 'Test') : null,
    has ? h('button', {
      class: 'btn small', type: 'button',
      onClick: () => {
        if (!confirm(`Remove the ${label} key from ALL your devices?`)) return;
        device.setAiKey(provider, '');
        store.dispatch('setAiKey', { provider, key: '' });
        render();
      },
    }, 'Remove') : null),
  h('p', { class: 'muted small' }, help));
}

async function downloadBackup() {
  toast('Preparing backup…', 20000);
  try {
    await store.loadAllHistory();
    const today = todayIndia();
    const { secrets, ...dataWithoutKeys } = store.view.data; // AI keys are left out of the backup file
    const backup = { app: 'daily-projects', madeAt: new Date().toISOString(), data: dataWithoutKeys, history: store.view.history };
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `daily-projects-backup-${today}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Backup downloaded');
  } catch (e) {
    toast(`Backup failed: ${e.message}`);
  }
}

function renderSettings() {
  const { data } = store.view;
  const provider = data.settings.aiProvider || 'claude';
  const usage = data.aiUsage.date === todayIndia() ? data.aiUsage.count : 0;
  return h('div', { class: 'settings' },
    h('section', { class: 'block' }, h('h3', null, 'GitHub access key'),
      h('p', null, isMock ? 'Test mode (no real GitHub).' : 'Connected to your private data ✓'),
      h('div', { class: 'row' },
        isMock ? null : h('button', { class: 'btn', onClick: () => showKeyScreen('Paste your new GitHub access key.') }, 'Change key'),
        h('button', {
          class: 'btn danger',
          onClick: () => {
            const waiting = store.pending.length;
            if (waiting && !confirm(`${waiting} change(s) are not saved yet and will be lost. Continue?`)) return;
            if (!confirm('Forget this device? All keys are removed from this browser.')) return;
            device.forgetAll();
            location.reload();
          },
        }, 'Forget this device'))),
    h('section', { class: 'block' }, h('h3', null, 'AI helper'),
      h('div', { class: 'row' },
        ['claude', 'gemini'].map((x) => h('label', { class: 'check' },
          h('input', {
            type: 'radio', name: 'provider', checked: provider === x,
            onChange: () => store.dispatch('setAiProvider', { provider: x }),
          }), x === 'claude' ? ' Claude Haiku (main)' : ' Gemini Flash (backup)'))),
      h('p', null, `AI uses today: ${usage} / ${AI_DAILY_LIMIT}`),
      keyForm('claude', 'Claude', 'From console.anthropic.com → API keys. Saved in your private data, so all your devices use it.'),
      keyForm('gemini', 'Gemini', 'Optional backup. From aistudio.google.com → Get API key. Shared with all your devices. On the free plan Google may read the text.')),
    h('section', { class: 'block' }, h('h3', null, 'Backup'),
      h('p', { class: 'muted' }, 'Every save is kept as a version on GitHub. You can also download a copy.'),
      h('button', { class: 'btn', onClick: downloadBackup }, 'Download backup')),
    h('section', { class: 'block' }, h('h3', null, 'iPhone'),
      h('p', null, 'Always open Daily Projects from its home-screen icon. In Safari: Share → "Add to Home Screen". Then paste your keys inside the icon app.')));
}

// ---------------------------------------------------------------- key screen

function showKeyScreen(message = '') {
  const screen = document.getElementById('keyscreen');
  screen.hidden = false;
  root.hidden = true;
  screen.replaceChildren(h('form', {
    class: 'key-card',
    onSubmit: async (e) => {
      e.preventDefault();
      const key = e.target.elements.key.value.trim();
      if (!key) return;
      const msg = screen.querySelector('.key-msg');
      msg.textContent = 'Checking…';
      try {
        const repo = new GitHubRepo(key, DATA_OWNER, DATA_REPO, DATA_BRANCH);
        await repo.headCommit();
        device.setGithubKey(key);
        screen.hidden = true;
        root.hidden = false;
        start();
      } catch (err) {
        msg.textContent = err.message === 'No connection' ? 'No connection. Try again.' : 'This key does not work. Check it and try again.';
      }
    },
  },
  h('img', { src: 'icons/icon-192.png', alt: '', width: 64, height: 64 }),
  h('h1', null, 'Daily Projects'),
  h('p', null, message || 'Paste your GitHub access key to open your projects.'),
  h('input', { name: 'key', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', autofocus: true }),
  h('button', { class: 'btn primary', type: 'submit' }, 'Open'),
  h('p', { class: 'key-msg muted' }),
  h('p', { class: 'muted small' }, 'The key stays only on this device.')));
}

// ---------------------------------------------------------------- render

function focusKey(key) {
  setTimeout(() => {
    const el = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el) el.focus();
  }, 30);
}

let sortables = [];

function setupSortable() {
  if (!window.Sortable) return;
  const lists = root.querySelectorAll('.plist, .sortable-steps');
  for (const el of lists) {
    const isProjects = el.classList.contains('plist');
    if (el.__sortable) {
      if (isProjects) el.__sortable.option('disabled', !canDrag());
      continue;
    }
    el.__sortable = window.Sortable.create(el, {
      animation: 150,
      disabled: isProjects && !canDrag(),
      handle: isProjects ? undefined : '.grip',
      delay: 300,
      delayOnTouchOnly: true,
      filter: 'input, select, textarea',
      preventOnFilter: false,
      onEnd: (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        const ids = [...el.children].map((c) => c.dataset.id);
        const id = evt.item.dataset.id;
        const i = ids.indexOf(id);
        const where = i > 0 ? { afterId: ids[i - 1] } : { beforeId: ids[1] };
        if (isProjects) {
          if (!canDrag()) { render(); return; }
          if (!store.dispatch('moveProject', { projectId: id, ...where })) render();
        } else {
          if (!store.dispatch('moveStep', { projectId: el.dataset.project, stepId: id, ...where })) render();
        }
      },
    });
    sortables.push(el.__sortable);
  }
}

function render() {
  if (!store || !store.view) {
    root.replaceChildren(h('div', { class: 'loading' }, store && store.status === 'offline' ? 'No connection. Retrying…' : 'Loading…'));
    return;
  }
  if (ui.selected && !store.view.data.projects.some((p) => p.id === ui.selected)) ui.selected = null;
  const wide = (ui.view === 'diary' || ui.view === 'settings' || ui.view === 'dashboard') && !ui.search;
  const next = h('div', {
    class: ['layout', wide ? 'wide' : '', ui.mobile === 'detail' && !wide ? 'show-detail' : '', ui.menuOpen ? 'menu-open' : ''].join(' ').trim(),
  },
  h('aside', { id: 'menu' }, renderMenu()),
  h('div', { class: 'scrim', onClick: () => { ui.menuOpen = false; render(); } }),
  h('main', { id: 'list' }, renderListColumn()),
  wide ? null : h('section', { id: 'detail' }, ui.round ? renderRound() : ui.view === 'people' && !ui.search ? renderPerson(ctx) : renderDetail(ctx)),
  ui.showKeys ? keysHelp() : null);
  if (root.firstChild && root.firstChild.classList && root.firstChild.classList.contains('layout')) morph(root.firstChild, next);
  else root.replaceChildren(next);
  setupSortable();
}

// ---------------------------------------------------------------- daily round
// One project at a time, red first. Every action saves AND jumps to the next project that is not green.

function startRound() {
  const today = todayIndia();
  const active = store.view.data.projects.filter((p) => p.state === 'active');
  const ids = computeRedFirst(active, today).filter((p) => dotColour(p, today) !== 'green').map((p) => p.id);
  if (!ids.length) { toast('Everything is green for today 🎉'); return; }
  ui.round = { ids, i: 0, mode: null, total: active.length };
  ui.mobile = 'detail';
  ui.menuOpen = false;
  markOpened(ids[0]);
  render();
  const d = document.getElementById('detail');
  if (d) d.scrollTop = 0;
}

function endRound() {
  ui.round = null;
  ui.mobile = 'list';
  render();
}

function roundProject() {
  if (!ui.round || ui.round.done) return null;
  const p = store.view.data.projects.find((x) => x.id === ui.round.ids[ui.round.i]);
  return p && p.state === 'active' ? p : null; // deleted, paused or finished elsewhere = gone
}

/** Move the round to the next project that is not green. Returns false when none is left. */
function advanceRound() {
  const r = ui.round;
  const today = todayIndia();
  const stillOpen = (id) => {
    const p = store.view.data.projects.find((x) => x.id === id);
    return p && p.state === 'active' && dotColour(p, today) !== 'green';
  };
  const order = [...r.ids.slice(r.i + 1), ...r.ids.slice(0, r.i + 1)];
  const nextId = order.find((id) => stillOpen(id) && id !== r.ids[r.i]) || null;
  r.mode = null;
  if (!nextId) { r.done = true; return false; }
  r.i = r.ids.indexOf(nextId);
  return true;
}

function roundNext() {
  if (!ui.round) return;
  if (advanceRound()) markOpened(ui.round.ids[ui.round.i]);
  render();
  if (!ui.round.done) focusKey('round-card');
}

function roundAct(kind) {
  const p = roundProject();
  if (!p) return;
  const ns = nextStep(p, todayIndia(), { dueOnly: true });
  if (kind === 'done') {
    if (!ns) { ui.round.mode = 'next'; render(); focusKey('round-input'); return; }
    const done = act('tickStep', { projectId: p.id, stepId: ns.id });
    if (!done) return;
    const after = store.view.data.projects.find((x) => x.id === p.id);
    if (after && !nextStep(after, todayIndia(), { dueOnly: true })) { ui.round.mode = 'next'; render(); focusKey('round-input'); toast(`✓ ${ns.text}. What's next?`, 4000, done.undo); return; }
    toast(`✓ ${ns.text} (${p.name})`, 4000, done.undo);
    roundNext();
  } else if (kind === 'add' || kind === 'note') {
    ui.round.mode = kind;
    render();
    focusKey('round-input');
  } else if (kind === 'ok') {
    if (act('okForToday', { projectId: p.id }, `✓ ${p.name}: OK for today`)) roundNext();
  } else if (kind === 'chase') {
    if (ns && ns.waiting && act('chased', { projectId: p.id, stepId: ns.id }, `Chased${ns.waitingOn ? ' ' + ns.waitingOn : ''} (${p.name})`)) roundNext();
  } else if (kind === 'skip') {
    roundNext();
  }
}

function roundSubmit(text) {
  const p = roundProject();
  const t = text.trim();
  if (!p || !t) return;
  const mode = ui.round.mode;
  const ok = mode === 'note'
    ? act('addWorkNote', { projectId: p.id, noteId: newId(), text: t, stepId: (nextStep(p, todayIndia(), { dueOnly: true }) || {}).id }, `Note saved (${p.name})`)
    : act('addStep', { projectId: p.id, stepId: newId(), text: t }, `Added: ${t}`);
  if (ok) roundNext();
}

function renderRound() {
  const r = ui.round;
  const today = todayIndia();
  const active = store.view.data.projects.filter((p) => p.state === 'active');
  const greenCount = active.filter((p) => dotColour(p, today) === 'green').length;
  const left = active.length - greenCount;
  const top = h('div', { class: 'round-top' },
    h('button', { class: 'icon back', 'aria-label': 'End round', onClick: endRound }, '←'),
    h('strong', null, 'Daily round'),
    h('span', { class: 'muted small' }, `${greenCount} of ${active.length} green · ${left} left`),
    h('button', { class: 'btn small', onClick: endRound, title: 'End the round (Esc)' }, 'End'));
  // The current project was deleted / paused on another device: quietly move on.
  if (!r.done && !roundProject()) {
    if (advanceRound()) setTimeout(() => { if (ui.round) markOpened(ui.round.ids[ui.round.i]); }, 0);
  }
  if (r.done || !roundProject()) {
    return h('div', { class: 'detail-inner round', key: 'round-done' }, top,
      h('div', { class: 'round-card round-finish', key: 'round-card', tabindex: '-1' },
        h('div', { class: 'round-big' }, left ? 'Round finished' : 'All green for today 🎉'),
        h('p', { class: 'muted' }, left ? `${left} project${left > 1 ? 's' : ''} still not green (you skipped them).` : 'Every project got your attention today.'),
        h('div', { class: 'row' },
          left ? h('button', { class: 'btn', onClick: () => { ui.round = null; startRound(); } }, 'Go through skipped ones') : null,
          h('button', { class: 'btn primary', onClick: endRound }, 'Done'))));
  }
  const p = roundProject();
  const ns = nextStep(p, today);
  const due = nextStep(p, today, { dueOnly: true });
  const colour = dotColour(p, today);
  const g = store.view.data.groups.find((x) => x.id === p.groupId);
  const open = p.steps.filter((s) => !s.done);
  const lastNote = p.workNotes[0];
  const mode = r.mode;
  const placeholder = mode === 'note' ? 'What did you do? (Enter)' : mode === 'next' ? `What's next for "${p.name}"? (Enter)` : 'New step (Enter)';
  const btn = (kind, label, keyName, cls = '') => h('button', { class: `btn round-btn ${cls}`, onClick: () => roundAct(kind), title: `Key: ${keyName}` },
    label, h('kbd', null, keyName));
  return h('div', { class: 'detail-inner round', key: 'round-' + p.id }, top,
    h('div', { class: 'round-card', key: 'round-card', tabindex: '-1' },
      h('div', { class: 'round-name' },
        h('span', { class: `dot ${colour}` }),
        h('button', { class: 'link round-title', title: 'Open the full project', onClick: () => { const id = p.id; ui.round = null; select(id); } }, p.name)),
      h('p', { class: 'muted small round-meta' }, [g ? g.name : '', p.priority === 'high' ? 'High' : '', p.deadline ? `${isOverdue(p, today) ? 'Overdue' : 'Target'} ${fmtDay(p.deadline)}` : '']
        .filter(Boolean).join(' · ')),
      h('div', { class: 'round-next' + (ns ? '' : ' warn') },
        ns ? ['Next: ', h('strong', null, ns.text)] : 'No next step yet',
        ns && ns.waiting ? waitingTag(ns) : null),
      open.length > 1 ? h('p', { class: 'muted small' }, `then: ${open.slice(1, 3).map((s) => s.text).join(' · ')}${open.length > 3 ? ' …' : ''}`) : null,
      lastNote ? h('p', { class: 'muted small' }, `Last note (${fmtDay(indiaDate(lastNote.createdAt))}): ${lastNote.text}`) : null,
      noWorkTag(p, today),
      mode ? h('form', {
        class: 'row round-form', key: 'round-form-' + mode,
        onSubmit: (e) => { e.preventDefault(); roundSubmit(e.target.elements.text.value); },
      },
      h('input', { name: 'text', key: 'round-input', placeholder, autocomplete: 'off', 'data-mention': '1', enterkeyhint: 'done' }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn', type: 'button', onClick: () => { ui.round.mode = null; render(); } }, 'Cancel')) : null,
      mode ? null : h('div', { class: 'round-actions' },
        due ? btn('done', '✓ Step done', 'x', 'primary') : btn('done', '+ What\'s next?', 'x', 'primary'),
        btn('add', '+ Add step', 's'),
        btn('note', '✎ Note', 'w'),
        due && due.waiting ? btn('chase', 'Chased', 'c') : null,
        due && due.waiting ? h('button', { class: 'btn round-btn', onClick: () => draftFollowUp(p, due) }, '✍ Draft message', h('kbd', null, 'm')) : null,
        h('label', { class: 'btn round-btn photo-btn' }, '📷 Photo',
          h('input', {
            type: 'file', accept: 'image/*', class: 'visually-hidden',
            onChange: async (e, el) => {
              const file = el.files && el.files[0];
              el.value = '';
              if (!file) return;
              const up = await uploadBlob(ctx, file);
              if (!up) return;
              const noteId = newId();
              actMany(p.id, [
                ['addWorkNote', { projectId: p.id, noteId, text: `📷 Photo${due ? ' — ' + due.text : ''}`, stepId: due ? due.id : null }],
                ['addFile', { projectId: p.id, ...up, noteId }],
              ], `Photo added to ${p.name}`);
            },
          })),
        btn('ok', '✓ OK for today', 'o', 'ok-btn'),
        btn('skip', 'Skip →', 'n'))));
}

// ---------------------------------------------------------------- keyboard

const KEYS = [
  ['↓  ↑', 'Next / previous project'],
  ['x', 'Tick the next step of the open project'],
  ['o', 'OK for today (or undo)'],
  ['g', 'Start the daily round (then x s w o c n)'],
  ['s', 'Type a new step'],
  ['w', 'Type in "What did you do today?"'],
  ['i', '✨ AI: suggest the next steps'],
  ['n', 'New project'],
  ['/', 'Search'],
  ['r', 'Switch "My order" / "Red first"'],
  ['t  b  d  p', 'Go to Today / Dashboard / Diary / People'],
  ['@', 'In a step or note: pick a person'],
  ['Esc', 'Leave a box, or close what is open'],
  ['?', 'Show or hide this list'],
];

function keysHelp() {
  return h('div', { class: 'keys-help', key: 'keys-help', role: 'dialog', 'aria-label': 'Keyboard shortcuts' },
    h('div', { class: 'keys-head' }, h('strong', null, 'Keyboard shortcuts'),
      h('button', { class: 'icon', 'aria-label': 'Close', onClick: () => { ui.showKeys = false; render(); } }, '✕')),
    h('p', { class: 'muted small' }, 'They work when you are not typing in a box. Press Esc to leave a box.'),
    h('table', null, KEYS.map(([k, what]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, what)))));
}

function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.nodeName === 'TEXTAREA' || el.nodeName === 'SELECT') return true;
  return el.nodeName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type);
}

function currentList() {
  if (!store || !store.view || ui.view === 'diary' || ui.view === 'settings' || ui.view === 'dashboard') return [];
  const today = todayIndia();
  const { open, done } = splitToday(sortForView(visibleProjects(), today), today);
  return ui.showDoneToday || ui.view !== 'today' ? [...open, ...done] : open;
}

function moveSelection(step) {
  if (ui.view === 'people' && !ui.search) {
    const people = store.view.data.people || [];
    if (!people.length) return;
    const i = people.findIndex((x) => x.id === ui.person);
    const next = i < 0 ? people[0] : people[Math.min(people.length - 1, Math.max(0, i + step))];
    ctx.selectPerson(next.id);
    ui.mobile = 'list'; render();
    const row = root.querySelector(`.people-list .prow[data-id="${CSS.escape(next.id)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    return;
  }
  const list = currentList();
  if (!list.length) return;
  const i = list.findIndex((p) => p.id === ui.selected);
  let next;
  if (i >= 0) next = list[Math.min(list.length - 1, Math.max(0, i + step))];
  else if (ui.selected && ui.listIndex !== undefined) {
    // the selected row folded away: the row now at its old place is the "next" one
    const base = step > 0 ? ui.listIndex : ui.listIndex - 1;
    next = list[Math.min(list.length - 1, Math.max(0, base))];
  } else next = list[step > 0 ? 0 : list.length - 1];
  if (!next || next.id === ui.selected) return;
  select(next.id);
  ui.mobile = 'list'; // keyboard use: keep the list in view on small screens
  render();
  const row = root.querySelector(`.prow[data-id="${CSS.escape(next.id)}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function selectedProject() {
  return store && store.view ? store.view.data.projects.find((p) => p.id === ui.selected) : null;
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
  if (e.key === 'Escape') {
    const viewer = document.getElementById('viewer');
    if (!viewer.hidden) { closeSheet(); return; }
    if (ui.showKeys) { ui.showKeys = false; render(); return; }
    if (isTyping(document.activeElement)) { document.activeElement.blur(); return; }
    if (ui.round) { if (ui.round.mode) { ui.round.mode = null; render(); } else endRound(); return; }
    if (ui.menuOpen) { ui.menuOpen = false; render(); return; }
    if (ui.adding) { ui.adding = false; render(); return; }
    if (ui.search) { ui.search = ''; render(); return; }
    if (ui.ai) { ui.ai = null; render(); return; }
    return;
  }
  if (isTyping(document.activeElement)) return;
  if (!store || !store.view || !document.getElementById('keyscreen').hidden) return;
  const isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp';
  if (e.repeat && !isArrow && e.key !== 'j' && e.key !== 'k') return; // holding x / o / r must not repeat
  const focused = document.activeElement;
  if (isArrow && focused && (focused.type === 'radio' || focused.nodeName === 'SUMMARY')) return;
  if (isArrow && (ui.view === 'diary' || ui.view === 'settings' || ui.view === 'dashboard') && !ui.search) return; // let the page scroll
  const k = e.key;
  if (ui.round) {
    const map = { x: 'done', s: 'add', w: 'note', o: 'ok', c: 'chase', n: 'skip', ArrowRight: 'skip' };
    if (map[k] && !ui.round.done) { e.preventDefault(); roundAct(map[k]); return; }
    if (k === 'm' && !ui.round.done) {
      const rp = roundProject();
      const d = rp && nextStep(rp, todayIndia(), { dueOnly: true });
      if (d && d.waiting) { e.preventDefault(); draftFollowUp(rp, d); }
      return;
    }
    if (k === '?') { ui.showKeys = !ui.showKeys; render(); e.preventDefault(); }
    return; // other keys do nothing during the round
  }
  const p = selectedProject();
  let handled = true;
  if (k === 'ArrowDown' || k === 'j') moveSelection(1);
  else if (k === 'ArrowUp' || k === 'k') moveSelection(-1);
  else if (ui.view === 'people' && 'xswoi'.includes(k)) handled = false; // project keys do nothing on People
  else if (k === 'i') {
    if (p && p.state === 'active') { ui.mobile = 'detail'; runSuggest(p); }
    else toast('Pick a project first (↓ ↑).');
  }
  else if (k === 'o') {
    if (p && p.state === 'active') toggleOk(p);
    else toast('Pick an active project first (↓ ↑).');
  }
  else if (k === 'x') {
    const ns = p && p.state === 'active' && nextStep(p, todayIndia(), { dueOnly: true });
    if (ns) {
      const done = act('tickStep', { projectId: p.id, stepId: ns.id });
      if (done) {
        const after = selectedProject();
        const nn = after && nextStep(after, todayIndia(), { dueOnly: true });
        if (nn) toast(`✓ ${ns.text}. Next: ${nn.text}`, 4500, done.undo);
        else afterTick(p.id, 'detail', done.undo);
      }
    } else toast(p ? 'No step to tick. Press "s" to add one.' : 'Pick a project first (↓ ↑).');
  } else if (k === 's') {
    if (!p) { toast('Pick a project first (↓ ↑).'); return; }
    ui.mobile = 'detail'; render(); focusKey('add-step-' + p.id);
  } else if (k === 'w') {
    if (!p) { toast('Pick a project first (↓ ↑).'); return; }
    ui.mobile = 'detail'; render(); focusKey('wn-' + p.id);
  } else if (k === 'n') {
    if (ui.view === 'diary' || ui.view === 'settings' || ui.view === 'paused' || ui.view === 'finished') ui.view = 'today';
    ui.search = ''; ui.adding = true; ui.mobile = 'list'; render(); focusKey('new-name');
  } else if (k === '/') {
    const box = [...root.querySelectorAll('input.search')].find((el) => el.offsetParent !== null);
    if (box) box.focus();
  } else if (k === 'r') {
    ui.sort = ui.sort === 'red' ? 'mine' : 'red'; resetRedOrder(); rememberUi(); render();
    toast(ui.sort === 'red' ? 'Red first' : 'My order', 1500);
  } else if (k === 'g') { if (ui.view !== 'today') go('today'); startRound(); }
  else if (k === 't') go('today');
  else if (k === 'd') go('diary');
  else if (k === 'p') go('people');
  else if (k === 'b') go('dashboard');
  else if (k === '?') { ui.showKeys = !ui.showKeys; render(); }
  else handled = false;
  if (handled) e.preventDefault();
}

// ---------------------------------------------------------------- start

async function doRefresh(force) {
  if (!store || store.status === 'auth') return;
  await store.refresh(force);
  if (force && store.status === 'saved') toast('Up to date ✓');
  makeBrief();
}

let started = false;

function start() {
  const key = device.githubKey();
  if (!isMock && !key) { showKeyScreen(); return; }
  const repo = isMock ? new MockRepo() : new GitHubRepo(key, DATA_OWNER, DATA_REPO, DATA_BRANCH);
  store = new Store(repo);
  store.addEventListener('change', () => render());
  store.addEventListener('status', (e) => {
    // Only build the key screen when it is not already showing, so a pasted key is not wiped.
    if (e.detail.status === 'auth' && document.getElementById('keyscreen').hidden) {
      showKeyScreen('Your GitHub key stopped working. Paste a new one. Your unsaved changes are kept.');
    }
    render();
  });
  store.addEventListener('blocked', (e) => {
    toast(e.detail.status === 'offline' ? 'No connection — changes not saved. Try again when online.' : 'Please wait…');
    render(); // put ticked boxes and menus back to the real data
  });
  render();
  store.init().then(() => { render(); shareLocalKeys(); markShownOpened(); makeBrief(); recordPastScores(); });
  if (started) return;
  started = true;
  let shownDay = todayIndia();
  setInterval(() => {
    if (document.visibilityState === 'visible') doRefresh(false);
    if (todayIndia() !== shownDay) { shownDay = todayIndia(); resetRedOrder(); render(); markShownOpened(); recordPastScores(); } // midnight: every dot resets
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') doRefresh(false);
    else saveTypedText();
  });
  window.addEventListener('pagehide', saveTypedText);
  window.addEventListener('online', () => {
    if (store.status !== 'offline') return;
    store.init().then(() => { if (store.pending.length) store.save(); else if (store.status !== 'auth') store.setStatus('saved'); });
  });
  window.addEventListener('offline', () => store.setStatus('offline', 'No connection'));
  document.addEventListener('keydown', onKey);
}

installEvents(document.body);
installMentions(() => ctx);
if (isMock) document.title = 'Daily Projects (test mode)';
start();
