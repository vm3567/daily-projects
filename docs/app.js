// Daily Projects — main app: start-up, menu, project list, Today box, Diary, Settings, key screen.

import { h, morph, installEvents, fmtDay, fmtLongDay, fmtTime, keyHint, withKey } from './ui/dom.js';
import { renderDetail, linkChip, isMailLink, pasteIntoProject } from './ui/detail.js';
import { renderPeopleList, renderPerson, peopleByFollowUp } from './ui/people.js';
import { installMentions } from './ui/mention.js';
import { installAutocorrect, setAutocorrect, autocorrectOn } from './ui/autocorrect.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderTimeReport } from './ui/timereport.js';
import { projectMatches, diaryEntries, backupPayload, summaryText, personMessageText } from './reports.js';
import { closeViewer, uploadBlob } from './ui/files.js';
import { Store } from './store.js';
import { GitHubRepo } from './github.js';
import { ServerRepo, SERVER_TOKEN_KEY } from './serverrepo.js';
import { MockRepo } from './mockrepo.js';
import { device } from './device.js';
import { DATA_OWNER, DATA_REPO, DATA_BRANCH, MOVED_TO, REFRESH_MS, AI_DAILY_LIMIT, BRIEF_CLAIM_MINUTES, WAIT_RED_DAYS, NO_WORK_NOTE_DAYS } from './config.js';
import { dotColour, greenByTeamOnly, isSnoozed, restUntil, awakeProjects, activeProjects, nextStep, todayIndia, isSundayIndia, colourCounts, isOverdue, indiaDate, waitingDays, daysWithoutWork, dayScore, greenStreak, addDays, monthOf, fmtMinutes, singleStepCloseWaits, takeBackWaits, staffStepAction, pasteGoesToProject } from './rules.js';
import { newId, clone, opMonth, groupHasTimer, cleanLink, carriedOps } from './ops.js';
import * as ai from './ai.js';
import { parseVoice } from './voice.js';

const root = document.getElementById('app');
const isMock = new URLSearchParams(location.search).has('mock')
  && ['localhost', '127.0.0.1'].includes(location.hostname);
// On worktask.in the data lives on the Work Task server (sign in with username and password), not on GitHub.
// On this Mac, the local Work Task test server (port 8090) works the same way.
const onServer = ['worktask.in', 'www.worktask.in'].includes(location.hostname)
  || (location.port === '8090' && ['localhost', '127.0.0.1'].includes(location.hostname));
const serverToken = () => { try { return localStorage.getItem(SERVER_TOKEN_KEY) || ''; } catch { return ''; } };
/** To the Work Task sign-in page; it comes back here after signing in. */
function toSignIn() { location.href = '../?next=projects'; }

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
  showMore: saved.showMore === true, // project page "More" fold (notes, links, files, history)
  showDone: saved.showDone !== false, // the Done list under the steps is open unless you closed it (remembered)
  ai: null,
  brief: { busy: false, error: '' },
  diaryDays: 14,
};

let store = null;
let toastTimer = null;
let searchTimer = null;

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
    // (a step the person added, taken away by this Undo, is remembered as deleted on every device)
    const dropTeamSteps = ops.filter((o) => o.type === 'addStep' && o.args.byTeam).map((o) => o.args.stepId);
    if (store.dispatch('restoreProject', { project: before, index, undoOpIds: ops.map((o) => o.id), undoMonth: months[0], dropTeamSteps })) toast('Undone', 1500);
  } : null;
  if (message) toast(message, 5000, undo);
  return { ops, undo };
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

/** Remember how far the list and the project page were scrolled (when leaving the app). */
function rememberScroll() {
  const list = document.getElementById('list');
  const detail = document.getElementById('detail');
  device.setUi({
    ...device.ui(),
    scroll: { view: ui.view, selected: ui.selected, list: list ? list.scrollTop : 0, detail: detail ? detail.scrollTop : 0, win: window.scrollY || 0 },
  });
}

let scrollRestored = false;
/** First screen with data: open exactly where you left it (same list position, same place in the project). */
function restoreScrollOnce() {
  if (scrollRestored || !store || !store.view) return;
  scrollRestored = true;
  const s = saved.scroll;
  setTimeout(() => {
    const list = document.getElementById('list');
    const detail = document.getElementById('detail');
    if (s && s.view === ui.view) {
      if (list) list.scrollTop = s.list || 0;
      if (s.win) window.scrollTo(0, s.win);
      if (detail && s.selected === ui.selected) detail.scrollTop = s.detail || 0;
    } else if (ui.selected) {
      const row = root.querySelector(`.prow[data-id="${CSS.escape(ui.selected)}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
    }
  }, 0);
}

function rememberUi() {
  device.setUi({
    scroll: device.ui().scroll, view: ui.view, selected: ui.selected, briefFolded: ui.briefFolded, sort: ui.sort, showDone: ui.showDone, showMore: ui.showMore });
}

const ctx = {
  get store() { return store; },
  ui,
  rememberUi: () => rememberUi(),
  nextOpenProject: (id) => nextOpenProject(id),
  openNextOpen: (id) => openNextOpen(id),
  toast,
  render: () => render(),
  aiSuggest: (p) => runAi(p, 'next'),
  aiSteps: (p) => runSuggest(p),
  goSettings: () => go('settings'),
  goTime: () => go('time'),
  draftFollowUp: (p, s) => draftFollowUp(p, s),
  openSummary: () => openSummary(),
  openPersonMessage: (person) => openSheet({
    title: `Pending list for ${person.name}`, text: personMessageText(store.view.data, person, todayIndia()), subject: 'Pending items', to: person,
  }),
  openPerson: (id) => { pushNav(); go('people'); ctx.selectPerson(id); },
  goBack: () => goBack(),
  openInList: (id) => { select(id); const row = root.querySelector(`.prow[data-id="${CSS.escape(id)}"]`); if (row) row.scrollIntoView({ block: 'nearest' }); },
  canGoBack: () => !!(ui.navStack && ui.navStack.length),
  neighbourProject: (step) => neighbourProject(step),
  neighbourPerson: (step) => neighbourPerson(step),
  aiBreakdown: (p, goal) => runAi(p, 'breakdown', goal),
  hasAiKey: () => !!(store && aiReady().key),
  startTimer: (p) => startTimer(p),
  stopTimer: () => stopTimer(),
  clockText: (iso) => clockText(iso),
  act: (type, args, message, ms) => act(type, args, message, ms),
  actMany: (projectId, steps, message) => actMany(projectId, steps, message),
  chase: (p, s) => chase(p, s),
  onServer,
  teamTask: (stepId) => team.byStep.get(stepId) || null,
  teamProgress: (projectId) => teamProgress(projectId),
  teamPeople: () => teamPeople(),
  teamDaily: (p) => teamDaily(p),
  teamPhoto: (id) => teamPhoto(id),
  teamReply: (p, taskId, text, allIds = [], clientId = null) => teamApi('comment.add', { taskId, text, ...(clientId ? { clientId } : {}) })
    .then(() => (allIds.length > 1 ? teamApi('tasks.read', { ids: allIds }) : null)) // answered = every message in the box is read
    .then(() => { refreshDaily(p.id); loadTeam(true); toast('Sent ✓'); }),
  teamSeen: (p, taskIds) => teamApi('tasks.read', { ids: taskIds }).then(() => { refreshDaily(p.id); loadTeam(true); }),
  teamMsgPhoto: (id) => teamMsgPhoto(id),
  moreDaily: (p) => { const e = daily.get(p.id); teamDaily(p, (e ? e.days : 30) + 30); },
  teamBusy: (id) => team.busy.has(id),
  giveProject: (p, person) => giveProject(p, person),
  takeBackProject: (p) => giveProject(p, null),
  setGivePhoto: (on) => { ui.givePhoto = on; render(); },
  teamInfo: () => team,
  afterTick: (id, where, undo) => afterTick(id, where, undo),
  openPersonMenu: (id, e) => openPersonMenu(id, e),
  selectPerson: (id) => { ui.person = id; ui.mobile = 'detail'; render(); const d = document.getElementById('detail'); if (d) d.scrollTop = 0; },
  openProject: (id) => {
    const p = store.view.data.projects.find((x) => x.id === id);
    if (!p) return;
    pushNav();
    ui.view = p.state === 'active' ? 'all' : p.state; // 'paused' or 'finished'
    ui.search = '';
    rememberUi();
    select(id);
  },
};

// ---------------------------------------------------------------- AI

/** AI key: the one shared through my private data (newest, same on every device), else one saved only here. */
function aiKeyFor(provider) {
  const secrets = (store && store.view && store.view.data.secrets) || {};
  if (secrets[provider]) return secrets[provider];
  if (secrets.removed && secrets.removed[provider]) return ''; // removed in Settings: an old copy on this device is not used
  return device.aiKey(provider) || '';
}

/** Keys saved only on this device (from before keys were shared) are uploaded once, so other devices get them. */
function shareLocalKeys() {
  if (!store || !store.canEdit()) return;
  const shared = store.view.data.secrets || {};
  const removed = shared.removed || {};
  for (const provider of ['claude', 'gemini']) {
    const local = device.aiKey(provider);
    if (!local) continue;
    if (shared[provider] || removed[provider]) { device.setAiKey(provider, ''); continue; } // shared one wins; a removed key stays removed
    if (store.dispatch('setAiKey', { provider, key: local })) device.setAiKey(provider, ''); // moved into the shared data once
  }
}

function anyAiKey() {
  return !!(aiKeyFor('claude') || aiKeyFor('gemini'));
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
  const ticket = { projectId: p.id, mode: 'suggest', state: 'busy' };
  ui.ai = ticket;
  render();
  const stillWanted = () => ui.ai === ticket; // the user may have closed it or asked for another project
  let lastError = null;
  for (const provider of order) {
    try {
      const steps = await ai.suggestSteps(provider, aiKeyFor(provider), p);
      if (!stillWanted()) return;
      ui.ai = { projectId: p.id, mode: 'suggest', state: 'list', steps, picked: steps.map(() => true), provider };
      render();
      return;
    } catch (e) { lastError = e; }
  }
  if (!stillWanted()) return;
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

/** The saved person for a name (for their WhatsApp number and email). */
function personNamed(name) {
  const n = String(name || '').trim().toLowerCase();
  return n ? (store.view.data.people || []).find((x) => x.name.toLowerCase() === n) || null : null;
}

/** to = a person: WhatsApp and Outlook open straight to them when their number / email is saved on their page. */
function openSheet({ title, text, busy = false, error = '', extra = null, subject = 'Update', to = null }) {
  const v = document.getElementById('viewer');
  v.hidden = false;
  v.classList.add('sheet-mode');
  const area = h('textarea', { class: 'sheet-text', rows: 12, 'aria-label': title });
  area.value = text || '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(area.value); toast('Copied ✓ — paste it in WhatsApp or email', 2500); }
    catch { area.select(); document.execCommand && document.execCommand('copy'); toast('Copied ✓', 2000); }
  };
  const phone = to && to.phone;
  const email = to && to.email;
  const wa = () => window.open(`https://wa.me/${phone || ''}?text=${encodeURIComponent(area.value)}`, '_blank', 'noopener');
  // Outlook on the web, new mail with To, subject and text filled in (you use Outlook in Chrome)
  const outlook = () => window.open(`https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(email || '')}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(area.value)}`, '_blank', 'noopener');
  const first = to ? to.name.split(/\s+/)[0] : '';
  v.replaceChildren(
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-head' }, h('strong', null, title), h('button', { class: 'icon', 'aria-label': 'Close', onClick: closeSheet }, '✕')),
      busy ? h('p', { class: 'muted' }, 'Writing…') : error ? h('p', { class: 'error' }, error) : area,
      busy || error ? null : h('p', { class: 'muted small' }, 'You can change the words before sending.',
        to && (!phone || !email) ? ` Tip: save ${first}'s ${!phone && !email ? 'phone and email' : !phone ? 'phone' : 'email'} on ${first}'s page, and these buttons go straight to ${first}.` : ''),
      h('div', { class: 'row sheet-actions' },
        busy || error ? null : h('button', { class: 'btn wa' + (phone ? ' primary' : ''), onClick: wa, title: phone ? `Opens WhatsApp chat with ${to.name}` : 'Opens WhatsApp; you pick the person' }, phone ? `WhatsApp ${first}` : 'WhatsApp'),
        busy || error ? null : h('button', { class: 'btn' + (email ? ' primary' : ''), onClick: outlook, title: email ? `New Outlook mail to ${email}` : 'New Outlook mail; you add the person' }, email ? `✉ Outlook ${first}` : '✉ Outlook'),
        busy || error ? null : h('button', { class: 'btn', onClick: copy }, '📋 Copy'),
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
      title, text, subject: step.text, to: personNamed(step.waitingOn),
      extra: h('button', { class: 'btn', title: 'Saves a work note and restarts the waiting count', onClick: () => { chase(p, step); closeSheet(); } }, 'Mark as chased'),
    });
  } catch (e) {
    openSheet({ title, error: e.message });
  }
}

/** 📋 Everything done today, grouped by project, ready to send. */
function todaySummaryText() {
  const dateText = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());
  const base = summaryText(store.view.data, store.view.history, todayIndia(), dateText);
  // the team's updates today (worktask.in), under their projects
  const today = todayIndia();
  const teamToday = [...team.byStep.values()].filter((t) => t.today && t.today.day === today);
  if (!teamToday.length) return base;
  const names = new Map(store.view.data.projects.map((p) => [p.id, p.name]));
  return `${base}\n\nTeam updates:\n${teamToday.map((t) => `- ${t.assignee.name} — ${names.get(t.projectRef) || t.project || ''}: ${t.title}: ${t.today.note}${t.today.state === 'stuck' ? ' (stuck)' : t.today.state === 'finished' ? ' (finished)' : ''}`).join('\n')}`;
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
  if (!aiKeyFor('gemini')) return; // Morning plan / Weekly review use Gemini only (free; saves Claude credit)
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
    if (kind === 'weekly') await store.loadAllHistory();
    // Gemini only, never Claude (the user's choice, to keep Claude credit for AI steps and drafts)
    if (!useAi()) return;
    const gKey = aiKeyFor('gemini');
    const content = kind === 'weekly'
      ? await ai.weeklyReview('gemini', gKey, store.view.data, store.view.history)
      : await ai.morningPlan('gemini', gKey, store.view.data);
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


function visibleProjects() {
  const all = store.view.data.projects;
  const q = ui.search.trim().toLowerCase();
  if (q) return all.filter((p) => projectMatches(p, q));
  if (ui.view === 'today') return awakeProjects(store.view.data, todayIndia());
  if (ui.view === 'all') return all.filter((p) => p.state === 'active');
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
  return { today: 'Today', inbox: 'Inbox', all: 'All projects', paused: 'Paused', finished: 'Finished', diary: 'Diary', settings: 'Settings', people: 'People', dashboard: 'Dashboard', time: 'Time report' }[ui.view];
}

function go(view) {
  ui.view = view;
  ui.rowMenu = null;
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
  // every missing day since the last saved one (so a week away does not break the streak), up to 120 days back
  const savedDays = Object.keys(saved).sort();
  const firstCreated = store.view.data.projects.map((p) => (p.createdAt ? indiaDate(p.createdAt) : today)).sort()[0] || today;
  let from = firstCreated; // every day without a score (a later day scored by the team's work must not hide earlier ones)
  if (from < addDays(today, -120)) from = addDays(today, -120);
  void savedDays;
  const days = [];
  for (let d = from; d < today; d = addDays(d, 1)) if (!saved[d]) days.push(d);
  if (!days.length || !store.view.data.projects.length) return;
  const months = [...new Set(days.map(monthOf))].filter((m) => !store.view.history[m] && store.availableMonths().includes(m));
  try { for (const m of months) await store.loadMonth(m); } catch { return; } // offline: next time
  const scores = {};
  for (const d of days) {
    const sc = dayScore(store.view.data, store.view.history, d);
    if (sc.total) scores[d] = sc;
  }
  if (Object.keys(scores).length) store.dispatch('recordScores', { scores });
}

function todayScore() {
  const today = todayIndia();
  const active = awakeProjects(store.view.data, todayIndia());
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

function select(id) {
  ui.round = null; // opening a project leaves the daily round
  ui.rowMenu = null;
  const list = currentList();
  const at = list.findIndex((x) => x.id === id);
  if (at >= 0) ui.listIndex = at; // remembered, so ↓ ↑ keep your place if this row folds away
  if (ui.selected !== id) {
    ui.selected = id;
    ui.openStep = null;
    ui.historyLimit = 30;
    ui.notesLimit = 3;
    ui.doneLimit = 10;
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

/** Enter in the search box opens the first project found. */
function searchEnter(e, el) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  clearTimeout(searchTimer);
  ui.search = el.value;
  if (!ui.search.trim()) return;
  const first = sortForView(visibleProjects(), todayIndia())[0];
  if (!first) { render(); toast('Nothing found', 1500); return; }
  el.blur();
  select(first.id);
}

function renderMenu() {
  const { data } = store.view;
  const active = data.projects.filter((p) => p.state === 'active');
  const count = (f) => data.projects.filter(f).length;
  const MENU_KEYS = { today: 'T', dashboard: 'B', people: 'P', diary: 'D', inbox: 'Q' };
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
      onInput: (e, el) => { ui.search = el.value; clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); },
      onKeydown: searchEnter,
    }),
    h('ul', { class: 'menu-list' },
      item('today', 'Today', active.filter((p) => !isSnoozed(p, today)).length),
      h('li', { class: 'menu-dots', key: 'dots' },
        h('span', { class: 'dot red' }), String(counts.red), ' ',
        h('span', { class: 'dot yellow' }), String(counts.yellow), ' ',
        h('span', { class: 'dot green' }), String(counts.green)),
      item('inbox', '📥 Inbox', (data.inbox || []).length),
      item('dashboard', 'Dashboard'),
      item('time', 'Time report'),
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
      peopleByFollowUp(data).filter((x) => x.st.colour !== 'green').slice(0, 6).map(({ person, st }) => h('li', { key: 'mp-' + person.id },
        h('button', {
          class: 'menu-item menu-person' + (ui.view === 'people' && ui.person === person.id ? ' current' : ''),
          title: st.waiting ? `Waiting ${st.maxWait} day${st.maxWait === 1 ? '' : 's'}` : `${st.open} to discuss`,
          onClick: () => { ui.menuOpen = false; ctx.openPerson(person.id); },
        }, h('span', null, h('span', { class: `dot ${st.colour}` }), ` ${person.name}`), h('span', { class: 'count' }, String(st.open))))),
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
  const key = aiKeyFor('gemini'); // the plan is made with Gemini only
  if (!key && !ready) return null; // no Gemini key: don't take space
  let body;
  if (ui.brief.error && !ui.brief.busy) body = h('p', { class: 'error' }, `${ui.brief.error} Tap ↻ to try again.`);
  else if (ui.brief.busy || (b && b.date === today && claimIsFresh(b))) body = h('p', { class: 'muted' }, 'Making today\'s plan…');
  else if (!ready) {
    body = h('p', { class: 'muted' }, key
      ? 'No plan yet. Tap ↻ to make one.'
      : 'No plan yet — the Morning plan needs a Gemini key (Settings).');
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
  return h('li', {
    key: 'p-' + p.id, 'data-id': p.id, class: 'prow' + (ui.selected === p.id ? ' current' : ''),
    onContextmenu: (e) => { e.preventDefault(); ui.rowMenu = { id: p.id, x: e.clientX, y: e.clientY }; render(); },
  },
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
      colour === 'green' && greenByTeamOnly(p, today) ? h('span', { class: 'team-green', title: 'Green today because the team sent an update' }, '👥') : null,
      h('span', { class: 'prow-text' },
        h('span', { class: 'prow-name' }, p.name,
          p.state !== 'active' ? h('span', { class: 'tag' }, p.state) : null,
          p.priority === 'high' ? h('span', { class: 'tag high' }, 'High') : null),
        h('span', { class: 'prow-next' + (ns ? '' : ' warn') }, ns ? `Next: ${ns.text}` : 'No next step — add one',
          ns && ns.waiting ? waitingTag(ns) : null,
          ns && ns.snoozedUntil && ns.snoozedUntil > today ? h('span', { class: 'tag repeat' }, `↻ from ${fmtDay(ns.snoozedUntil)}`) : null,
          isOverdue(p, today) ? h('span', { class: 'tag late' }, `Overdue · ${fmtDay(p.deadline)}`) : null,
          isSnoozed(p, today) ? h('span', { class: 'tag snoozed' }, `${p.snoozedUntil > today ? '💤' : '⏰'} back ${fmtDay(restUntil(p, today))}`) : noWorkTag(p, today)),
        p.status ? h('span', { class: 'prow-status' }, p.status) : null)),
    rowAction(p, due, colour),
    canDrag() ? h('span', { class: 'grip', 'aria-hidden': 'true', title: 'Drag to reorder' }, '⋮⋮') : null,
    ui.quickAdd === p.id ? quickAddForm(p) : null);
}

/** One-tap action on a row that is not green yet: "Chased" for a waiting step (a real update). */
function rowAction(p, ns, colour) {
  if (p.state !== 'active' || colour === 'green' || colour === 'grey') return null; // grey = snoozed
  if (ns && ns.waiting) {
    return h('button', { class: 'row-act chase', title: `Followed up${ns.waitingOn ? ' with ' + ns.waitingOn : ''} today`, onClick: () => chase(p, ns) }, 'Chased');
  }
  return null;
}

function chase(p, step) {
  act('chased', { projectId: p.id, stepId: step.id }, `Noted: followed up${step.waitingOn ? ' with ' + step.waitingOn : ''}. Waiting count restarted.`);
}

/** After ticking: if the project has no next step left, ask "What's next?" straight away. */
function afterTick(projectId, where, undo = null) {
  const p = store.view.data.projects.find((x) => x.id === projectId);
  if (!p || p.state !== 'active' || p.steps.some((s) => !s.done)) return false;
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

/** "No real work for 6 days": no update, tick, follow-up or time for that long. */
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
      onClick: () => { ui.round = null; ui.view = 'people'; ui.search = ''; rememberUi(); ctx.selectPerson(person.id); },
      onContextmenu: (e) => openPersonMenu(person.id, e),
    }, h('span', { class: `dot ${st.colour}` }), `${person.name} (${st.open})`))));
}

// ---------------------------------------------------------------- quick capture + Inbox

function openCapture() {
  ui.capture = true;
  ui.rowMenu = null;
  ui.menuOpen = false;
  render();
  focusKey('capture-input');
}

/** The quick capture box: type, Enter, it is in the Inbox. Esc or ✕ closes it. */
/**
 * From the Chrome button: the app opens with #add={text, title, url}. The add box shows it filled in;
 * one tap on a project adds it as a step (with ✉ Open mail), or New project / To Inbox.
 */
const CLIP_KEY = 'dp.clip';

function takeClipFromHash() {
  if (!location.hash.startsWith('#add=')) {
    // a page from the Chrome button that was not added yet (the app went to sign in first): show it again
    try { const c = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); if (c && typeof c === 'object' && !ui.capture) ui.capture = c; } catch { /* none */ }
    return;
  }
  let clip = null;
  try { clip = JSON.parse(decodeURIComponent(location.hash.slice(5))); } catch { clip = null; }
  history.replaceState(null, '', location.pathname + location.search); // a refresh must not add it twice
  if (!clip || typeof clip !== 'object') return;
  const link = cleanLink({ url: clip.url, title: clip.title });
  const text = String(clip.text || clip.title || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!text && !link) return;
  const nameOf = (n) => String(n || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const seen = new Set();
  const people = [clip.from, ...(Array.isArray(clip.people) ? clip.people : [])].map(nameOf)
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, 8);
  ui.capture = { text: text || (link && link.title) || '', link, find: '', people, waitOn: '', when: 0 };
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(ui.capture)); } catch { /* blocked */ } // kept if signing in is needed first
  ui.rowMenu = null;
  ui.menuOpen = false;
  if (store && store.view) { render(); focusKey('capture-input'); }
}

/**
 * From Siri (an iPhone Shortcut): the app opens with #say=<what you said>. It is kept on this device
 * first, so it is not lost if the app is still loading or the key is missing, then saved at once.
 */
const VOICE_KEY = 'dp.voice';
let voiceReady = false;

function readVoice() {
  try { const v = JSON.parse(localStorage.getItem(VOICE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function keepVoice(list) {
  try { if (list.length) localStorage.setItem(VOICE_KEY, JSON.stringify(list)); else localStorage.removeItem(VOICE_KEY); } catch { /* blocked */ }
}

function takeVoiceFromHash() {
  if (!location.hash.startsWith('#say=')) return;
  let said = '';
  try { said = decodeURIComponent(location.hash.slice(5).replace(/\+/g, ' ')); } catch { said = ''; }
  history.replaceState(null, '', location.pathname + location.search); // a refresh must not add it twice
  said = said.replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (said) keepVoice([...readVoice(), { said, at: new Date().toISOString() }]);
  if (voiceReady) runVoice();
}

function runVoice() {
  const list = readVoice();
  if (!list.length || !store || !store.canEdit()) return;
  const left = [];
  let last = null;
  for (const item of list) {
    try { // one note that goes wrong is dropped; it must not stop the others or add them twice
      const { data } = store.view;
      const v = parseVoice(item.said, { projects: activeProjects(data), people: data.people || [], today: item.at ? indiaDate(item.at) : todayIndia() }); // 'tomorrow' from the day it was said
      if (!v) continue;
      if (v.project) {
        if (v.waitOn) ensurePeople([v.waitOn]);
        const stepId = newId();
        const steps = [['addStep', { projectId: v.project.id, stepId, text: v.text }]];
        if (v.waitOn) steps.push(['setStepField', { projectId: v.project.id, stepId, field: 'waitingOn', value: v.waitOn }], ['setStepField', { projectId: v.project.id, stepId, field: 'waiting', value: true }]);
        if (v.date) steps.push(['remindStep', { projectId: v.project.id, stepId, date: v.date }]);
        const done = actMany(v.project.id, steps, null);
        if (done) {
          // "comes back" only when the reminder was really set
          const extra = (v.waitOn ? ` · waiting on ${v.waitOn}` : '') + (v.date && done.ops.some((o) => o.type === 'remindStep') ? ` · comes back ${fmtDay(v.date)}` : '');
          toast(`🎤 Added to ${v.project.name}: ${v.text}${extra}`, 5000, done.undo);
          last = { project: v.project };
        } else left.push(item);
      } else {
        const itemId = newId();
        if (store.dispatch('addInbox', { itemId, text: v.text })) {
          last = { inbox: true };
          toast(`🎤 In your Inbox: ${v.text}${v.missed ? ` (no project called “${v.missed}”)` : ''}`, 8000,
            () => { if (store.dispatch('removeInbox', { itemId })) toast('Undone', 1500); });
        } else left.push(item);
      }
    } catch { /* this note could not be read: dropped */ }
  }
  keepVoice(left);
  if (last && last.project) select(last.project.id);
  else if (last) go('inbox');
}

/** Same mail or page = same key (Outlook: the message id, which stays the same in every folder). */
function linkKey(url) {
  const m = /\/id\/([^/?#]+)/.exec(url || '');
  if (m && /outlook\./.test(url)) { try { return 'mail:' + decodeURIComponent(m[1]); } catch { return 'mail:' + m[1]; } }
  return String(url || '').replace(/#.*$/, '').replace(/\/$/, '');
}

/** Where this mail or page was already added: [{ project, step?, inbox? }]. */
function alreadyAdded(link) {
  if (!link) return [];
  const key = linkKey(link.url);
  const out = [];
  for (const p of store.view.data.projects) {
    for (const st of p.steps) if (st.link && linkKey(st.link.url) === key) out.push({ project: p, step: st });
    if (!out.some((x) => x.project === p) && (p.links || []).some((l) => linkKey(l.url) === key)) out.push({ project: p });
  }
  for (const it of store.view.data.inbox || []) if (it.link && linkKey(it.link.url) === key) out.push({ inbox: it });
  return out;
}

/** Add any new names to People (names already there are matched, ignoring capitals). */
function ensurePeople(names) {
  const people = store.view.data.people || [];
  for (const name of names) {
    if (!people.some((x) => x.name.toLowerCase() === name.toLowerCase())) store.dispatch('addPerson', { personId: newId(), name });
  }
}

function clipBox() {
  const clip = ui.capture;
  const { data } = store.view;
  const close = () => { ui.capture = false; render(); };
  const textNow = () => (document.querySelector('.capture [name=text]')?.value || clip.text).replace(/\s+/g, ' ').trim();
  const find = clip.find.trim().toLowerCase();
  const all = awakeProjects(data, todayIndia());
  const sugg = inboxSuggestions(`${clip.text} ${clip.link ? clip.link.title : ''}`);
  const recent = all.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const list = find ? all.filter((p) => p.name.toLowerCase().includes(find)).slice(0, 8)
    : [...sugg, ...recent.filter((p) => !sugg.includes(p))].slice(0, 6);
  const today = todayIndia();
  const addTo = (p) => {
    let text = textNow();
    if (!text) { toast('Write the step first'); return; }
    ensurePeople(clip.people);
    // the people you kept are @mentioned (they show on the People page); the one you wait on is linked by "Waiting"
    for (const n of clip.people) if (n !== clip.waitOn && !text.toLowerCase().includes('@' + n.toLowerCase())) text += ` @${n}`;
    const stepId = newId();
    if (store.dispatch('addStep', { projectId: p.id, stepId, text, link: clip.link })) {
      if (clip.waitOn) {
        store.dispatch('setStepField', { projectId: p.id, stepId, field: 'waitingOn', value: clip.waitOn });
        store.dispatch('setStepField', { projectId: p.id, stepId, field: 'waiting', value: true });
      }
      if (clip.when) store.dispatch('remindStep', { projectId: p.id, stepId, date: addDays(today, clip.when) });
      ui.capture = false;
      const extra = clip.when ? ` · comes back ${fmtDay(addDays(today, clip.when))}` : clip.waitOn ? ` · waiting on ${clip.waitOn}` : '';
      toast(`Added to ${p.name}: ${textNow()}${extra}`, 3500);
      select(p.id);
    }
  };
  const newProject = () => {
    const text = textNow();
    if (!text) { toast('Write the name first'); return; }
    const projectId = newId();
    const groupId = data.groups[0] && data.groups[0].id;
    const ok = store.dispatch('createProject', { projectId, name: text, groupId });
    if (ok) ensurePeople(clip.people);
    if (ok && clip.link) store.dispatch('addLink', { projectId, linkId: newId(), title: clip.link.title, url: clip.link.url });
    if (ok) { ui.capture = false; toast(`New project: ${text}`, 3000); select(projectId); }
  };
  const toInbox = () => {
    const text = textNow();
    if (!text) { toast('Write something first'); return; }
    if (store.dispatch('addInbox', { itemId: newId(), text, link: clip.link })) { ui.capture = false; toast(`📥 In your Inbox: ${text}`, 2500); render(); }
  };
  return h('div', { class: 'capture-wrap', key: 'capture', onClick: (e, el) => { if (e.target === el) close(); } },
    h('form', {
      class: 'capture clip', role: 'dialog', 'aria-label': 'Add from mail or page',
      onSubmit: (e) => { e.preventDefault(); if (list[0]) addTo(list[0]); else toInbox(); },
    },
    h('div', { class: 'capture-head' }, h('strong', null, isMailLink(clip.link) ? '✉ Add from mail' : '↗ Add from page'),
      h('span', { class: 'muted small' }, 'Enter = add to the first project · Esc = close'),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onClick: close }, '✕')),
    h('input', { name: 'text', key: 'capture-input', value: clip.text, autocomplete: 'off', 'aria-label': 'Step', placeholder: 'What is the next step?', 'data-mention': '1', onInput: (e, el) => { clip.text = el.value; } }),
    clip.link ? h('div', { class: 'clip-link muted small', title: clip.link.url }, '🔗 ', clip.link.title) : null,
    ...alreadyAdded(clip.link).slice(0, 3).map((x, i) => h('div', { class: 'clip-already', key: 'al' + i },
      x.inbox ? `⚠︎ Already in your Inbox: ${x.inbox.text}` : `⚠︎ Already in ${x.project.name}${x.step ? `: ${x.step.text}${x.step.done ? ' (done)' : ''}` : ' (project link)'}`,
      x.project ? h('button', { class: 'chip', type: 'button', onClick: () => { ui.capture = false; select(x.project.id); } }, 'Open') : h('button', { class: 'chip', type: 'button', onClick: () => { ui.capture = false; go('inbox'); } }, 'Open'))),
    clip.people.length ? h('div', { class: 'clip-people' },
      h('span', { class: 'muted small' }, 'People (✕ to remove):'),
      clip.people.map((n) => h('span', { class: 'person-chip', key: 'pp-' + n }, n,
        h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${n}`, onClick: () => {
          clip.text = textNow() || clip.text;
          clip.people = clip.people.filter((x) => x !== n);
          if (clip.waitOn === n) clip.waitOn = '';
          render();
        } }, '✕')))) : null,
    clip.people.length ? h('label', { class: 'clip-wait small' },
      h('input', { type: 'checkbox', checked: !!clip.waitOn, onChange: (e, el) => { clip.text = textNow() || clip.text; clip.waitOn = el.checked ? clip.people[0] : ''; render(); } }),
      ' Waiting for a reply from ',
      h('select', { 'aria-label': 'Waiting on', value: clip.waitOn || clip.people[0], onChange: (e, el) => { clip.text = textNow() || clip.text; clip.waitOn = el.value; render(); } },
        clip.people.map((n) => h('option', { value: n }, n)))) : null,
    h('div', { class: 'clip-when' },
      h('span', { class: 'muted small' }, 'When:'),
      [[0, 'Today'], [1, 'Tomorrow'], [2, 'In 2 days'], [7, '1 week']].map(([d, label]) => h('button', {
        class: 'chip' + (clip.when === d ? ' on' : ''), type: 'button', key: 'w' + d,
        title: d ? `Hide it until ${fmtDay(addDays(today, d))}, then it comes back first` : 'Work on it from today',
        onClick: () => { clip.text = textNow() || clip.text; clip.when = d; render(); },
      }, label))),
    h('div', { class: 'clip-label muted small' }, 'Add as a step to:'),
    h('input', { class: 'clip-find', key: 'clip-find', value: clip.find, autocomplete: 'off', placeholder: 'Search projects…', 'aria-label': 'Search projects',
      onInput: (e, el) => { clip.text = textNow() || clip.text; clip.find = el.value; render(); } }),
    h('div', { class: 'clip-projects' },
      list.length ? list.map((p, i) => h('button', { class: 'chip' + (i === 0 ? ' first' : ''), type: 'button', key: 'cp-' + p.id, onClick: () => addTo(p) }, p.name))
        : h('span', { class: 'muted small' }, find ? 'No project with that name.' : 'No projects yet — use + New project.')),
    h('div', { class: 'row clip-other' },
      h('button', { class: 'btn', type: 'button', onClick: newProject }, '+ New project'),
      h('button', { class: 'btn', type: 'button', onClick: toInbox }, '📥 To Inbox'))));
}

function captureBox() {
  if (ui.capture && typeof ui.capture === 'object') return clipBox();
  return h('div', { class: 'capture-wrap', key: 'capture', onClick: (e, el) => { if (e.target === el) { ui.capture = false; render(); } } },
    h('form', {
      class: 'capture', role: 'dialog', 'aria-label': 'Quick capture',
      onSubmit: (e) => {
        e.preventDefault();
        const input = e.target.elements.text;
        const text = input.value.trim();
        if (!text) { ui.capture = false; render(); return; }
        if (store.dispatch('addInbox', { itemId: newId(), text })) {
          input.value = '';
          ui.capture = false;
          toast(`📥 In your Inbox: ${text}`, 2500);
          render();
        }
      },
    },
    h('div', { class: 'capture-head' }, h('strong', null, '📥 Quick capture'), h('span', { class: 'muted small' }, 'Enter = save to Inbox · Esc = close'),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onClick: () => { ui.capture = false; render(); } }, '✕')),
    h('div', { class: 'row' },
      h('input', { name: 'text', key: 'capture-input', placeholder: 'An idea, a task, a reminder…', autocomplete: 'off', enterkeyhint: 'done', 'data-mention': '1' }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
}

/** Projects whose name shares a word with the item (for one-tap sorting). */
function inboxSuggestions(text) {
  const words = new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));
  const people = (store.view.data.people || []).filter((x) => text.toLowerCase().includes(x.name.toLowerCase()));
  return awakeProjects(store.view.data, todayIndia())
    .map((p) => {
      let score = p.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => words.has(w)).length * 2;
      if (people.some((x) => p.steps.some((s) => !s.done && s.text.includes('@' + x.name)))) score += 1;
      return { p, score };
    })
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.p);
}

/** An Inbox change (send to a project, or delete) with an Undo that puts the item back. */
function inboxAct(type, args, item, message) {
  const inbox = store.view.data.inbox || [];
  const index = inbox.findIndex((x) => x.id === item.id);
  const saved = { id: item.id, text: item.text, createdAt: item.createdAt, ...(item.link ? { link: item.link } : {}) };
  const before = args.projectId && type === 'inboxToStep' ? store.view.data.projects.find((p) => p.id === args.projectId) : null;
  const snapshot = before ? clone(before) : null;
  const op = store.dispatch(type, args);
  if (!op) return null;
  const undo = () => {
    const ok = store.dispatch('inboxUndo', {
      item: saved, index, undoOpId: op.id, undoMonth: opMonth(op),
      ...(type === 'inboxToProject' ? { removeProjectId: args.projectId } : snapshot ? { project: snapshot } : {}),
    });
    if (ok) toast('Undone — back in the Inbox', 1800);
  };
  toast(message, 6000, undo);
  return { op, undo };
}

function renderInbox() {
  const { data } = store.view;
  const items = data.inbox || [];
  const projects = awakeProjects(data, todayIndia()).slice().sort((a, b) => a.name.localeCompare(b.name));
  const toStep = (item, p) => inboxAct('inboxToStep', { itemId: item.id, projectId: p.id, stepId: newId() }, item, `Added to ${p.name}: ${item.text}`);
  return h('div', { class: 'inbox' },
    h('div', { class: 'row inbox-top' },
      h('button', { class: 'btn primary', onClick: openCapture }, '📥 Capture', keyHint('Q')),
      h('span', { class: 'muted small' }, items.length ? 'Send each item to a project. Tap a name, or pick from the list.' : '')),
    items.length ? h('ul', { class: 'inbox-list' }, items.map((item) => {
      const sugg = inboxSuggestions(item.text);
      return h('li', { key: 'ib-' + item.id },
        h('div', { class: 'inbox-text' }, item.text, h('span', { class: 'muted small' }, ` · ${fmtDay(indiaDate(item.createdAt))} `), linkChip(item.link)),
        h('div', { class: 'inbox-actions' },
          sugg.map((p) => h('button', { class: 'chip sugg', key: 'sg-' + p.id, title: `Add as a step in ${p.name}`, onClick: () => toStep(item, p) }, `→ ${p.name}`)),
          h('select', {
            class: 'inbox-pick', 'aria-label': 'Send to project', key: 'pick-' + item.id, value: '',
            onChange: (e, el) => {
              const v = el.value;
              el.value = '';
              if (v.startsWith('new:')) {
                const groupId = v.slice(4);
                const projectId = newId();
                if (inboxAct('inboxToProject', { itemId: item.id, projectId, groupId }, item, `New project: ${item.text}`)) render();
              } else {
                const p = data.projects.find((x) => x.id === v);
                if (p) toStep(item, p);
              }
            },
          },
          h('option', { value: '' }, 'Send to project…'),
          projects.map((p) => h('option', { value: p.id }, p.name)),
          data.groups.map((g) => h('option', { value: 'new:' + g.id }, `+ New project in ${g.name}`))),
          h('button', { class: 'icon', title: 'Delete', 'aria-label': 'Delete', onClick: () => inboxAct('removeInbox', { itemId: item.id }, item, 'Removed from Inbox') }, '🗑')));
    })) : h('p', { class: 'empty-list' }, 'Inbox is empty. Press Q anywhere (or 📥 at the top) to write something down fast.'));
}

/** Today: "📥 Inbox (3) — sort now" when something is waiting there. */
function inboxReminder() {
  const n = (store.view.data.inbox || []).length;
  if (!n) return null;
  return h('button', { class: 'inbox-reminder', key: 'inbox-rem', onClick: () => go('inbox') }, `📥 Inbox (${n}) — sort now →`);
}

/** The small menu that opens when you right-click a project in the list. */
function rowMenu() {
  const m = ui.rowMenu;
  if (m && m.kind === 'person') return personMenu(m);
  const p = m && store.view.data.projects.find((x) => x.id === m.id);
  if (!p) return null;
  const today = todayIndia();
  const due = p.state === 'active' && nextStep(p, today, { dueOnly: true });
  const g = store.view.data.groups.find((x) => x.id === p.groupId);
  const timing = store.view.data.timer && store.view.data.timer.projectId === p.id;
  const item = (icon, label, fn) => h('button', {
    class: 'row-menu-item', role: 'menuitem',
    onClick: () => { ui.rowMenu = null; fn(); render(); },
  }, h('span', { class: 'rm-icon', 'aria-hidden': 'true' }, icon), label);
  const el = h('div', { class: 'row-menu', role: 'menu', key: 'row-menu', 'aria-label': `Actions for ${p.name}` },
    h('div', { class: 'row-menu-title' }, p.name),
    due ? item('✓', `Tick: ${due.text}`, () => quickTick(p, due)) : null,
    p.state === 'active' ? item('+', 'Add a step', () => { select(p.id); focusKey('add-step-' + p.id); }) : null,
    p.state === 'active' ? item('📝', 'Write an update', () => { select(p.id); focusKey('wn-' + p.id); }) : null,
    due && due.waiting ? item('📞', `Chased${due.waitingOn ? ' ' + due.waitingOn : ''}`, () => chase(p, due)) : null,
    p.state === 'active' ? (p.snoozedUntil && p.snoozedUntil > today
      ? item('⏰', 'Wake up now', () => act('wake', { projectId: p.id }, `Back on Today: ${p.name}`))
      : item('💤', 'Snooze…', () => { select(p.id); ui.snoozeOpen = p.id; focusKey('snooze-' + p.id); })) : null,
    p.state === 'active' && groupHasTimer(g || {}) ? item(timing ? '⏹' : '▶', timing ? 'Stop timer' : 'Start timer', () => (timing ? stopTimer() : startTimer(p))) : null,
    p.state === 'active' ? item('⏸', 'Pause project', () => act('pause', { projectId: p.id }, `Paused: ${p.name}`))
      : p.state === 'paused' ? item('▶', 'Unpause project', () => act('unpause', { projectId: p.id }, `Back on Today: ${p.name}`)) : null,
    onServer && p.state === 'active' ? (p.team
      ? item('👥', `Take back from ${p.team.name}`, () => { if (confirm(`Take "${p.name}" back from ${p.team.name}? Their open steps are removed from their list.`)) giveProject(p, null); })
      : item('👥', 'Give project to…', () => { select(p.id); ui.giveOpen = p.id; ui.givePhoto = false; })) : null,
    item('↗', 'Open', () => select(p.id)),
    item('🗑', 'Delete project…', () => {
      if (!confirm(`Delete "${p.name}"?\n\nYou can press Undo for a few seconds after.`)) return;
      act('deleteProject', { projectId: p.id }, `Deleted: ${p.name}`, 10000);
      if (ui.selected === p.id) { ui.selected = null; ui.mobile = 'list'; }
    }));
  // keep it on the screen (style object: allowed by the page's safety rules)
  el.style.left = Math.max(8, Math.min(m.x, window.innerWidth - 270)) + 'px';
  el.style.top = Math.max(8, Math.min(m.y, window.innerHeight - 330)) + 'px';
  return el;
}

function canDrag() {
  return !ui.search && ui.sort === 'mine';
}

/** Right-click on a person (People list or the side menu): the things you can do with them. */
function openPersonMenu(personId, e) {
  e.preventDefault();
  ui.rowMenu = { kind: 'person', id: personId, x: e.clientX, y: e.clientY };
  if (onServer) teamAccounts(); // to know if they can sign in to Work Task
  render();
}

/** Every Work Task account (to match a person by name). null while loading. */
function teamAccounts(force = false) {
  if (team.accounts && !force) return team.accounts;
  if (!team.accountsLoading) {
    team.accountsLoading = true;
    teamApi('users.list').then((out) => { team.accounts = out.users; team.accountsLoading = false; render(); })
      .catch(() => { team.accountsLoading = false; });
  }
  return team.accounts || null;
}

/** A first password that is easy to read out: kiln-clay-427. */
function firstPassword() {
  const words = ['kiln', 'glaze', 'clay', 'tile', 'mould', 'fire', 'slip', 'basin', 'press', 'dryer'];
  const a = crypto.getRandomValues(new Uint32Array(3));
  return `${words[a[0] % words.length]}-${words[a[1] % words.length]}-${100 + (a[2] % 900)}`;
}

/** The sign-in details, ready to send (WhatsApp / Outlook straight to the person when their number / email is saved). */
function sendSignIn(person, username, password, isNew) {
  const link = location.origin + '/';
  openSheet({
    title: isNew ? `Sign-in for ${person.name}` : `New password for ${person.name}`,
    text: `Work Task (daily updates)\nLink: ${link}\nUsername: ${username}\nPassword: ${password}\nAfter signing in, choose your own password.`,
    subject: 'Your Work Task sign-in', to: person,
  });
}

/** Give a person a Work Task sign-in (username from their first name; a number is added if it is taken). */
async function giveSignIn(person) {
  const base = (person.name.trim().split(/\s+/)[0] || 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'user';
  const password = firstPassword();
  for (const extra of ['', '1', '2', '3', String(Date.now() % 1000)]) {
    let name = (base + extra).slice(0, 40);
    if (name.length < 3) name = (name + 'user').slice(0, 40);
    try {
      const out = await teamApi('user.save', { name: person.name, username: name, password, role: 'staff' });
      teamAccounts(true);
      sendSignIn(person, out.user.username, password, true);
      return;
    } catch (e) {
      if (!/taken/i.test(e.message)) { toast(e.message, 6000); return; }
    }
  }
  toast('Could not find a free username. Add them in Team → People.', 6000);
}

async function newPasswordFor(person, account) {
  if (!confirm(`Give ${person.name} a new first password?\nThey are signed out and choose their own again.`)) return;
  const password = firstPassword();
  try { await teamApi('user.reset', { id: account.id, password }); sendSignIn(person, account.username, password, false); }
  catch (e) { toast(e.message, 6000); }
}

function personMenu(m) {
  const person = (store.view.data.people || []).find((x) => x.id === m.id);
  if (!person) return null;
  const item = (icon, label, fn, cls = '') => h('button', {
    class: 'row-menu-item' + cls, role: 'menuitem',
    onClick: () => { ui.rowMenu = null; fn(); render(); },
  }, h('span', { class: 'rm-icon', 'aria-hidden': 'true' }, icon), label);
  const open = () => { ui.view = 'people'; ui.search = ''; rememberUi(); ctx.selectPerson(person.id); };
  const accounts = onServer ? teamAccounts() : null;
  const account = accounts && accounts.find((u) => u.name.trim().toLowerCase() === person.name.trim().toLowerCase());
  const el = h('div', { class: 'row-menu', role: 'menu', key: 'person-menu', 'aria-label': `Actions for ${person.name}` },
    h('div', { class: 'row-menu-title' }, person.name),
    item('↗', 'Open', open),
    item('+', `Add a task with ${person.name}`, () => { open(); focusKey('person-task-input'); }),
    item('📋', 'Send pending list…', () => ctx.openPersonMessage(person)),
    person.phone ? item('💬', `WhatsApp ${person.name}`, () => window.open(`https://wa.me/${person.phone}`, '_blank', 'noopener')) : null,
    item('📞', person.phone || person.email ? 'Change number / email' : 'Add WhatsApp number / email', open),
    onServer ? (accounts === null ? h('div', { class: 'row-menu-note muted small' }, 'Checking Work Task sign-in…')
      : account ? [
        h('div', { class: 'row-menu-note muted small' }, `Work Task: @${account.username}${account.active ? '' : ' (switched off)'}`),
        item('🔑', 'New password…', () => newPasswordFor(person, account)),
        item('👥', 'Their tasks (Team)', () => { location.href = '../?team'; }),
      ] : item('🔑', 'Give a Work Task sign-in', () => giveSignIn(person))) : null,
    item('✎', 'Rename…', () => {
      const n = prompt('Name:', person.name);
      if (n && n.trim() && n.trim() !== person.name) store.dispatch('renamePerson', { personId: person.id, name: n.trim() });
    }),
    item('🗑', 'Remove from People…', () => {
      if (confirm(`Remove ${person.name} from People?\n\nTheir name stays in your steps and notes; it is just no longer linked.${account ? '\nTheir Work Task sign-in is not changed.' : ''}`)) { if (store.dispatch('deletePerson', { personId: person.id })) toast(`Removed: ${person.name}`); }
    }, ' danger'));
  el.style.left = Math.max(8, Math.min(m.x, window.innerWidth - 270)) + 'px';
  el.style.top = Math.max(8, Math.min(m.y, window.innerHeight - 420)) + 'px';
  return el;
}

/** Tick a project's next step straight from the list. */
function quickTick(p, step, el = null) {
  if (el) el.checked = true;
  const done = act('tickStep', { projectId: p.id, stepId: step.id });
  if (!done) { if (el) el.checked = false; return; }
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
  const active = awakeProjects(store.view.data, todayIndia());
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

/** After the updates are due (18:00 by default): which projects still have nothing today. Tap a name to open it. */
function eveningCheck(today) {
  const nowHm = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  if (nowHm < (team.fillBy || '18:00')) return null;
  const left = awakeProjects(store.view.data, today).filter((p) => dotColour(p, today) !== 'green');
  if (!left.length) return null;
  return h('div', { class: 'evening-check', key: 'evening' },
    `🕕 Nothing today on ${left.length} project${left.length > 1 ? 's' : ''}: `,
    left.slice(0, 8).map((p, i) => [i ? ', ' : '', h('button', { class: 'link', type: 'button', key: 'ev-' + p.id, onClick: () => select(p.id) }, p.name)]),
    left.length > 8 ? ` and ${left.length - 8} more` : '');
}

/** Today: one line about the team — sent / due, stuck, new messages, who has not filled. Opens Team today. */
function teamLine() {
  if (!onServer || !team.summary) return null;
  const s = team.summary; const a = team.alerts;
  if (!s.due && !a.stuck && !a.unread && !a.suggestions) return null;
  const bits = [];
  if (s.due) bits.push(`${s.sent} of ${s.due} sent`);
  if (a.stuck) bits.push(`${a.stuck} stuck`);
  if (a.unread) bits.push(`${a.unread} new message${a.unread > 1 ? 's' : ''}`);
  if (a.suggestions) bits.push(`${a.suggestions} suggestion${a.suggestions > 1 ? 's' : ''}`);
  const missing = s.notFilled.length ? ` · ${team.late ? 'not filled' : 'waiting'}: ${s.notFilled.join(', ')}` : '';
  const bad = a.stuck || (team.late && s.notFilled.length);
  const m = team.messages[0];
  const ofProject = m && m.projectRef && store.view.data.projects.some((p) => p.id === m.projectRef);
  return [
    h('a', { class: 'team-line' + (bad ? ' late' : s.due && s.sent === s.due ? ' ok' : ''), href: '../?team', key: 'team-line', title: 'Open Team today' },
      `👥 Team: ${bits.join(' · ')}${missing}`),
    // the newest message from the team, right here: tap = open the project (or the task in the team app) to read and answer
    m ? h('a', {
      class: 'team-line msg', key: 'team-msg', href: ofProject ? '#' : `../?team#open=${m.taskId}`, title: 'Read and answer',
      onClick: (e) => { if (!ofProject) return; e.preventDefault(); select(m.projectRef); },
    }, `💬 ${m.by}: “${m.text.length > 70 ? m.text.slice(0, 68) + '…' : m.text}”${team.messages.length > 1 ? ` (+${team.messages.length - 1} more)` : ''} — answer →`) : null,
  ];
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
  // A steady cloud sign: ✓ when everything is saved. "Saving" only shows if it takes more than a second.
  if (s === 'saved') return h('span', { class: 'status sync ok', title: 'All your changes are saved', 'aria-label': 'Saved' }, '☁︎✓');
  if (s === 'saving' || s === 'checking') {
    return h('span', { class: 'status sync busy', title: s === 'checking' ? 'Getting the newest data…' : 'Saving…', 'aria-label': 'Saving' },
      '☁︎', h('span', { class: 'sync-dots' }, '…'));
  }
  if (s === 'offline') {
    const since = store.snapshotAt ? ` · data from ${fmtTime(store.snapshotAt)}` : '';
    return h('span', { class: 'status bad', title: 'Your changes wait on this device and are saved when the internet is back' }, `Offline — ${store.pending.length} waiting${since}`);
  }
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
    h('button', { class: 'icon', title: 'Quick capture: write down an idea or task (key: q)', 'aria-label': 'Quick capture', onClick: openCapture }, '📥'),
    h('button', { class: 'icon', title: 'Jump to a project, person or page (Ctrl+K)', 'aria-label': 'Jump', onClick: openJump }, '🔍'),
    onServer ? teamButton() : null,
    h('button', { class: 'icon', title: 'Get latest', 'aria-label': 'Refresh', onClick: () => doRefresh(true) }, '↻'));
  const mobileSearch = h('input', {
    class: 'search mobile-only', type: 'search', placeholder: withKey('Search…', '/'), value: ui.search, key: 'search-mobile', 'aria-label': 'Search',
    onInput: (e, el) => { ui.search = el.value; clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); },
    onKeydown: searchEnter,
  });

  if (ui.view === 'diary' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderDiary());
  if (ui.view === 'inbox' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderInbox());
  if (ui.view === 'settings' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderSettings());
  if (ui.view === 'dashboard' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderDashboard(ctx));
  if (ui.view === 'time' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderTimeReport(ctx));
  if (ui.view === 'people' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderPeopleList(ctx), rowMenu());

  const list = sortForView(visibleProjects(), today);
  const showSort = !ui.search && ui.view !== 'paused' && ui.view !== 'finished' && list.length > 1;
  const empty = !list.length ? h('p', { class: 'empty-list' },
    ui.search ? 'Nothing found.' : ui.view === 'paused' ? 'No paused projects.' : ui.view === 'finished' ? 'No finished projects yet.'
      : 'No projects yet. Add your first one with "+ New project".') : null;
  return h('div', { class: 'col-inner' },
    head,
    timerStrip(),
    mobileSearch,
    ui.view === 'today' && !ui.search ? celebration() : null,
    ui.view === 'today' && !ui.search ? progressLine(today) : null,
    ui.view === 'today' && !ui.search ? teamLine() : null,
    ui.view === 'today' && !ui.search ? eveningCheck(today) : null,
    ui.view === 'today' && !ui.search ? followUpRow() : null,
    ui.view === 'today' && !ui.search ? inboxReminder() : null,
    ui.view === 'today' && !ui.search ? renderBrief() : null,
    h('div', { class: 'list-tools' },
      ui.view === 'finished' || ui.view === 'paused' || ui.search ? null : newProjectForm(),
      showSort && !ui.adding ? sortSwitch() : null),
    ...listParts(list, today),
    empty,
    rowMenu());
}

/** Today: projects not yet green, then a folded "Done today (n)" group. Other views: one list. */
function splitToday(list, today) {
  if (ui.view !== 'today' || ui.search) return { open: list, done: [] };
  return { open: list.filter((p) => dotColour(p, today) !== 'green'), done: list.filter((p) => dotColour(p, today) === 'green') };
}

function listParts(list, today) {
  const { open, done } = splitToday(list, today);
  const parts = [h('ul', { class: 'plist', key: 'plist-' + (ui.search ? 'search' : ui.view) }, open.map((p) => projectRow(p, today)))];
  // Today: snoozed projects wait in their own folded list, with the day they come back
  const snoozed = ui.view === 'today' && !ui.search ? store.view.data.projects.filter((p) => isSnoozed(p, today)) : [];
  if (snoozed.length) {
    parts.push(h('button', {
      class: 'done-toggle', key: 'snooze-toggle', 'aria-expanded': String(!!ui.showSnoozed),
      onClick: () => { ui.showSnoozed = !ui.showSnoozed; render(); },
    }, `${ui.showSnoozed ? '▾' : '▸'} 💤 Snoozed (${snoozed.length})`));
    if (ui.showSnoozed) parts.push(h('ul', { class: 'plist-done', key: 'plist-snoozed' }, snoozed.sort((a, b) => (restUntil(a, today) < restUntil(b, today) ? -1 : 1)).map((p) => projectRow(p, today))));
  }
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
  const { history } = store.view;
  const byDay = diaryEntries(store.view.data, history);
  const days = [...byDay.keys()].sort().reverse();
  const shown = days.slice(0, ui.diaryDays);
  const loaded = new Set(Object.keys(history));
  const older = store.availableMonths().find((m) => !loaded.has(m));
  return h('div', { class: 'diary' },
    weekBars(),
    shown.length ? null : h('p', { class: 'empty-list' }, 'Nothing yet. Ticked steps and work notes will show here.'),
    shown.map((d) => h('section', { class: 'diary-day', key: 'd-' + d },
      h('h3', null, fmtLongDay(d)),
      h('ul', null, byDay.get(d).map((l) => h('li', null,
        h('span', { class: 'muted small' }, fmtTime(l.at)), ' ',
        l.exists
          ? h('button', { class: 'link', onClick: () => ctx.openProject(l.projectId) }, l.name)
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
    const backup = backupPayload(store.view.data, store.view.history); // AI keys are left out
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
    h('section', { class: 'block' }, h('h3', null, onServer ? 'Account' : 'GitHub access key'),
      h('p', null, isMock ? 'Test mode (no real GitHub).' : onServer ? 'Signed in to Work Task ✓ Your projects are private to you.' : 'Connected to your private data ✓'),
      h('div', { class: 'row' },
        isMock || onServer ? null : h('button', { class: 'btn', onClick: () => showKeyScreen('Paste your new GitHub access key.') }, 'Change key'),
        onServer ? h('a', { class: 'btn', href: '../?team' }, '👥 Team') : null,
        onServer ? h('button', { class: 'btn', onClick: signOutServer }, 'Sign out') : null,
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
    h('section', { class: 'block' }, h('h3', null, 'Typing'),
      h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', checked: autocorrectOn(),
          onChange: (e, el) => { setAutocorrect(el.checked); device.setAutocorrect(el.checked); toast(el.checked ? 'Auto-correct is on' : 'Auto-correct is off', 1500); },
        }), ' Auto-correct common typing mistakes (e.g. "teh" → "the", "becasue" → "because")'),
      h('p', { class: 'muted small' }, 'Works without AI or internet. Pressing Backspace right after a fix puts your own spelling back. Words starting with @ are never changed.')),
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
    h('section', { class: 'block' }, h('h3', null, 'Groups and tags'),
      h('p', { class: 'muted small' }, 'Tags belong to a group; each project picks one. The timer and the Time report use the groups that have the timer on.'),
      data.groups.map((g) => h('div', { class: 'group-set', key: 'gs-' + g.id },
        h('div', { class: 'row' },
          h('strong', null, g.name),
          h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: groupHasTimer(g), onChange: (e, el) => store.dispatch('setGroupTimer', { groupId: g.id, on: el.checked }) }),
            ' Timer')),
        h('div', { class: 'tag-list' },
          (g.tags || []).map((t) => h('span', { class: 'tag tag-chip', key: 'tg-' + t.id }, `🏷 ${t.name}`,
            h('button', {
              class: 'icon tiny-x', title: 'Rename tag',
              onClick: () => { const n = prompt('Rename tag:', t.name); if (n && n.trim()) store.dispatch('renameTag', { groupId: g.id, tagId: t.id, name: n.trim() }); },
            }, '✎'),
            h('button', {
              class: 'icon tiny-x', title: 'Delete tag',
              onClick: () => {
                const used = data.projects.filter((p) => p.tagId === t.id).length;
                if (confirm(`Delete the tag "${t.name}"?${used ? `\n\n${used} project(s) use it; they will have no tag (their time is kept).` : ''}`)) store.dispatch('deleteTag', { groupId: g.id, tagId: t.id });
              },
            }, '✕'))),
          h('button', {
            class: 'btn small',
            onClick: () => {
              const n = prompt(`New tag for ${g.name}:`);
              if (n && n.trim() && !store.dispatch('addTag', { groupId: g.id, tagId: newId(), name: n.trim() })) toast(`"${n.trim()}" already exists in ${g.name}`);
            },
          }, '+ Tag'))))),
    h('section', { class: 'block' }, h('h3', null, 'Backup'),
      h('p', { class: 'muted' }, 'Every save is kept as a version, so nothing is lost. You can also download a copy.'),
      h('button', { class: 'btn', onClick: downloadBackup }, 'Download backup')),
    h('section', { class: 'block' }, h('h3', null, 'iPhone'),
      h('p', null, onServer ? 'Open worktask.in in Safari and sign in. Share → "Add to Home Screen" puts it on your phone like an app.'
        : 'Always open Daily Projects from its home-screen icon. In Safari: Share → "Add to Home Screen". Then paste your keys inside the icon app.')));
}

async function signOutServer() {
  const waiting = store.pending.length;
  if (waiting && !confirm(`${waiting} change(s) are not saved yet and will be lost. Sign out anyway?`)) return;
  clearTimeout(store.saveTimer);
  store.forgetPending(); // before clearing storage below; also stops the leave-page check from sending them
  try { await fetch('../api/?a=logout', { method: 'POST', headers: { Authorization: 'Bearer ' + serverToken() } }); } catch { /* signed out anyway */ }
  try { localStorage.removeItem(SERVER_TOKEN_KEY); localStorage.removeItem('dp.pending'); localStorage.removeItem('dp.snapshot'); } catch { /* blocked */ }
  location.href = '../';
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

/** The old address (GitHub Pages) after the move: send people to worktask.in. Waiting changes stay on this device. */
function showMoved() {
  let waiting = [];
  try { waiting = JSON.parse(localStorage.getItem('dp.pending') || '[]'); } catch { waiting = []; }
  let moved = [];
  try { moved = JSON.parse(localStorage.getItem('dp.pending.moved') || '[]'); } catch { moved = []; }
  if (!Array.isArray(moved)) moved = [];
  // Siri (#say=) and the Chrome button (#add=) still work with the old address: pass them on.
  // A Siri note or Chrome-button page goes on at once; changes still waiting here stay on this device
  // and are offered (the button below) the next time this old address is opened.
  if ((!waiting.length && !moved.length) || /^#(say|add)=/.test(location.hash)) { location.replace(MOVED_TO + location.hash); return; }
  const screen = document.getElementById('keyscreen');
  screen.hidden = false;
  root.hidden = true;
  if (!waiting.length) {
    // changes taken across before: offered again until you say they arrived (the new address adds each one only once)
    screen.replaceChildren(h('div', { class: 'key-card' },
      h('img', { src: 'icons/icon-192.png', alt: '', width: 64, height: 64 }),
      h('h1', null, 'Daily Projects has moved'),
      h('p', null, `${moved.length} change(s) from this device were taken to worktask.in. If they did not arrive there, take them again.`),
      h('a', { class: 'btn primary', href: MOVED_TO + '#ops=' + encodeURIComponent(JSON.stringify(moved)) }, `Take my ${moved.length} change(s) again`),
      h('p', null, h('button', { class: 'btn', type: 'button', onClick: () => { try { localStorage.removeItem('dp.pending.moved'); } catch { /* blocked */ } location.replace(MOVED_TO); } }, 'Done, they arrived'))));
    return;
  }
  // changes made on this device that never reached GitHub: carry them to the new address (it adds them to its queue)
  // (with any taken across before that were not yet said to have arrived: the new address adds each one only once)
  const ids = new Set(waiting.map((o) => o && o.id));
  const all = [...moved.filter((o) => !(o && ids.has(o.id))), ...waiting];
  const carry = MOVED_TO + '#ops=' + encodeURIComponent(JSON.stringify(all));
  screen.replaceChildren(h('div', { class: 'key-card' },
    h('img', { src: 'icons/icon-192.png', alt: '', width: 64, height: 64 }),
    h('h1', null, 'Daily Projects has moved'),
    h('p', null, 'Your projects are now at worktask.in. Sign in there with your username and password.'),
    h('p', null, `⚠︎ ${waiting.length} change(s) made on this device were not sent before the move. The button below takes them with you.`),
    h('a', { class: 'btn primary', href: carry, onClick: () => { try { localStorage.setItem('dp.pending.moved', JSON.stringify(all)); localStorage.removeItem('dp.pending'); } catch { /* kept */ } } }, `Open worktask.in with my ${waiting.length} change(s)`)));
}

const CARRIED_KEY = 'dp.carriedIds'; // ids of changes already taken from the old address

/** From the old address: #ops=[…] are changes that never reached GitHub. Add them to this device's queue (no doubles). */
function takeOpsFromHash() {
  if (!location.hash.startsWith('#ops=')) return;
  let ops = [];
  try { ops = JSON.parse(decodeURIComponent(location.hash.slice(5))); } catch { ops = []; }
  history.replaceState(null, '', location.pathname + location.search);
  if (!Array.isArray(ops) || !ops.length) return;
  let mine = [];
  try { mine = JSON.parse(localStorage.getItem('dp.pending') || '[]'); } catch { mine = []; }
  const have = new Set(mine.map((o) => o.id));
  // changes carried before (and maybe saved since, so no longer waiting): never added a second time over newer edits
  let carried = [];
  try { carried = JSON.parse(localStorage.getItem(CARRIED_KEY) || '[]'); } catch { carried = []; }
  if (!Array.isArray(carried)) carried = [];
  const took = new Set(carried);
  // a link can come from anyone: only harmless kinds of change, and only after a yes
  const { ok, files, dropped } = carriedOps(ops);
  const add = ok.filter((o) => !have.has(o.id) && !took.has(o.id));
  const filesMsg = (files ? ` ${files} photo(s)/file(s) could not come along: please add them again.` : '')
    + (dropped ? ` ${dropped} change(s) (deletes, team changes) could not come along: please do them again.` : '');
  if (!add.length) {
    const msg = (ok.length ? 'These changes already arrived here ✓' : '') + filesMsg;
    if (msg) setTimeout(() => toast(msg.trim(), 8000), 1500);
    return;
  }
  const kinds = [...new Set(add.map((o) => o.type))].join(', ');
  if (!confirm(`Add ${add.length} change(s) carried from the old address (kinds: ${kinds})?${filesMsg}\n\nSay No if you did not just come from the old address.`)) return;
  try { localStorage.setItem('dp.pending', JSON.stringify([...mine, ...add])); } catch { toast('Could not keep the changes on this device. Open the old address again to bring them.', 8000); return; }
  try { localStorage.setItem(CARRIED_KEY, JSON.stringify([...carried, ...add.map((o) => o.id)].slice(-2000))); } catch { /* full */ }
  setTimeout(() => toast(`${add.length} change(s) from the old address added ✓${filesMsg}`, filesMsg ? 8000 : 5000), 1500);
}

// ---------------------------------------------------------------- render

function focusKey(key) {
  setTimeout(() => {
    const el = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el) el.focus();
  }, 30);
}

function setupSortable() {
  if (!window.Sortable) return;
  const lists = root.querySelectorAll('.plist:not(.people-list), .sortable-steps');
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
  }
}

function render() {
  if (!store || !store.view) {
    root.replaceChildren(h('div', { class: 'loading' }, store && store.status === 'offline' ? 'No connection. Retrying…' : 'Loading…'));
    return;
  }
  if (ui.selected && !store.view.data.projects.some((p) => p.id === ui.selected)) ui.selected = null;
  if (!(ui.capture && typeof ui.capture === 'object')) { try { localStorage.removeItem(CLIP_KEY); } catch { /* blocked */ } } // added or closed
  const wide = ['diary', 'settings', 'dashboard', 'time'].includes(ui.view) && !ui.search;
  const next = h('div', {
    class: ['layout', wide ? 'wide' : '', ui.mobile === 'detail' && !wide ? 'show-detail' : '', ui.menuOpen ? 'menu-open' : ''].join(' ').trim(),
  },
  h('aside', { id: 'menu' }, renderMenu()),
  h('div', { class: 'scrim', onClick: () => { ui.menuOpen = false; render(); } }),
  h('main', { id: 'list' }, renderListColumn()),
  wide ? null : h('section', { id: 'detail' }, ui.round ? renderRound() : ui.view === 'people' && !ui.search ? renderPerson(ctx) : renderDetail(ctx)),
  ui.showKeys ? keysHelp() : null,
  ui.capture ? captureBox() : null,
  offlineBar(),
  unsentBar(),
  tabBar());
  const moves = takePositions();
  if (root.firstChild && root.firstChild.classList && root.firstChild.classList.contains('layout')) morph(root.firstChild, next);
  else root.replaceChildren(next);
  playMoves(moves);
  document.body.classList.toggle('on-detail', ui.mobile === 'detail' || ui.menuOpen); // phone: messages sit lower when the bottom bar is hidden
  restoreScrollOnce();
  setupSortable();
}

/** A red bar when a change has waited over a minute without reaching GitHub (so it would be missing on the other computer). */
const UNSENT_AFTER_MS = 60 * 1000;
/** No internet: say so at once, and that work goes on (changes wait on this device). */
function offlineBar() {
  if (!store || store.status !== 'offline') return null;
  const n = store.pending.length;
  return h('button', {
    class: 'offline-bar', key: 'offline', type: 'button', title: 'Try to connect now',
    onClick: () => doRefresh(true).then(() => { if (store.status !== 'offline') toast(store.pending.length ? 'Back online — sending…' : 'Back online ✓'); render(); }),
  }, '📴 ', h('b', null, 'Offline'), ' — you can keep working. ',
  n ? (n === 1 ? '1 change waits on this device and is sent when you are back online.' : `${n} changes wait on this device and are sent when you are back online.`)
    : 'Changes you make are kept here and sent when you are back online.',
  store.snapshotAt ? ` (Data as of ${fmtTime(store.snapshotAt)}.)` : '');
}

function unsentBar() {
  if (!store || !store.pending.length || store.status === 'auth' || store.status === 'offline') return null;
  const oldest = Date.parse(store.pending[0].at);
  if (!(Date.now() - oldest > UNSENT_AFTER_MS)) return null;
  const n = store.pending.length;
  const what = `${n} change${n === 1 ? '' : 's'} not sent yet`;
  const why = store.status === 'offline' ? ' — no internet. Keep this computer on; they send when the internet is back. Tap to try now.'
    : store.saving ? ' — sending now…' : ' — your other computer cannot see them. Tap to send.';
  return h('button', {
    class: 'unsent-bar', key: 'unsent', type: 'button', title: 'Send waiting changes now',
    onClick: () => doRefresh(true).then(() => { if (!store.pending.length) toast('All sent ✓'); render(); }),
  }, '⚠︎ ', h('b', null, what), why);
}

/** Phone only: a fixed bar at the bottom — Today, Inbox, People, More (the menu). Hidden on the desktop by CSS. */
function tabBar() {
  const n = (store.view.data.inbox || []).length;
  const tab = (view, icon, label, extra = null) => h('button', {
    class: 'tab' + (ui.view === view && !ui.search && !ui.menuOpen ? ' current' : ''), key: 'tab-' + view, 'aria-label': label,
    onClick: () => go(view),
  }, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, icon), h('span', { class: 'tab-label' }, label), extra);
  return h('nav', { class: 'tabbar', key: 'tabbar', 'aria-label': 'Main pages' },
    tab('today', '☀︎', 'Today'),
    tab('inbox', '📥', 'Inbox', n ? h('span', { class: 'tab-count' }, String(n)) : null),
    tab('people', '👥', 'People'),
    h('button', { class: 'tab' + (ui.menuOpen ? ' current' : ''), key: 'tab-more', 'aria-label': 'More pages', onClick: () => { ui.menuOpen = true; render(); } },
      h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, '☰'), h('span', { class: 'tab-label' }, 'More')));
}

// ---------------------------------------------------------------- gentle movement
// Rows that move (a project turning green, a step going to Done) slide to their new place; rows that leave fade out.
// Only within the same list (same tab, same project) — switching pages never animates.

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastMoveContext = '';

function takePositions() {
  if (REDUCED_MOTION || !root.firstChild) return null;
  const context = `${ui.view}|${ui.search}|${ui.selected}|${ui.mobile}`;
  const same = context === lastMoveContext;
  lastMoveContext = context;
  if (!same) return null;
  const rows = root.querySelectorAll('#list .prow[data-id], #detail .step[data-id]');
  if (!rows.length || rows.length > 120) return null;
  const map = new Map();
  for (const el of rows) {
    const r = el.getBoundingClientRect();
    if (r.height) map.set((el.closest('#list') ? 'p:' : 's:') + el.dataset.id, { el, r });
  }
  return map;
}

function playMoves(before) {
  if (!before || !before.size) return;
  const now = new Map();
  for (const el of root.querySelectorAll('#list .prow[data-id], #detail .step[data-id]')) now.set((el.closest('#list') ? 'p:' : 's:') + el.dataset.id, el);
  for (const [id, { el: oldEl, r }] of before) {
    const el = now.get(id);
    if (el) {
      const n = el.getBoundingClientRect();
      const dy = r.top - n.top;
      if (Math.abs(dy) > 2 && Math.abs(dy) < 1200 && el.animate) {
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)' });
      }
    } else if (!oldEl.isConnected && oldEl.animate && r.top < window.innerHeight && r.bottom > 0) {
      // the row left this list: a copy fades out where it was
      const ghost = document.createElement(oldEl.nodeName === 'LI' ? 'ul' : 'div');
      ghost.className = (id.startsWith('p:') ? 'plist' : 'steps') + ' move-ghost';
      ghost.appendChild(oldEl);
      Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` }); // style object (allowed by the page's safety rules)
      document.body.appendChild(ghost);
      const a = ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px)' }], { duration: 240, easing: 'ease-out' });
      a.onfinish = () => ghost.remove();
      setTimeout(() => ghost.remove(), 600);
    }
  }
}

// ---------------------------------------------------------------- daily round
// One project at a time, red first. Every action saves AND jumps to the next project that is not green.

function startRound() {
  const today = todayIndia();
  const active = awakeProjects(store.view.data, todayIndia());
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
    return p && ['red', 'yellow'].includes(dotColour(p, today)); // not green, not snoozed
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
  const active = awakeProjects(store.view.data, todayIndia());
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
        btn('skip', 'Skip →', 'n'))));
}

// ---------------------------------------------------------------- time log

/** "0:23" style clock for the running timer. */
function clockText(startIso) {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(startIso)) / 60000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

function startTimer(p) {
  const running = store.view.data.timer;
  const other = running && running.projectId !== p.id && store.view.data.projects.find((x) => x.id === running.projectId);
  if (store.dispatch('startTimer', { projectId: p.id })) toast(other ? `⏱ Started ${p.name} (stopped ${other.name})` : `⏱ Started: ${p.name}`, 2500);
}

function stopTimer() {
  const t = store.view.data.timer;
  if (!t) return;
  const p = store.view.data.projects.find((x) => x.id === t.projectId);
  const mins = Math.round((Date.now() - Date.parse(t.start)) / 60000);
  if (store.dispatch('stopTimer', {})) toast(mins >= 1 ? `⏸ ${p ? p.name : 'Timer'}: ${fmtMinutes(Math.min(mins, 600))} logged` : 'Timer stopped (under a minute, not logged)', 3000);
}

/** The running timer, shown at the top of every screen so it is never forgotten. */
function timerStrip() {
  const t = store && store.view && store.view.data.timer;
  if (!t) return null;
  const p = store.view.data.projects.find((x) => x.id === t.projectId);
  return h('div', { class: 'timer-strip', key: 'timer-strip' },
    h('span', { class: 'timer-dot' }),
    h('button', { class: 'link timer-name', onClick: () => p && ctx.openProject(p.id) }, p ? p.name : 'Timer'),
    h('span', { class: 'timer-clock' }, clockText(t.start)),
    h('button', { class: 'btn small', onClick: stopTimer }, '⏸ Stop'));
}

// ---------------------------------------------------------------- navigation: back, next / previous

function pushNav() {
  const here = { view: ui.view, selected: ui.selected, person: ui.person };
  const stack = (ui.navStack ||= []);
  const last = stack[stack.length - 1];
  if (!last || last.view !== here.view || last.selected !== here.selected || last.person !== here.person) stack.push(here);
  if (stack.length > 20) stack.shift();
}

function goBack() {
  const prev = ui.navStack && ui.navStack.pop();
  if (!prev) return;
  ui.round = null;
  ui.rowMenu = null;
  ui.view = prev.view;
  ui.selected = prev.selected;
  ui.person = prev.person;
  ui.search = '';
  ui.mobile = 'detail';
  resetRedOrder();
  rememberUi();
  render();
}

/** Next / previous project in the tab you are in (Today, All, a group, Paused…). */
function neighbourProject(step) {
  const list = currentList();
  if (!list.length || !ui.selected) return null;
  const i = list.findIndex((p) => p.id === ui.selected);
  if (i < 0) return null;
  return list[i + step] || null;
}

function goProject(step) {
  const p = neighbourProject(step);
  if (!p) { toast(step > 0 ? 'This is the last project in this list' : 'This is the first project in this list', 1500); return; }
  select(p.id);
  const row = root.querySelector(`.prow[data-id="${CSS.escape(p.id)}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
  followFocus(row);
}

/** The next project after this one (in the tab you are in) that is not green yet — red first. */
function nextOpenProject(id) {
  const today = todayIndia();
  let list = ['diary', 'settings', 'dashboard', 'time', 'people', 'inbox'].includes(ui.view) || ui.search
    ? store.view.data.projects.filter((p) => p.state === 'active') : sortForView(visibleProjects(), today);
  list = list.filter((p) => p.state === 'active' && (p.id === id || !isSnoozed(p, today)));
  const i = Math.max(0, list.findIndex((p) => p.id === id));
  const after = [...list.slice(i + 1), ...list.slice(0, i)].filter((p) => p.id !== id);
  return after.find((p) => dotColour(p, today) === 'red') || after.find((p) => dotColour(p, today) !== 'green') || null;
}

function openNextOpen(id) {
  select(id);
  const row = root.querySelector(`.prow[data-id="${CSS.escape(id)}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

/** Next / previous person who has open work (people with nothing pending are skipped). */
function neighbourPerson(step) {
  const list = peopleByFollowUp(store.view.data).filter((x) => x.st.open > 0).map((x) => x.person);
  if (!list.length) return null;
  const i = list.findIndex((p) => p.id === ui.person);
  if (i < 0) return list[step > 0 ? 0 : list.length - 1];
  return list[i + step] || null;
}

function goPerson(step) {
  const p = neighbourPerson(step);
  if (!p) { toast(step > 0 ? 'No more people with open work' : 'This is the first person', 1500); return; }
  ctx.selectPerson(p.id);
}

/** Swipe left / right on the phone = next / previous (project, or person on the People page). */
function installSwipe() {
  let x0 = null;
  let y0 = null;
  document.addEventListener('touchstart', (e) => {
    const t = e.target;
    if (!t.closest || !t.closest('#detail') || t.closest('input, textarea, select, .sortable-steps')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
    const step = dx < 0 ? 1 : -1; // swipe left = next
    if (ui.round) return;
    if (ui.view === 'people' && !ui.search) goPerson(step);
    else if (ui.selected) goProject(step);
  }, { passive: true });
}

// ---------------------------------------------------------------- quick jump (Ctrl+K)

function jumpItems() {
  const { data } = store.view;
  const today = todayIndia();
  const pages = [
    ['Today', () => go('today')], ['All projects', () => go('all')], ['Dashboard', () => go('dashboard')],
    ['People', () => go('people')], ['Diary', () => go('diary')], ['Paused', () => go('paused')],
    ['Finished', () => go('finished')], ['Settings', () => go('settings')], ['Time report', () => go('time')], ['Daily round', () => { go('today'); startRound(); }],
    ["Today's summary", () => openSummary()], ['New project', () => { go('today'); ui.adding = true; render(); focusKey('new-name'); }],
    ...data.groups.map((g) => [`Group: ${g.name}`, () => go('group:' + g.id)]),
  ].map(([label, run]) => ({ kind: 'page', label, run }));
  const projects = data.projects.map((p) => ({
    kind: 'project', label: p.name, dot: dotColour(p, today), sub: p.state !== 'active' ? p.state : (nextStep(p, today) || {}).text || '',
    run: () => ctx.openProject(p.id),
  }));
  const people = peopleByFollowUp(data).map(({ person, st }) => ({
    kind: 'person', label: person.name, dot: st.colour, sub: st.open ? `${st.open} open` : 'nothing open',
    run: () => ctx.openPerson(person.id),
  }));
  return [...projects, ...people, ...pages];
}

function openJump() {
  if (!store || !store.view) return;
  const v = document.getElementById('viewer');
  v.hidden = false;
  v.classList.add('sheet-mode');
  const all = jumpItems();
  let shown = [];
  let index = 0;
  const list = h('ul', { class: 'jump-list', role: 'listbox' });
  const input = h('input', { class: 'jump-input', placeholder: 'Type a project, person or page…', autocomplete: 'off', 'aria-label': 'Jump to' });
  const run = (it) => { closeSheet(); it.run(); };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = (q ? all.filter((it) => it.label.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || it.label.toLowerCase().includes(q)) : all).slice(0, 12);
    if (index >= shown.length) index = 0;
    list.replaceChildren(...shown.map((it, i) => h('li', null, h('button', {
      class: 'jump-item' + (i === index ? ' on' : ''), onClick: () => run(it),
    },
    it.dot ? h('span', { class: `dot ${it.dot}` }) : h('span', { class: 'jump-kind' }, '→'),
    h('span', { class: 'jump-label' }, it.label),
    h('span', { class: 'muted small' }, it.kind === 'page' ? 'page' : it.sub)))));
    if (!shown.length) list.replaceChildren(h('li', { class: 'muted small' }, 'Nothing found'));
  };
  input.addEventListener('input', () => { index = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { index = Math.min(shown.length - 1, index + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { index = Math.max(0, index - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[index]) run(shown[index]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); }
    else return;
    e.stopPropagation();
  });
  v.replaceChildren(h('div', { class: 'sheet jump' },
    h('div', { class: 'sheet-head' }, h('strong', null, 'Jump to'), h('button', { class: 'icon', 'aria-label': 'Close', onClick: closeSheet }, '✕')),
    input, list,
    h('p', { class: 'muted small' }, '↓ ↑ to choose · Enter to open · Esc to close')));
  draw();
  setTimeout(() => input.focus(), 30);
}

// ---------------------------------------------------------------- keyboard

const KEYS = [
  ['↓  ↑', 'Next / previous project'],
  ['←  →', 'Previous / next project (or person on People)'],
  ['⌫', 'Back to where you came from'],
  ['Ctrl K', 'Jump to any project, person or page'],
  ['x', 'Tick the next step of the open project'],
  ['g', 'Start the daily round (then x s w o c n)'],
  ['s', 'Type a new step'],
  ['w', 'Type in "What did you do today?"'],
  ['n', 'New project'],
  ['/', 'Search'],
  ['q', 'Quick capture: write an idea or task into the Inbox'],
  ['r', 'Switch "My order" / "Red first"'],
  ['t  b  d  p', 'Go to Today / Dashboard / Diary / People'],
  ['@', 'In a step or note: pick a person'],
  ['Ctrl/⌘ Enter', 'In Today\'s update: save and tick the step'],
  ['Enter', 'In search: open the first project found'],
  ['Right-click', 'On a project in the list: quick menu'],
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
  if (!store || !store.view || ['diary', 'settings', 'dashboard', 'time'].includes(ui.view)) return [];
  const today = todayIndia();
  const { open, done } = splitToday(sortForView(visibleProjects(), today), today);
  return ui.showDoneToday || ui.view !== 'today' ? [...open, ...done] : open;
}

/**
 * After a keyboard move: if a list row still holds the browser's focus box (from an earlier click),
 * move that focus to the row that is now selected, so only one row looks picked.
 */
function followFocus(row) {
  const active = document.activeElement;
  if (!active || !active.closest || !active.closest('.prow')) return;
  const btn = row && row.querySelector('.prow-btn');
  if (btn && btn !== active) btn.focus({ preventScroll: true });
  else if (!btn) active.blur();
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
    followFocus(row);
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
  followFocus(row);
}

function selectedProject() {
  return store && store.view ? store.view.data.projects.find((p) => p.id === ui.selected) : null;
}

function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openJump(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
  if (e.key === 'Escape') {
    const viewer = document.getElementById('viewer');
    if (!viewer.hidden) { closeSheet(); return; }
    if (ui.showKeys) { ui.showKeys = false; render(); return; }
    if (ui.rowMenu) { ui.rowMenu = null; render(); return; }
    if (ui.projMenu || ui.giveOpen || ui.snoozeOpen) { ui.projMenu = null; ui.giveOpen = null; ui.snoozeOpen = null; render(); return; }
    if (ui.capture) { ui.capture = false; render(); return; }
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
  if (!document.getElementById('viewer').hidden || ui.capture) return; // a photo / message is open on top: keys must not act on the page behind
  const isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp';
  if (e.repeat && !isArrow && e.key !== 'j' && e.key !== 'k') return; // holding x / o / r must not repeat
  const focused = document.activeElement;
  if (isArrow && focused && (focused.type === 'radio' || focused.nodeName === 'SUMMARY')) return;
  if (isArrow && ['diary', 'settings', 'dashboard', 'time', 'inbox'].includes(ui.view) && !ui.search) return; // let the page scroll
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
  if (k === 'ArrowRight' || k === 'ArrowLeft') {
    const step = k === 'ArrowRight' ? 1 : -1;
    if (ui.view === 'people' && !ui.search) goPerson(step);
    else if (ui.selected && !['diary', 'settings', 'dashboard', 'time', 'inbox'].includes(ui.view)) goProject(step);
    else handled = false;
  } else if (k === 'Backspace') {
    if (ui.navStack && ui.navStack.length) goBack(); else handled = false;
  } else if (k === 'ArrowDown' || k === 'j') moveSelection(1);
  else if (k === 'ArrowUp' || k === 'k') moveSelection(-1);
  else if (ui.view === 'people' && 'xswi'.includes(k)) handled = false; // project keys do nothing on People
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
  } else if (k === 'n' && ui.view === 'people' && ui.person && !ui.search) {
    focusKey('person-task-input'); // on a person's page: the "Add a task with …" box
  } else if (k === 'n') {
    if (!(ui.view === 'today' || ui.view === 'all' || ui.view.startsWith('group:'))) ui.view = 'today'; // the form is only on project lists
    ui.search = ''; ui.adding = true; ui.mobile = 'list'; render(); focusKey('new-name');
  } else if (k === 'q') {
    openCapture();
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

/** Send waiting changes right away (used when leaving or closing the app). */
function sendNow() {
  if (store && store.pending.length && !store.saving && store.status !== 'auth' && store.status !== 'checking') store.flush();
}

// ---------------------------------------------------------------- team (worktask.in only)

/** Team tasks given from a step, by step id, so each step can show the person's latest update. */
const team = { byStep: new Map(), fillBy: '18:00', late: false, at: 0, gen: 0, syncErr: {}, busy: new Set(), loading: false, again: false, alerts: { stuck: 0, unread: 0, suggestions: 0 }, messages: [] };
const TICKED_KEY = 'dp.teamTicked'; // team tasks already ticked on this device (so an un-tick by hand stays)

/** 👥 in the top bar, with a red number when the team needs you (stuck, new messages, suggestions). */
function teamButton() {
  const a = team.alerts;
  const n = a.stuck + a.unread + a.suggestions;
  const why = [a.stuck && `${a.stuck} stuck`, a.unread && `${a.unread} with new messages`, a.suggestions && `${a.suggestions} suggestion(s)`].filter(Boolean).join(', ');
  return h('a', { class: 'icon team-btn', href: '../?team', title: n ? `Team needs you: ${why}` : 'Team: tasks you gave and their daily updates', 'aria-label': n ? `Team, ${n} need you` : 'Team' },
    '👥', n ? h('span', { class: 'team-count' }, String(n)) : null);
}

function teamApi(a, body = {}) {
  return fetch('../api/?a=' + a, { method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer ' + serverToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .catch(() => { throw new Error('No connection'); })
    .then((r) => r.json().catch(() => { throw new Error(r.ok ? 'Server error' : 'Server busy, try again'); }))
    .then((out) => { if (!out.ok) throw new Error(out.error || 'Server error'); return out; });
}

/** One project.sync at a time, also across tabs: two at once would put every step on the person's list twice. */
function withSyncLock(fn) {
  return navigator.locks && navigator.locks.request ? navigator.locks.request('dp.teamSync', fn) : fn();
}

/** A team member's photo for the diary (needs the sign-in, so it is fetched, then shown). null while loading. */
const teamPhotos = new Map(); // photo id -> object URL, or 'loading'
function teamPhoto(id) {
  const v = teamPhotos.get(id);
  if (v && v !== 'loading') return v;
  if (!v) {
    teamPhotos.set(id, 'loading');
    fetch('../api/?a=photo&id=' + id, { headers: { Authorization: 'Bearer ' + serverToken() } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('photo'))))
      .then((b) => { teamPhotos.set(id, URL.createObjectURL(b)); render(); })
      .catch(() => teamPhotos.delete(id));
  }
  return null;
}

/** The team sent an update on a project today: it counts as work (green, shown with 👥). Once a day per project. */
/** A given project on the team: steps done / open, the step they are on, their last update. */
function teamProgress(projectId) {
  const list = [...team.byStep.values()].filter((t) => t.projectRef === projectId && t.seq !== null && t.seq !== undefined && !String(t.stepRef).endsWith(':whole'));
  const open = list.filter((t) => t.status === 'open'), done = list.filter((t) => t.status === 'done');
  const days = [...team.byStep.values()].filter((t) => t.projectRef === projectId).map((t) => (t.today || t.last || {}).day).filter(Boolean).sort();
  return { open: open.length, done: done.length, current: open.find((t) => !t.queued) || null, lastUpdate: days[days.length - 1] || null, stuck: open.some((t) => t.stuck) };
}

function markTeamWork(tasks, teamDays) {
  const firstPast = [];
  if (!store || !store.view || !store.canEdit()) return;
  const today = todayIndia();
  const projects = store.view.data.projects;
  for (const t of tasks) {
    // the newest real work (today's, or the one before if today's says Stuck or there is none yet): a Stuck day is not work
    const u = [t.today, t.last].find((x) => x && x.state !== 'stuck');
    if (!u || !u.day || u.day > today) continue;
    const p = projects.find((x) => x.id === t.projectRef) || projects.find((x) => x.steps.some((st) => st.id === t.stepRef));
    if (p && p.state === 'active' && (!p.teamWorkDate || p.teamWorkDate < u.day) && store.dispatch('teamWorked', { projectId: p.id, day: u.day }) && u.day < today) firstPast.push(u.day);
  }
  // every day the team worked on a project (also days this page was not open): those day boxes count it too
  const past = new Set(firstPast);
  for (const [ref, days] of Object.entries(teamDays || {})) {
    for (const day of days) {
      const p = store.view.data.projects.find((x) => x.id === ref);
      if (!p || day > today || (p.teamDays || []).includes(day)) continue;
      if (store.dispatch('teamWorked', { projectId: p.id, day }) && day < today) past.add(day);
    }
  }
  if (past.size) rescoreDays([...past]); // days already scored without this work: score them again (a score only goes up)
}

/** Score these past days again, with their months' history loaded first (else your own work those days is missing). */
async function rescoreDays(days) {
  const months = [...new Set(days.map(monthOf))].filter((m) => !store.view.history[m] && store.availableMonths().includes(m));
  try { for (const m of months) await store.loadMonth(m); } catch { return; } // offline: next time
  const scores = {};
  for (const d of days) { const sc = dayScore(store.view.data, store.view.history, d); if (sc.total) scores[d] = sc; }
  if (Object.keys(scores).length && store.canEdit()) store.dispatch('recordScores', { scores, raise: true });
}

/** The diary of this project is fetched again with the next redraw (after a reply, or a new message). */
function refreshDaily(projectId) { const e = daily.get(projectId); if (e) e.at = 0; render(); }

/** A photo in a team message (fetched with the sign-in, shown from memory). */
const msgPhotos = new Map();
function teamMsgPhoto(id) {
  if (msgPhotos.has(id)) return msgPhotos.get(id);
  msgPhotos.set(id, null);
  fetch('../api/?a=comment.photo&id=' + id, { headers: { Authorization: 'Bearer ' + serverToken() } })
    .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { msgPhotos.set(id, URL.createObjectURL(b)); render(); } else msgPhotos.delete(id); })
    .catch(() => msgPhotos.delete(id)); // failed: tried again on the next draw
  return null;
}

/** 📅 Daily updates per project: loaded when the project is opened, again after 20 seconds (or on ↻). */
const daily = new Map(); // projectId -> { at, days, data, loading }
function teamDaily(p, days) {
  if (!onServer) return null;
  let e = daily.get(p.id);
  const want = Math.max(days || 0, e ? e.days : 30, (e && e.wantDays) || 0);
  if (e && e.loading && days) e.wantDays = Math.max(e.wantDays || 0, days); // asked while loading: fetched right after
  if (!e || (!e.loading && (Date.now() - e.at > 20000 || want !== e.days))) {
    e = { ...(e || {}), days: want, loading: true, at: Date.now(), wantDays: 0 };
    daily.set(p.id, e);
    teamApi('project.updates', { projectRef: p.id, days: want })
      .then((out) => { e.data = out; e.loading = false; e.at = e.wantDays > e.days ? 0 : Date.now(); render(); })
      .catch(() => { e.loading = false; });
  }
  return e;
}

/** Active team members to give a project to (loaded once). null while loading. */
function teamPeople() {
  if (team.people) return team.people;
  if (!team.peopleLoading) {
    team.peopleLoading = true;
    teamApi('users.list').then((out) => { team.people = out.users.filter((u) => u.active && !u.owner); render(); })
      .catch((e) => { team.peopleLoading = false; toast(e.message); });
  }
  return null;
}

/** What the server needs to know about a given project: its open steps, in order. A step that comes back later
 *  (snoozed, or the next copy of a repeating step) is sent on the day it comes back, not before. */
const projectSteps = (p) => {
  const today = todayIndia();
  const open = p.steps.filter((x) => !x.done && !(x.snoozedUntil && x.snoozedUntil > today)).map((x) => ({ stepRef: x.id, title: x.text, details: x.note || '', dueDate: x.dueDate || null }));
  if (open.length || p.steps.length) return open; // (steps all done or snoozed: nothing to do; the whole-project task is only for no steps at all)
  // no steps at all: the person still gets the project, as one task with its name, until steps are added
  return [{ stepRef: wholeRef(p.id), title: p.name, details: p.status || '' }];
};
const wholeRef = (projectId) => projectId + ':whole';
let dataFreshAt = 0; // when the projects were last checked against the server (0 = not yet)
const SYNC_KEY = 'dp.teamSync'; // last steps sent per given project, so unchanged projects are not sent again
const SYNC_RETRY = 'retry'; // never matches: sent again next time, but a deleted project is still taken back

/** Give the whole project to a person (or take it back with person = null). */
async function giveProject(p, person, needsPhoto = !!ui.givePhoto) {
  if (team.busy.has(p.id)) return; // a double tap must not send it twice
  team.busy.add(p.id);
  render();
  try {
    await withSyncLock(async () => {
      const steps = person ? projectSteps(p) : [];
      // (the change of person is saved right after this: the server must not act on the older saved copy meanwhile)
      const out = await teamApi('project.sync', { projectRef: p.id, project: p.name, assigneeId: person ? person.id : 0, steps, needsPhoto, reason: person ? '' : 'taken', baseCommit: store.base && store.base.commit, pending: true });
      team.gen++; // a list fetched before this change is old now: it must not move the project back
      store.dispatch('setProjectTeam', { projectId: p.id, userId: person ? person.id : null, name: person ? person.name : '', needsPhoto });
      ui.giveOpen = null;
      ui.givePhoto = false;
      toast(person ? `👥 ${p.name} given to ${person.name} ✓` : `Taken back: ${p.name}`);
      // a step the server did not make yet (just finished): sent again later
      rememberSync(p.id, !person ? null : notSent(out, steps).length ? SYNC_RETRY : JSON.stringify([person.id, p.name, steps, needsPhoto]));
    });
    loadTeam(true);
  } catch (e) { toast(e.message, 5000); } finally { team.busy.delete(p.id); render(); }
}

/** Steps sent with project.sync that are not on the person's list yet (the server waits 10 minutes after one was finished). */
function notSent(out, steps) {
  if (Array.isArray(out.skipped)) return out.skipped;
  const on = new Set((out.tasks || []).map((t) => t.stepRef));
  return steps.filter((x) => x.title && !on.has(x.stepRef)).map((x) => x.stepRef);
}

function rememberSync(id, sig) {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch { m = {}; }
  if (sig) m[id] = sig; else delete m[id];
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(m)); } catch { /* full */ }
}

/** Given projects: new, changed, ticked or deleted steps reach the person's list. */
function syncGivenProjects(gen = team.gen) {
  return withSyncLock(() => syncGivenNow(gen));
}

async function syncGivenNow(gen) {
  if (!store || !store.view) return;
  let m = {};
  try { m = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch { m = {}; }
  // store.view is replaced after each save: read every project fresh after each wait, never an old copy
  const fresh = (id) => store.view.data.projects.find((x) => x.id === id);
  for (const id of store.view.data.projects.filter((x) => x.team).map((x) => x.id)) {
    let p = fresh(id);
    if (!p || !p.team) continue;
    // moved on Work Task (↔ Move to…): follow the new person instead of moving the steps back
    const onTeam = gen === team.gen && team.listAt >= dataFreshAt ? [...team.byStep.values()].filter((t) => t.projectRef === p.id && t.seq !== null && t.status === 'open') : [];
    const moved = onTeam.length && onTeam.every((t) => t.assignee.id === onTeam[0].assignee.id) && onTeam[0].assignee.id !== p.team.userId ? onTeam[0].assignee : null;
    if (moved) {
      store.dispatch('setProjectTeam', { projectId: p.id, userId: moved.id, name: moved.name, needsPhoto: !!p.team.needsPhoto, byTeam: true });
      p = fresh(id);
      if (!p || !p.team) continue;
    }
    const steps = p.state === 'active' ? projectSteps(p) : [];
    const sig = JSON.stringify([p.team.userId, p.name, steps, !!p.team.needsPhoto]);
    if (m[p.id] === sig) continue;
    const name = p.name, who = p.team.name;
    try {
      const out = await teamApi('project.sync', { projectRef: p.id, project: name, assigneeId: p.state === 'active' ? p.team.userId : 0, steps, needsPhoto: !!p.team.needsPhoto, reason: p.state,
        baseCommit: store.base && store.base.commit, pending: store.pending.length > 0 });
      // a re-opened step that was just finished is not made yet: sent again next time
      rememberSync(id, notSent(out, steps).length ? SYNC_RETRY : sig);
      delete team.syncErr[id];
    } catch (e) {
      // try again next time; say it once, so new steps do not quietly reach nobody
      if (e.message !== 'No connection' && team.syncErr[id] !== e.message) {
        team.syncErr[id] = e.message;
        toast(`Could not send ${name} to ${who}: ${e.message} Use Change person.`, 8000);
      }
    }
  }
  // a given project that was deleted: take its steps back from the person
  const ids = new Set(store.view.data.projects.map((p) => p.id));
  const savedIds = store.base ? new Set(store.base.data.projects.map((p) => p.id)) : null;
  for (const ref of Object.keys(m)) {
    if (ids.has(ref)) continue;
    if (takeBackWaits(ref, savedIds, store.view.history)) continue; // not saved yet, or Undo still on screen: next time
    try {
      await teamApi('project.sync', { projectRef: ref, project: '', assigneeId: 0, steps: [], reason: 'deleted' });
      rememberSync(ref, null);
    } catch { /* try again next time */ }
  }
}

/** A team task given from a step was finished: tick the step (once), with the person's last words as a work note. */
/** A step given on its own (not a whole project): when you tick or delete the step, the person's task closes too. */
async function syncSingleSteps(tasks) {
  if (!store || !store.view || !store.canEdit()) return;
  const projects = store.view.data.projects;
  for (const t of tasks) {
    if (t.status !== 'open' || (t.seq !== null && t.seq !== undefined) || !t.stepRef) continue;
    const p = projects.find((x) => x.steps.some((st) => st.id === t.stepRef));
    if (p && p.team) continue; // part of a given project now: that path keeps it
    const step = p && p.steps.find((st) => st.id === t.stepRef);
    if (step && !step.done) continue;
    if (singleStepCloseWaits(step, t.stepRef, store.view.history)) continue; // Undo still on screen: next time
    if (step && t.reopenedAt && step.doneAt && Date.parse(String(t.reopenedAt).replace(' ', 'T') + '+05:30') > Date.parse(step.doneAt)) continue; // opened again there after your tick
    if (!step && !projects.some((x) => x.id === t.projectRef)) continue; // its project is not on this device: leave it
    try { await teamApi('task.status', { id: t.id, status: step ? 'done' : 'cancelled' }); } catch { /* next time */ }
  }
}

/** Steps the person added on Work Task: put into the project (same id), so from now on they are the project's own steps. */
function adoptStaffSteps(tasks) {
  if (!store || !store.view || !store.canEdit()) return;
  const adopted = [];
  for (const t of tasks) {
    if (!t.fromStaff) continue; // (a step added just before the project was taken back counts too: it is not lost)
    const p = store.view.data.projects.find((x) => x.id === t.projectRef);
    if (!p) continue; // not here yet (data still loading): next time
    // already in the project, or deleted / undone by you (kept in the saved data, so every device knows): once saved, the server may forget it
    const saved = store.base && store.base.data.projects.find((x) => x.id === p.id);
    const what = staffStepAction(t.stepRef, p, saved);
    if (what === 'adopted') adopted.push(t.id);
    if (what !== 'add') continue;
    actMany(p.id, [['addStep', { projectId: p.id, stepId: t.stepRef, text: t.title, byTeam: true }]], `👥 ${t.assignee.name} added a step: ${t.title}`);
  }
  if (adopted.length) teamApi('tasks.adopted', { ids: adopted }).catch(() => { /* asked again next time; adding twice is ignored */ });
}

function tickFinishedTeamTasks(tasks) {
  if (!store || !store.view || !store.canEdit()) return;
  let done = [];
  try { done = JSON.parse(localStorage.getItem(TICKED_KEY) || '[]'); } catch { done = []; }
  if (!Array.isArray(done)) done = [];
  const seen = new Set(done);
  const serverTime = (v) => (v ? v.replace(' ', 'T') + '+05:30' : null); // server times are India time
  for (const t of tasks) {
    if (t.status === 'open') {
      // ticked here because they finished it, then opened again (their undo, or the manager's Open again): untick
      const p = store.view.data.projects.find((x) => x.id === t.projectRef);
      const step = p && p.steps.find((st) => st.id === t.stepRef);
      const note = p && (p.workNotes || []).find((n) => n.id === 'tn' + t.id);
      const latest = team.byStep.get(t.stepRef);
      if (p && t.stepRef === wholeRef(p.id) && note && (!latest || latest.id === t.id)) actMany(p.id, [['deleteWorkNote', { projectId: p.id, noteId: note.id, byTeam: true }]], `↩ ${t.assignee.name} opened “${p.name}” again`);
      else if (step && note && (!latest || latest.id === t.id)) { // (the note says "this finish was handled": it is not finished now)
        actMany(p.id, [...(step.done ? [['untickStep', { projectId: p.id, stepId: step.id, byTeam: true }]] : []), ['deleteWorkNote', { projectId: p.id, noteId: note.id, byTeam: true }]], `↩ ${t.assignee.name} opened “${step.text}” again`);
      }
      seen.delete(t.id); // open now: when it is finished again, it is new again (here and on every other device)
      continue;
    }
    if (t.status !== 'done') continue;
    if (t.closedByPerson === false && (t.seq === null || t.seq === undefined)) continue; // a single step closed by you / the manager: your tick decides
    // (handled = the shared 'tn' note below; this device's list only saves work, a team untick on another device clears the note)
    const latest = team.byStep.get(t.stepRef); // the step was given again after this (re-opened): the old task must not tick it
    if (latest && latest.id !== t.id) { seen.add(t.id); continue; }
    const p = store.view.data.projects.find((x) => x.id === t.projectRef) || store.view.data.projects.find((x) => x.steps.some((st) => st.id === t.stepRef));
    if (p && t.stepRef === wholeRef(p.id)) { // the project with no steps, finished as one task: a note, you decide on Finish
      seen.add(t.id);
      if (!(p.workNotes || []).some((n) => n.id === 'tn' + t.id)) {
        const words = (t.today || t.last) ? (t.today || t.last).note : '';
        actMany(p.id, [['addWorkNote', { projectId: p.id, noteId: 'tn' + t.id, team: true, at: serverTime(t.doneAt), text: `👥 ${t.assignee.name} finished the project${words ? ': ' + words : '.'}` }]], `✓ ${t.assignee.name} finished: ${p.name}`);
      }
      continue;
    }
    const step = p && p.steps.find((st) => st.id === t.stepRef);
    if (!step) continue; // not here yet (data still loading): tried again next time
    seen.add(t.id);
    if (step.done) continue;
    // handled on another device already (its note is saved with the data): an un-tick by hand there stays
    if ((p.workNotes || []).some((n) => n.id === 'tn' + t.id)) continue;
    const words = (t.today || t.last) ? (t.today || t.last).note : '';
    actMany(p.id, [
      ['tickStep', { projectId: p.id, stepId: step.id, byTeam: true, at: serverTime(t.doneAt) }], // their day, not your work today
      // always a note (same id on every device), so no other device ticks it again
      ['addWorkNote', { projectId: p.id, noteId: 'tn' + t.id, stepId: step.id, team: true, at: serverTime(t.doneAt),
        text: t.closedByPerson === false ? `👥 Marked done in Work Task: “${step.text}” (${t.assignee.name}'s step)` : `👥 ${t.assignee.name} finished “${step.text}”${words ? ': ' + words : '.'}` }],
    ], `✓ ${t.assignee.name} finished: ${step.text}`);
  }
  // keep every id the server still sends (60 days), so none of them looks new again
  const live = new Set(tasks.map((t) => t.id));
  try { localStorage.setItem(TICKED_KEY, JSON.stringify([...seen].filter((id) => live.has(id)))); } catch { /* full */ }
}

/** One load at a time: a forced load asked for while one runs makes that one go round once more. */
async function loadTeam(force = false) {
  if (force) for (const e of daily.values()) e.at = 0; // ↻ also brings the newest daily updates
  if (!onServer || (!force && Date.now() - team.at < 60000)) return;
  if (team.loading) { if (force) team.again = true; return; }
  team.loading = true;
  try {
    do { team.again = false; await loadTeamOnce(); } while (team.again);
  } finally { team.loading = false; }
}

async function loadTeamOnce() {
  team.at = Date.now();
  const gen = team.gen; // changed by giveProject while this list is on its way: the list is old
  try {
    const res = await fetch('../api/?a=tasks.linked', { method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer ' + serverToken(), 'Content-Type': 'application/json' }, body: '{}' });
    const out = await res.json();
    if (!out.ok || gen !== team.gen) return;
    team.byStep = new Map(out.tasks.map((t) => [t.stepRef, t]));
    team.listAt = Date.now(); // (a list older than the projects on screen must not move a project back)
    team.fillBy = out.fillBy;
    team.late = out.late;
    // a new message from the team: the project diaries fetch again at once (not after their usual minute)
    const newMsg = (out.messages || []).some((m) => !team.messages.some((x) => x.id === m.id));
    team.messages = out.messages || [];
    if (newMsg) for (const e of daily.values()) e.at = 0;
    if (out.alerts) team.alerts = out.alerts;
    if (out.summary) team.summary = out.summary;
    adoptStaffSteps(out.tasks);
    tickFinishedTeamTasks(out.tasks);
    markTeamWork(out.tasks, out.teamDays);
    // only from data checked against the server a moment ago (a phone that was asleep could otherwise undo the PC's changes)
    if (Date.now() - dataFreshAt < 90000) {
      await syncGivenProjects(gen);
      await syncSingleSteps(out.tasks);
    }
    render();
  } catch { /* no connection: try again next time */ }
}

async function doRefresh(force) {
  if (!store || store.status === 'auth') { loadTeam(force); return; }
  await store.refresh(force);
  if (store.status === 'saved') dataFreshAt = Date.now();
  loadTeam(force); // after the newest data is in: given projects are sent from it, never from an old copy
  if (force && store.status === 'saved') toast('Up to date ✓');
  makeBrief();
}

let started = false;

function start() {
  if (!isMock && !onServer && MOVED_TO) { showMoved(); return; } // first: it passes #say= / #add= on to the new address
  takeClipFromHash();
  takeVoiceFromHash();
  if (onServer) takeOpsFromHash(); // before the store starts: it reads the waiting changes once
  if (onServer && !serverToken()) { toSignIn(); return; }
  const key = device.githubKey();
  if (!isMock && !onServer && !key) { showKeyScreen(); return; }
  const repo = isMock ? new MockRepo() : onServer ? new ServerRepo(serverToken(), '../api/') : new GitHubRepo(key, DATA_OWNER, DATA_REPO, DATA_BRANCH);
  store = new Store(repo);
  store.addEventListener('change', () => render());
  store.addEventListener('status', (e) => {
    // Only build the key screen when it is not already showing, so a pasted key is not wiped.
    if (e.detail.status === 'auth' && onServer) { toSignIn(); return; } // changes waiting on this device are kept and sent after signing in
    if (e.detail.status === 'auth' && document.getElementById('keyscreen').hidden) {
      showKeyScreen('Your GitHub key stopped working. Paste a new one. Your unsaved changes are kept.');
    }
    render();
  });
  store.addEventListener('remote', () => toast('↻ Updated with changes from your other device'));
  store.addEventListener('blocked', (e) => {
    toast(e.detail.status === 'offline' ? 'No connection — changes not saved. Try again when online.' : 'Please wait…');
    render(); // put ticked boxes and menus back to the real data
  });
  render();
  store.init().then(() => { if (store.status === 'saved') dataFreshAt = Date.now(); render(); if (ui.capture) focusKey('capture-input'); voiceReady = true; runVoice(); loadTeam(true); shareLocalKeys(); markShownOpened(); makeBrief(); recordPastScores(); });
  if (started) return;
  started = true;
  // redraw now and then: the running timer, and the "not sent yet" bar appearing after a minute
  setInterval(() => { if (store && store.view && (store.view.data.timer || store.pending.length) && document.visibilityState === 'visible') render(); }, 20000);
  let shownDay = todayIndia();
  let lastTick = Date.now();
  setInterval(() => {
    const woke = Date.now() - lastTick > REFRESH_MS * 3; // the computer was asleep: check at once, even if this window is behind another
    lastTick = Date.now();
    if (document.visibilityState === 'visible' || woke || (store && store.pending.length)) doRefresh(false);
    if (todayIndia() !== shownDay) { shownDay = todayIndia(); resetRedOrder(); render(); markShownOpened(); recordPastScores(); } // midnight: every dot resets
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') doRefresh(false);
    else { saveTypedText(); rememberScroll(); sendNow(); } // leaving the app: send waiting changes at once, not after the usual pause
  });
  window.addEventListener('focus', () => doRefresh(false));
  window.addEventListener('hashchange', () => { takeClipFromHash(); takeVoiceFromHash(); }); // the Chrome button, when the app is already open // back to this window from another app
  window.addEventListener('pagehide', () => { saveTypedText(); rememberScroll(); sendNow(); });
  // Closing the app while changes are still being sent: ask first, so nothing stays only on this computer.
  window.addEventListener('beforeunload', (e) => {
    if (store && store.pending.length && store.status !== 'auth') { sendNow(); e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('online', () => {
    if (store.status !== 'offline') return;
    store.init().then(() => { if (store.pending.length) store.save(); else if (store.status !== 'auth') store.setStatus('saved'); });
  });
  window.addEventListener('offline', () => store.setStatus('offline', 'No connection'));
  document.addEventListener('keydown', onKey);
  // Ctrl+V anywhere on an open project: a screenshot or a copied file is added to it (the update box handles its own paste)
  document.addEventListener('paste', (e) => {
    if (e.defaultPrevented || !store || !store.view) return;
    // the project page must be on screen (not the Diary, Dashboard, Settings, Time, People, the round, Quick capture, or a sheet on top)
    if (!pasteGoesToProject(ui, { viewerOpen: !document.getElementById('viewer').hidden, narrow: matchMedia('(max-width: 760px)').matches })) return;
    if (e.clipboardData && (e.clipboardData.getData('text/plain') || '').trim()) return; // text with a picture of it: the text
    const files = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (!files.length) return; // plain text: pasted as usual
    const p = store.view.data.projects.find((x) => x.id === ui.selected);
    if (!p) return;
    e.preventDefault();
    pasteIntoProject(ctx, p, files);
  });
  // a click anywhere else closes the right-click menu
  document.addEventListener('click', (e) => {
    if (ui.rowMenu && !e.target.closest('.row-menu')) { ui.rowMenu = null; render(); }
    if (ui.projMenu && !e.target.closest('.proj-menu') && !e.target.closest('[aria-label="More actions"]')) { ui.projMenu = null; render(); }
  });
  window.addEventListener('scroll', () => { if (ui.rowMenu) { ui.rowMenu = null; render(); } }, true);
}

installEvents(document.body);
installSwipe();
// Keep the app's files on the device so it opens without internet (not in test mode on this Mac).
if ('serviceWorker' in navigator && !isMock && !(onServer && !['worktask.in', 'www.worktask.in'].includes(location.hostname))) navigator.serviceWorker.register('sw.js').catch(() => {});
installMentions(() => ctx);
installAutocorrect(device.autocorrect());
if (isMock) document.title = 'Daily Projects (test mode)';
else if (onServer && location.hostname !== 'worktask.in' && location.hostname !== 'www.worktask.in') document.title = 'Daily Projects (server test)';
start();

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
