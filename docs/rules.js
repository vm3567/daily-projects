// Shared rules (used by the app in the browser AND by tools/tracker.mjs on the Mac).
// No browser-only or Node-only code in this file.

import { TIME_ZONE, WAIT_RED_DAYS } from './config.js';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' });

/** India date "YYYY-MM-DD" for an ISO time, a Date, or now. */
export function indiaDate(when = new Date()) {
  const d = when instanceof Date ? when : new Date(when);
  return dateFmt.format(d); // en-CA gives YYYY-MM-DD
}

export function todayIndia() {
  return indiaDate(new Date());
}

/** "YYYY-MM" for a "YYYY-MM-DD" date. */
export function monthOf(date) {
  return date.slice(0, 7);
}

/** Whole days from date a to date b (both "YYYY-MM-DD"). */
export function daysBetween(a, b) {
  const ms = Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z');
  return Math.round(ms / 86400000);
}

export function addDays(date, n) {
  const d = new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000);
  return d.toISOString().slice(0, 10);
}

export function isSundayIndia(when = new Date()) {
  const d = when instanceof Date ? when : new Date(when);
  return weekdayFmt.format(d) === 'Sun';
}

export function laterDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Daily dot colour for a project (resets every midnight, India time):
 *   red    = not looked at today
 *   yellow = opened today, nothing done yet
 *   green  = a real update today (written update, ticked step, follow-up, time, or the team's update)
 *   grey   = paused or finished
 */
/** A step set to "remind me" on a later date: hidden until that day. */
export function stepWaitsForReminder(step, today = todayIndia()) {
  return !step.done && !!step.remindUntil && !!step.snoozedUntil && step.snoozedUntil > today;
}

/**
 * The day an active project comes back to Today, or null if it needs you now:
 * the project is snoozed, OR every open step is set to "remind me" later (then: the earliest reminder).
 */
export function restUntil(project, today = todayIndia()) {
  if (project.state !== 'active') return null;
  if (project.snoozedUntil && project.snoozedUntil > today) return project.snoozedUntil;
  const open = (project.steps || []).filter((s) => !s.done);
  if (!open.length || !open.every((s) => stepWaitsForReminder(s, today))) return null;
  return open.map((s) => s.snoozedUntil).sort()[0];
}

/** Snoozed (or all steps waiting for their reminder): hidden from Today until a date; comes back by itself. */
export function isSnoozed(project, today = todayIndia()) {
  return !!restUntil(project, today);
}

export function dotColour(project, today = todayIndia()) {
  if (project.state !== 'active' || isSnoozed(project, today)) return 'grey';
  if (lastWorkDate(project) === today) return 'green'; // only a real update makes it green (there is no "OK for today")
  if (project.lastOpenedDate === today) return 'yellow';
  return 'red';
}

/**
 * Last day with a real update: a written update (work note), a ticked step, a follow-up, time logged,
 * or a team member's update (teamWorkDate). Renaming, moving steps or other edits do not count.
 */
/** The newest note you wrote yourself (a 👥 note about the team's work is their work, counted by teamWorkDate). */
const ownNote = (project) => (project.workNotes || []).find((n) => !n.team && !n.mail && !String(n.text || '').startsWith('👥 '));
export function lastWorkDate(project) {
  const n = ownNote(project);
  const note = n ? indiaDate(n.createdAt) : null; // newest first
  return laterDate(laterDate(project.workDate, project.lastTickDate), laterDate(project.teamWorkDate, note));
}

/** Green today only because the team sent an update (shown with 👥). */
export function greenByTeamOnly(project, today = todayIndia()) {
  const n = ownNote(project);
  return project.teamWorkDate === today && laterDate(laterDate(project.workDate, project.lastTickDate), n ? indiaDate(n.createdAt) : null) !== today;
}

/** Days since the last real update. */
export function daysWithoutWork(project, today = todayIndia()) {
  const since = lastWorkDate(project) || project.activeSince || (project.createdAt ? indiaDate(project.createdAt) : today);
  return Math.max(0, daysBetween(since, today));
}

export function isOverdue(project, today = todayIndia()) {
  return !!(project.deadline && project.deadline < today);
}

/** First unfinished step, or null. */
/**
 * The next step: the first open step that is due now. A repeating step that comes back later
 * ("snoozed until") waits its turn, unless it is the only open step.
 */
export function nextStep(project, today = todayIndia(), opts = {}) {
  const open = project.steps.filter((s) => !s.done);
  // a "remind me" step whose day has come goes first; then the first step that is due
  const due = open.find((s) => s.remindUntil && s.remindUntil <= today && (!s.snoozedUntil || s.snoozedUntil <= today))
    || open.find((s) => !s.snoozedUntil || s.snoozedUntil <= today);
  if (opts.dueOnly) return due || null; // for ticking: never tick a step that comes back later
  return due || open[0] || null;
}

export const REPEATS = ['daily', 'weekly', 'monthly'];

/**
 * Next date for a repeating step, after the day it was done. Keeps the weekday / day of month of its date.
 * `dayOfMonth` (monthly) is the step's own day, so "the 31st" stays the 31st after a short month (28 Feb → 31 Mar).
 */
export function nextRepeatDate(repeat, anchor, doneDay, dayOfMonth = null) {
  const keepDay = dayOfMonth || Number((anchor || doneDay).slice(8, 10));
  const step = (d) => {
    if (repeat === 'daily') return addDays(d, 1);
    if (repeat === 'weekly') return addDays(d, 7);
    // monthly: same day next month (31st → last day of a shorter month)
    const [y, m] = d.split('-').map(Number);
    const day = keepDay;
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  };
  let d = step(anchor || doneDay); // always at least one step on, so an early tick never repeats the same date
  for (let i = 0; i < 400 && d <= doneDay; i++) d = step(d);
  return d;
}

export function activeProjects(data) {
  return data.projects.filter((p) => p.state === 'active');
}

/** Active and not snoozed: the projects that need you today. */
export function awakeProjects(data, today = todayIndia()) {
  return data.projects.filter((p) => p.state === 'active' && !isSnoozed(p, today));
}

/** Counts of dot colours for active projects. */
export function colourCounts(data, today = todayIndia()) {
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const p of awakeProjects(data, today)) counts[dotColour(p, today)]++;
  return counts;
}

// ---------- People (@mentions) ----------

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Ids of people mentioned as "@Name" in a text. At each "@", the LONGEST matching name wins,
 * so "@Ravi Kumar" links to "Ravi Kumar", not to a separate "Ravi".
 */
const sortedCache = new WeakMap(); // people list -> longest names first (sorted once, not per call)

export function mentionedPeople(text, people) {
  const found = new Set();
  if (!text || !people || !people.length || text.indexOf('@') < 0) return found;
  // re-sort only when the list changed (people are added / renamed in place)
  const sig = people.map((x) => x.id + ':' + x.name).join('|');
  let c = sortedCache.get(people);
  if (!c || c.sig !== sig) { c = { sig, sorted: [...people].sort((a, b) => b.name.length - a.name.length) }; sortedCache.set(people, c); }
  const sorted = c.sorted;
  const lower = text.toLowerCase();
  for (let i = lower.indexOf('@'); i >= 0; i = lower.indexOf('@', i + 1)) {
    for (const p of sorted) {
      const n = p.name.toLowerCase();
      if (lower.startsWith(n, i + 1) && !WORD_CHAR.test(text.charAt(i + 1 + n.length))) { found.add(p.id); break; }
    }
  }
  return found;
}

/**
 * Rewrite every "@Name" in a text the same way mentionedPeople reads it (longest name wins):
 * replace(person, matchedText) returns what to put instead of "@" + matchedText.
 */
export function replaceMentions(text, people, replace) {
  if (!text || text.indexOf('@') < 0) return text || '';
  const sorted = [...(people || [])].sort((a, b) => b.name.length - a.name.length);
  const lower = text.toLowerCase();
  let out = '';
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf('@', i);
    if (at < 0) { out += text.slice(i); break; }
    out += text.slice(i, at);
    const hit = sorted.find((p) => lower.startsWith(p.name.toLowerCase(), at + 1) && !WORD_CHAR.test(text.charAt(at + 1 + p.name.length)));
    if (hit) { out += replace(hit, text.substr(at + 1, hit.name.length)); i = at + 1 + hit.name.length; } else { out += '@'; i = at + 1; }
  }
  return out;
}

/** Is this step linked to the person (by @name in its text or note, or by "Waiting on")? */
export function stepLinkedTo(step, person, people) {
  if (step.waitingOn && step.waitingOn.trim().toLowerCase() === person.name.toLowerCase()) return true;
  return mentionedPeople(step.text, people).has(person.id) || mentionedPeople(step.note, people).has(person.id);
}

export function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Days a waiting step has been waiting (older steps without waitingSince use their last change). */
export function waitingDays(step, today = todayIndia()) {
  if (!step.waiting) return 0;
  const since = step.waitingSince || (step.updatedAt ? indiaDate(step.updatedAt) : today);
  return Math.max(0, daysBetween(since, today));
}

/** Steps linked to a person, split into lists (finished projects are left out of the open lists). */
export function personSteps(data, person, opts = {}) {
  const people = data.people || [];
  const waiting = [];
  const discuss = [];
  const done = [];
  for (const p of data.projects) {
    if (opts.openOnly && p.state === 'finished') continue;
    for (const s of p.steps) {
      if (opts.openOnly && s.done) continue;
      if (!stepLinkedTo(s, person, people)) continue;
      const item = { project: p, step: s };
      if (s.done) done.push(item);
      else if (p.state === 'finished') continue;
      else if (s.waiting) waiting.push(item);
      else discuss.push(item);
    }
  }
  done.sort((a, b) => (a.step.doneAt < b.step.doneAt ? 1 : -1));
  return { waiting, discuss, done };
}

/**
 * Follow-up colour for a person:
 *   red    = waiting on them WAIT_RED_DAYS+ days, or a linked step is past its date → contact now
 *   orange = something open (waiting less long, or to discuss)
 *   green  = nothing open
 */
export function personStatus(data, person, today = todayIndia()) {
  const { waiting, discuss } = personSteps(data, person, { openOnly: true });
  const maxWait = waiting.reduce((m, it) => Math.max(m, waitingDays(it.step, today)), 0);
  const late = [...waiting, ...discuss].some((it) => it.step.dueDate && it.step.dueDate < today);
  const open = waiting.length + discuss.length;
  const colour = !open ? 'green' : (waiting.length && maxWait >= WAIT_RED_DAYS) || late ? 'red' : 'orange';
  return { colour, open, waiting: waiting.length, discuss: discuss.length, maxWait, late };
}

// ---------- Daily score and streak ----------

/**
 * How many projects were green on a past day, worked out from the saved dates and the history.
 * Counts projects that existed and were active that day.
 */
/** Real work in the history, the same as the dot's rule: your notes, ticks and time (the team's counts through teamDays). */
const WORK = new Set(['note_added', 'step_ticked', 'time_logged', 'time_added']);
const NOT_WORK = new Set(['created', 'snoozed', 'woke', 'step_remind', 'team_ticked', 'team_note', 'team_step_added', 'team_step_unticked', 'team_note_deleted', 'team_moved', 'mail_note']); // (the team's work counts through teamDays)

/** On that day, was every open step of the project waiting for a "remind me" date? */
function restingByReminders(p, day) {
  const open = (p.steps || []).filter((s) => (!s.createdAt || indiaDate(s.createdAt) <= day) && (!s.done || (s.doneAt && indiaDate(s.doneAt) > day)));
  return open.length > 0 && open.every((s) => s.remindFrom && s.remindUntil && s.remindFrom <= day && day < s.remindUntil);
} // these history lines are not work on the project

export function dayScore(data, history, day) {
  const busy = new Set();
  for (const e of (history[monthOf(day)] || [])) {
    if (e.projectId && indiaDate(e.at) === day && WORK.has(e.kind)) busy.add(e.projectId);
  }
  let total = 0;
  let green = 0;
  for (const p of data.projects) {
    const created = p.createdAt ? indiaDate(p.createdAt) : null;
    if (!created || created > day) continue;
    const changed = p.stateChangedAt ? indiaDate(p.stateChangedAt) : created;
    const activeThen = p.state === 'active' ? (p.activeSince || created) <= day : changed > day;
    if (!activeThen) continue;
    if (p.snoozedFrom && p.snoozedUntil && p.snoozedFrom <= day && day < p.snoozedUntil) continue; // snoozed that day: not counted
    if (restingByReminders(p, day)) continue; // every open step was waiting for its "remind me" day
    total++;
    if (busy.has(p.id) || lastWorkDate(p) === day || (p.teamDays || []).includes(day)) green++;
  }
  return { green, total };
}

/** Days in a row (ending yesterday, plus today if already all green) where every project was green. */
export function greenStreak(scores, todayScore, today = todayIndia()) {
  let n = todayScore && todayScore.total && todayScore.green === todayScore.total ? 1 : 0;
  for (let d = addDays(today, -1); ; d = addDays(d, -1)) {
    const s = scores[d];
    if (!s || !s.total || s.green < s.total) break;
    n++;
  }
  return n;
}

// ---------- Time log ----------

/** Minutes logged on a project between two India dates (inclusive). Counts a running timer too. */
export function minutesBetween(project, fromDay, toDay, timer = null, now = new Date()) {
  let m = 0;
  for (const t of project.timeLogs || []) {
    const d = indiaDate(t.start);
    if (d >= fromDay && d <= toDay) m += t.minutes;
  }
  if (timer && timer.projectId === project.id) {
    const d = indiaDate(timer.start);
    if (d >= fromDay && d <= toDay) m += Math.max(0, Math.min(600, Math.round((now - Date.parse(timer.start)) / 60000)));
  }
  return m;
}

/** "1h 20m", "45m", "0m". */
export function fmtMinutes(m) {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

/** Monday of the India week that contains `day`. */
export function weekStart(day) {
  const dow = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -dow);
}

/**
 * Time in a group between two India dates, split by tag (or by project).
 * Returns [{ key, name, minutes }] biggest first; projects without a tag are "No tag".
 */
export function timeSplit(data, groupId, fromDay, toDay, by = 'tag', now = new Date()) {
  const g = data.groups.find((x) => x.id === groupId);
  const tags = (g && g.tags) || [];
  const rows = new Map();
  for (const p of data.projects) {
    if (p.groupId !== groupId) continue;
    const m = minutesBetween(p, fromDay, toDay, data.timer, now);
    if (!m) continue;
    let key;
    let name;
    if (by === 'project') { key = p.id; name = p.name; } else {
      const t = tags.find((x) => x.id === p.tagId);
      key = t ? t.id : 'none'; name = t ? t.name : 'No tag';
    }
    const row = rows.get(key) || { key, name, minutes: 0 };
    row.minutes += m;
    rows.set(key, row);
  }
  // biggest first; on a tie, "No tag" goes last, then by name (same order every time)
  return [...rows.values()].sort((a, b) => b.minutes - a.minutes || (a.key === 'none') - (b.key === 'none') || a.name.localeCompare(b.name));
}

/** Whole-number percentages that always add up to 100. */
export function percents(rows) {
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  if (!total) return rows.map(() => 0);
  const raw = rows.map((r) => (r.minutes * 100) / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < left; k++) out[order[k % order.length][1]]++;
  return out;
}

// ---------------------------------------------------------------- team (worktask.in)

/** Longer than any Undo button (a step tick or delete: 6 s, a project delete: 10 s). */
export const UNDO_GRACE_MS = 15000;

const recent = (at, now, ms = UNDO_GRACE_MS) => !!at && now - Date.parse(at) < ms;
const lastEvent = (history, test) => {
  let found = null;
  for (const events of Object.values(history || {})) for (const e of events || []) if (test(e) && (!found || e.at > found.at)) found = e;
  return found;
};

/** A step given on its own was ticked or deleted: wait while that can still be undone, before closing the person's task. */
export function singleStepCloseWaits(step, stepId, history, now = Date.now()) {
  if (step) return !!step.done && recent(step.doneAt, now);
  const del = lastEvent(history, (e) => e.kind === 'step_deleted' && e.stepId === stepId);
  return !!del && recent(del.at, now);
}

/** A given project is gone from the screen: take it back from the person only once the delete is saved
 *  and can no longer be undone. `savedIds` = the project ids in the saved data (null = not loaded). */
export function takeBackWaits(ref, savedIds, history, now = Date.now()) {
  if (!savedIds || savedIds.has(ref)) return true; // the delete is not saved yet
  const del = lastEvent(history, (e) => e.kind === 'deleted' && e.projectId === ref);
  return !!del && recent(del.at, now);
}

/** A step the person added on Work Task: 'add' it to the project, tell the server it is 'adopted' (it may forget it), or 'wait'.
 *  `p` = the project on screen, `saved` = the same project in the saved data. A step you deleted or undid stays away. */
export function staffStepAction(stepRef, p, saved) {
  const inSaved = (list) => !!saved && (saved[list] || []).some((x) => (typeof x === 'string' ? x : x.id) === stepRef);
  if (p.steps.some((st) => st.id === stepRef)) return inSaved('steps') ? 'adopted' : 'wait';
  if ((p.teamDropped || []).includes(stepRef)) return inSaved('teamDropped') ? 'adopted' : 'wait';
  return 'add';
}

/** Ctrl+V with a picture: it goes to the open project only when that project's page is what is on screen. */
export function pasteGoesToProject(ui, { viewerOpen = false, narrow = false } = {}) {
  if (!ui.selected || viewerOpen || ui.showKeys) return false; // a sheet (Jump, a draft, a photo) or the shortcuts list is on top
  const wideView = ['diary', 'settings', 'dashboard', 'time'].includes(ui.view) && !ui.search;
  if (wideView || (ui.view === 'people' && !ui.search) || ui.round || ui.capture) return false;
  return !(narrow && ui.mobile !== 'detail');
}

/** A step given on its own (not a whole project): what to do with the person's open task now.
 *  'done' (you ticked it), 'cancelled' (you deleted the step, or its whole project), or null (leave it / wait).
 *  `savedIds` = the project ids in the saved data (null = not loaded). */
export function singleStepClose(t, projects, savedIds, history, now = Date.now()) {
  if (t.status !== 'open' || (t.seq !== null && t.seq !== undefined) || !t.stepRef) return null;
  const p = projects.find((x) => x.steps.some((st) => st.id === t.stepRef));
  if (p && p.team) return null; // part of a given project now: that path keeps it
  const step = p && p.steps.find((st) => st.id === t.stepRef);
  if (step && !step.done) return null;
  if (singleStepCloseWaits(step, t.stepRef, history, now)) return null; // Undo still on screen: next time
  if (step && t.reopenedAt && step.doneAt && Date.parse(String(t.reopenedAt).replace(' ', 'T') + '+05:30') > Date.parse(step.doneAt)) return null; // opened again there after your tick
  if (!step && !projects.some((x) => x.id === t.projectRef)) {
    // its whole project is gone: cancel once that delete is saved and can no longer be undone
    if (!t.projectRef || takeBackWaits(t.projectRef, savedIds, history, now)) return null;
  }
  return step ? 'done' : 'cancelled';
}

/** The newest team message the owner was shown: 'Seen' / an answer marks as read only up to it (not one that came later). */
export function seenUpTo(list) {
  const ids = (list || []).map((c) => Number(c.id)).filter((n) => Number.isFinite(n) && n > 0);
  return ids.length ? Math.max(...ids) : 0;
}

/** The version check: the first one past the browser's own store (it may hold an old version.txt), later ones never stored. */
export function versionRequest(codeStamp, now = Date.now()) {
  return codeStamp === null ? { url: 'version.txt', init: { cache: 'no-cache' } } : { url: `version.txt?check=${now}`, init: { cache: 'no-store' } };
}

/** A project's diary is wanted again at once. If a fetch is on its way (it may hold older data), it goes again when that ends. */
export function askDiaryAgain(e) {
  if (!e) return;
  e.at = 0;
  if (e.loading) e.stale = true;
}

/** A diary fetch ended: when it counts as fresh from (0 = fetch again at once). */
export function diaryLoadedAt(e, now = Date.now()) {
  const again = e.stale || (e.wantDays || 0) > e.days;
  e.stale = false;
  return again ? 0 : now;
}

/** A team photo kept in memory: fetch it (again)? Not while loading or shown; a failed one only after a minute (or ↻). */
export const PHOTO_RETRY_MS = 60000;
export function photoNeedsFetch(v, now = Date.now()) {
  if (v === undefined) return true;
  return !!v && typeof v === 'object' && now - v.failedAt >= PHOTO_RETRY_MS;
}

/** A team tick / untick / finished note you undid: remembered in the project (every device) per task and per finish or
 *  re-open, so the next team load does not do it again. A new finish (new time) or a new re-open counts as new. */
export function teamUndoKey(t) {
  return 'tn' + t.id + (t.status === 'open' ? '@r' + (t.reopenedAt || '') : '@d' + (t.doneAt || ''));
}
export function teamActionUndone(p, t) {
  return !!p && (p.teamUndone || []).includes(teamUndoKey(t));
}

/** A given project on the team: steps done / open, the step they are on, their last update, stuck.
 *  A project given as one task (no steps, ':whole') counts for stuck too. */
export function teamProgressOf(tasks, projectId) {
  const given = tasks.filter((t) => t.projectRef === projectId && t.seq !== null && t.seq !== undefined);
  const list = given.filter((t) => !String(t.stepRef).endsWith(':whole'));
  const open = list.filter((t) => t.status === 'open'), done = list.filter((t) => t.status === 'done');
  const days = tasks.filter((t) => t.projectRef === projectId).map((t) => (t.today || t.last || {}).day).filter(Boolean).sort();
  return { open: open.length, done: done.length, current: open.find((t) => !t.queued) || null, lastUpdate: days[days.length - 1] || null,
    stuck: given.some((t) => t.status === 'open' && t.stuck) };
}

/** Keys that act on the open project (x tick, s add step, w work note, i): not while its page is not on screen. */
export function projectKeyIgnored(ui, k) {
  if (ui.view === 'people') return 'xswi'.includes(k); // project keys do nothing on People
  return ['diary', 'settings', 'dashboard', 'time'].includes(ui.view) && !ui.search && 'xsw'.includes(k); // no project column there
}

/** Moved on Work Task (↔ Move to…): the person to follow now, or null. `tasks` = the team list (fresh), `p` = the project.
 *  All open steps with one other person: them. None open: the person who finished the newest one, when that was
 *  after the day you gave it to the one on record (same day: not sure, left alone). */
/** After project.sync: the server says who has the project now (it follows a Work Task move the app had not seen).
 * Returns that person's id when the app must follow it, else null. People: the team list ({id, name}). */
export function serverHolder(out, sentId, people) {
  const id = out && Number(out.assigneeId);
  if (!id || !sentId || id === sentId) return null; // 0 = taken back, as sent
  const who = (people || []).find((u) => u && u.id === id);
  return { id, name: who ? who.name : 'Team member' }; // follow even if the name is not known yet: a later sync must not give it back
}

export function teamMovedTo(p, tasks) {
  if (!p || !p.team) return null;
  const mine = tasks.filter((t) => t.projectRef === p.id && t.seq !== null && t.seq !== undefined);
  const open = mine.filter((t) => t.status === 'open');
  if (open.length) return open.every((t) => t.assignee.id === open[0].assignee.id) && open[0].assignee.id !== p.team.userId ? open[0].assignee : null;
  const done = mine.filter((t) => t.status === 'done' && t.doneAt && t.assignee).sort((a, b) => (a.doneAt < b.doneAt ? -1 : a.doneAt > b.doneAt ? 1 : a.id - b.id));
  const last = done[done.length - 1];
  if (!last || last.assignee.id === p.team.userId) return null;
  return p.team.since && String(last.doneAt).slice(0, 10) > p.team.since ? last.assignee : null;
}

// ---------- One People page: a Daily Projects person and their Work Task account ----------

const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Is this Work Task name the same person? Same name (any case, extra spaces), or the team name is the person's first name. */
export function sameTeamName(person, teamName) {
  const full = normName(person && person.name);
  const t = normName(teamName);
  if (!full || !t) return false;
  return t === full || t === full.split(' ')[0];
}

/** The Work Task account of a person (from users.list or people.morning), or null. An exact name wins over a first-name match. */
export function teamMemberFor(person, list) {
  const all = (list || []).filter((u) => u && sameTeamName(person, u.name));
  return all.find((u) => normName(u.name) === normName(person && person.name)) || all[0] || null;
}

/** Projects given to this person through "Give project to…" (active or paused; not finished, not deleted). */
export function givenProjectsOf(data, person) {
  return (data.projects || []).filter((p) => p.team && (p.state === 'active' || p.state === 'paused') && sameTeamName(person, p.team.name));
}
