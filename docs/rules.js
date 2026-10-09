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
 *   green  = changed something today, or pressed "OK for today"
 *   grey   = paused or finished
 */
export function dotColour(project, today = todayIndia()) {
  if (project.state !== 'active') return 'grey';
  if (lastWorkDate(project) === today || project.okDate === today) return 'green';
  if (project.lastOpenedDate === today) return 'yellow';
  return 'red';
}

/** Last day with a real change (older data only has lastTickDate, so both are read). */
export function lastWorkDate(project) {
  return laterDate(project.lastActivityDate, project.lastTickDate);
}

/** Days since the last real change ("OK for today" does not count). */
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
  const due = open.find((s) => !s.snoozedUntil || s.snoozedUntil <= today);
  if (opts.dueOnly) return due || null; // for ticking: never tick a step that comes back later
  return due || open[0] || null;
}

export const REPEATS = ['daily', 'weekly', 'monthly'];

/** Next date for a repeating step, after the day it was done. Keeps the weekday / day of month of its date. */
export function nextRepeatDate(repeat, anchor, doneDay) {
  const step = (d) => {
    if (repeat === 'daily') return addDays(d, 1);
    if (repeat === 'weekly') return addDays(d, 7);
    // monthly: same day next month (31st → last day of a shorter month)
    const [y, m, day] = d.split('-').map(Number);
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

/** Counts of dot colours for active projects. */
export function colourCounts(data, today = todayIndia()) {
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const p of activeProjects(data)) counts[dotColour(p, today)]++;
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
export function dayScore(data, history, day) {
  const busy = new Set();
  for (const e of (history[monthOf(day)] || [])) {
    if (e.projectId && indiaDate(e.at) === day && e.kind !== 'created') busy.add(e.projectId);
  }
  let total = 0;
  let green = 0;
  for (const p of data.projects) {
    const created = p.createdAt ? indiaDate(p.createdAt) : null;
    if (!created || created > day) continue;
    const changed = p.stateChangedAt ? indiaDate(p.stateChangedAt) : created;
    const activeThen = p.state === 'active' ? (p.activeSince || created) <= day : changed > day;
    if (!activeThen) continue;
    total++;
    if (busy.has(p.id) || lastWorkDate(p) === day || p.okDate === day) green++;
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
