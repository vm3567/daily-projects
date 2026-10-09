// Shared rules (used by the app in the browser AND by tools/tracker.mjs on the Mac).
// No browser-only or Node-only code in this file.

import { TIME_ZONE } from './config.js';

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
 * Dot colour for a project: 'green' | 'orange' | 'red' | 'grey'.
 * See PLAN.md section 5 and section 25 "Dot colour".
 */
export function dotColour(project, today = todayIndia()) {
  if (project.state !== 'active') return 'grey';
  if (project.deadline && project.deadline < today) return 'red';
  // Any activity counts (adding or ticking a step, a note, a link, a file, an edit).
  // Older data only has lastTickDate, so both are read.
  const last = laterDate(project.lastActivityDate, project.lastTickDate);
  if (last === today) return 'green';
  const ref = laterDate(last, project.activeSince);
  if (ref && daysBetween(ref, today) < 2) return 'orange';
  return 'red';
}

export function isOverdue(project, today = todayIndia()) {
  return !!(project.deadline && project.deadline < today);
}

/** First unfinished step, or null. */
export function nextStep(project) {
  return project.steps.find((s) => !s.done) || null;
}

export function activeProjects(data) {
  return data.projects.filter((p) => p.state === 'active');
}

/** Counts of dot colours for active projects. */
export function colourCounts(data, today = todayIndia()) {
  const counts = { green: 0, orange: 0, red: 0 };
  for (const p of activeProjects(data)) counts[dotColour(p, today)]++;
  return counts;
}
