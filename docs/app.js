// Daily Projects — main app: start-up, menu, project list, Today box, Diary, Settings, key screen.

import { h, morph, installEvents, fmtDay, fmtLongDay, fmtTime, keyHint, withKey } from './ui/dom.js';
import { pageKey, isTyping } from './ui/listkeys.js';
import { renderDetail, linkChip, isMailLink, pasteIntoProject, takeBackQuestion, updateState, makeItAProject } from './ui/detail.js';
import { renderPeopleList, renderPerson, peopleByFollowUp } from './ui/people.js';
import { installMentions } from './ui/mention.js';
import { installAutocorrect, setAutocorrect, autocorrectOn } from './ui/autocorrect.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderTimeReport } from './ui/timereport.js';
import { renderReplies, renderReplyRound, replyArea, readyCount } from './ui/replies.js';
import { renderConnectionsSettings, renderFromApps, loadApps, appsPending, forgetOnce } from './ui/connections.js';
import { projectChips, renderProjectsHead, openMainBox, openMoveBox, moveBox, listColour, newInnerProject } from './ui/mains.js';
import { projectMatches, diaryEntries, backupPayload, summaryText, personMessageText, personMessageHtml, sentMarkOf, copyNotice, tasksListText, teamUpdatesText } from './reports.js';
import { closeViewer, uploadBlob, photoThumb } from './ui/files.js';
import { newTaskBox, createTaskWithNote, richView } from './ui/richedit.js';
import { Store } from './store.js';
import { GitHubRepo } from './github.js';
import { ServerRepo, SERVER_TOKEN_KEY } from './serverrepo.js';
import { MockRepo } from './mockrepo.js';
import { device } from './device.js';
import { DATA_OWNER, DATA_REPO, DATA_BRANCH, MOVED_TO, REFRESH_MS, AI_DAILY_LIMIT, BRIEF_CLAIM_MINUTES, WAIT_RED_DAYS, NO_WORK_NOTE_DAYS } from './config.js';
import { dotColour, greenByTeamOnly, isSnoozed, restUntil, restReason, onlyDaysLabel, openIdFromHash, awakeProjects, activeProjects, nextStep, todayIndia, isSundayIndia, colourCounts, isOverdue, indiaDate, waitingDays, daysWithoutWork, dayScore, greenStreak, addDays, monthOf, fmtMinutes, takeBackWaits, staffStepAction, pasteGoesToProject, singleStepClose, versionRequest, askDiaryAgain, pasteInForm, diaryLoadedAt, photoNeedsFetch, teamUndoKey, teamActionUndone, teamProgressOf, projectKeyIgnored, teamMovedTo, serverHolder, keepMovedStep, teamMemberFor, repliesOf, mailThreads, replyMailto, MAILTO_BODY_MAX, emailPath, pasteReason } from './rules.js';
import { stageOf, stageCounts, byStage, STAGES, STAGE_LABELS, moveEveryOf, everyText, MOVE_EVERY_PICKS, MOVE_EVERY_DEFAULT, everyDefaultOf, useEveryDefault, colourShort, colourWhy } from './rules.js';
import { stageChip, stageFilterBar } from './ui/stage.js';
import { whoFromUser, signInTag, timerOn, projectGiveChanges, UNDO_GRACE_MS, MISC_ID } from './rules.js';
import { signInCard, firstPasswordCard } from './ui/signin.js';
import { createBell } from './ui/bell.js';
import { parentIdsOf, isMainProject, mainProjects, activeTasks, todayWithoutEmptyMains, todayList, stepTargets, mainSummary, childrenOf, deleteQuestion, pickEnterTarget, projectLine, projectTasks, inboxMatches } from './rules.js';
import { newId, clone, opMonth, cleanLink, carriedOps, orderPosOf } from './ops.js';
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
/** Signed out (or the sign-in stopped working) while the app runs: the sign-in of this app, then it opens again. */
function toSignIn() { signInAgain(); }

// ---------------------------------------------------------------- signing in (one app: everyone signs in here)
// The sign-in card sits where the owner's key screen does; the person's own screens stay hidden behind it.
const LAST_USER_KEY = 'wt.lastUser';
const signScreen = () => document.getElementById('keyscreen');
function showCard(el) { const s = signScreen(); root.hidden = true; s.hidden = false; s.replaceChildren(el); if (bell) bell.el.hidden = true; }
function hideCard() { const s = signScreen(); s.hidden = true; s.replaceChildren(); root.hidden = false; if (bell) bell.el.hidden = false; }

/** 🔔 Notifications inside the app (ui/bell.js), on top of whichever screens are open: worktask.in, signed in. */
let bell = null;
function startBell() {
  if (bell || !onServer || !serverToken()) return;
  bell = createBell({ post: async (a, body) => {
    const r = await fetch('../api/?a=' + a, { method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer ' + serverToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const out = await r.json();
    if (!out || !out.ok) throw new Error((out && out.error) || 'Something went wrong.');
    return out;
  } });
  document.body.appendChild(bell.el);
  document.body.classList.add('has-bell'); // (room for it in the headers: styles.css)
}
async function postNoToken(a, body, token = '') {
  const r = await fetch(`../api/?a=${a}`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  let out = null; try { out = await r.json(); } catch { /* not an answer */ }
  return { status: r.status, out };
}
/** Keep the new sign-in. Someone else than last time on this phone: the last person's saved lists go. */
function keepSignIn(token, user) {
  try {
    if (localStorage.getItem(LAST_USER_KEY) !== String(user.id)) {
      for (const k of Object.keys(localStorage)) if (k.startsWith('wt.c.')) localStorage.removeItem(k);
      if (!user.owner) localStorage.removeItem('dp.snapshot'); // the owner's copy of the projects never stays for someone else
      localStorage.setItem(LAST_USER_KEY, String(user.id));
    }
    localStorage.setItem(SERVER_TOKEN_KEY, token);
    localStorage.removeItem(WHO_KEY);
  } catch { /* blocked */ }
}
/** The sign-in card; then(user) once signed in. */
function showSignIn(then, message = '') {
  showCard(signInCard({ post: postNoToken, message, onSignedIn: ({ token, user }) => { keepSignIn(token, user); hideCard(); then(user); } }));
}
/** Their first password (or one the manager reset), before anything else; then(user) once saved. */
function showFirstPassword(user, then) {
  const api = async (a, body = {}) => {
    let res; try { res = await postNoToken(a, body, serverToken()); } catch { throw new Error('No connection. Try again when the internet is back.'); }
    if (!res.out || !res.out.ok) throw new Error((res.out && res.out.error) || 'Something went wrong. Try again.');
    return res.out;
  };
  showCard(firstPasswordCard({
    api, user,
    onDone: (u) => { rememberWho(whoFromUser(u)); hideCard(); toast('Password changed ✓'); then(u); },
    onSignOut: async () => { try { await api('logout'); } catch { /* signed out on this phone anyway */ } dropSignIn(); showSignIn(then); },
  }));
}
function dropSignIn() { try { localStorage.removeItem(SERVER_TOKEN_KEY); localStorage.removeItem(WHO_KEY); } catch { /* blocked */ } }
/** The sign-in stopped working (or a new password is needed) while the app runs: sign in here, then open again. */
let signingIn = false;
async function signInAgain() {
  if (signingIn) return;
  signingIn = true;
  const { user, who } = serverToken() ? await askWho() : {};
  if (user && user.mustChange) { showFirstPassword(user, () => location.reload()); return; }
  // the sign-in still works (e.g. the wrong screens were open): open the right ones again — once, never in a loop
  if (who && !reloadedJustNow()) { location.reload(); return; }
  dropSignIn(); // (what waits to be sent stays on this phone and goes after signing in)
  showSignIn(() => location.reload(), 'Please sign in again.');
}
/** True when signInAgain reloaded the page less than a minute ago (then it asks to sign in instead of reloading again). */
function reloadedJustNow() {
  try {
    const at = Number(sessionStorage.getItem('dp.authReload') || 0);
    if (Date.now() - at < 60000) return true;
    sessionStorage.setItem('dp.authReload', String(Date.now()));
  } catch { /* blocked: one reload at most anyway (signingIn) */ }
  return false;
}
/** First start with this sign-in and no answer from the server: never guess who it is — this phone's owner copy says so, else try again. */
function routeWho({ who, user, answered }, teamTask) {
  if (user && user.mustChange) openFor(user, teamTask); // their own password first
  else if (who === 'staff') startStaff(user, teamTask);
  else if (who === 'manager') startManager(user, teamTask);
  else if (who === 'owner' || ownerCopyHere()) startOwner(); // (offline: the owner's own phone opens as before)
  else if (answered) signInAgain(); // the sign-in does not work any more
  else noAnswerYet(teamTask);
}
const ownerCopyHere = () => { try { return !!localStorage.getItem('dp.snapshot'); } catch { return false; } };
function noAnswerYet(teamTask) {
  const again = () => { window.removeEventListener('online', again); root.replaceChildren(h('div', { class: 'loading' }, 'Loading…')); askWho().then((r) => routeWho(r, teamTask)); };
  window.addEventListener('online', again);
  root.replaceChildren(h('div', { class: 'loading' }, h('p', null, 'Cannot reach worktask.in right now. Check the internet.'), h('button', { class: 'btn primary', onClick: again }, 'Try again')));
}
/** Signed in: their first password if needed, then their own screens (team task: a task link that waited). */
function openFor(user, teamTask = 0) {
  if (user && user.mustChange) { showFirstPassword(user, (u) => openFor(u, teamTask)); return; }
  const who = whoFromUser(user);
  if (who) rememberWho(who);
  if (who === 'staff') startStaff(user, teamTask);
  else if (who === 'manager') startManager(user, teamTask);
  else startOwner();
}

// ---------------------------------------------------------------- one app for everyone on worktask.in
// Who signed in decides the screens: the owner gets this app, a team member gets the staff view (only their own
// Work Task tasks, ui/staff.js), another manager goes to Work Task's manager screens. It is remembered for this
// sign-in only, so the owner's start-up never waits for the server (and works offline as before).
const WHO_KEY = 'dp.who';
function rememberedWho() {
  try { const w = JSON.parse(localStorage.getItem(WHO_KEY) || 'null'); return w && w.tag === signInTag(serverToken()) ? w.who : ''; } catch { return ''; }
}
function rememberWho(who) { try { localStorage.setItem(WHO_KEY, JSON.stringify({ tag: signInTag(serverToken()), who })); } catch { /* blocked */ } }
/** First time with this sign-in: ask the server who it is (no answer in 4 s, or none at all = the owner's app, as before). */
async function askWho() {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 4000);
  try {
    const r = await fetch('../api/?a=me', { method: 'POST', cache: 'no-store', signal: stop.signal, headers: { Authorization: 'Bearer ' + serverToken(), 'Content-Type': 'application/json' }, body: '{}' });
    const out = await r.json();
    const who = out && out.ok ? whoFromUser(out.user) : '';
    if (who) rememberWho(who);
    return { who, user: out && out.user, answered: true }; // (answered without a user: the sign-in does not work any more)
  } catch { return { who: '', answered: false }; } finally { clearTimeout(timer); }
}

/**
 * What the staff view and the team pages share: photos fetched with the sign-in, the viewer, signing out.
 * more: { waiting() (items still to send), push() (this phone's notifications) }.
 */
function serverTools(api, more = {}) {
  const photos = new Map();
  const photo = (kind, id) => {
    const k = kind + ':' + id;
    if (!photos.has(k)) {
      const p = fetch(`../api/?a=${kind}&id=${id}`, { headers: { Authorization: 'Bearer ' + serverToken() } }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('photo')))).then((b) => URL.createObjectURL(b));
      p.catch(() => photos.delete(k)); // a failed one is tried again next time
      photos.set(k, p);
    }
    return photos.get(k);
  };
  const signOut = async () => {
    const n = more.waiting ? more.waiting() : 0;
    if (n && !confirm(`${n} item${n > 1 ? 's are' : ' is'} not sent yet. They go out when you sign in again on this phone. Sign out anyway?`)) return;
    try { const p = more.push && more.push(); if (p) await p.unlink(); } catch { /* tried: offline */ } // the next person on this phone must not get this person's messages
    try { await api('logout'); } catch { /* signed out on this phone anyway */ }
    try { // nothing of this person stays for the next one on this phone (what waits to send stays, sent after they sign in again)
      localStorage.removeItem(SERVER_TOKEN_KEY); localStorage.removeItem(WHO_KEY);
      for (const k of Object.keys(localStorage)) if (k.startsWith('wt.c.')) localStorage.removeItem(k);
    } catch { /* blocked */ }
    location.replace(location.pathname); // this app's sign-in
  };
  /** A photo or PDF on top of the page (the same viewer as the owner's files). */
  const viewer = (url, name, image) => {
    const v = document.getElementById('viewer');
    const close = () => { v.hidden = true; v.replaceChildren(); };
    v.replaceChildren(h('div', { class: 'viewer-bar' }, h('strong', { class: 'viewer-name' }, name), h('a', { class: 'btn', href: url, download: name }, 'Download'), h('button', { class: 'btn', onClick: close }, 'Close')),
      h('div', { class: 'viewer-body' }, image ? h('img', { src: url, alt: name }) : h('iframe', { src: url, title: name })));
    v.hidden = false;
  };
  return { photo, viewer, signOut };
}

/** The team pages (ui/team.js): the owner's "👥 Team" space, or all a manager who is not the owner gets. */
let teamView = null, staffView = null, space = 'owner'; // space: 'owner' (Daily Projects) | 'team' (the team pages)
async function teamPages(user, more = {}) {
  const [{ createTeam }, { staffApi, shrinkPhoto, browserPush }, { idbOutbox }, rules] = await Promise.all([import('./ui/team.js'), import('./ui/staff.js'), import('./ui/staffbox.js'), import('../logic.js')]);
  let t = null;
  const api = staffApi(serverToken(), '../api/', { allow: null, onNet: (on) => { if (t) t.setOffline(!on); } }); // (the server decides what a manager may do)
  if (!user) user = (await api('me')).user;
  const push = browserPush(api, user.id);
  const { photo, viewer, signOut } = serverTools(api, { waiting: () => (t ? t.state.outbox.length : 0), push: () => push });
  t = createTeam({ root, api, rules, user, toast, signOut, onAuth: () => signInAgain(), photo, viewer, box: idbOutbox(), shrink: shrinkPhoto, push, appLink: location.origin + '/', ...more });
  setInterval(() => { if (document.visibilityState === 'visible' && (space === 'team' || !store)) t.act.liveCheck(); }, 20000); // new work comes in by itself
  setInterval(() => { if (t.state.outbox.length) t.act.flush(); }, 30000);
  window.addEventListener('online', () => { t.setOffline(false); t.act.flush(); });
  window.addEventListener('offline', () => t.setOffline(true));
  return t;
}

/** The owner: open "👥 Team" inside this app (from 👥, a team task chip, or "Give to team"); "📋 My projects" comes back. */
async function openTeam(how = {}) {
  if (!onServer || isMock) return;
  try {
    if (!teamView) {
      teamView = await teamPages(null, {
        toProjects: () => { leaveTeam(); render(); },
        openPeople: () => { leaveTeam(); go('people'); },
      });
    }
  } catch (e) { toast(e.message, 5000); return; }
  space = 'team'; teamView.state.hidden = false;
  root.replaceChildren();
  teamView.start(how);
}

/** Back from the team pages to the owner's projects. */
function leaveTeam() { space = 'owner'; if (teamView) teamView.state.hidden = true; root.replaceChildren(); }

/**
 * worktask.in/projects/#team (👥), #team-task=<id> (a team task chip, a phone notification), #team-new=<what to give>
 * ("Give to team"): what to open on the team pages, or null. Taken off the address.
 */
function teamHowFromHash() {
  const hsh = location.hash;
  let how = null;
  const m = /^#team-task=(\d+)$/.exec(hsh);
  if (hsh === '#team') how = {};
  else if (hsh === '#team-settings') how = { view: 'settings' }; // Settings → Outlook and the team's settings
  else if (m) how = { sel: 'task:' + m[1], fromProjects: true };
  else if (hsh.startsWith('#team-new=')) { try { const p = JSON.parse(decodeURIComponent(hsh.slice(10))); how = { sel: 'give', prefill: p && typeof p === 'object' ? p : null, fromProjects: true }; } catch { how = { sel: 'give' }; } }
  if (how) history.replaceState(null, '', location.pathname + location.search);
  return how;
}
/** The owner: "#team…" opens the team pages of this app. */
function takeTeamFromHash() {
  const how = teamHowFromHash();
  if (!how) return false;
  openTeam(how);
  return true;
}

/** A manager who is not the owner: the team pages are all of this app for them (teamTask: a task to open first). */
async function startManager(user, teamTask = 0) {
  root.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
  try { teamView = await teamPages(user); } catch (e) { if (e.auth) { signInAgain(); return; } root.replaceChildren(h('div', { class: 'loading' }, e.message)); return; }
  space = 'team';
  listenKeys(); // ↓ ↑ and the other keys on their pages too
  const how = teamHowFromHash() || (teamTask ? { sel: 'task:' + teamTask } : {});
  teamView.start({ ...how, fromProjects: false }); // (they have no projects page to go back to)
  startBell();
  window.addEventListener('hashchange', () => { const h2 = teamHowFromHash(); if (h2) teamView.start({ ...h2, fromProjects: false }); }); // a notification tapped while open
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') teamView.act.reload(); });
  document.addEventListener('paste', (e) => pasteToView(teamView, e, TEAM_BOX));
}
/** Ctrl+V on the staff view or the team pages: to that view (in its message box: a photo message). One copy for all. */
const TEAM_BOX = /^Reply or give/, STAFF_BOX = /^Ask or reply/; // (the message boxes' first words)
function pasteToView(view, e, box) {
  if (e.defaultPrevented || !e.clipboardData) return;
  const inMessageBox = !!(e.target && e.target.tagName === 'TEXTAREA' && box.test(e.target.placeholder || ''));
  if (view.act.paste({ files: [...(e.clipboardData.files || [])], text: e.clipboardData.getData('text/plain') || '', inMessageBox })) e.preventDefault();
}
/** A task number on the address for a team member or a manager (a phone notification): "#team-task=<id>", or the older "#open=<id>". */
const teamTaskInHash = () => Number((/^#(?:open|team-task)=(\d+)$/.exec(location.hash) || [])[1] || 0);

/** A team member: the staff view, in the same layout and look as this app (the rules come from Work Task's logic.js). */
async function startStaff(user, openTask = 0) {
  // (staff see this app's own design: only its styles, never Work Task's on top)
  root.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
  const [{ createStaff, staffApi, shrinkPhoto, browserPush }, { idbOutbox }, rules] = await Promise.all([import('./ui/staff.js'), import('./ui/staffbox.js'), import('../logic.js')]);
  let staff = null;
  const api = staffApi(serverToken(), '../api/', { onNet: (on) => { if (staff) staff.setOffline(!on); } });
  if (!user) {
    try { user = (await api('me')).user; } // (offline: the saved copy)
    catch (e) { if (e.auth) { signInAgain(); return; } root.replaceChildren(h('div', { class: 'loading' }, e.message)); return; }
  }
  const push = browserPush(api, user.id);
  const { photo, viewer, signOut } = serverTools(api, { waiting: () => (staff ? staff.state.outbox.length : 0), push: () => push });
  // signed out (or their first password still to choose): this app's sign-in; what waits on the phone stays and is sent after
  const onAuth = () => signInAgain();
  staff = createStaff({ root, api, rules, user, toast, signOut, onAuth, photo, viewer, box: idbOutbox(), shrink: shrinkPhoto, push });
  staffView = staff;
  listenKeys(); // ↓ ↑ and the other keys in the staff app too
  if (openTask) { if (teamTaskInHash() === openTask) history.replaceState(null, '', location.pathname + location.search); staff.open('task:' + openTask); } // a phone notification: that task (taken off the address, so a reload does not open it again)
  staff.start();
  startBell();
  window.addEventListener('hashchange', () => { // a notification tapped while open
    const id = teamTaskInHash();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (id) staff.open('task:' + id);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') staff.act.reload(); });
  window.addEventListener('online', () => { staff.setOffline(false); staff.act.flush(); });
  window.addEventListener('offline', () => staff.setOffline(true));
  setInterval(() => { if (staff.state.outbox.length) staff.act.flush(); }, 30000); // weak signal: keep trying
  setInterval(() => { if (document.visibilityState === 'visible') staff.act.liveCheck(); }, 20000); // new work comes in by itself
  window.addEventListener('focus', () => staff.act.liveCheck());
  // Ctrl+V on an open task: a photo into today's update, or (in the message box) a photo message
  document.addEventListener('paste', (e) => pasteToView(staff, e, STAFF_BOX));
}

const saved = device.ui();
const ui = {
  view: saved.view && !String(saved.view).startsWith('group:') ? saved.view : saved.view ? 'all' : 'today', // today | all | mains | paused | finished | diary | settings (groups are gone: an old group view opens ✅ Tasks)
  selected: saved.selected || null,
  search: '',
  mobile: 'list', // list | detail (phone only)
  menuOpen: false,
  briefFolded: !!saved.briefFolded,
  moreMenu: !!saved.moreMenu, // the menu's More ▸ (Diary, Dashboard, Time report) is open
  taskFilter: saved.taskFilter === 'loose' ? 'loose' : 'all', // ✅ Tasks: 'all' tasks, or 'loose' = only tasks not in any 📂 project
  sort: saved.sortV === 2 && saved.sort === 'mine' ? 'mine' : 'red', // 'red' = red first (red, yellow, green, grey: the default); 'mine' = my drag order, kept only when picked after this became the default
  adding: false,
  openStep: null,
  showMore: saved.showMore === true, // project page "More" fold (notes, links, files, history)
  showDone: saved.showDone !== false, // the Done list under the steps is open unless you closed it (remembered)
  ai: null,
  brief: { busy: false, error: '' },
  diaryDays: 14,
  folded: saved.folded && typeof saved.folded === 'object' ? saved.folded : {}, // (older: 📂 folded rows; lists are flat now)
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

// changes that take a task out of 📂 projects' order (dropFromOrder)
const DROPS_ORDER = new Set(['removeFromProject', 'deleteProject', 'setParent']);

/**
 * Several changes to one project as ONE action with one Undo (e.g. note + tick + next step).
 * `steps` is a list of [type, args]. Returns the ops that were applied, or null.
 * `undoMark`: a team tick / untick (teamUndoKey): its Undo is remembered, so the next team load does not do it again.
 */
function actMany(projectId, steps, message, undoMark = null) {
  const list = store.view.data.projects;
  const index = list.findIndex((x) => x.id === projectId);
  const before = index >= 0 ? clone(list[index]) : null;
  // taking it out of a 📂 project (or deleting it): Undo puts it back in its place in that project's order
  const orderPos = steps.some(([type]) => DROPS_ORDER.has(type)) ? orderPosOf(store.view.data, projectId) : null;
  const ops = [];
  for (const [type, args] of steps) { const op = store.dispatch(type, args); if (op) ops.push(op); }
  if (!ops.length) return null;
  const undo = before ? () => {
    const months = [...new Set(ops.map(opMonth))];
    // (a step the person added, taken away by this Undo, is remembered as deleted on every device)
    const dropTeamSteps = ops.filter((o) => o.type === 'addStep' && o.args.byTeam).map((o) => o.args.stepId);
    // (an undone untick puts its tick line back: the save loads the month it is in)
    const tickMonths = [...new Set(ops.flatMap((o) => o.args.tickMonths || []))];
    if (store.dispatch('restoreProject', { project: before, index, undoOpIds: ops.map((o) => o.id), undoMonth: months[0], dropTeamSteps, teamUndone: undoMark, tickMonths, ...(orderPos ? { orderPos } : {}) })) toast('Undone', 1500);
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
  // a new 📂 project with a task in it: Undo puts that task back as it was, and the new project goes
  const snapId = type === 'createMainProject' ? args.childId : args.projectId;
  const index = list.findIndex((x) => x.id === snapId);
  const before = index >= 0 ? clone(list[index]) : null;
  // deleting a 📂 project: its tasks stay (no longer in it); Undo puts them back into it
  const parentIds = type === 'deleteProject' ? Object.fromEntries(list.filter((x) => parentIdsOf(x).includes(args.projectId)).map((x) => [x.id, args.projectId])) : null;
  const orderPos = DROPS_ORDER.has(type) ? orderPosOf(store.view.data, snapId) : null; // Undo: its place in each 📂 project's order
  const timerBefore = store.view.data.timer && store.view.data.timer.projectId === snapId ? clone(store.view.data.timer) : null;
  const op = store.dispatch(type, args);
  if (!op) return null;
  // Pause / Finish stopped its timer: Undo starts it again from its start (no timed minutes lost)
  const timerStopped = timerBefore && !(store.view.data.timer && store.view.data.timer.id === timerBefore.id) ? timerBefore : null;
  const undo = before ? () => {
    // (Make it a task / new 📂 project: the new one goes too)
    const made = type === 'stepToProject' ? { removeProjectId: args.newProjectId } : {};
    Object.assign(made, type === 'createMainProject' ? { removeProjectId: args.projectId } : parentIds ? { parentIds } : {});
    if (timerStopped) made.timer = timerStopped;
    if (orderPos) made.orderPos = orderPos;
    if (op.args.tickMonths) made.tickMonths = op.args.tickMonths; // an undone untick puts its tick line back
    if (store.dispatch('restoreProject', { project: before, index, undoOpId: op.id, undoMonth: opMonth(op), ...made })) toast('Undone', 1500);
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
    scroll: device.ui().scroll, view: ui.view, selected: ui.selected, briefFolded: ui.briefFolded, sort: ui.sort, sortV: 2, taskFilter: ui.taskFilter, moreMenu: !!ui.moreMenu, showDone: ui.showDone, showMore: ui.showMore, folded: ui.folded });
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
  openPersonMessage: (person) => openPersonMessage(person),
  teamLink: (person) => personTeamLink(person),
  teamAccounts: () => (onServer ? teamAccounts() : null),
  sentMark: (person) => { const link = personTeamLink(person); return sentMarkOf(person, link && link.member, todayIndia()); },
  giveSignIn: (person, email) => giveSignIn(person, email),
  newPasswordFor: (person, account) => newPasswordFor(person, account),
  setTeamEmail: (account, email) => setTeamEmail(account, email),
  toggleTeamUser: (account) => toggleTeamUser(account),
  moveAllTasks: (account, to) => moveAllTasks(account, to),
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
  // upTo = the newest message shown in the box: one that came after it stays unread (it is shown next)
  teamReply: (p, taskId, text, allIds = [], clientId = null, upTo = 0) => teamApi('comment.add', { taskId, text, ...(clientId ? { clientId } : {}), ...(upTo ? { upTo } : {}) })
    .then(() => (allIds.length > 1 ? teamApi('tasks.read', { ids: allIds, ...(upTo ? { upTo } : {}) }) : null)) // answered = every message in the box is read
    .then(() => { refreshDaily(p.id); loadTeam(true); toast('Sent ✓'); }),
  teamSeen: (p, taskIds, upTo = 0) => teamApi('tasks.read', { ids: taskIds, ...(upTo ? { upTo } : {}) }).then(() => { refreshDaily(p.id); loadTeam(true); }),
  teamMsgPhoto: (id) => teamMsgPhoto(id),
  moreDaily: (p) => { const e = daily.get(p.id); teamDaily(p, (e ? e.days : 30) + 30); },
  teamBusy: (id) => team.busy.has(id),
  giveProject: (p, person) => giveProject(p, person),
  takeBackProject: (p) => giveProject(p, null),
  setGivePhoto: (on) => { ui.givePhoto = on; render(); },
  setGiveRecord: (on) => { ui.giveRecord = on; render(); },
  teamInfo: () => team,
  afterTick: (id, where, undo) => afterTick(id, where, undo),
  openPersonMenu: (id, e) => openPersonMenu(id, e),
  openRowMenu: (id, e, from) => openRowMenu({ id, from }, e),
  openStepMenu: (projectId, stepId, e) => openRowMenu({ kind: 'step', id: projectId, stepId }, e),
  selectPerson: (id) => { ui.person = id; ui.mobile = 'detail'; render(); const d = document.getElementById('detail'); if (d) d.scrollTop = 0; },
  giveSteps: (items, user, person) => giveStepsTo(items, user, person),
  openReplyDraft: (m) => openReplyDraft(m),
  openMail: (m) => openMail(m),
  startReplyRound: () => startReplyRound(),
  copyList: (tasks, opts) => copyList(tasks, opts),
  // on the 📂 Projects page: show a project or a task on the right and stay on the page (nothing jumps away)
  showHere: (id) => {
    if (!store.view.data.projects.some((x) => x.id === id)) return;
    pushNav();
    if (ui.view !== 'mains') { ui.view = 'mains'; ui.search = ''; rememberUi(); }
    select(id);
  },
  openProject: (id) => {
    const p = store.view.data.projects.find((x) => x.id === id);
    if (!p) return;
    pushNav();
    // a 📂 project opens on the Projects page (its own page: description, tasks); a task on the Tasks list
    ui.view = p.state !== 'active' ? p.state : isMainProject(store.view.data, p) ? 'mains' : 'all'; // ('paused' or 'finished')
    ui.search = '';
    rememberUi();
    select(id);
  },
};

/** 🔌 Connections (Settings) and the 🔌 From apps page: the server calls, and the address apps use (this host's /api/). */
const appsCtx = {
  api: (a, body) => teamApi(a, body),
  toast: (...args) => toast(...args),
  render: () => render(),
  base: () => new URL('../api/', location.href).href,
  openConnections: () => { go('settings'); setTimeout(() => { const el = document.querySelector('[data-key="connections"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); }, 50); },
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
/**
 * The send sheet: the words in a box, then WhatsApp / Outlook / Copy.
 * html: the same message as an email table — then Outlook and Copy put the table on the clipboard (with plain lines
 * as the fallback) and Outlook opens a new mail with To and Subject (you paste the table in). onSent: WhatsApp or Outlook pressed.
 */
function openSheet({ title, text, busy = false, error = '', extra = null, subject = 'Update', to = null, html = '', onSent = null, draft = false }) {
  const v = document.getElementById('viewer');
  v.hidden = false;
  v.classList.add('sheet-mode');
  const area = h('textarea', { class: 'sheet-text', rows: 12, 'aria-label': title });
  area.value = text || '';
  const notice = h('p', { class: 'sheet-notice small', role: 'status', hidden: true });
  const tell = (words) => { notice.textContent = words; notice.hidden = false; toast(words, 6000); };
  const say = (how, why = '') => { const words = copyNotice(how); tell(why ? `${why} — ${words.charAt(0).toLowerCase()}${words.slice(1)}` : words); };
  const copyPlain = async () => {
    try { await navigator.clipboard.writeText(area.value); return 'text'; }
    catch { area.select(); return document.execCommand && document.execCommand('copy') ? 'text' : 'none'; }
  };
  // the table AND plain lines in one copy; the blobs are made here, inside the click, so the browser allows it
  const copyTable = () => {
    let write = null;
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        const item = new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([area.value], { type: 'text/plain' }) });
        write = navigator.clipboard.write([item]);
      }
    } catch { write = null; }
    return write ? write.then(() => 'html', () => copyPlain()) : copyPlain();
  };
  const copy = async () => {
    if (html) { say(await copyTable()); return; }
    try { await navigator.clipboard.writeText(area.value); toast('Copied ✓ — paste it in WhatsApp or email', 2500); }
    catch { area.select(); document.execCommand && document.execCommand('copy'); toast('Copied ✓', 2000); }
  };
  const phone = to && to.phone;
  const email = to && to.email;
  const wa = () => { window.open(`https://wa.me/${phone || ''}?text=${encodeURIComponent(area.value)}`, '_blank', 'noopener'); if (onSent) onSent('whatsapp'); };
  // Outlook on the web, new mail with To, subject and text filled in (you use Outlook in Chrome)
  // draft: "no paste" — with Outlook connected and an email saved, the finished email (table inside) goes straight into
  // the owner's Outlook Drafts (outlook.compose, never sent) and opens; else (or if that fails) the copy + new mail way.
  const outlook = async () => {
    let why = '';
    if (html && draft) {
      const connected = outlookConnected();
      if (emailPath({ connected, email }) === 'draft') {
        const tab = window.open('about:blank', '_blank'); // opened now, inside the click (a tab opened later is blocked)
        tell('Making the draft in Outlook…');
        try {
          const out = await teamApi('outlook.compose', { to: email, subject, html });
          if (tab) { try { tab.opener = null; } catch { /* fine */ } tab.location.href = out.webLink; } else window.open(out.webLink, '_blank', 'noopener');
          tell('Draft ready in Outlook — check it and press Send.');
          if (onSent) onSent('outlook'); // marked sent as today, the same as the paste way
          return;
        } catch (e) {
          if (tab) tab.close();
          why = pasteReason({ connected, email, name: to && to.name, error: e.message });
        }
      } else why = pasteReason({ connected, email, name: to && to.name }) || '';
    }
    if (html) { // the table cannot go in a link: copy it, then open the mail with To and Subject only
      const done = copyTable();
      const how = await done;
      say(how, why);
      location.href = `mailto:${encodeURIComponent(email || '').replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}`;
    } else window.open(`https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(email || '')}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(area.value)}`, '_blank', 'noopener');
    if (onSent) onSent('outlook');
  };
  const first = to ? to.name.split(/\s+/)[0] : '';
  v.replaceChildren(
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-head' }, h('strong', null, title), h('button', { class: 'icon', 'aria-label': 'Close', onClick: closeSheet }, '✕')),
      busy ? h('p', { class: 'muted' }, 'Writing…') : error ? h('p', { class: 'error' }, error) : area,
      busy || error ? null : h('p', { class: 'muted small' }, html ? 'Outlook and Copy send the table. Changes in this box only go to WhatsApp (and plain copies).' : 'You can change the words before sending.',
        to && (!phone || !email) ? ` Tip: save ${first}'s ${!phone && !email ? 'phone and email' : !phone ? 'phone' : 'email'} on ${first}'s page, and these buttons go straight to ${first}.` : ''),
      notice,
      h('div', { class: 'row sheet-actions' },
        busy || error ? null : h('button', { class: 'btn wa' + (phone ? ' primary' : ''), onClick: wa, title: phone ? `Opens WhatsApp chat with ${to.name}` : 'Opens WhatsApp; you pick the person' }, phone ? `WhatsApp ${first}` : 'WhatsApp'),
        busy || error ? null : h('button', { class: 'btn' + (email ? ' primary' : ''), onClick: outlook, title: html ? 'Copies the table, then opens a new mail — paste it in' : email ? `New Outlook mail to ${email}` : 'New Outlook mail; you add the person' }, email ? `✉ Outlook ${first}` : '✉ Outlook'),
        busy || error ? null : h('button', { class: 'btn', onClick: copy, title: html ? 'Copies the table (and plain lines)' : 'Copies the words' }, '📋 Copy'),
        extra)));
  if (!busy && !error) setTimeout(() => area.focus(), 30);
}

/** "📋 Send pending list": the words for WhatsApp, the table for Outlook. A person with a Work Task account gets the
 *  server's projects and tasks first and their sent mark is kept on the server (as in the Work Task app). */
function openPersonMessage(person) {
  outlookConnected(); // asked now (once per page load), so the Outlook button knows by the time it is pressed
  const data = store.view.data;
  const today = todayIndia();
  const link = personTeamLink(person);
  const items = link && link.member ? link.member.items || [] : null;
  const owner = ((team.accounts || []).find((u) => u.owner) || {}).name || '';
  const mail = personMessageHtml(data, person, today, { items, owner });
  const email = (link && link.user && link.user.email) || person.email || '';
  openSheet({
    title: `Pending list for ${person.name}`, text: personMessageText(data, person, today, items), subject: mail.subject, html: mail.html,
    to: { ...person, email }, onSent: () => markPersonSent(person, link), draft: true,
  });
}

/**
 * Is the owner's Outlook connected (for the "no paste" email)? Asked once per page load (outlook.status), kept in memory.
 * false until the answer comes, on this computer's copy (not worktask.in), and for anyone but the owner.
 */
let outlookOn = null; // null: not asked; a promise while asking; then true / false
function outlookConnected() {
  if (outlookOn === null) {
    outlookOn = onServer ? teamApi('outlook.status').then((o) => { outlookOn = !!(o.outlook && o.outlook.connected); }, () => { outlookOn = false; }) : false;
  }
  return outlookOn === true;
}

/** Remember that today's list went out: on the server for a Work Task person, else in this app's data. */
function markPersonSent(person, link) {
  if (link && link.member) {
    const member = link.member;
    teamApi('morning.sent', { userId: member.id }).then((r) => { member.sentAt = r.sentAt; render(); }, (e) => toast(e.message, 5000));
  } else store.dispatch('markPersonSent', { personId: person.id, at: new Date().toISOString() });
  render();
}

/** Each Work Task staff person's pending work and today's send (people.morning, manager only). null while loading, false if it failed. */
function teamMorning(force = false) {
  if (!onServer) return false;
  if (team.morning !== undefined && team.morning !== null && !force) return team.morning;
  if (!team.morningLoading) {
    team.morningLoading = true;
    teamApi('people.morning').then((out) => { team.morning = out; team.morningLoading = false; render(); })
      .catch(() => { team.morning = false; team.morningLoading = false; render(); });
  }
  return team.morning === undefined ? null : team.morning;
}

/** A person's Work Task account (users.list) and pending work (people.morning), matched by name; null when none. */
function personTeamLink(person) {
  if (!onServer || !person) return null;
  const users = (teamAccounts() || []).filter((u) => !u.owner);
  const user = teamMemberFor(person, users);
  const m = teamMorning();
  const member = m && m.people ? (user ? m.people.find((x) => x.id === user.id) : teamMemberFor(person, m.people)) || null : null;
  if (!user && !member) return null;
  return { user, member, loading: m === null, failed: m === false };
}

/**
 * People page "→ Give to <Name>" / "→ Give all N" / "<Name> does it": each step becomes that person's Work Task task, the same
 * as "👥 Give to team" on a step (projectRef + stepRef link it: the step then shows the team task, and is ticked when they finish).
 * One by one; one summary at the end. No page change.
 */
async function giveStepsTo(items, user, person) {
  const first = person.name.split(/\s+/)[0];
  const giving = (team.giving ||= new Set());
  const ids = (team.giveIds ||= new Map()); // one id per step and person until it is given: a retry after a lost reply is the same give
  let given = 0;
  const failed = [];
  for (const { project, step } of items) {
    if (giving.has(step.id)) continue; // a second tap while it is on its way
    giving.add(step.id);
    const key = step.id + ' ' + user.id;
    if (!ids.has(key)) ids.set(key, 'give-' + newId() + newId());
    try {
      const out = await teamApi('task.save', {
        assigneeId: user.id, title: step.text, details: '', project: project.name, projectRef: project.id, stepRef: step.id,
        repeat: 'once', dueDate: step.dueDate || null, skipSunday: true, clientId: ids.get(key), // once: their Finished closes it and ticks the step
      });
      ids.delete(key); // given: a later give (after a cancel) is a new task
      if (out.task) team.byStep.set(step.id, out.task); // shows "👥 on …'s list" at once
      given++;
    } catch (e) {
      failed.push(`${step.text.slice(0, 40)}: ${e.message}`);
    } finally {
      giving.delete(step.id);
    }
  }
  if (items.length === 1) toast(given ? `Given to ${first} ✓` : `Not given: ${failed[0] || 'already on the way'}`, given ? 2500 : 6000);
  else toast(`Given ${given} to ${person.name} ✓${failed.length ? ` (${failed.length} failed: ${failed[0]})` : ''}`, failed.length ? 7000 : 3000);
  if (given) { teamMorning(true); loadTeam(true); } // the Work Task table and the steps' team chips catch up
  render();
}

function refreshTeamPeople() { teamAccounts(true); teamMorning(true); }

async function setTeamEmail(account, email) {
  try { await teamApi('user.save', { id: account.id, name: account.name, role: account.role, email: String(email || '').trim() }); toast('Email saved ✓'); refreshTeamPeople(); }
  catch (e) { toast(e.message, 6000); refreshTeamPeople(); }
}

async function toggleTeamUser(account) {
  if (account.active && !confirm(`Switch off ${account.name}? They can no longer sign in. Their updates stay.`)) return;
  try { await teamApi('user.active', { id: account.id, active: !account.active }); toast(account.active ? 'Switched off' : 'Switched on'); refreshTeamPeople(); }
  catch (e) { toast(e.message, 6000); }
}

async function moveAllTasks(account, to) {
  if (!confirm(`Move all of ${account.name}'s open tasks to ${to.name}?`)) return;
  try { const out = await teamApi('tasks.moveAll', { fromId: account.id, toId: to.id }); toast(`${out.moved} task${out.moved === 1 ? '' : 's'} moved to ${to.name} ✓`); refreshTeamPeople(); loadTeam(true); }
  catch (e) { toast(e.message, 6000); }
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
  return base + teamUpdatesText(store.view.data, team.summary, [...team.byStep.values()], today);
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

/** 'project' for a 📂 project, 'task' for everything else (what the app once called a project). */
function kindWord(p) {
  return isMainProject(store.view.data, p) ? 'project' : 'task';
}


/** ✅ Tasks: a task's stage (a given task: stuck on the team = waiting). rules.js stageOf. */
function taskStage(p) {
  return stageOf(p, p.team ? teamProgress(p.id) : null);
}

function visibleProjects({ stage = true } = {}) {
  const all = store.view.data.projects;
  const q = ui.search.trim().toLowerCase();
  if (q) return all.filter((p) => projectMatches(p, q));
  if (ui.view === 'today') return todayWithoutEmptyMains(awakeProjects(store.view.data, todayIndia()), todayIndia()); // a 📂 project with no own step: its tasks show instead
  if (ui.view === 'all' && stage) return byStage(visibleProjects({ stage: false }), ui.stageFilter, (p) => taskStage(p).stage); // ✅ Tasks: then the Stage filter chips
  if (ui.view === 'all') return activeTasks(store.view.data).filter((p) => ui.taskFilter !== 'loose' || !parentIdsOf(p).length); // ✅ Tasks: tasks only, each once; 'No project' = loose tasks
  if (ui.view === 'mains') return mainProjects(store.view.data).filter((p) => p.state !== 'finished'); // 📂 Projects: projects only, a list like Tasks
  if (ui.view === 'paused') return all.filter((p) => p.state === 'paused');
  if (ui.view === 'finished') return all.filter((p) => p.state === 'finished');
  return [];
}

function viewTitle() {
  if (ui.search.trim()) return `Search: "${ui.search.trim()}"`;
  return { today: 'Today', inbox: 'Inbox', all: '✅ Tasks', paused: 'Paused', finished: 'Finished', diary: 'Diary', settings: 'Settings', people: 'People', dashboard: 'Dashboard', time: 'Time report', replies: '✉ Replies', apps: '🔌 From apps', mains: '📂 Projects' }[ui.view];
}

function go(view) {
  if (view !== 'settings') forgetOnce(); // a new key shown once: gone when you leave Settings
  if (view === 'apps' && onServer) loadApps(appsCtx, true); // 🔌 From apps: always fresh when you open it (a new job shows at once)
  ui.view = view;
  ui.rowMenu = null;
  ui.round = null;
  ui.replyRound = null;
  ui.replyOpen = null;
  resetRedOrder();
  ui.search = '';
  // the task open on the right stays only if this page lists it (owner, 24 Oct: no old task beside 🔌 From apps)
  if (ui.selected && (!TASK_PAGES.includes(view) || !visibleProjects({ stage: false }).some((p) => p.id === ui.selected))) ui.selected = null;
  ui.menuOpen = false;
  ui.mobile = 'list';
  rememberUi();
  render();
}
const TASK_PAGES = ['today', 'all', 'mains', 'paused', 'finished'];

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
  const active = todayWithoutEmptyMains(awakeProjects(store.view.data, today), today); // an empty 📂 project is left out, as in colourCounts
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

/** "📋 Copy list": the tasks as a numbered list (rich for email, plain for an AI chat), copied in one tap. */
async function copyList(tasks, opts = {}) {
  const { text, html } = tasksListText(tasks);
  const n = (tasks || []).length;
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(text);
    toast(`📋 Copied ${n} task${n === 1 ? '' : 's'} — paste into an AI chat or an email.`);
  } catch { toast('Could not copy here. Try again, or use Chrome.'); }
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
  const MENU_KEYS = { today: 'T', all: 'A', dashboard: 'B', people: 'P', diary: 'D', inbox: 'I', replies: 'E', mains: 'M' }; // (the keys that open them; i = Inbox, q = Capture, owner 24 Oct)
  const item = (view, label, n, extra) => h('li', { key: 'm-' + view },
    h('button', { class: 'menu-item' + (ui.view === view && !ui.search ? ' current' : ''), onClick: () => go(view) },
      h('span', null, label, MENU_KEYS[view] ? keyHint(MENU_KEYS[view]) : null), n !== undefined ? h('span', { class: 'count' }, String(n)) : null),
    extra || null);
  const today = todayIndia();
  const counts = colourCounts(data, today);

  const moreOpen = !!ui.moreMenu || ['diary', 'dashboard', 'time'].includes(ui.view);
  return h('nav', { class: 'menu-inner' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 28, height: 28 }), h('span', null, 'Task List')),
    h('input', {
      class: 'search', type: 'search', placeholder: withKey('Search…', '/'), value: ui.search, key: 'search-desktop', 'aria-label': 'Search',
      onInput: (e, el) => { ui.search = el.value; clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); },
      onKeydown: searchEnter,
    }),
    h('ul', { class: 'menu-list' },
      item('today', 'Today', todayWithoutEmptyMains(active.filter((p) => !isSnoozed(p, today)), today).length), // what Today shows (each task once)
      h('li', { class: 'menu-dots', key: 'dots' },
        h('span', { class: 'dot red' }), String(counts.red), ' ',
        h('span', { class: 'dot yellow' }), String(counts.yellow), ' ',
        h('span', { class: 'dot green' }), String(counts.green)),
      // order the owner chose (22 Oct): Today, Tasks, Projects, Replies, Inbox, Paused, Finished, People, Settings, More (no groups, 23 Oct)
      item('all', '✅ Tasks', activeTasks(data).length),
      item('mains', '📂 Projects', mainProjects(data).length),
      item('replies', '✉ Replies', readyCount(data, today)), // replies ready to send
      onServer ? item('apps', '🔌 From apps', appsPending()) : null, // approvals your apps sent, waiting for ✓ / ✕
      item('inbox', '📥 Inbox', (data.inbox || []).length),
      onServer ? h('li', { key: 'team-menu' }, h('a', { class: 'menu-item', href: '#team', title: 'Tasks you gave and their daily updates' }, h('span', null, '👥 Team'))) : null, // (also on the 👥 icon; on a phone the menu is where it is found)
      h('li', { class: 'menu-sep', key: 'sep' }),
      item('paused', 'Paused', count((p) => p.state === 'paused')),
      item('finished', 'Finished', count((p) => p.state === 'finished')),
      item('people', 'People', (data.people || []).length), // (open People to see each person)
      item('settings', 'Settings'),
      // More ▸: Diary, Dashboard and Time report, folded away (open while one of them is on screen)
      h('li', { key: 'more-menu' }, h('button', {
        class: 'menu-item more-toggle', 'aria-expanded': String(moreOpen),
        onClick: () => { ui.moreMenu = !moreOpen; rememberUi(); render(); },
      }, moreOpen ? 'More ▾' : 'More ▸')),
      moreOpen ? [item('diary', 'Diary'), item('dashboard', 'Dashboard'), item('time', 'Time report')] : null),
    h('button', { class: 'keys-hint', onClick: () => { ui.showKeys = true; ui.menuOpen = false; render(); } }, 'Keyboard shortcuts: press ?'));
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

function projectRow(p, today, opts = {}) {
  const colour = opts.colour || rowColour(p, today); // a 📂 project in the lists (not Today): the worst of it and its tasks
  const ns = nextStep(p, today); // shown as "Next:"
  const due = nextStep(p, today, { dueOnly: true }); // what the tick box ticks
  const asProject = ui.view === 'mains' && !ui.search; // 📂 Projects list: "3 tasks · 1 red" instead of the next step
  const canTick = due && p.state === 'active' && !asProject;
  const picking = canPickRows(); // ✅ Tasks: a select box for moving many tasks at once
  return h('li', {
    key: 'p-' + p.id, 'data-id': p.id, class: 'prow' + (ui.selected === p.id ? ' current' : '') + (isMainProject(store.view.data, p) ? ' main-row' : ''),
    onContextmenu: (e) => openRowMenu({ id: p.id }, e),
  },
    picking
      ? h('input', {
        type: 'checkbox', class: 'row-pick', key: 'pick-' + p.id, checked: picked.has(p.id) ? true : undefined,
        title: 'Select (then 📂 Add to project…)', 'aria-label': `Select ${p.name}`,
        onChange: (e, el) => { if (el.checked) picked.add(p.id); else picked.delete(p.id); render(); },
      })
      : canTick
      ? h('input', {
        type: 'checkbox', class: 'quick-tick', key: 'qt-' + p.id + '-' + due.id,
        title: `Tick: ${due.text}`, 'aria-label': `Tick next step of ${p.name}: ${due.text}`,
        onChange: (e, el) => quickTick(p, due, el),
      })
      : p.state === 'active' && !asProject
        ? h('button', {
          class: 'quick-add', title: 'Add the first step', 'aria-label': `Add a step to ${p.name}`,
          onClick: () => { ui.quickAdd = ui.quickAdd === p.id ? null : p.id; render(); focusKey('qa-' + p.id); },
        }, '+')
        : h('span', { class: 'quick-tick-space', 'aria-hidden': 'true' }),
    h('button', { class: 'prow-btn', onClick: () => select(p.id) },
      h('span', { class: `dot ${colour}`, 'aria-label': colour }),
      colour === 'green' && greenByTeamOnly(p, today) ? h('span', { class: 'team-green', title: 'On track today because the team sent an update' }, '👥') : null,
      h('span', { class: 'prow-text' },
        h('span', { class: 'prow-name' }, isMainProject(store.view.data, p) ? '📂 ' : '', p.name,
          p.state !== 'active' ? h('span', { class: 'tag' }, p.stateChangedAt && (p.state === 'paused' || p.state === 'finished') ? `${p.state === 'paused' ? 'paused since' : 'finished'} ${fmtDay(indiaDate(p.stateChangedAt))}` : p.state) : null,
          p.priority === 'high' ? h('span', { class: 'tag high' }, 'High') : null,
          ui.view === 'all' && !isMainProject(store.view.data, p) ? stageChip(taskStage(p)) : null), // ✅ Tasks: the Stage chip on each row
        asProject ? h('span', { class: 'prow-next' }, projectLine(store.view.data, p, today)) : null, // "2 projects · 5 tasks · 1 red"
        asProject ? null : h('span', { class: 'prow-next' }, ns ? `Next: ${ns.text}` : '', // (no next step: nothing said — the + on the left adds one)
          ns && ns.waiting ? waitingTag(ns) : null,
          ns && ns.snoozedUntil && ns.snoozedUntil > today ? h('span', { class: 'tag repeat' }, `↻ from ${fmtDay(ns.snoozedUntil)}`) : null,
          isOverdue(p, today) ? h('span', { class: 'tag late' }, `Overdue · ${fmtDay(p.deadline)}`) : null,
          restReason(p, today) === 'onlyDays' ? h('span', { class: 'tag snoozed', title: `Comes up only on these days — back ${fmtDay(restUntil(p, today))}` }, `📅 ${onlyDaysLabel(p.onlyDays)}`)
            : isSnoozed(p, today) ? h('span', { class: 'tag snoozed' }, `${p.snoozedUntil > today ? '💤' : '⏰'} back ${fmtDay(restUntil(p, today))}`) : noWorkTag(p, today)),
        p.status ? h('span', { class: 'prow-status' }, p.status) : null,
        projectChips(store.view.data, p))), // "📂 Kilns" "📂 Supplier approval": the projects this task is in
    rowAction(p, due, colour),
    canDrag() ? h('span', { class: 'grip', 'aria-hidden': 'true', title: 'Drag to reorder' }, '⋮⋮') : null,
    ui.quickAdd === p.id ? quickAddForm(p) : null);
}

/** ✅ Tasks: rows can be selected, then put into one 📂 project together. Today keeps its tick box. */
const picked = new Set();
function canPickRows() {
  return !ui.search && ui.view === 'all';
}

/** The bar over the list while tasks are selected: "3 selected · 📂 Add to project… · Clear". */
function pickBar(list) {
  for (const id of [...picked]) if (!list.some((p) => p.id === id)) picked.delete(id); // (only what is on screen)
  if (!canPickRows() || !picked.size) return null;
  const data = store.view.data;
  const box = ui.pickBox;
  const add = (main) => {
    let n = 0;
    for (const id of picked) if (store.dispatch('addToProject', { projectId: id, parentId: main.id })) n++;
    toast(`${n} task${n === 1 ? '' : 's'} added to 📂 ${main.name}`);
    picked.clear(); ui.pickBox = null; render();
  };
  const create = (name) => {
    const ids = [...picked];
    const projectId = newId();
    if (!store.dispatch('createMainProject', { projectId, name, childId: ids[0] })) return;
    for (const id of ids.slice(1)) store.dispatch('addToProject', { projectId: id, parentId: projectId });
    toast(`New project 📂 ${name} with ${ids.length} task${ids.length === 1 ? '' : 's'}`);
    picked.clear(); ui.pickBox = null; render();
  };
  const q = box ? box.q.trim() : '';
  const mains = mainProjects(data).filter((m) => m.state !== 'finished' && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
  const exact = mains.some((m) => m.name.toLowerCase() === q.toLowerCase());
  return h('div', { class: 'pick-bar', key: 'pick-bar' },
    h('div', { class: 'row' },
      h('strong', null, `${picked.size} selected`),
      h('button', { class: 'btn primary small', type: 'button', onClick: () => { ui.pickBox = box ? null : { q: '' }; render(); focusKey('pick-q'); } }, '📂 Add to project…'),
      h('button', { class: 'link small', type: 'button', onClick: () => { for (const p of list) picked.add(p.id); render(); } }, 'Select all'),
      h('button', { class: 'link small', type: 'button', onClick: () => { picked.clear(); ui.pickBox = null; render(); } }, 'Clear')),
    box ? h('div', { class: 'pick-box' },
      h('input', { class: 'main-box-input', key: 'pick-q', value: box.q, placeholder: 'Type a project name…', autocomplete: 'off', 'aria-label': 'Project name',
        onInput: (e, el) => { box.q = el.value; render(); },
        onKeydown: (e) => { if (e.key === 'Escape') { ui.pickBox = null; render(); } else if (e.key === 'Enter') { e.preventDefault(); const t = pickEnterTarget(mains, q); if (t && t.add) add(t.add); else if (t) create(t.create); } } }),
      h('div', { class: 'pick-list' }, mains.slice(0, 10).map((m) =>
        h('button', { class: 'main-box-item', key: 'pk-' + m.id, type: 'button', onClick: () => add(m) }, `📂 ${m.name}`)),
        q && !exact ? h('button', { class: 'main-box-item create', key: 'pk-new', type: 'button', onClick: () => create(q) }, `+ Create '${q}' as a new project`) : null)) : null);
}

/** One-tap action on a row that is not green yet: "Chased" for a waiting step (a real update). */
function rowAction(p, ns, colour) {
  // ⏸ Paused list: Unpause right on the row (owner, 24 Oct)
  if (p.state === 'paused') return h('button', { class: 'row-act', title: `Unpause ${p.name}`, onClick: () => act('unpause', { projectId: p.id }, `▶ ${p.name} is back on your lists`) }, '▶ Unpause');
  // ✓ Finished list: Reopen right on the row (owner, 24 Oct)
  if (p.state === 'finished' && !p.misc) return h('button', { class: 'row-act', title: `Open ${p.name} again`, onClick: () => act('reopen', { projectId: p.id }, `↺ ${p.name} is open again`) }, '↺ Reopen');
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
  // a red / yellow row says why (owner, 24 Oct): "Target 25 Oct is near", "No update for 4 days" (Overdue has its own tag)
  const why = isOverdue(p, today) ? '' : colourShort(p, today);
  if (why) return h('span', { class: 'tag ' + (dotColour(p, today) === 'red' ? 'late' : 'stale'), title: colourWhy(p, today) }, why);
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
  const all = stepTargets(data, todayIndia()); // tasks only: a 📂 project holds tasks, not steps
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
    const ok = store.dispatch('createProject', { projectId, name: text });
    if (ok) ensurePeople(clip.people);
    if (ok && clip.link) store.dispatch('addLink', { projectId, linkId: newId(), title: clip.link.title, url: clip.link.url });
    if (ok) { ui.capture = false; toast(`New task: ${text}`, 3000); select(projectId); }
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
      h('span', { class: 'muted small' }, 'Enter = add to the first task · Esc = close'),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onClick: close }, '✕')),
    h('input', { name: 'text', key: 'capture-input', value: clip.text, autocomplete: 'off', 'aria-label': 'Step', placeholder: 'What is the next step?', 'data-mention': '1', onInput: (e, el) => { clip.text = el.value; } }),
    clip.link ? h('div', { class: 'clip-link muted small', title: clip.link.url }, '🔗 ', clip.link.title) : null,
    ...alreadyAdded(clip.link).slice(0, 3).map((x, i) => h('div', { class: 'clip-already', key: 'al' + i },
      x.inbox ? `⚠︎ Already in your Inbox: ${x.inbox.text}` : `⚠︎ Already in ${x.project.name}${x.step ? `: ${x.step.text}${x.step.done ? ' (done)' : ''}` : ' (task link)'}`,
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
    h('input', { class: 'clip-find', key: 'clip-find', value: clip.find, autocomplete: 'off', placeholder: 'Search tasks…', 'aria-label': 'Search tasks',
      onInput: (e, el) => { clip.text = textNow() || clip.text; clip.find = el.value; render(); } }),
    h('div', { class: 'clip-projects' },
      list.length ? list.map((p, i) => h('button', { class: 'chip' + (i === 0 ? ' first' : ''), type: 'button', key: 'cp-' + p.id, onClick: () => addTo(p) }, p.name))
        : h('span', { class: 'muted small' }, find ? 'No task with that name.' : 'No tasks yet — use + New task.')),
    h('div', { class: 'row clip-other' },
      h('button', { class: 'btn', type: 'button', onClick: newProject }, '+ New task'),
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
  return inboxMatches(store.view.data, text, todayIndia());
}

/** An Inbox change (send to a project, or delete) with an Undo that puts the item back. */
function inboxAct(type, args, item, message) {
  const inbox = store.view.data.inbox || [];
  const index = inbox.findIndex((x) => x.id === item.id);
  const saved = clone(item); // the whole item: its email thread, note and reply draft come back too
  const op = store.dispatch(type, args);
  if (!op) return null;
  const undo = () => {
    const ok = store.dispatch('inboxUndo', {
      item: saved, index, undoOpId: op.id, undoMonth: opMonth(op),
      // only the step it added is taken back (by id), never an old copy of the whole task
      ...(type === 'inboxToProject' ? { removeProjectId: args.projectId } : type === 'inboxToStep' ? { projectId: args.projectId, stepId: args.stepId } : {}),
    });
    if (ok) toast('Undone — back in the Inbox', 1800);
  };
  toast(message, 6000, undo);
  return { op, undo };
}

/** The reply box of an Inbox item from an email. */
function inboxReply(item) {
  const m = mailThreads(store.view.data).find((x) => x.kind === 'inbox' && x.item.id === item.id);
  return m ? replyArea(ctx, m) : null;
}

// ---------------------------------------------------------------- email replies (✉ Replies)

/** One by one through the replies ready to send. */
function startReplyRound() {
  const { ready } = repliesOf(store.view.data, todayIndia());
  if (!ready.length) { toast('No reply ready to send.'); return; }
  ui.view = 'replies';
  ui.search = '';
  ui.replyRound = { ids: ready.map((m) => m.key), pos: 0 };
  ui.mobile = 'list';
  render();
}

/** Tap on a reply: its project (a step's or project's email), or the Inbox (an Inbox item's email). */
function openMail(m) {
  ui.replyRound = null;
  if (m.kind === 'inbox') { pushNav(); go('inbox'); return; }
  ctx.openProject(m.project.id);
}

/**
 * "Open in Outlook (same thread)": the server makes a draft reply to the newest email of the thread, with the SAVED reply
 * text (so the typed text is saved first), and its link opens in a new tab. Never sent: you press Send in Outlook.
 * Outlook not connected, no Outlook id, or Outlook says no: a new email (mailto:) to the sender instead.
 */
async function openReplyDraft(m) {
  saveTypedText(); // the reply being typed right now is saved first
  const fresh = mailThreads(store.view.data).find((x) => x.key === m.key) || m;
  const text = (fresh.reply && fresh.reply.state !== 'sent' && fresh.reply.text) || '';
  if (!text.trim()) { toast('Write the reply first.'); return; }
  const fallback = (why) => {
    const { url, cut } = replyMailto(fresh.mail, text);
    toast(`${why ? why + ' — ' : ''}a new email opens instead${cut ? ` (the reply was cut to ${MAILTO_BODY_MAX} letters: paste the rest from here)` : ''}.`, 8000);
    location.href = url;
  };
  if (!onServer || !fresh.mail.messageId) { fallback(onServer ? 'This email has no Outlook id' : ''); return; }
  const tab = window.open('', '_blank'); // opened now, while the tap counts (a tab opened later is blocked)
  toast('Making the draft in Outlook…', 6000);
  try {
    await store.flush();
    if (store.pending.length) throw new Error('The reply is not saved yet (no internet?)');
    const out = await teamApi('outlook.draft', { ref: fresh.id });
    if (tab) { try { tab.opener = null; } catch { /* fine */ } tab.location.href = out.webLink; } else window.open(out.webLink, '_blank', 'noopener');
    toast('Draft ready in Outlook ✓ — check it and press Send there. Then tap ✓ Sent.', 7000);
  } catch (e) {
    if (tab) tab.close();
    fallback(e.message);
  }
}

function renderInbox() {
  const { data } = store.view;
  const items = data.inbox || [];
  const projects = stepTargets(data, todayIndia()).slice().sort((a, b) => a.name.localeCompare(b.name));
  const toStep = (item, p) => inboxAct('inboxToStep', { itemId: item.id, projectId: p.id, stepId: newId() }, item, `Added to ${p.name}: ${item.text}`);
  return h('div', { class: 'inbox' },
    h('div', { class: 'row inbox-top' },
      h('button', { class: 'btn primary', onClick: openCapture }, '📥 Capture', keyHint('Q')),
      h('span', { class: 'muted small' }, items.length ? 'Send each item to a task. Tap a name, or pick from the list.' : '')),
    items.length ? h('ul', { class: 'inbox-list' }, items.map((item) => {
      const sugg = inboxSuggestions(item.text);
      return h('li', { key: 'ib-' + item.id, onContextmenu: (e) => openRowMenu({ kind: 'inbox', id: item.id }, e) },
        h('div', { class: 'inbox-text' }, item.text, h('span', { class: 'muted small' }, ` · ${fmtDay(indiaDate(item.createdAt))} `), linkChip(item.link, item.mail ? '✉ Open in Outlook' : null)),
        item.note ? h('div', { class: 'inbox-note muted small', key: 'ibn-' + item.id }, item.note) : null, // from an email: when, and how it starts
        item.mail ? inboxReply(item) : null, // ✉ the reply to this email (a draft; you press Send in Outlook)
        h('div', { class: 'inbox-actions' },
          h('button', { class: 'chip new-from-inbox', key: 'nt-' + item.id, title: 'Make it a new task', onClick: () => { if (inboxAct('inboxToProject', { itemId: item.id, projectId: newId() }, item, `New task: ${item.text}`)) render(); } }, '+ New task'),
          sugg.map((p) => h('button', { class: 'chip sugg', key: 'sg-' + p.id, title: `Add as a step in ${p.name}`, onClick: () => toStep(item, p) }, `→ ${p.name}`)),
          h('select', {
            class: 'inbox-pick', 'aria-label': 'Send to task', key: 'pick-' + item.id, value: '',
            onChange: (e, el) => {
              const v = el.value;
              el.value = '';
              if (v === 'new') {
                const projectId = newId();
                if (inboxAct('inboxToProject', { itemId: item.id, projectId }, item, `New task: ${item.text}`)) render();
              } else {
                const p = data.projects.find((x) => x.id === v);
                if (p) toStep(item, p);
              }
            },
          },
          h('option', { value: '' }, 'Send to task…'),
          projects.map((p) => h('option', { value: p.id }, p.name)),
          h('option', { value: 'new' }, '+ New task')),
          h('button', { class: 'icon', title: 'Delete', 'aria-label': 'Delete', onClick: () => inboxAct('removeInbox', { itemId: item.id }, item, 'Removed from Inbox') }, '🗑')));
    })) : h('p', { class: 'empty-list' }, 'Inbox is empty. Press Q anywhere (or 📥 at the top) to write something down fast.'));
}

/** Today: "📥 Inbox (3) — sort now" when something is waiting there. */
function inboxReminder() {
  const n = (store.view.data.inbox || []).length;
  if (!n) return null;
  return h('button', { class: 'inbox-reminder', key: 'inbox-rem', onClick: () => go('inbox') }, `📥 Inbox (${n}) — sort now →`);
}

/**
 * Right-click (or a long press on a phone): open the small menu at the pointer. `what` = { id } for a task or project
 * row (+ from: the 📂 project whose table it is in), { kind: 'step', id, stepId } or { kind: 'inbox', id }.
 * Inside a text box the browser's own menu (copy, paste) stays.
 */
function openRowMenu(what, e) {
  // (a tick box and a step's name, data-rowmenu, open this menu too)
  if (e.target && e.target.closest && e.target.closest('input:not([type="checkbox"]):not([data-rowmenu]), textarea, select, [contenteditable="true"]')) return;
  e.preventDefault();
  ui.rowMenu = { ...what, x: e.clientX, y: e.clientY };
  render();
}

/** One item of a right-click menu: closes the menu, then does its job. cls ' danger' = red. */
function menuItem(icon, label, fn, cls = '') {
  return h('button', {
    class: 'row-menu-item' + cls, role: 'menuitem',
    onClick: () => { ui.rowMenu = null; fn(); render(); },
  }, h('span', { class: 'rm-icon', 'aria-hidden': 'true' }, icon), label);
}

/** Keep a menu on the screen (style object: allowed by the page's safety rules); a tall one scrolls inside. */
function placeMenu(el, m) {
  el.style.left = Math.max(8, Math.min(m.x, window.innerWidth - 290)) + 'px';
  el.style.top = Math.max(8, Math.min(m.y, window.innerHeight - 480)) + 'px';
  return el;
}

/** After drawing: a menu near the bottom moves up so all of it shows (it scrolls inside only when taller than the screen). */
function fitMenu() {
  const el = document.querySelector('.row-menu');
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 8) el.style.top = Math.max(8, window.innerHeight - 8 - r.height) + 'px';
}

/** The menu's 4 stage buttons on one line (⚪ 🔵 🟠 ✅); the one it is at now is marked. */
function stageButtons(p) {
  const info = stageOf(p, p.team ? ctx.teamProgress(p.id) : null);
  return h('div', { class: 'row-menu-stages', role: 'group', 'aria-label': 'Stage' }, STAGES.map((s) => h('button', {
    class: 'stage-chip stage-' + s + ' tap' + (info.stage === s ? ' on' : ''), type: 'button', role: 'menuitemradio', 'aria-checked': String(info.stage === s),
    title: STAGE_LABELS[s].replace(/^\S+ /, ''),
    onClick: () => { ui.rowMenu = null; act('setStage', { projectId: p.id, stage: s }, `${p.name}: ${STAGE_LABELS[s]}`); render(); },
  }, STAGE_LABELS[s])));
}

/** The menu's "🔁 Move every" line: 1 2 3 5 7 14 30 days (the one now is marked). */
function everyButtons(p) {
  const now = moveEveryOf(p);
  const main = isMainProject(store.view.data, p);
  return h('div', { class: 'row-menu-stages row-menu-every', role: 'group', 'aria-label': 'Should move every' },
    h('span', { class: 'muted small' }, '🔁 Move every'),
    MOVE_EVERY_PICKS.map((n) => h('button', {
      class: 'chip' + (n === now ? ' on' : ''), type: 'button', role: 'menuitemradio', 'aria-checked': String(n === now), title: n === 1 ? 'Every day' : `Every ${n} days`,
      onClick: () => { ui.rowMenu = null; if (store.dispatch('setMoveEvery', { projectId: p.id, days: n })) toast(`${p.name}: should move ${everyText(n)}${main ? ' (and everything inside it)' : ''}`); render(); },
    }, n === 1 ? '1d' : `${n}d`)));
}

/** The small menu that opens when you right-click a task or project (a list, a project's task table), a step or an Inbox item. */
function rowMenu() {
  const m = ui.rowMenu;
  if (m && m.kind === 'person') return personMenu(m);
  if (m && m.kind === 'step') return stepMenu(m);
  if (m && m.kind === 'inbox') return inboxMenu(m);
  const p = m && store.view.data.projects.find((x) => x.id === m.id);
  if (!p) return null;
  const today = todayIndia();
  const due = p.state === 'active' && nextStep(p, today, { dueOnly: true });
  const timing = store.view.data.timer && store.view.data.timer.projectId === p.id;
  const task = !isMainProject(store.view.data, p) && !p.misc;
  const movable = !p.misc; // a task, or a 📂 project (projects inside projects); never 📂 Misc
  const from = m.from ? store.view.data.projects.find((x) => x.id === m.from) : null; // right-clicked in this project's table
  const item = menuItem;
  const el = h('div', { class: 'row-menu', role: 'menu', key: 'row-menu', 'aria-label': `Actions for ${p.name}` },
    h('div', { class: 'row-menu-title' }, p.name),
    task && p.state !== 'finished' ? stageButtons(p) : null,
    !p.misc && p.state !== 'finished' ? everyButtons(p) : null,
    due ? item('✓', `Tick: ${due.text}`, () => quickTick(p, due)) : null,
    p.state === 'active' ? item('+', 'Add a step', () => { select(p.id); focusKey('add-step-' + p.id); }) : null,
    p.state === 'active' ? item('📝', 'Write an update', () => { select(p.id); focusKey('wn-' + p.id); }) : null,
    due && due.waiting ? item('📞', `Chased${due.waitingOn ? ' ' + due.waitingOn : ''}`, () => chase(p, due)) : null,
    p.state === 'active' ? (p.snoozedUntil && p.snoozedUntil > today
      ? item('⏰', 'Wake up now', () => act('wake', { projectId: p.id }, `Back on Today: ${p.name}`))
      : item('💤', 'Snooze…', () => { select(p.id); ui.snoozeOpen = p.id; focusKey('snooze-' + p.id); })) : null,
    p.state === 'active' && timerOn(store.view.data) ? item(timing ? '⏹' : '▶', timing ? 'Stop timer' : 'Start timer', () => (timing ? stopTimer() : startTimer(p))) : null,
    p.state === 'active' ? item('⏸', `Pause ${kindWord(p)}`, () => act('pause', { projectId: p.id }, `Paused: ${p.name}`))
      : p.state === 'paused' ? item('▶', `Unpause ${kindWord(p)}`, () => act('unpause', { projectId: p.id }, `Back on Today: ${p.name}`)) : null,
    onServer && p.state === 'active' ? (p.team
      ? item('👥', `Take back from ${p.team.name}`, () => { if (confirm(takeBackQuestion(store.view.data, p))) giveProject(p, null); })
      : item('👥', `Give ${kindWord(p)} to…`, () => { select(p.id); ui.giveOpen = p.id; ui.givePhoto = false; ui.giveRecord = false; })) : null,
    item('↗', 'Open', () => select(p.id)),
    movable ? item('🔀', task ? 'Move to another project…' : 'Move inside another project…', () => openMoveBox(ctx, p, from ? from.id : null)) : null,
    movable ? item('📂', task ? 'Add to a project…' : 'Put inside a project…', () => { select(p.id); openMainBox(ctx, p, 'parent'); }) : null,
    !task && !p.misc && p.state !== 'finished' ? item('＋', 'New project inside…', () => newInnerProject(ctx, p)) : null,
    from && !from.misc ? item('✕', `Take out of 📂 ${from.name}`, () => act('removeFromProject', { projectId: p.id, parentId: from.id }, `${p.name} taken out of 📂 ${from.name} (the task is kept)`)) : null,
    item('✎', 'Rename…', () => {
      const n = prompt('New name:', p.name);
      if (n && n.trim() && n.trim() !== p.name) act('setProjectField', { projectId: p.id, field: 'name', value: n.trim() }, `Renamed: ${n.trim()}`);
    }),
    p.state === 'finished' ? item('↺', `Reopen ${kindWord(p)}`, () => act('reopen', { projectId: p.id }, `Reopened: ${p.name}`))
      : !p.misc ? item('🏁', `Finish ${kindWord(p)}`, () => act('finish', { projectId: p.id }, `Finished: ${p.name} (moved to Finished)`)) : null,
    p.misc ? null : item('🗑', `Delete ${kindWord(p)}…`, () => {
      if (!confirm(deleteQuestion(store.view.data, p))) return;
      act('deleteProject', { projectId: p.id }, `Deleted: ${p.name}`, 10000);
      if (ui.selected === p.id) { ui.selected = null; ui.mobile = 'list'; }
    }, ' danger'));
  return placeMenu(el, m);
}

/** Right-click on a step (a task's page): tick, write an update, waiting, give to the team, make it a task, delete. */
function stepMenu(m) {
  const p = store.view.data.projects.find((x) => x.id === m.id);
  const s = p && p.steps.find((x) => x.id === m.stepId);
  if (!s) return null;
  const item = menuItem;
  const tt = ctx.teamTask(s.id);
  const live = !!tt && tt.status === 'open';
  const open = p.state === 'active';
  const el = h('div', { class: 'row-menu', role: 'menu', key: 'step-menu', 'aria-label': `Actions for ${s.text}` },
    h('div', { class: 'row-menu-title' }, s.text),
    s.done ? item('↺', 'Un-tick', () => act('untickStep', { projectId: p.id, stepId: s.id }))
      : item('✓', 'Tick (done)', () => { const done = act('tickStep', { projectId: p.id, stepId: s.id }, `✓ ${s.text}`); if (done) ctx.afterTick(p.id, 'detail', done.undo); }),
    s.done ? null : item('📝', 'Write what happened', () => { updateState(ui, p).about = s.id; focusKey('wn-' + p.id); }),
    s.done ? null : item('⏳', s.waiting ? 'Not waiting any more' : 'Waiting on someone', () => {
      const waiting = !s.waiting; // (read first: the change updates s)
      store.dispatch('setStepField', { projectId: p.id, stepId: s.id, field: 'waiting', value: waiting });
      if (waiting) ui.openStep = s.id; // then: on whom
    }),
    s.done ? null : item('⏰', 'Remind me later / due date…', () => { ui.openStep = s.id; }),
    onServer && open && !s.done ? (live ? item('👥', `Team task: ${tt.assignee.name}`, () => { location.hash = `#team-task=${tt.id}`; })
      : item('👥', 'Give to team…', () => { location.hash = '#team-new=' + encodeURIComponent(JSON.stringify({ title: s.text, project: p.name, projectRef: p.id, stepRef: s.id })); })) : null,
    s.done ? null : item('↗', 'Make it a task', () => makeItAProject(ctx, p, s, live ? tt : null)),
    item('🗑', 'Delete step', () => act('deleteStep', { projectId: p.id, stepId: s.id }, `Step deleted: ${s.text}`), ' danger'));
  return placeMenu(el, m);
}

/** Right-click on an Inbox item: make it a task (or a task in a project), open its email, delete. */
function inboxMenu(m) {
  const item0 = (store.view.data.inbox || []).find((x) => x.id === m.id);
  if (!item0) return null;
  const item = menuItem;
  const newTask = () => { const projectId = newId(); return inboxAct('inboxToProject', { itemId: item0.id, projectId }, item0, `New task: ${item0.text}`) ? projectId : null; };
  const el = h('div', { class: 'row-menu', role: 'menu', key: 'inbox-menu', 'aria-label': `Actions for ${item0.text}` },
    h('div', { class: 'row-menu-title' }, item0.text),
    item('+', 'Make it a new task', () => newTask()),
    item('📂', 'Make it a task in a project…', () => {
      const id = newTask();
      const p = id && store.view.data.projects.find((x) => x.id === id);
      if (p) openMoveBox(ctx, p, null);
    }),
    item('→', 'Add as a step to a task…', () => focusKey('pick-' + item0.id)),
    item0.link ? item('✉', item0.mail ? 'Open in Outlook' : 'Open link', () => window.open(item0.link, '_blank', 'noopener')) : null,
    item('🗑', 'Delete', () => inboxAct('removeInbox', { itemId: item0.id }, item0, 'Removed from Inbox'), ' danger'));
  return placeMenu(el, m);
}

/** Lists where a 📂 project shows (and sorts by) the worst of it and its tasks. Today and search: its own dot. */
function rollsUpHere() {
  return !ui.search && (ui.view === 'paused' || ui.view === 'finished' || ui.view === 'mains');
}

function rowColour(p, today) {
  return rollsUpHere() ? listColour(store.view.data, p, today) : dotColour(p, today);
}

/** The rows in the order they are on screen. */
function shownOrder(list) {
  return list;
}

function canDrag() {
  return !ui.search && ui.sort === 'mine' && !taskListView();
}

/** ✅ Tasks: the 'All tasks | No project' switch, always red first. */
function taskListView() {
  return ui.view === 'all';
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
    text: `Task List (daily updates)\nLink: ${link}\nUsername: ${username}\nPassword: ${password}\nAfter signing in, choose your own password.`,
    subject: 'Your Task List sign-in', to: person,
  });
}

/** Give a person a Work Task sign-in (username from their first name; a number is added if it is taken). */
async function giveSignIn(person, email = '') {
  const base = (person.name.trim().split(/\s+/)[0] || 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'user';
  const password = firstPassword();
  let checked = false;
  for (const extra of ['', '1', '2', '3', String(Date.now() % 1000)]) {
    let name = (base + extra).slice(0, 40);
    if (name.length < 3) name = (name + 'user').slice(0, 40);
    try {
      const out = await teamApi('user.save', { name: person.name, username: name, password, role: 'staff', ...(email ? { email: String(email).trim() } : {}) });
      refreshTeamPeople();
      sendSignIn(person, out.user.username, password, true);
      return;
    } catch (e) {
      if (!/taken/i.test(e.message)) { toast(e.message, 6000); refreshTeamPeople(); return; } // it may be made with the reply lost: reload the sign-ins
      if (checked) continue;
      checked = true; // taken: by this person (an earlier try whose reply was lost)? Then a new password, not a second account
      let mine = null;
      try { const users = (await teamApi('users.list')).users || []; team.accounts = users; mine = teamMemberFor(person, users.filter((u) => !u.owner)); } catch (e2) { toast(e2.message, 6000); return; } // cannot tell: never make a second one blind
      if (mine) { render(); toast(`${person.name} already has a Task List sign-in: @${mine.username}`, 6000); newPasswordFor(person, mine); return; }
    }
  }
  toast('Could not find a free username. Add them in Team → People.', 6000);
}

async function newPasswordFor(person, account) {
  if (!confirm(`Give ${person.name} a new first password?\nThey are signed out and choose their own again.`)) return;
  const password = firstPassword();
  try { await teamApi('user.reset', { id: account.id, password }); sendSignIn(person, account.username, password, false); } // shown once, in the sheet
  catch (e) { toast(e.message, 6000); }
}

function personMenu(m) {
  const person = (store.view.data.people || []).find((x) => x.id === m.id);
  if (!person) return null;
  const item = menuItem;
  const open = () => { ui.view = 'people'; ui.search = ''; rememberUi(); ctx.selectPerson(person.id); };
  const accounts = onServer ? teamAccounts() : null;
  const account = accounts && teamMemberFor(person, accounts.filter((u) => !u.owner));
  const el = h('div', { class: 'row-menu', role: 'menu', key: 'person-menu', 'aria-label': `Actions for ${person.name}` },
    h('div', { class: 'row-menu-title' }, person.name),
    item('↗', 'Open', open),
    item('+', `Add a task with ${person.name}`, () => { open(); focusKey('person-task-input'); }),
    item('📋', 'Send pending list…', () => ctx.openPersonMessage(person)),
    person.phone ? item('💬', `WhatsApp ${person.name}`, () => window.open(`https://wa.me/${person.phone}`, '_blank', 'noopener')) : null,
    item('📞', person.phone || person.email ? 'Change number / email' : 'Add WhatsApp number / email', open),
    onServer ? (accounts === null ? h('div', { class: 'row-menu-note muted small' }, 'Checking Task List sign-in…')
      : account ? [
        h('div', { class: 'row-menu-note muted small' }, `Task List: @${account.username}${account.active ? '' : ' (switched off)'}`),
        item('🔑', 'New password…', () => newPasswordFor(person, account)),
        item('👥', 'Their tasks (Team)', () => openTeam()),
      ] : item('🔑', 'Give a Task List sign-in', () => giveSignIn(person))) : null,
    item('✎', 'Rename…', () => {
      const n = prompt('Name:', person.name);
      if (n && n.trim() && n.trim() !== person.name) store.dispatch('renamePerson', { personId: person.id, name: n.trim() });
    }),
    item('🗑', 'Remove from People…', () => {
      if (confirm(`Remove ${person.name} from People?\n\nTheir name stays in your steps and notes; it is just no longer linked.${account ? '\nTheir Task List sign-in is not changed.' : ''}`)) { if (store.dispatch('deletePerson', { personId: person.id })) toast(`Removed: ${person.name}`); }
    }, ' danger'));
  return placeMenu(el, m);
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
  if ((ui.sort !== 'red' && !taskListView()) || ui.search) return list; // (✅ Tasks is always red first)
  const ids = list.map((p) => p.id);
  if (redOrder && redOrder.view === ui.view && ids.length === redOrder.ids.length && ids.every((id) => redOrder.pos.has(id))) {
    return [...list].sort((a, b) => redOrder.pos.get(a.id) - redOrder.pos.get(b.id));
  }
  const sorted = computeRedFirst(list, today);
  redOrder = { view: ui.view, ids: sorted.map((p) => p.id), pos: new Map(sorted.map((p, i) => [p.id, i])) };
  return sorted;
}

function computeRedFirst(list, today) {
  return list // a 📂 project sorts by its worst task (mainColour) where the list rolls up
    .map((p, i) => ({ p, i, c: COLOUR_ORDER[rowColour(p, today)], r: PRIORITY_ORDER[p.priority] ?? 1 }))
    .sort((a, b) => a.c - b.c || a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}

/** ✅ Tasks: "All tasks 19" | "No project 7" (both red first). */
function taskFilterSwitch() {
  const all = activeTasks(store.view.data);
  const loose = all.filter((p) => !parentIdsOf(p).length).length;
  const opt = (value, label) => h('button', {
    class: 'seg' + (ui.taskFilter === value ? ' on' : ''), 'aria-pressed': String(ui.taskFilter === value),
    onClick: () => { ui.taskFilter = value; resetRedOrder(); rememberUi(); render(); },
  }, label);
  return h('div', { class: 'segmented', role: 'group', 'aria-label': 'Which tasks' }, opt('all', `All tasks ${all.length}`), opt('loose', `No project ${loose}`));
}

/** ✅ Tasks: All N | Not started N | In progress N | Waiting N | Done N — counts within the list shown (All tasks or No project). */
function stageFilterChips() {
  return stageFilterBar(stageCounts(visibleProjects({ stage: false }), (p) => taskStage(p).stage), ui.stageFilter,
    (k) => { ui.stageFilter = k === 'all' ? '' : k; resetRedOrder(); rememberUi(); render(); });
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
    h('div', { class: 'celebrate-big' }, `🎉 All ${sc.total} tasks on track!`),
    h('div', null, n > 1 ? `${n} days in a row. Keep it going!` : 'Every task is moving as often as you set.'),
    h('button', { class: 'link small', onClick: () => go('dashboard') }, 'See your dashboard →'));
}

function streakBadge() {
  const n = greenStreak(store.view.data.dayScores || {}, todayScore());
  return n >= 1 ? h('span', { class: 'streak', title: 'Days in a row with every task on track' }, ` · 🔥 ${n} day${n > 1 ? 's' : ''} all on track`) : null;
}

/** Last 7 days: how many projects were green each day (today is live). */
function weekBars() {
  const today = todayIndia();
  const saved = store.view.data.dayScores || {};
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(today, -i));
  const wd = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' });
  return h('div', { class: 'week', key: 'week' },
    h('div', { class: 'week-title' }, 'Last 7 days — tasks on track each day'),
    h('div', { class: 'week-bars' }, days.map((d) => {
      const sc = d === today ? todayScore() : saved[d];
      const pct = sc && sc.total ? Math.round((sc.green / sc.total) * 100) : 0;
      const fill = h('div', { class: 'week-fill' + (pct === 100 ? ' full' : '') });
      fill.style.height = `${Math.max(pct, sc && sc.total ? 4 : 0)}%`; // style object (allowed by the page's safety rules)
      return h('div', { class: 'week-day', key: 'wk-' + d, title: sc ? `${sc.green} of ${sc.total} on track` : 'No data' },
        h('div', { class: 'week-bar' }, fill),
        h('div', { class: 'week-num' }, sc && sc.total ? `${sc.green}/${sc.total}` : '–'),
        h('div', { class: 'week-label' + (d === today ? ' today' : '') }, d === today ? 'Today' : wd.format(new Date(d + 'T00:00:00Z'))));
    })));
}

/** "3 of 7 on track (green)" with a thin bar. */
function progressLine(today) {
  const active = todayList(store.view.data, todayIndia()); // as Today: an empty 📂 project is left out
  if (!active.length) return null;
  const done = active.filter((p) => dotColour(p, today) === 'green').length;
  const pct = Math.round((done / active.length) * 100);
  const bar = h('div', { class: 'progress-bar' }, h('div', { class: 'progress-fill', key: 'pf' }));
  bar.firstChild.style.width = `${pct}%`; // set through the style object (allowed by the page's safety rules)
  return h('div', { class: 'progress', key: 'progress' },
    h('div', { class: 'progress-row' },
      h('div', { class: 'progress-text' },
        h('strong', null, `${done} of ${active.length}`), done === active.length ? ' on track — all of them! 🎉' : ' on track',
        streakBadge()),
      h('div', { class: 'progress-btns' },
        h('button', { class: 'btn small', title: "Everything you did today, ready to send", onClick: openSummary }, '📋 Summary'),
        done < active.length && !ui.round
          ? h('button', { class: 'btn primary small round-start', title: 'One task at a time (key: g)', onClick: startRound }, '▶ Daily round', keyHint('G'))
          : null)),
    bar);
}

/** After the updates are due (18:00 by default): which projects still have nothing today. Tap a name to open it. */
function eveningCheck(today) {
  const nowHm = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  if (nowHm < (team.fillBy || '18:00')) return null;
  const left = todayList(store.view.data, today).filter((p) => dotColour(p, today) !== 'green');
  if (!left.length) return null;
  return h('div', { class: 'evening-check', key: 'evening' },
    `🕕 Nothing today on ${left.length} task${left.length > 1 ? 's' : ''}: `,
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
    h('a', { class: 'team-line' + (bad ? ' late' : s.due && s.sent === s.due ? ' ok' : ''), href: '#team', key: 'team-line', title: 'Open Team today' },
      `👥 Team: ${bits.join(' · ')}${missing}`),
    // the newest message from the team, right here: tap = open the project (or the task in the team app) to read and answer
    m ? h('a', {
      class: 'team-line msg', key: 'team-msg', href: ofProject ? '#' : `#team-task=${m.taskId}`, title: 'Read and answer',
      onClick: (e) => { if (!ofProject) return; e.preventDefault(); select(m.projectRef); },
    }, `💬 ${m.by}: “${m.text.length > 70 ? m.text.slice(0, 68) + '…' : m.text}”${team.messages.length > 1 ? ` (+${team.messages.length - 1} more)` : ''} — answer →`) : null,
  ];
}

function newProjectForm() {
  if (!ui.adding) {
    return h('button', { class: 'btn primary new-project', onClick: () => { ui.adding = true; render(); focusKey('new-name'); } }, '+ New task', keyHint('N'));
  }
  const d = ((ui.newTaskDraft ||= {}).list ||= {});
  const close = () => { ui.adding = false; render(); };
  // a name, then notes you can paste a screenshot, a table or words into (they become the task's first update)
  return newTaskBox(ctx, d, {
    key: 'new',
    onCancel: close,
    onCreate: (name, editor) => {
      const projectId = createTaskWithNote(ctx, { name, d, editor });
      if (!projectId) return;
      ui.adding = false;
      if (ui.view !== 'today' && ui.view !== 'all') ui.view = 'today';
      select(projectId);
      focusKey('add-step-' + projectId);
    },
  });
}

/** The small word under a top icon (shown on a computer only; the icons alone were not clear). */
const iconCap = (word) => h('span', { class: 'icon-cap', 'aria-hidden': 'true' }, word);

function statusText() {
  const s = store ? store.status : 'loading';
  // A steady cloud sign: ✓ when everything is saved. "Saving" only shows if it takes more than a second.
  if (s === 'saved') return h('span', { class: 'status sync ok head-icon', title: 'All your changes are saved', 'aria-label': 'Saved' }, '☁︎✓', iconCap('Saved'));
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
  const head = h('div', { class: 'list-head owner-head' }, // (five icons: on a computer the page name has its own line)
    h('button', { class: 'icon menu-btn', 'aria-label': 'Menu', onClick: () => { ui.menuOpen = true; render(); } }, '☰'),
    h('h2', null, viewTitle()),
    statusText(),
    // each icon has a small word under it on a computer (owner, 24 Oct); on a phone 📥 is in the bottom bar (Inbox)
    h('button', { class: 'icon head-icon capture-btn', title: 'Quick capture: write down an idea or task (key: q)', 'aria-label': 'Quick capture', onClick: openCapture }, '📥', iconCap('Capture')),
    h('button', { class: 'icon head-icon', title: 'Jump to a task, project, person or page (Ctrl+K)', 'aria-label': 'Jump', onClick: openJump }, '🔍', iconCap('Find')),
    onServer ? teamButton() : null,
    h('button', { class: 'icon head-icon', title: 'Get latest', 'aria-label': 'Refresh', onClick: () => doRefresh(true) }, '↻', iconCap('Refresh')));
  const mobileSearch = h('input', {
    class: 'search mobile-only', type: 'search', placeholder: withKey('Search…', '/'), value: ui.search, key: 'search-mobile', 'aria-label': 'Search',
    onInput: (e, el) => { ui.search = el.value; clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); },
    onKeydown: searchEnter,
  });

  if (ui.view === 'diary' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderDiary());
  if (ui.view === 'inbox' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderInbox());
  if (ui.view === 'replies' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), ui.replyRound ? renderReplyRound(ctx) : renderReplies(ctx));
  if (ui.view === 'apps' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), onServer ? renderFromApps(appsCtx) : h('p', { class: 'muted' }, 'Connections work on worktask.in.'));
  if (ui.view === 'settings' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderSettings());
  if (ui.view === 'dashboard' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderDashboard(ctx));
  if (ui.view === 'time' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderTimeReport(ctx));
  if (ui.view === 'people' && !ui.search) return h('div', { class: 'col-inner' }, head, timerStrip(), renderPeopleList(ctx));

  const list = sortForView(visibleProjects(), today);
  const showSort = !ui.search && ui.view !== 'paused' && ui.view !== 'finished' && list.length > 1;
  const empty = !list.length ? h('p', { class: 'empty-list' },
    ui.search ? 'Nothing found.' : ui.view === 'paused' ? 'No paused tasks.' : ui.view === 'finished' ? 'No finished tasks yet.'
      : 'No tasks yet. Add your first one with "+ New task".') : null;
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
      ui.view === 'mains' && !ui.search ? renderProjectsHead(ctx) : ui.view === 'finished' || ui.view === 'paused' || ui.search ? null : newProjectForm(),
      taskListView() && !ui.search && !ui.adding ? taskFilterSwitch() : showSort && !ui.adding ? sortSwitch() : null,
      !ui.search && list.length && ui.view !== 'mains' ? h('button', { class: 'btn small copy-list', type: 'button', title: 'Copy these as a numbered list (for an AI chat or an email)', onClick: () => copyList(currentList(), { title: viewTitle() }) }, '📋 Copy list') : null),
    taskListView() && !ui.search && !ui.adding ? stageFilterChips() : null,
    pickBar(list),
    ...listParts(list, today),
    empty);
}

/** Today: the ones not green (slipping or stuck), then a folded "On track (n)" group. Other views: one list. */
function splitToday(list, today) {
  if (ui.view !== 'today' || ui.search) return { open: list, done: [] };
  return { open: list.filter((p) => dotColour(p, today) !== 'green'), done: list.filter((p) => dotColour(p, today) === 'green') };
}

function listParts(list, today) {
  const { open, done } = splitToday(list, today);
  const rows = open.map((p) => projectRow(p, today)); // flat: a task in two projects is listed once, with both chips
  const parts = [h('ul', { class: 'plist', key: 'plist-' + (ui.search ? 'search' : ui.view) }, rows)];
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
  if (!open.length) parts.push(h('p', { class: 'all-green', key: 'all-green' }, 'Everything is on track 🎉'));
  // nothing needs you: the On track list is open by itself, so Today is never an empty page (owner, 24 Oct)
  const showDone = ui.showDoneToday === undefined || ui.showDoneToday === null ? !open.length : !!ui.showDoneToday;
  parts.push(h('button', {
    class: 'done-toggle', key: 'done-toggle', 'aria-expanded': String(showDone),
    onClick: () => { ui.showDoneToday = !showDone; render(); },
  }, `${showDone ? '▾' : '▸'} On track (${done.length})`));
  if (showDone) parts.push(h('ul', { class: 'plist-done', key: 'plist-done' }, done.map((p) => projectRow(p, today))));
  return parts;
}

// ---------------------------------------------------------------- Diary

/** A rich update in the Diary: its table, list and photos (the words of everything else stay plain). */
function diaryRich(l) {
  const p = store.view.data.projects.find((x) => x.id === l.projectId);
  return h('span', { class: 'diary-rich' }, '📝 ', richView(l.html, (id) => photoThumb(ctx, p && (p.files || []).find((f) => f.id === id))),
    l.onStep ? h('span', { class: 'muted small' }, `(on: ${l.onStep})`) : null);
}

function renderDiary() {
  const { history } = store.view;
  const byDay = diaryEntries(store.view.data, history, [...team.byStep.values()]); // (your team's newest updates too)
  const days = [...byDay.keys()].sort().reverse();
  const shown = days.slice(0, Number(ui.diaryDays) || 14);
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
        ': ', l.html ? diaryRich(l) : l.text))))),
    days.length > shown.length
      ? h('button', { class: 'btn', onClick: () => { ui.diaryDays = (Number(ui.diaryDays) || 14) + 14; render(); } }, 'Show older days')
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
      h('p', null, isMock ? 'Test mode (no real GitHub).' : onServer ? 'Signed in to Task List ✓ Your projects are private to you.' : 'Connected to your private data ✓'),
      h('div', { class: 'row' },
        isMock || onServer ? null : h('button', { class: 'btn', onClick: () => showKeyScreen('Paste your new GitHub access key.') }, 'Change key'),
        onServer ? h('a', { class: 'btn', href: '#team' }, '👥 Team') : null,
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
    // 🔁 how often a task should move when it has no choice of its own (was always 3, owner 24 Oct)
    h('section', { class: 'block', key: 'every-default' }, h('h3', null, '🔁 How often a task should move'),
      h('p', { class: 'muted small' }, 'A task with no real update for this many days turns yellow (twice as long: red). Each task or 📂 project can still have its own.'),
      h('div', { class: 'row every-picks' }, MOVE_EVERY_PICKS.map((n) => h('button', {
        class: 'chip' + (everyDefaultOf(data) === n ? ' on' : ''), type: 'button', key: 'ed-' + n, 'aria-pressed': String(everyDefaultOf(data) === n),
        onClick: () => { if (store.dispatch('setEveryDefault', { days: n === MOVE_EVERY_DEFAULT ? null : n })) toast(`Tasks with no choice of their own: should move ${everyText(n)}`); },
      }, everyText(n))))),
    h('section', { class: 'block' }, h('h3', null, 'Tags and timer'),
      h('p', { class: 'muted small' }, 'Each task can pick one tag. The Time report shows your time by tag.'),
      h('div', { class: 'group-set' },
        h('div', { class: 'row' },
          h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: timerOn(data), onChange: (e, el) => store.dispatch('setTimer', { on: el.checked }) }),
            ' Timer')),
        h('div', { class: 'tag-list' },
          (data.tags || []).map((t) => h('span', { class: 'tag tag-chip', key: 'tg-' + t.id }, `🏷 ${t.name}`,
            h('button', {
              class: 'icon tiny-x', title: 'Rename tag',
              onClick: () => { const n = prompt('Rename tag:', t.name); if (n && n.trim()) store.dispatch('renameTag', { tagId: t.id, name: n.trim() }); },
            }, '✎'),
            h('button', {
              class: 'icon tiny-x', title: 'Delete tag',
              onClick: () => {
                const used = data.projects.filter((p) => p.tagId === t.id).length;
                if (confirm(`Delete the tag "${t.name}"?${used ? `\n\n${used} project(s) use it; they will have no tag (their time is kept).` : ''}`)) store.dispatch('deleteTag', { tagId: t.id });
              },
            }, '✕'))),
          h('button', {
            class: 'btn small',
            onClick: () => {
              const n = prompt('New tag:');
              if (n && n.trim() && !store.dispatch('addTag', { tagId: newId(), name: n.trim() })) toast(`"${n.trim()}" already exists`);
            },
          }, '+ Tag')))),
    onServer ? renderConnectionsSettings(appsCtx) : null, // 🔌 other apps send tasks and approvals (worktask.in only)
    h('section', { class: 'block' }, h('h3', null, 'Backup'),
      h('p', { class: 'muted' }, 'Every save is kept as a version, so nothing is lost. You can also download a copy.'),
      h('button', { class: 'btn', onClick: downloadBackup }, 'Download backup')),
    // Outlook, the morning email and the team's times are on the team's Settings page: one tap there (owner, 24 Oct)
    onServer ? h('section', { class: 'block', key: 'team-settings' }, h('h3', null, '📧 Outlook and the team'),
      h('p', { class: 'muted small' }, 'Connect Outlook, the morning email and the time updates are due are in the team\'s Settings.'),
      h('a', { class: 'btn', href: '#team-settings' }, 'Open the team\'s Settings ›')) : null,
    h('section', { class: 'block' }, h('h3', null, 'Phone'),
      h('p', null, h('strong', null, 'iPhone: '), onServer ? 'Open worktask.in in Safari and sign in. Share → "Add to Home Screen" puts it on your phone like an app.'
        : 'Always open Task List from its home-screen icon. In Safari: Share → "Add to Home Screen". Then paste your keys inside the icon app.'),
      h('p', null, h('strong', null, 'Android: '), onServer ? 'Open worktask.in in Chrome and sign in. Tap ⋮ → "Add to Home screen" (or "Install app").'
        : 'Open Task List in Chrome. Tap ⋮ → "Add to Home screen" (or "Install app"), then paste your keys inside the icon app.')));
}

async function signOutServer() {
  const waiting = store.pending.length;
  if (waiting && !confirm(`${waiting} change(s) are not saved yet and will be lost. Sign out anyway?`)) return;
  clearTimeout(store.saveTimer);
  store.forgetPending(); // before clearing storage below; also stops the leave-page check from sending them
  // this phone's notifications stop too (the next person on it must not get the owner's messages)
  let endpoint = '';
  try {
    const r = navigator.serviceWorker && await navigator.serviceWorker.getRegistration('../');
    const sub = r && await r.pushManager.getSubscription();
    if (sub) { endpoint = sub.endpoint; await sub.unsubscribe().catch(() => {}); }
  } catch { /* no notifications here */ }
  try { await fetch('../api/?a=logout', { method: 'POST', headers: { Authorization: 'Bearer ' + serverToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) }); } catch { /* signed out anyway */ }
  try { localStorage.removeItem(SERVER_TOKEN_KEY); localStorage.removeItem(WHO_KEY); localStorage.removeItem('dp.pending'); localStorage.removeItem('dp.snapshot'); } catch { /* blocked */ }
  location.replace(location.pathname); // this app's sign-in
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
  h('h1', null, 'Task List'),
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
      h('h1', null, 'Task List has moved'),
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
    h('h1', null, 'Task List has moved'),
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
    + (dropped ? ` ${dropped} change(s) (deletes, removals, edits, team changes) could not come along: please do them again.` : '');
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
  if (space === 'team') return; // the team pages draw themselves (ui/team.js)
  if (!store || !store.view) {
    root.replaceChildren(h('div', { class: 'loading' }, store && store.status === 'offline' ? 'No connection. Retrying…' : 'Loading…'));
    return;
  }
  useEveryDefault(store.view.data); // 🔁 Settings: the owner's own "should move every N days" for tasks with no choice of their own
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
  rowMenu(), // right-click menu: over the list or the task's page
  moveBox(ctx),
  offlineBar(),
  unsentBar(),
  tabBar());
  const moves = takePositions();
  if (root.firstChild && root.firstChild.classList && root.firstChild.classList.contains('layout')) morph(root.firstChild, next);
  else root.replaceChildren(next);
  playMoves(moves);
  if (ui.rowMenu) fitMenu();
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
    // the pages used most (owner, 24 Oct): People is in More (☰)
    tab('today', '☀︎', 'Today'),
    tab('all', '✅', 'Tasks'),
    tab('mains', '📂', 'Projects'),
    tab('inbox', '📥', 'Inbox', n ? h('span', { class: 'tab-count' }, String(n)) : null),
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
  const active = todayList(store.view.data, todayIndia());
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
  ui.selected = null; // (the right side does not keep the task from before the round, owner 24 Oct)
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
  const active = todayList(store.view.data, todayIndia());
  const greenCount = active.filter((p) => dotColour(p, today) === 'green').length;
  const left = active.length - greenCount;
  const top = h('div', { class: 'round-top' },
    h('button', { class: 'icon back', 'aria-label': 'End round', onClick: endRound }, '←'),
    h('strong', null, 'Daily round'),
    h('span', { class: 'muted small' }, `${greenCount} of ${active.length} on track · ${left} left`),
    h('button', { class: 'btn small', onClick: endRound, title: 'End the round (Esc)' }, 'End'));
  // The current project was deleted / paused on another device: quietly move on.
  if (!r.done && !roundProject()) {
    if (advanceRound()) setTimeout(() => { if (ui.round) markOpened(ui.round.ids[ui.round.i]); }, 0);
  }
  if (r.done || !roundProject()) {
    return h('div', { class: 'detail-inner round', key: 'round-done' }, top,
      h('div', { class: 'round-card round-finish', key: 'round-card', tabindex: '-1' },
        h('div', { class: 'round-big' }, left ? 'Round finished' : 'All green for today 🎉'),
        h('p', { class: 'muted' }, left ? `${left} task${left > 1 ? 's' : ''} still not on track (you skipped them).` : 'Every task is on track.'),
        h('div', { class: 'row' },
          left ? h('button', { class: 'btn', onClick: () => { ui.round = null; startRound(); } }, 'Go through skipped ones') : null,
          h('button', { class: 'btn primary', onClick: endRound }, 'Done'))));
  }
  const p = roundProject();
  const ns = nextStep(p, today);
  const due = nextStep(p, today, { dueOnly: true });
  const colour = dotColour(p, today);
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
        h('button', { class: 'link round-title', title: 'Open the full task', onClick: () => { const id = p.id; ui.round = null; select(id); } }, p.name)),
      h('p', { class: 'muted small round-meta' }, [p.priority === 'high' ? 'High' : '', p.deadline ? `${isOverdue(p, today) ? 'Overdue' : 'Target'} ${fmtDay(p.deadline)}` : '']
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
  if (store.dispatch('startTimer', { projectId: p.id, running: running ? running.id : null })) toast(other ? `⏱ Started ${p.name} (stopped ${other.name})` : `⏱ Started: ${p.name}`, 2500);
}

function stopTimer() {
  const t = store.view.data.timer;
  if (!t) return;
  const p = store.view.data.projects.find((x) => x.id === t.projectId);
  const mins = Math.round((Date.now() - Date.parse(t.start)) / 60000);
  if (store.dispatch('stopTimer', { timerId: t.id })) toast(mins >= 1 ? `⏸ ${p ? p.name : 'Timer'}: ${fmtMinutes(Math.min(mins, 600))} logged` : 'Timer stopped (under a minute, not logged)', 3000);
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

/** Next / previous project in the tab you are in (Today, All, Paused…). */
function neighbourProject(step) {
  const list = currentList();
  if (!list.length || !ui.selected) return null;
  const i = list.findIndex((p) => p.id === ui.selected);
  if (i < 0) return null;
  return list[i + step] || null;
}

function goProject(step) {
  const p = neighbourProject(step);
  if (!p) { toast(step > 0 ? 'This is the last task in this list' : 'This is the first task in this list', 1500); return; }
  select(p.id);
  const row = root.querySelector(`.prow[data-id="${CSS.escape(p.id)}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
  followFocus(row);
}

/** The next project after this one (in the tab you are in) that is not green yet — red first. */
function nextOpenProject(id) {
  const today = todayIndia();
  let list = ['diary', 'settings', 'dashboard', 'time', 'people', 'inbox', 'replies', 'apps'].includes(ui.view) || ui.search
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
    ['Today', () => go('today')], ['✅ Tasks', () => go('all')], ['Dashboard', () => go('dashboard')],
    ['People', () => go('people')], ['Diary', () => go('diary')], ['Paused', () => go('paused')],
    ['Finished', () => go('finished')], ['Settings', () => go('settings')], ['Time report', () => go('time')], ['✉ Replies', () => go('replies')], ['📂 Projects', () => go('mains')], ['Daily round', () => { go('today'); startRound(); }],
    ["Today's summary", () => openSummary()], ['New task', () => { go('today'); ui.adding = true; render(); focusKey('new-name'); }],
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
  const input = h('input', { class: 'jump-input', placeholder: 'Type a task, project, person or page…', autocomplete: 'off', 'aria-label': 'Jump to' });
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
  ['↓  ↑', 'Next / previous task'],
  ['←  →', 'Previous / next task (or person on People)'],
  ['⌫', 'Back to where you came from'],
  ['Ctrl K', 'Jump to any task, project, person or page'],
  ['x', 'Tick the next step of the open task'],
  ['g', 'Start the daily round (then x s w o c n)'],
  ['s', 'Type a new step'],
  ['w', 'Type in "What did you do today?"'],
  ['n', 'New task'],
  ['/', 'Search'],
  ['q', 'Quick capture: write an idea or task into the Inbox'],
  ['r', 'Switch "My order" / "Red first"'],
  ['t  b  d  p', 'Go to Today / Dashboard / Diary / People'],
  ['a  i', 'Go to ✅ Tasks / 📥 Inbox'],
  ['e', 'Go to ✉ Replies (emails waiting for your reply)'],
  ['m', 'Go to 📂 Projects'],
  ['@', 'In a step or note: pick a person'],
  ['Ctrl/⌘ Enter', 'In Today\'s update: save and tick the step'],
  ['Enter', 'In search: open the first task found'],
  ['Right-click', 'On a task in the list: quick menu'],
  ['Esc', 'Leave a box, or close what is open'],
  ['?', 'Show or hide this list'],
  ['👥 Team pages', 't a m f: Team today / Tasks / Projects / Follow-up · n: give a task · ↓ ↑ · / · Esc'],
];

function keysHelp() {
  return h('div', { class: 'keys-help', key: 'keys-help', role: 'dialog', 'aria-label': 'Keyboard shortcuts' },
    h('div', { class: 'keys-head' }, h('strong', null, 'Keyboard shortcuts'),
      h('button', { class: 'icon', 'aria-label': 'Close', onClick: () => { ui.showKeys = false; render(); } }, '✕')),
    h('p', { class: 'muted small' }, 'They work when you are not typing in a box. Press Esc to leave a box.'),
    h('table', null, KEYS.map(([k, what]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, what)))));
}


function currentList() {
  if (!store || !store.view || ['diary', 'settings', 'dashboard', 'time'].includes(ui.view)) return [];
  const today = todayIndia();
  const { open, done } = splitToday(sortForView(visibleProjects(), today), today);
  const showDone = ui.showDoneToday === undefined || ui.showDoneToday === null ? !open.length : !!ui.showDoneToday; // (as listParts: ↓ ↑ go through what is on screen)
  return showDone || ui.view !== 'today' ? shownOrder([...open, ...done]) : open;
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

/** The keys, once, for whoever signed in (owner, manager or staff: onKey sends each to its own pages). */
let keysOn = false;
function listenKeys() {
  if (keysOn) return;
  keysOn = true;
  document.addEventListener('keydown', onKey);
  // the team / staff pages' right-click menu: a click elsewhere or a scroll closes it (for every kind of sign-in)
  const closeTheirs = (e) => {
    for (const v of [teamView, staffView]) if (v && v.state.rowMenu && !(e && e.target && e.target.closest && e.target.closest('.row-menu'))) { v.state.rowMenu = null; v.render(); }
  };
  document.addEventListener('click', closeTheirs);
  window.addEventListener('scroll', () => closeTheirs(null), true);
}

/** A key after a click on the menu: the clicked item lets go of the focus, so no box stays around it (owner, 24 Oct). */
export function dropMenuFocus(doc) {
  const a = doc && doc.activeElement;
  if (a && a.nodeName !== 'INPUT' && a.closest && a.closest('#menu, .tabbar') && typeof a.blur === 'function') a.blur();
}

function onKey(e) {
  if (!['Enter', ' ', 'Tab'].includes(e.key)) dropMenuFocus(document);
  // the team pages and the staff app: their own keys (↓ ↑ j k next task, Esc, /, n, ?; ui/listkeys.js)
  if (space === 'team') { pageKey(e, document, teamView, { say: toast, owner: true }); return; }
  if (staffView && !store) { pageKey(e, document, staffView, { say: toast }); return; }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openJump(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
  if (e.key === 'Escape') {
    const viewer = document.getElementById('viewer');
    if (!viewer.hidden) { closeSheet(); return; }
    if (ui.showKeys) { ui.showKeys = false; render(); return; }
    if (ui.rowMenu) { ui.rowMenu = null; render(); return; }
    if (ui.moveBox) { ui.moveBox = null; render(); return; }
    if (ui.mainBox) { ui.mainBox = null; render(); return; }
    if (ui.projMenu || ui.giveOpen || ui.snoozeOpen) { ui.projMenu = null; ui.giveOpen = null; ui.snoozeOpen = null; render(); return; }
    if (ui.capture) { ui.capture = false; render(); return; }
    if (isTyping(document.activeElement)) { document.activeElement.blur(); return; }
    if (ui.round) { if (ui.round.mode) { ui.round.mode = null; render(); } else endRound(); return; }
    if (ui.replyRound) { ui.replyRound = null; render(); return; }
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
  if (isArrow && ['diary', 'settings', 'dashboard', 'time', 'inbox', 'replies', 'apps'].includes(ui.view) && !ui.search) return; // let the page scroll
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
    else if (ui.selected && !['diary', 'settings', 'dashboard', 'time', 'inbox', 'replies', 'apps'].includes(ui.view)) goProject(step);
    else handled = false;
  } else if (k === 'Backspace') {
    if (ui.navStack && ui.navStack.length) goBack(); else handled = false;
  } else if (k === 'ArrowDown' || k === 'j') moveSelection(1);
  else if (k === 'ArrowUp' || k === 'k') moveSelection(-1);
  else if (projectKeyIgnored(ui, k)) handled = false; // project keys do nothing on People, or where the project is not on screen
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
    } else toast(p ? 'No step to tick. Press "s" to add one.' : 'Pick a task first (↓ ↑).');
  } else if (k === 's') {
    if (!p) { toast('Pick a task first (↓ ↑).'); return; }
    ui.mobile = 'detail'; render(); focusKey('add-step-' + p.id);
  } else if (k === 'w') {
    if (!p) { toast('Pick a task first (↓ ↑).'); return; }
    ui.mobile = 'detail'; render(); focusKey('wn-' + p.id);
  } else if (k === 'n' && ui.view === 'people' && ui.person && !ui.search) {
    focusKey('person-task-input'); // on a person's page: the "Add a task with …" box
  } else if (k === 'n') {
    if (!(ui.view === 'today' || ui.view === 'all')) ui.view = 'today'; // the form is only on project lists
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
  else if (k === 'e') go('replies');
  else if (k === 'm') go('mains');
  else if (k === 'a') go('all');
  else if (k === 'i') go('inbox');
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
  return h('a', { class: 'icon team-btn head-icon', href: '#team', title: n ? `Team needs you: ${why}` : 'Team: tasks you gave and their daily updates', 'aria-label': n ? `Team, ${n} need you` : 'Team' },
    '👥', n ? h('span', { class: 'team-count' }, String(n)) : null, iconCap('Team'));
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
const teamPhotos = new Map(); // photo id -> object URL, 'loading', or { failedAt } (tried again after a minute, or on ↻)
function teamPhoto(id) {
  const v = teamPhotos.get(id);
  if (typeof v === 'string' && v !== 'loading') return v;
  if (photoNeedsFetch(v)) {
    teamPhotos.set(id, 'loading');
    fetch('../api/?a=photo&id=' + id, { headers: { Authorization: 'Bearer ' + serverToken() } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('photo'))))
      .then((b) => { teamPhotos.set(id, URL.createObjectURL(b)); render(); })
      .catch(() => teamPhotos.set(id, { failedAt: Date.now() }));
  }
  return null;
}

/** The team sent an update on a project today: it counts as work (green, shown with 👥). Once a day per project. */
/** A given project on the team: steps done / open, the step they are on, their last update. */
function teamProgress(projectId) {
  return teamProgressOf([...team.byStep.values()], projectId); // (rules.js: a project given as one task counts for stuck too)
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
function refreshDaily(projectId) { askDiaryAgain(daily.get(projectId)); render(); }

/** A photo in a team message (fetched with the sign-in, shown from memory). */
const msgPhotos = new Map(); // id -> object URL, null while loading, or { failedAt }
function teamMsgPhoto(id) {
  const v = msgPhotos.get(id);
  if (typeof v === 'string') return v;
  if (!photoNeedsFetch(v)) return null;
  msgPhotos.set(id, null);
  const failed = () => msgPhotos.set(id, { failedAt: Date.now() }); // tried again after a minute (or on ↻), not on every draw
  fetch('../api/?a=comment.photo&id=' + id, { headers: { Authorization: 'Bearer ' + serverToken() } })
    .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { msgPhotos.set(id, URL.createObjectURL(b)); render(); } else failed(); })
    .catch(failed);
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
      .then((out) => { e.data = out; e.loading = false; e.at = diaryLoadedAt(e); render(); }) // asked again meanwhile: fetched again at once
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
  // a step made into its own project ("Make it a project") whose team task is still open: kept, so the person's task stays
  const movedButGiven = (x) => keepMovedStep(x, team.byStep.get(x.id), !!team.listAt);
  // (moved: the server only keeps the task it already has for it, never makes a new one)
  const open = p.steps.filter((x) => (!x.done || movedButGiven(x)) && !(x.snoozedUntil && x.snoozedUntil > today)).map((x) => ({ stepRef: x.id, title: x.text, details: x.note || '', dueDate: x.dueDate || null, ...(x.done && x.movedTo ? { moved: true } : {}) }));
  if (open.length || p.steps.length) return open; // (steps all done or snoozed: nothing to do; the whole-project task is only for no steps at all)
  if (isMainProject(store.view.data, p)) return []; // a 📂 project: its tasks go to the person themselves (projectGiveChanges), never one task with its name
  // no steps at all: the person still gets the project, as one task with its name, until steps are added
  return [{ stepRef: wholeRef(p.id), title: p.name, details: p.status || '' }];
};
const wholeRef = (projectId) => projectId + ':whole';
let dataFreshAt = 0; // when the projects were last checked against the server (0 = not yet)
const SYNC_KEY = 'dp.teamSync'; // last steps sent per given project, so unchanged projects are not sent again
const SYNC_RETRY = 'retry'; // never matches: sent again next time, but a deleted project is still taken back

/**
 * Give the whole project to a person (or take it back with person = null). A 📂 project: its tasks go with it, except
 * those given to someone else on their own and those you keep (`keep`: the task ids you unticked in the give box).
 */
async function giveProject(p, person, needsPhoto = !!ui.givePhoto, keep = ui.giveKeepFor === p.id ? ui.giveKeep : null) {
  const record = !!ui.giveRecord; // 📒 the give box's "Record (entries)" (set from the project when the box opens)
  if (team.busy.has(p.id)) return; // a double tap must not send it twice
  team.busy.add(p.id);
  render();
  const main = isMainProject(store.view.data, p);
  try {
    await withSyncLock(async () => {
      const steps = person ? projectSteps(p) : [];
      // (the change of person is saved right after this: the server must not act on the older saved copy meanwhile)
      const out = await teamApi('project.sync', { projectRef: p.id, project: p.name, about: p.about || '', folder: folderOf(p), assigneeId: person ? person.id : 0, steps, needsPhoto, kind: record ? 'log' : '', reason: person ? '' : 'taken', baseCommit: store.base && store.base.commit, pending: true });
      team.gen++; // a list fetched before this change is old now: it must not move the project back
      store.dispatch('setProjectTeam', { projectId: p.id, userId: person ? person.id : null, name: person ? person.name : '', needsPhoto, record, ...(main && person ? { giveTasks: true } : {}), ...(!main && !person ? { keepOff: true } : {}) });
      const kids = new Set(main ? projectTasks(store.view.data, p.id).map((c) => c.id) : []); // (its projects' tasks too)
      if (main && person && keep) for (const id of keep) if (kids.has(id)) store.dispatch('setProjectTeam', { projectId: id, userId: null, keepOff: true }); // the ones you keep (of this project only)
      ui.giveOpen = null;
      ui.givePhoto = false; ui.giveRecord = false;
      ui.giveKeep = null; ui.giveKeepFor = null;
      const moved = main ? followProjects() : null;
      // taken back by you: the tasks that went with it leave the person's list now too (not only at the next sync)
      if (moved) {
        for (const id of moved.backIds) {
          const t = store.view.data.projects.find((x) => x.id === id);
          try { await teamApi('project.sync', { projectRef: id, project: t ? t.name : '', assigneeId: 0, steps: [], reason: 'taken', baseCommit: store.base && store.base.commit, pending: true }); rememberSync(id, null); } catch { /* the sync takes it back later */ }
        }
      }
      toast(!person ? `Taken back: ${p.name}${moved && moved.back ? ` (and ${moved.back} task${moved.back > 1 ? 's' : ''} that went with it)` : ''}`
        : main ? `👥 ${p.name} given to ${person.name} ✓ — ${giveSummary(p, person)}` : `👥 ${p.name} given to ${person.name} ✓`, main ? 8000 : 3000);
      // a step the server did not make yet (just finished): sent again later
      rememberSync(p.id, !person ? null : notSent(out, steps).length ? SYNC_RETRY : syncSig(person.id, p, steps, needsPhoto));
    });
    if (main) syncGivenProjects(); // its tasks reach the person's list now
    loadTeam(true);
  } catch (e) { toast(e.message, 5000); } finally { team.busy.delete(p.id); render(); }
}

/**
 * The tasks of given 📂 projects follow them (rules.js projectGiveChanges). Returns { given, back } counts.
 * onlyFresh (the background sync): only on data just checked with the server — an old copy on a phone must never
 * give (or take back) tasks the owner changed elsewhere since.
 */
function followProjects({ onlyFresh = false } = {}) {
  const out = { given: 0, back: 0, backIds: [] };
  if (!store || !store.view || !store.canEdit()) return out;
  if (onlyFresh && (store.status !== 'saved' || !dataFreshAt || Date.now() - dataFreshAt > 2 * 60000)) return out;
  for (const c of projectGiveChanges(store.view.data)) {
    if (store.dispatch('setProjectTeam', c.team ? { projectId: c.projectId, ...c.team } : { projectId: c.projectId, userId: null })) {
      out[c.team ? 'given' : 'back']++;
      if (!c.team) out.backIds.push(c.projectId);
    }
  }
  return out;
}

/** "4 tasks go with it · 2 stay with Ravi · 1 stays with you" — after giving a 📂 project. */
function giveSummary(p, person) {
  const kids = projectTasks(store.view.data, p.id).filter((c) => c.state !== 'finished'); // (its projects' tasks go too)
  const go = kids.filter((c) => c.team && c.team.userId === person.id).length;
  const others = new Map();
  for (const c of kids) if (c.team && c.team.userId !== person.id) others.set(c.team.name, (others.get(c.team.name) || 0) + 1);
  const mine = kids.filter((c) => !c.team).length;
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  return [`${n(go, 'task')} go${go === 1 ? 'es' : ''} with it`, ...[...others].map(([name, k]) => `${k} stay${k === 1 ? 's' : ''} with ${name}`), mine ? `${mine} stay${mine === 1 ? 's' : ''} with you` : null].filter(Boolean).join(' · ');
}

/** Steps sent with project.sync that are not on the person's list yet (the server waits 10 minutes after one was finished). */
function notSent(out, steps) {
  if (Array.isArray(out.skipped)) return out.skipped;
  const on = new Set((out.tasks || []).map((t) => t.stepRef));
  return steps.filter((x) => x.title && !on.has(x.stepRef)).map((x) => x.stepRef);
}

/** What was sent for a given project: a change in any part (the short description too) sends it again. */
function syncSig(userId, p, steps, needsPhoto) {
  return JSON.stringify([userId, p.name, steps, !!needsPhoto, folderOf(p), p.about || '', !!(p.team && p.team.record)]); // (📒 record: a change sends it again)
}
/** The 📂 project a given task is in (its first one; '' = in none, 📂 Misc too): the team sees the same folders. */
function folderOf(p) {
  const m = parentIdsOf(p).map((id) => store.view.data.projects.find((x) => x.id === id)).find((x) => x && !x.misc);
  return m ? m.name : '';
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
  followProjects({ onlyFresh: true }); // a task added to (or taken out of) a given 📂 project follows it (fresh data only)
  // store.view is replaced after each save: read every project fresh after each wait, never an old copy
  const fresh = (id) => store.view.data.projects.find((x) => x.id === id);
  for (const id of store.view.data.projects.filter((x) => x.team).map((x) => x.id)) {
    let p = fresh(id);
    if (!p || !p.team) continue;
    // moved on Work Task (↔ Move to…): follow the new person instead of moving the steps back
    // (also when the new person has finished every step: the newest finish tells, rules.js)
    const moved = gen === team.gen && team.listAt >= dataFreshAt ? teamMovedTo(p, [...team.byStep.values()]) : null;
    if (moved) {
      store.dispatch('setProjectTeam', { projectId: p.id, userId: moved.id, name: moved.name, needsPhoto: !!p.team.needsPhoto, record: !!p.team.record, byTeam: true });
      p = fresh(id);
      if (!p || !p.team) continue;
    }
    const steps = p.state === 'active' ? projectSteps(p) : [];
    const sig = syncSig(p.team.userId, p, steps, !!p.team.needsPhoto);
    if (m[p.id] === sig) continue;
    const name = p.name, about = p.about || '', who = p.team.name;
    try {
      const out = await teamApi('project.sync', { projectRef: p.id, project: name, about, folder: folderOf(p), assigneeId: p.state === 'active' ? p.team.userId : 0, steps, needsPhoto: !!p.team.needsPhoto, kind: p.team.record ? 'log' : '', reason: p.state,
        baseCommit: store.base && store.base.commit, pending: store.pending.length > 0 });
      // a re-opened step that was just finished is not made yet: sent again next time
      rememberSync(id, notSent(out, steps).length ? SYNC_RETRY : sig);
      delete team.syncErr[id];
      // the server followed a Work Task move this app had not seen: record the new person (once; the next sync sends them)
      const now = serverHolder(out, p.state === 'active' ? p.team.userId : 0, [...(team.people || []), ...[...team.byStep.values()].map((t) => t.assignee)]);
      if (now && fresh(id) && fresh(id).team) store.dispatch('setProjectTeam', { projectId: id, userId: now.id, name: now.name, needsPhoto: !!p.team.needsPhoto, record: !!p.team.record, byTeam: true });
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
    const still = fresh(ref);
    if (still && still.team) continue;
    if (still) { // no longer given (it went with its 📂 project, which was taken back or it left): off the person's list —
      // once that is saved, its Undo time is over, and only if no other device saved since (ifHead: else "stale", look again later)
      const saved = store.base && store.base.data.projects.find((x) => x.id === ref);
      if (store.pending.length || !saved || saved.team || Date.now() - Date.parse(still.updatedAt || 0) < UNDO_GRACE_MS) continue;
      try {
        const out = await teamApi('project.sync', { projectRef: ref, project: still.name, assigneeId: 0, steps: [], reason: 'taken', ifHead: store.base.commit });
        if (!out.stale) rememberSync(ref, null);
      } catch { /* try again next time */ }
      continue;
    }
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
  const savedIds = store.base ? new Set(store.base.data.projects.map((p) => p.id)) : null;
  for (const t of tasks) {
    // ticked, or deleted (the step, or its whole project) once Undo is gone (rules.js)
    const status = singleStepClose(t, projects, savedIds, store.view.history);
    if (!status) continue;
    try { await teamApi('task.status', { id: t.id, status }); } catch { /* next time */ }
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
      if (teamActionUndone(p, t)) { /* you undid this untick: it stays as you left it (every device) */ }
      else if (p && t.stepRef === wholeRef(p.id) && note && (!latest || latest.id === t.id)) actMany(p.id, [['deleteWorkNote', { projectId: p.id, noteId: note.id, byTeam: true }]], `↩ ${t.assignee.name} opened “${p.name}” again`, teamUndoKey(t));
      else if (step && note && (!latest || latest.id === t.id)) { // (the note says "this finish was handled": it is not finished now)
        actMany(p.id, [...(step.done ? [['untickStep', { projectId: p.id, stepId: step.id, byTeam: true }]] : []), ['deleteWorkNote', { projectId: p.id, noteId: note.id, byTeam: true }]], `↩ ${t.assignee.name} opened “${step.text}” again`, teamUndoKey(t));
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
      if (!(p.workNotes || []).some((n) => n.id === 'tn' + t.id) && !teamActionUndone(p, t)) {
        const words = (t.today || t.last) ? (t.today || t.last).note : '';
        actMany(p.id, [['addWorkNote', { projectId: p.id, noteId: 'tn' + t.id, team: true, at: serverTime(t.doneAt), text: `👥 ${t.assignee.name} finished the task${words ? ': ' + words : '.'}` }]], `✓ ${t.assignee.name} finished: ${p.name}`, teamUndoKey(t));
      }
      continue;
    }
    const step = p && p.steps.find((st) => st.id === t.stepRef);
    if (!step) continue; // not here yet (data still loading): tried again next time
    seen.add(t.id);
    if (step.done) continue;
    // handled on another device already (its note is saved with the data): an un-tick by hand there stays
    if ((p.workNotes || []).some((n) => n.id === 'tn' + t.id)) continue;
    if (teamActionUndone(p, t)) continue; // you undid this tick: it stays open (every device)
    const words = (t.today || t.last) ? (t.today || t.last).note : '';
    actMany(p.id, [
      ['tickStep', { projectId: p.id, stepId: step.id, byTeam: true, at: serverTime(t.doneAt) }], // their day, not your work today
      // always a note (same id on every device), so no other device ticks it again
      ['addWorkNote', { projectId: p.id, noteId: 'tn' + t.id, stepId: step.id, team: true, at: serverTime(t.doneAt),
        text: t.closedByPerson === false ? `👥 Marked done by the team: “${step.text}” (${t.assignee.name}'s step)` : `👥 ${t.assignee.name} finished “${step.text}”${words ? ': ' + words : '.'}` }],
    ], `✓ ${t.assignee.name} finished: ${step.text}`, teamUndoKey(t));
  }
  // keep every id the server still sends (60 days), so none of them looks new again
  const live = new Set(tasks.map((t) => t.id));
  try { localStorage.setItem(TICKED_KEY, JSON.stringify([...seen].filter((id) => live.has(id)))); } catch { /* full */ }
}

/** One load at a time: a forced load asked for while one runs makes that one go round once more. */
async function loadTeam(force = false) {
  if (force) {
    for (const e of daily.values()) askDiaryAgain(e); // ↻ also brings the newest daily updates
    for (const m of [teamPhotos, msgPhotos]) for (const [id, v] of m) if (v && typeof v === 'object') m.delete(id); // and tries failed photos again
  }
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
    if (newMsg) for (const e of daily.values()) askDiaryAgain(e);
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
  if (onServer) loadApps(appsCtx, force || ui.view === 'apps'); // 🔌 approvals from apps (at most once a minute)
  if (force && store.status === 'saved') toast('Up to date ✓');
  makeBrief();
}

/** "#open=<id>" (the link in a phone reminder): open that project, then tidy the address. */
function takeOpenFromHash() {
  const id = openIdFromHash(location.hash);
  if (!id) return false;
  history.replaceState(null, '', location.pathname + location.search);
  if (store) select(id);
  else { ui.selected = id; ui.mobile = 'detail'; }
  return true;
}

let started = false;

function start() {
  if (!isMock && !onServer && MOVED_TO) { showMoved(); return; } // first: it passes #say= / #add= on to the new address
  takeClipFromHash();
  takeVoiceFromHash();
  // a team task on the address (a phone notification): read before the owner's reminder link below takes "#open=" away
  const teamTask = teamTaskInHash();
  takeOpenFromHash(); // "#open=<id>": a phone reminder opens that project
  if (location.hash === '#people') { ui.view = 'people'; ui.search = ''; history.replaceState(null, '', location.pathname + location.search); } // from Work Task's "People ↗"
  if (location.hash === '#apps' && onServer) { ui.view = 'apps'; ui.search = ''; history.replaceState(null, '', location.pathname + location.search); } // a phone alert "🔌 App: title"
  if (onServer) takeOpsFromHash(); // before the store starts: it reads the waiting changes once
  if (onServer && !isMock && !serverToken()) { root.replaceChildren(); showSignIn((user) => openFor(user, teamTask)); return; } // sign in here (one app)
  if (onServer && !isMock) { // one app: who signed in picks the screens (the owner's start is not held up once known)
    const known = rememberedWho();
    if (known === 'staff') { startStaff(undefined, teamTask); return; }
    if (known === 'manager') { startManager(undefined, teamTask); return; }
    if (!known) {
      root.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
      askWho().then((r) => routeWho(r, teamTask)); // (no answer: only this phone's owner copy opens the owner's app)
      return;
    }
  }
  startOwner();
}

/** The owner's Daily Projects. */
function startOwner() {
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
  store.addEventListener('refused', (e) => toast(`The server refused one change (it holds code-like text), so it was not saved: ${e.detail.what}. Your other changes are saved.`, 10000));
  store.addEventListener('blocked', (e) => {
    toast(e.detail.status === 'offline' ? 'No connection — changes not saved. Try again when online.' : 'Please wait…');
    render(); // put ticked boxes and menus back to the real data
  });
  render();
  if (onServer && !isMock) takeTeamFromHash(); // "#team…": the team pages of this app (from 👥, a team task chip, Give to team)
  if (onServer && !isMock) startBell();
  store.init().then(() => { if (store.status === 'saved') dataFreshAt = Date.now(); if (store.canEdit() && !store.view.data.projects.some((p) => p.id === MISC_ID)) store.dispatch('makeMisc', {}); render(); if (ui.capture) focusKey('capture-input'); voiceReady = true; runVoice(); loadTeam(true); if (onServer) loadApps(appsCtx, true); shareLocalKeys(); markShownOpened(); makeBrief(); recordPastScores(); });
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
  window.addEventListener('hashchange', () => { takeClipFromHash(); takeVoiceFromHash(); if (takeTeamFromHash()) return; if (space === 'team' && openIdFromHash(location.hash)) leaveTeam(); if (takeOpenFromHash()) render(); }); // the Chrome button, when the app is already open // back to this window from another app
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
  listenKeys();
  // Ctrl+V anywhere on an open project: a screenshot or a copied file is added to it (the update box handles its own paste)
  document.addEventListener('paste', (e) => {
    if (space === 'team' && teamView) { pasteToView(teamView, e, TEAM_BOX); return; } // the team pages: an instruction file, or a photo message
    if (e.defaultPrevented || !store || !store.view) return;
    if (pasteInForm(e.target)) return; // naming a new task: its own box takes the paste, never the open task's update
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
  window.addEventListener('scroll', () => {
    if (ui.rowMenu) { ui.rowMenu = null; render(); }
  }, true);
}

installEvents(document.body);
installSwipe();
// Keep the app's files on the device so it opens without internet (not in test mode on this Mac).
if ('serviceWorker' in navigator && !isMock && !(onServer && !['worktask.in', 'www.worktask.in'].includes(location.hostname))) navigator.serviceWorker.register('sw.js').catch(() => {});
// A phone notification tapped (or arriving) while this app is open: the site's service worker (../sw.js) tells it.
// Tapped: open that team task (or the owner's project reminder). Arriving: look for the news now.
if ('serviceWorker' in navigator && onServer) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'open' && typeof d.hash === 'string' && /^#(?:team-task=\d+|open=[\w-]{1,64})$/.test(d.hash)) location.hash = d.hash;
    else if (d.type === 'push') { if (staffView) staffView.act.liveCheck(); else if (teamView) teamView.act.liveCheck(); }
  });
}
installMentions(() => ctx);
installAutocorrect(device.autocorrect());
if (isMock) document.title = 'Task List (test mode)';
else if (onServer && location.hostname !== 'worktask.in' && location.hostname !== 'www.worktask.in') document.title = 'Task List (server test)';
start();

// ---------------------------------------------------------------- a new version was uploaded while this page stayed open
// Offer a reload (a page left open could otherwise run old code for days). Checked every 5 minutes and when coming back.
let codeStamp = null;
async function checkNewVersion() {
  try {
    // version.txt is written by every upload (tools/deploy-worktask.sh): a different one = a new version
    // the first one comes the same way as the page's code (offline: the copy kept with it); later ones always from the server
    const { url, init } = versionRequest(codeStamp); // the first one past the browser's store (offline: the copy kept with the page)
    const r = await fetch(url, init);
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
