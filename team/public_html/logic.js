// Work Task: the rules behind the screens, kept apart from the drawing so they can be checked
// automatically (tests/team-app.test.mjs). No page, no network here.

/** 'YYYY-MM-DD' moved by n days. */
export const addDay = (day, n) => { const x = new Date(day + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** 0 = Sunday … 6 = Saturday, for a 'YYYY-MM-DD' day. */
export const weekdayOf = (day) => new Date(day + 'T00:00:00Z').getUTCDay();

/** Is this task due on that day? (the same rule as the server's due_on) */
export function dueOn(t, day) {
  if (t.startDate && day < t.startDate) return false;
  const wd = weekdayOf(day);
  if (t.repeat === 'weekly') return wd === (t.weekday ?? 1);
  return !(t.skipSunday && wd === 0);
}

/** What a waiting outbox item belongs to: later items of the same thing wait behind one that keeps failing. */
export const itemKey = (it) => (it.kind === 'step' ? 'p:' + it.projectRef : it.kind === 'suggest' ? 's:' + it.id : 't:' + it.taskId);

/**
 * The days of a task's diary, newest first: each is { day, kind, ups } where kind is
 *  'ups'  — the updates written that day
 *  'off'  — Sunday (or another day the task is not due) with nothing written
 *  'wait' — today, before the "updates are due by" time
 *  'miss' — a day it was due with no update ("No progress")
 * Days with nothing to say are left out (before it started, while it was closed, a step waiting its turn…).
 * opts: { staff (today is in its own box), n (how many days), fillBy 'HH:MM', nowHm 'HH:MM' }
 * Returns { rows, more } — more = older days exist (the "Show older days" button).
 */
export function diaryRows(t, updates, today, opts = {}) {
  const n = opts.n || 14;
  const fillBy = opts.fillBy || '18:00';
  const nowHm = opts.nowHm || '00:00';
  const notYet = t.queued || t.status === 'suggested'; // a step waiting its turn, a suggestion: no day is "missed"
  const start = [t.startDate || '', (t.createdAt || '').slice(0, 10), t.turnSince || ''].sort().pop() || today; // (a step: from when its turn came)
  const end = t.status !== 'open' && t.doneAt ? t.doneAt.slice(0, 10) : today;
  const byDay = new Map();
  for (const u of updates) byDay.set(u.day, [...(byDay.get(u.day) || []), u]);
  // the server sends the newest 60 days with an update: never call days older than those "No progress"
  const oldest = updates.length >= 60 ? updates.map((u) => u.day).sort()[0] : '';
  const firstUpdate = updates.map((u) => u.day).sort()[0] || start;
  const begin = firstUpdate < start ? firstUpdate : start; // an update written before the step's turn still shows
  const lower = oldest > begin ? oldest : begin;
  const from = addDay(end, -(n - 1)) > lower ? addDay(end, -(n - 1)) : lower;
  const reopened = t.reopenedAt ? String(t.reopenedAt).slice(0, 10) : '';
  const closedFrom = t.closedFrom ? String(t.closedFrom).slice(0, 10) : '';
  const rows = [];
  for (let day = end; day >= from; day = addDay(day, -1)) {
    if (opts.staff && day === today) continue; // today's update is in its own box above
    const ups = byDay.get(day) || [];
    if (ups.length) { rows.push({ day, kind: 'ups', ups }); continue; }
    if (day < start) continue; // before its start: nothing to show
    if (reopened && day < reopened && (!closedFrom || day >= closedFrom)) continue; // closed that day (open again since)
    if (t.status !== 'open' && day === end) continue; // the day it was closed
    if (notYet || !dueOn(t, day)) {
      if (weekdayOf(day) === 0) rows.push({ day, kind: 'off', ups: [] }); // (other days a task is not due: left out)
      continue;
    }
    rows.push({ day, kind: day === today && nowHm < fillBy ? 'wait' : 'miss', ups: [] });
  }
  return { rows, more: from > lower };
}
