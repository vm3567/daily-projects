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

// ---------- "📅 Only on": a project that comes up only on chosen weekdays ----------

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** Weekday of an India date "YYYY-MM-DD": 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The project's chosen weekdays (sorted, unique, 0–6); [] = every day. All seven days = every day. */
export function onlyDaysOf(project) {
  const days = [...new Set((project && Array.isArray(project.onlyDays) ? project.onlyDays : [])
    .map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  return days.length === 7 ? [] : days;
}

/** "Mondays" for one day, "Mon, Thu" for several, "every day" for none. */
export function onlyDaysLabel(days) {
  const d = onlyDaysOf({ onlyDays: days });
  if (!d.length) return 'every day';
  return d.length === 1 ? WEEKDAYS_LONG[d[0]] : d.map((n) => WEEKDAYS[n]).join(', ');
}

/** "09:30" → "9:30" (for the chips). */
export function shortTime(hhmm) {
  return hhmm ? hhmm.replace(/^0(\d)/, '$1') : '';
}

/** The project page chip: "📅 Mondays · 🔔 9:30", "📅 Mon, Thu", "🔔 9:30" (every day), or '' (nothing set). */
export function onlyDaysChip(project) {
  const parts = [];
  if (onlyDaysOf(project).length) parts.push(`📅 ${onlyDaysLabel(project.onlyDays)}`);
  if (project.remindAt) parts.push(`🔔 ${shortTime(project.remindAt)}`);
  return parts.join(' · ');
}

/** The project id in a "#open=<id>" link (from a reminder on the phone), or null. */
export function openIdFromHash(hash) {
  const m = /^#open=([\w-]{1,64})$/.exec(hash || '');
  return m ? m[1] : null;
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** India date and time "YYYY-MM-DD HH:MM" for an ISO time, a Date, or now. */
export function indiaDateTime(when = new Date()) {
  const d = when instanceof Date ? when : new Date(when);
  return `${indiaDate(d)} ${timeFmt.format(d)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A one-time reminder "YYYY-MM-DD HH:MM" is a real date and time. */
export function validRemindOnce(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):[0-5]\d$/.exec(typeof v === 'string' ? v : '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
/** "2026-10-22 16:00" → "22 Oct 16:00" (history lines). */
export function remindOnceText(v) {
  return `${Number(v.slice(8, 10))} ${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(11)}`;
}
/** The chip for a one-time reminder still to come: "🔔 Today 16:00", "🔔 Tomorrow 09:30", "🔔 30 Oct 16:00"; '' once it has passed. */
export function remindOnceChip(project, now = new Date()) {
  const v = project.remindOnce;
  const at = indiaDateTime(now);
  if (!validRemindOnce(v) || v < at) return '';
  const day = v.slice(0, 10);
  const today = at.slice(0, 10);
  const when = day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : remindOnceText(v).replace(/ \d\d:\d\d$/, '');
  return `🔔 ${when} ${v.slice(11)}`;
}

/** First chosen day on or after a date (the date itself when no days are chosen). */
function chosenDayFrom(days, date) {
  let d = date;
  for (let i = 0; i < 7 && days.length && !days.includes(weekdayOf(d)); i++) d = addDays(d, 1);
  return d;
}

/** Today is not one of the project's chosen days (it rests today, like a snooze). */
export function restDayToday(project, today = todayIndia()) {
  const days = onlyDaysOf(project);
  return days.length > 0 && !days.includes(weekdayOf(today));
}

/**
 * The day an active project comes back to Today, or null if it needs you now:
 * the project is snoozed, OR every open step is set to "remind me" later (then: the earliest reminder),
 * OR today is not one of its "📅 Only on" days. With chosen days it always comes back on a chosen day
 * (a snooze or reminder that ends on a rest day waits for the next chosen day).
 */
export function restUntil(project, today = todayIndia()) {
  if (project.state !== 'active') return null;
  let base = null;
  if (project.snoozedUntil && project.snoozedUntil > today) base = project.snoozedUntil;
  else {
    const open = (project.steps || []).filter((s) => !s.done);
    if (open.length && open.every((s) => stepWaitsForReminder(s, today))) base = open.map((s) => s.snoozedUntil).sort()[0];
  }
  const restDay = restDayToday(project, today);
  if (!base && !restDay) return null;
  return chosenDayFrom(onlyDaysOf(project), base || addDays(today, 1));
}

/** Why an active project is resting today: 'snooze', 'onlyDays', 'remind', or null. */
export function restReason(project, today = todayIndia()) {
  if (!restUntil(project, today)) return null;
  if (project.snoozedUntil && project.snoozedUntil > today) return 'snooze';
  return restDayToday(project, today) ? 'onlyDays' : 'remind';
}

/** Snoozed (or all steps waiting for their reminder, or a rest day): hidden from Today until a date; comes back by itself. */
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
// (a 🔌 note from an outside app — n.app, connect.php — is not your work either)
const ownNote = (project) => (project.workNotes || []).find((n) => !n.team && !n.mail && !n.app && !String(n.text || '').startsWith('👥 '));
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
  // each project once, its OWN dot (never a main's roll-up); a main with no own step is left out, as on Today
  for (const p of todayWithoutEmptyMains(awakeProjects(data, today), today)) counts[dotColour(p, today)]++;
  return counts;
}

// ---------- Projects (📂 a project holds a few tasks; a task can be in several projects, or none) ----------
// In the data every one of them is in data.projects: a "project" is one with isMain (or with tasks in it), a "task" is any
// other one. A task lists the projects it is in as parentIds (older data: one parentId, read the same way).

/** The ids of the projects this task is in (parentIds; older data: parentId). */
export function parentIdsOf(p) {
  if (!p) return [];
  const out = Array.isArray(p.parentIds) ? p.parentIds.filter((x) => typeof x === 'string' && x && x !== p.id) : [];
  if (typeof p.parentId === 'string' && p.parentId && p.parentId !== p.id) out.push(p.parentId);
  return [...new Set(out)];
}

/**
 * Older saved data, read the new way (in place; done when data loads and before changes): parentId → parentIds,
 * and every object that holds tasks is marked isMain (so it stays a project when it is emptied).
 */
/**
 * Groups are gone (the owner asked, 23 Oct): an older data file is brought up to date when it is read. The tags of all
 * groups become one list (the same name: one tag), the timer stays on if any group had it on, and every task loses its
 * groupId (and the formerGroup kept for a few days). A file without groups is left as it is (only data.tags is made sure).
 */
export function dropGroups(data) {
  if (!data || typeof data !== 'object') return data;
  if (!Array.isArray(data.tags)) data.tags = [];
  if (Array.isArray(data.groups)) {
    const map = new Map(); // old tag id -> the kept tag's id
    for (const g of data.groups) {
      for (const t of (g && Array.isArray(g.tags) ? g.tags : [])) {
        if (!t || typeof t.name !== 'string') continue;
        const same = data.tags.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
        if (!same) data.tags.push({ id: t.id, name: t.name });
        else if (same.id !== t.id) map.set(t.id, same.id);
      }
    }
    if (!data.settings || typeof data.settings !== 'object') data.settings = {};
    if (typeof data.settings.timer !== 'boolean') { // (a group had the timer unless switched off; Personal was off by default)
      data.settings.timer = data.groups.some((g) => g && (typeof g.timer === 'boolean' ? g.timer : String(g.name || '').trim().toLowerCase() !== 'personal'));
    }
    for (const p of data.projects || []) if (p && map.has(p.tagId)) p.tagId = map.get(p.tagId);
    delete data.groups;
  }
  for (const p of data.projects || []) if (p && typeof p === 'object') { delete p.groupId; delete p.formerGroup; }
  return data;
}

/** The timer (and the Time report) is on unless switched off in Settings. */
export const timerOn = (data) => !(data && data.settings && data.settings.timer === false);

export function normalizeParents(data) {
  if (!data || !Array.isArray(data.projects)) return data;
  const ids = new Set(data.projects.filter((p) => p && typeof p === 'object').map((p) => p.id));
  for (const p of data.projects) {
    if (!p || typeof p !== 'object') continue;
    const dangling = Array.isArray(p.parentIds) && p.parentIds.some((x) => !ids.has(x) || x === p.id); // a link to a project that is gone
    if ('parentId' in p || ('parentIds' in p && !Array.isArray(p.parentIds)) || dangling) {
      const list = parentIdsOf(p).filter((x) => ids.has(x) && x !== p.id);
      delete p.parentId;
      if (list.length) p.parentIds = list; else delete p.parentIds;
    }
  }
  const holders = new Set(data.projects.flatMap((p) => parentIdsOf(p)));
  for (const p of data.projects) if (p && holders.has(p.id) && !p.isMain) p.isMain = true;
  return data;
}

/** The tasks in this project (any state; a deleted one is gone from the list). */
/**
 * Giving a 📂 project gives its tasks (owner, 23 Oct): each task in a given project that is not given to anyone goes to
 * that project's person (its team.viaProject = the project). A task given on its own stays with its person; a task taken
 * back on its own (teamOff) stays off. A task given through a project follows it: a new person, take back, or taken out
 * of the project. Finished tasks are not given. Returns the changes: [{ projectId, team: { userId, name, needsPhoto,
 * viaProject } | null }].
 */
export function projectGiveChanges(data) {
  const byId = new Map(data.projects.map((p) => [p.id, p]));
  const out = [];
  for (const t of data.projects) {
    if (isMainProject(data, t)) continue;
    if (t.team && !t.team.viaProject) continue; // given on its own: stays with its person
    const given = parentIdsOf(t).map((id) => byId.get(id)).filter((m) => m && m.team && m.state !== 'finished');
    const via = t.team && byId.get(t.team.viaProject);
    const m = (via && given.includes(via) ? via : given[0]) || null;
    if (!m) { if (t.team) out.push({ projectId: t.id, team: null }); continue; }
    if (!t.team && (t.teamOff || t.state === 'finished')) continue;
    const want = { userId: m.team.userId, name: m.team.name, needsPhoto: !!m.team.needsPhoto, viaProject: m.id };
    if (!t.team || t.team.userId !== want.userId || t.team.name !== want.name || !!t.team.needsPhoto !== want.needsPhoto || t.team.viaProject !== m.id) out.push({ projectId: t.id, team: want });
  }
  return out;
}

export function childrenOf(data, id) {
  return id ? data.projects.filter((p) => p.id !== id && parentIdsOf(p).includes(id)) : [];
}

/** The projects this task is in (the ones that still exist), in the order it was added to them. */
export function parentsOf(data, p) {
  return parentIdsOf(p).map((id) => data.projects.find((x) => x.id === id)).filter(Boolean);
}

/** The first project this task is in, or null. */
export function parentOf(data, p) {
  return parentsOf(data, p)[0] || null;
}

/** A project: made as one (isMain, so a new empty one still shows) or it holds at least one task. */
export function isMainProject(data, p) {
  return !!p && (!!p.isMain || data.projects.some((x) => x.id !== p.id && parentIdsOf(x).includes(p.id)));
}

export function mainProjects(data) {
  return data.projects.filter((p) => p.state !== 'finished' && isMainProject(data, p));
}

/** The tasks: every object that is not a project. */
export function tasksOf(data) {
  return data.projects.filter((p) => !isMainProject(data, p));
}

/** The "✅ Tasks" list: the active tasks, each once (a task in two projects too); 📂 projects are left out. */
export function activeTasks(data) {
  return data.projects.filter((p) => p.state === 'active' && !isMainProject(data, p));
}

const WORST = ['red', 'yellow', 'green', 'grey'];
/** The project's dot: the worst of its own dot and its active tasks (resting / snoozed ones count as grey). */
export function mainColour(main, children, today = todayIndia()) {
  const live = (children || []).filter((c) => c.state === 'active');
  // a project with no step of its own is just a holder: only its tasks decide its colour
  let best = live.length && !nextStep(main, today) ? 'grey' : dotColour(main, today);
  for (const c of children || []) {
    if (c.state !== 'active') continue;
    const col = dotColour(c, today);
    if (WORST.indexOf(col) < WORST.indexOf(best)) best = col;
  }
  return best;
}

/** "3 tasks · 1 red · 2 yellow" / "3 tasks · all green" (its active tasks). */
export function mainSummary(children, today = todayIndia()) {
  const active = (children || []).filter((c) => c.state === 'active');
  if (!active.length) return (children || []).length ? `${children.length} task${children.length === 1 ? '' : 's'} · none active` : 'No tasks in it yet';
  const n = { red: 0, yellow: 0, green: 0, grey: 0 };
  for (const c of active) n[dotColour(c, today)]++;
  const head = `${active.length} task${active.length === 1 ? '' : 's'}`;
  const bits = [n.red ? `${n.red} red` : null, n.yellow ? `${n.yellow} yellow` : null].filter(Boolean);
  if (bits.length) return [head, ...bits].join(' · ');
  if (n.green === active.length) return `${head} · all green`;
  return [head, n.green ? `${n.green} green` : null, n.grey ? `${n.grey} resting` : null].filter(Boolean).join(' · ');
}

/** Can the task `child` go into the project `main`? (never itself; a project is never inside another; the project is active or paused). */
export function canPutUnder(data, child, main) {
  if (!child || !main || child.id === main.id) return false;
  if (parentIdsOf(main).length || main.state === 'finished') return false; // something inside a project cannot hold tasks
  if (isMainProject(data, child)) return false; // a project is never inside another project
  return true;
}

/**
 * The "📂 Add to a project…" box: the projects to offer for `query` (any case, anywhere in the name); `in` = this task is
 * already in it (shown with ✓; picking it again takes the task out). `create` = the typed name when no project has
 * exactly that name (offered as "+ Create '<typed>' as a new project").
 */
export function mainChoices(data, p, query = '') {
  const q = String(query || '').trim().toLowerCase();
  const inIds = parentIdsOf(p);
  const fits = (x) => (inIds.includes(x.id) || canPutUnder(data, p, x)) && x.id !== p.id && (!q || x.name.toLowerCase().includes(q));
  const mains = data.projects.filter((x) => isMainProject(data, x) && x.state !== 'finished' && fits(x));
  const exact = q && data.projects.some((x) => isMainProject(data, x) && x.name.trim().toLowerCase() === q);
  return { items: mains.map((x) => ({ p: x, main: true, in: inIds.includes(x.id) })), create: q && !exact && !isMainProject(data, p) ? String(query).trim() : null };
}

/**
 * Enter in the list's "📂 Add to project…" box (several tasks picked): the project whose name is exactly the typed one
 * (any case), wherever it is in the list; else a new project with that name. Nothing typed: nothing (no hidden pick).
 * Returns { add: project } | { create: name } | null.
 */
export function pickEnterTarget(mains, query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const hit = (mains || []).find((m) => String(m.name || '').trim().toLowerCase() === q.toLowerCase());
  return hit ? { add: hit } : { create: q };
}

/** "+ Add a task here" on a project's page: the tasks that can go into it, for `query`. */
export function addHereChoices(data, main, query = '') {
  const q = String(query || '').trim().toLowerCase();
  const list = data.projects.filter((x) => x.state !== 'finished' && !parentIdsOf(x).includes(main.id) && canPutUnder(data, x, main)
    && (!q || x.name.toLowerCase().includes(q)));
  // tasks in no project first, then the ones already in another project (owner asked, 22 Oct)
  return [...list.filter((x) => !parentIdsOf(x).length), ...list.filter((x) => parentIdsOf(x).length)];
}

/** Today: a project with no own next step only holds its tasks; they show as normal rows (the project is left out). */
export function todayWithoutEmptyMains(list, today = todayIndia()) {
  const parents = new Set(list.flatMap((p) => parentIdsOf(p)));
  return list.filter((p) => !((p.isMain || parents.has(p.id)) && !nextStep(p, today)));
}

/** What Today counts (its rows, the progress line, the Daily round, the evening check): awake, empty 📂 projects left out. */
export function todayList(data, today = todayIndia()) {
  return todayWithoutEmptyMains(awakeProjects(data, today), today);
}

/** Where a new step can go (Inbox, Chrome clip, a person's task box): awake tasks only — a 📂 project holds tasks, not steps. */
export function stepTargets(data, today = todayIndia()) {
  return awakeProjects(data, today).filter((p) => !isMainProject(data, p));
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
export const WORK = new Set(['note_added', 'step_ticked', 'time_logged', 'time_added', 'reply_sent']);
const NOT_WORK = new Set(['created', 'snoozed', 'woke', 'step_remind', 'team_ticked', 'team_note', 'team_step_added', 'team_step_unticked', 'team_note_deleted', 'team_moved', 'mail_note', 'mail_task', 'reply_prepared', 'mail_replied', 'app_task', 'app_note']); // (the team's work counts through teamDays)

/** On that day, was every open step of the project waiting for a "remind me" date? */
function openStepsOn(p, day) {
  return (p.steps || []).filter((s) => (!s.createdAt || indiaDate(s.createdAt) <= day) && (!s.done || (s.doneAt && indiaDate(s.doneAt) > day)));
}

function restingByReminders(p, day) {
  const open = openStepsOn(p, day);
  return open.length > 0 && open.every((s) => s.remindFrom && s.remindUntil && s.remindFrom <= day && day < s.remindUntil);
} // these history lines are not work on the project

export function dayScore(data, history, day) {
  const busy = new Set();
  for (const e of (history[monthOf(day)] || [])) {
    if (e.projectId && indiaDate(e.at) === day && WORK.has(e.kind)) busy.add(e.projectId);
  }
  let total = 0;
  let green = 0;
  const holders = new Set(data.projects.flatMap((p) => parentIdsOf(p)));
  for (const p of data.projects) {
    if ((p.isMain || holders.has(p.id)) && !openStepsOn(p, day).length) continue; // an empty 📂 project only holds its tasks (as colourCounts and Today)
    const created = p.createdAt ? indiaDate(p.createdAt) : null;
    if (!created || created > day) continue;
    const changed = p.stateChangedAt ? indiaDate(p.stateChangedAt) : created;
    const activeThen = p.state === 'active' ? (p.activeSince || created) <= day : changed > day;
    if (!activeThen) continue;
    if (p.snoozedFrom && p.snoozedUntil && p.snoozedFrom <= day && day < p.snoozedUntil) continue; // snoozed that day: not counted
    if (restingByReminders(p, day)) continue; // every open step was waiting for its "remind me" day
    if (p.onlyDaysSince && p.onlyDaysSince <= day && restDayToday(p, day)) continue; // a "📅 Only on" rest day: not counted
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

/** A "+ Add time" answer in minutes, or null when it is not understood: 45, 45m, 45 min, 1.5h, 2 hours, 1h 30m, 1:30. */
export function parseDuration(v) {
  const t = String(v ?? '').trim().toLowerCase();
  const n = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
  const mins = '(?:m|min|mins|minute|minutes)';
  let m;
  let out = null;
  if ((m = /^(\d+):([0-5]\d)$/.exec(t))) out = +m[1] * 60 + +m[2];
  else if ((m = new RegExp(`^${n}\\s*(?:h|hr|hrs|hour|hours)(?:\\s*${n}\\s*${mins}?)?$`).exec(t))) out = +m[1] * 60 + (m[2] ? +m[2] : 0);
  else if ((m = new RegExp(`^${n}\\s*${mins}?$`).exec(t))) out = +m[1];
  out = Math.round(out); // anything left over (like "2 apples") matched nothing: null → 0
  return Number.isFinite(out) && out > 0 ? out : null;
}

/** Monday of the India week that contains `day`. */
export function weekStart(day) {
  const dow = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -dow);
}

/**
 * Time between two India dates, split by tag (or by project).
 * Returns [{ key, name, minutes }] biggest first; projects without a tag are "No tag".
 */
export function timeSplit(data, fromDay, toDay, by = 'tag', now = new Date()) {
  const tags = data.tags || [];
  const rows = new Map();
  for (const p of data.projects) {
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

/** Ctrl+V inside the "+ New task" box: it belongs to the new task, never to the project open on the right. */
export function pasteInForm(target) {
  const el = target && target.nodeType === 3 ? target.parentNode : target; // (a text node inside a box)
  return !!(el && typeof el.closest === 'function' && el.closest('.new-task-box'));
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
  if (step && step.movedTo) return null; // "Make it a project": the person's task stays as it is (with the old project)
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

// ---------- Email replies ("✉ Replies" page) ----------

export const REPLY_RED_DAYS = 3; // waiting this many days (or more) for your reply: red
export const MAILTO_BODY_MAX = 1800; // a mailto: link holds only so much: longer replies are cut (and you are told)

/** A reply was sent, but a newer email came in the same thread after it: it waits for your reply again. */
export function waitingAgain(t) {
  const r = t && t.reply;
  return !!(r && r.state === 'sent' && t.mail && t.mail.at && r.sentAt && Date.parse(t.mail.at) > Date.parse(r.sentAt));
}

/** The key of an email thread's place: 'inbox:<id>', 'step:<projectId>:<stepId>' or 'project:<id>'. */
export function mailKey(m) {
  return m.kind === 'inbox' ? `inbox:${m.item.id}` : m.kind === 'step' ? `step:${m.project.id}:${m.step.id}` : `project:${m.project.id}`;
}

export const THREAD_MAX = 50; // a task made from an email keeps its newest 50 emails
export const THREAD_PREVIEW_MAX = 300;

/** A task made from an email: its emails [{ at, fromName, fromMe, preview, link, messageId }], oldest first (only good entries). */
export function mailThreadOf(p) {
  return (p && Array.isArray(p.thread) ? p.thread : []).filter((e) => e && typeof e === 'object' && typeof e.at === 'string');
}

/** The newest email note (from Outlook) on this step / project, or null. */
function newestMailNote(p, stepId) {
  return (p.workNotes || []).find((n) => n.mail && (n.stepId || null) === (stepId || null)) || null;
}

/**
 * Every email thread kept in Daily Projects (Inbox items, steps and projects with `mail`), with what the pages need:
 * { kind, key, ref (the op args: {itemId} | {projectId, stepId?}), id (for the server / Claude), mail, reply, item, project,
 *   step, name (where it is), subject, from, since (India date of the newest email), at, preview, link, count }.
 * Finished projects, their steps and done steps are left out.
 */
export function mailThreads(data) {
  const out = [];
  for (const item of data.inbox || []) {
    if (!item.mail) continue;
    out.push({ kind: 'inbox', ref: { itemId: item.id }, id: item.id, mail: item.mail, reply: item.reply || null, item, project: null, step: null,
      name: '📥 Inbox', at: item.mail.at || item.createdAt, preview: item.note || '', link: item.link || null, count: item.mail.count || 1 });
  }
  for (const p of data.projects) {
    if (p.state === 'finished') continue;
    const mails = (p.workNotes || []).filter((n) => n.mail);
    if (p.mail) {
      const n = newestMailNote(p, null);
      const th = mailThreadOf(p); // a task made from an email: its emails, newest last
      const last = th.length ? th[th.length - 1] : null;
      out.push({ kind: 'project', ref: { projectId: p.id }, id: p.id, mail: p.mail, reply: p.reply || null, item: null, project: p, step: null,
        name: p.name, at: p.mail.at || (last && last.at) || (n && n.createdAt) || p.createdAt,
        preview: last ? last.preview : n ? n.text : String(p.notes || '').slice(-300),
        link: last && last.link ? { url: last.link, title: p.mail.subject || p.name } : (n && n.link) || (p.links || []).find((l) => l.id === p.id + '-link') || null,
        count: th.length || 1 + mails.filter((x) => !x.stepId).length, lastFromMe: last ? !!last.fromMe : false });
    }
    for (const s of p.steps) {
      if (!s.mail || s.done) continue;
      const n = newestMailNote(p, s.id);
      out.push({ kind: 'step', ref: { projectId: p.id, stepId: s.id }, id: s.id, mail: s.mail, reply: s.reply || null, item: null, project: p, step: s,
        name: `${p.name} → ${s.text}`, at: s.mail.at || (n && n.createdAt) || s.createdAt || p.createdAt, preview: n ? n.text : s.note || '',
        link: (n && n.link) || s.link || null, count: 1 + mails.filter((x) => x.stepId === s.id).length });
    }
  }
  for (const m of out) {
    m.key = mailKey(m);
    m.subject = m.mail.subject || (m.item ? m.item.text : m.step ? m.step.text : m.project.name);
    m.from = m.mail.fromName || m.mail.fromAddress || 'someone';
    m.since = m.at ? indiaDate(m.at) : null;
  }
  return out;
}

/** Where a thread stands: 'ready' (a draft to send), 'later' (waits for its day), 'waiting' (needs your reply), 'done'. */
export function replyState(m, today = todayIndia()) {
  const r = m.reply;
  if (r && r.state === 'ready') return 'ready';
  if (r && r.state === 'later') return r.laterUntil && r.laterUntil > today ? 'later' : 'ready';
  if (m.mail.fromMe || m.lastFromMe) return 'done'; // the newest email is your own: nothing to answer
  if (!r || waitingAgain(m)) return 'waiting';
  return 'done';
}

/**
 * The "✉ Replies" page: { ready, waiting, later } — each thread once, with days (waiting since the newest email)
 * and colour (red REPLY_RED_DAYS+ days, orange 1+, grey today). Longest waiting first.
 */
export function repliesOf(data, today = todayIndia()) {
  const ready = []; const waiting = []; const later = [];
  for (const m of mailThreads(data)) {
    const st = replyState(m, today);
    if (st === 'done') continue;
    m.days = m.since ? Math.max(0, daysBetween(m.since, today)) : 0;
    m.colour = m.days >= REPLY_RED_DAYS ? 'red' : m.days >= 1 ? 'orange' : 'grey';
    m.newer = !!(m.reply && m.reply.forMessageId && m.mail.messageId && m.reply.forMessageId !== m.mail.messageId); // a newer email came after the draft
    (st === 'ready' ? ready : st === 'later' ? later : waiting).push(m);
  }
  const order = (a, b) => b.days - a.days || String(a.at || '').localeCompare(String(b.at || '')) || a.subject.localeCompare(b.subject);
  ready.sort(order); waiting.sort(order); later.sort(order);
  return { ready, waiting, later };
}

/**
 * The one-by-one round over the ready replies: ids = the keys when it started, pos = where you are.
 * A reply that is no longer ready (sent, later or cleared elsewhere) is passed over.
 * Returns { pos, done, n (1-based), of, progress (0..1) }.
 */
export function replyRoundAt(ids, pos, readyKeys) {
  let i = Math.max(0, pos | 0);
  while (i < ids.length && !readyKeys.has(ids[i])) i++;
  const of = ids.length;
  return { pos: i, done: i >= of, n: Math.min(i + 1, of), of, progress: of ? i / of : 1 };
}

/** The fallback when Outlook cannot make the draft: a mailto: link (the body cut to MAILTO_BODY_MAX letters). */
export function replyMailto(mail, text) {
  const subject = String((mail && mail.subject) || '').replace(/^(re:\s*)+/i, '');
  const full = String(text || '');
  const cut = full.length > MAILTO_BODY_MAX;
  const body = cut ? full.slice(0, MAILTO_BODY_MAX) + '…' : full;
  const to = mail && mail.fromAddress ? encodeURIComponent(mail.fromAddress).replace(/%40/g, '@') : '';
  return { url: `mailto:${to}?subject=${encodeURIComponent('Re: ' + subject)}&body=${encodeURIComponent(body)}`, cut };
}

/** A thread by the id Claude and the server use (Inbox item, step or project id), or a unique part of its subject or name. */
export function findMailThread(data, query, list = mailThreads(data)) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Say which email (its id, or part of the subject or project name).');
  const exact = list.find((m) => m.id === q);
  if (exact) return exact;
  const low = q.toLowerCase();
  const hits = list.filter((m) => m.subject.toLowerCase().includes(low) || m.name.toLowerCase().includes(low));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`No email matches "${q}".`);
  throw new Error(`Several emails match "${q}": ${hits.map((m) => `${m.subject} [${m.id}]`).join(', ')}`);
}

// ---------- People page: give @mentioned steps to the person's Work Task list ----------

/**
 * "→ Give to <Name>": can this one step go to the person's Work Task list? Only when the person is linked to a Work Task
 * account (member), the step is open, its project is active and not given as a whole (that path sends its steps), and the
 * step is not already an open team task (`task` = the team task linked to the step, if any).
 */
export function canGiveStep(member, project, step, task) {
  return !!(member && member.id) && !step.done && project.state === 'active' && !project.team && !(task && task.status === 'open');
}

/** The steps of a People-page list that can be given (for "→ Give all N"). items = [{ project, step }]. */
export function givableSteps(items, member, taskOf) {
  return items.filter(({ project, step }) => canGiveStep(member, project, step, taskOf ? taskOf(step.id) : null));
}

/**
 * "No paste" email (Send pending list → Outlook): 'draft' = the finished email goes straight into the owner's Outlook
 * Drafts (outlook.compose, never sent); 'paste' = the old way (table copied, a new mail opens, you paste it).
 * Draft only when Outlook is connected AND the person has an email saved.
 */
export function emailPath({ connected = false, email = '' } = {}) {
  return connected === true && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(email || '').trim()) ? 'draft' : 'paste';
}

/** Why the email goes the paste way, in one short line (null when it goes as a draft). error: Outlook's words when the draft failed. */
export function pasteReason({ connected = false, email = '', name = '', error = '' } = {}) {
  if (!String(email || '').trim()) return `Add ${String(name || '').split(/\s+/)[0] || 'the person'}'s email first`;
  if (error) return String(error).replace(/[.\s]+$/, '');
  if (connected !== true) return 'Outlook not connected';
  return emailPath({ connected, email }) === 'paste' ? 'That email address does not look right' : null;
}

/** A step made into its own project is still sent with its old (given) project while the person's task is open —
 *  and also while the team list has not loaded yet (unknown = keep it, so the person's task is never cancelled by mistake). */
export function keepMovedStep(step, task, teamLoaded) {
  if (!step || !step.movedTo) return false;
  if (!teamLoaded || !task) return true; // not known yet (list not loaded, or older than the task): keep it
  return task.status === 'open'; // let it go only once the person's task is known to be finished or closed
}

/** The delete question: a 📂 project says its tasks are kept (they only leave it); a task asks plainly. */
export function deleteQuestion(data, p) {
  const n = childrenOf(data, p.id).length;
  if (isMainProject(data, p)) {
    return `Delete the project "${p.name}"?\n\n${n ? `Its ${n} task${n === 1 ? ' is' : 's are'} kept — ${n === 1 ? 'it just leaves' : 'they just leave'} this project.` : 'It has no tasks.'}\n\nYou can press Undo for a few seconds after.`;
  }
  return `Delete "${p.name}"?\n\nYou can press Undo for a few seconds after.`;
}

/** A 📂 project's tasks in the owner's order (p.taskOrder); tasks not placed yet come after, red first. */
export function orderedTasks(data, main, today = todayIndia()) {
  const kids = childrenOf(data, main.id);
  const pos = new Map((main.taskOrder || []).map((id, i) => [id, i]));
  const rank = { red: 0, yellow: 1, green: 2, grey: 3 };
  return kids.map((c, i) => ({ c, i })).sort((x, y) => {
    const a = pos.has(x.c.id) ? pos.get(x.c.id) : Infinity;
    const b = pos.has(y.c.id) ? pos.get(y.c.id) : Infinity;
    if (a !== b) return a - b;
    return (rank[dotColour(x.c, today)] ?? 4) - (rank[dotColour(y.c, today)] ?? 4) || x.i - y.i;
  }).map((x) => x.c);
}

/** Move one task up (-1) or down (+1) in its project's order; returns the new full order (ids). */
export function movedOrder(list, id, dir) {
  const ids = list.map((x) => x.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

/**
 * Drag-to-move on a 📂 project's task rows: which gap the dragged row lands in.
 * `mids` = the middle (y) of each row, top to bottom; `y` = where the finger / mouse is.
 * Returns 0 (above the first row) … mids.length (below the last row).
 */
export function dropSlot(mids, y) {
  let slot = 0;
  for (const m of mids) if (y > m) slot++;
  return slot;
}

/** The new full order (ids) after dropping task `id` into gap `slot` (0 … list.length); null when it would stay where it is. */
export function droppedOrder(list, id, slot) {
  const ids = list.map((x) => x.id);
  const i = ids.indexOf(id);
  if (i < 0 || !Number.isInteger(slot) || slot < 0 || slot > ids.length) return null;
  if (slot === i || slot === i + 1) return null; // the same place
  ids.splice(i, 1);
  ids.splice(slot > i ? slot - 1 : slot, 0, id);
  return ids;
}

/**
 * Who signed in on worktask.in, for the one app: 'owner' (the Daily Projects owner: the full app), 'staff' (the staff
 * view: only their own Work Task tasks), 'manager' (a manager who is not the owner: Work Task's manager screens).
 * The server decides what each may reach; this only picks the screens.
 */
export function whoFromUser(u) {
  if (!u) return '';
  if (u.owner) return 'owner';
  return u.role === 'admin' ? 'manager' : 'staff';
}

/** A short tag of a sign-in (never the sign-in itself), so a remembered "who" is used only for that same sign-in. */
export function signInTag(token) {
  let x = 2166136261;
  for (const c of String(token || '')) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
  return token ? x.toString(36) : '';
}
