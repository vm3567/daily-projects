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

/**
 * Has the person changed this field since the screen was drawn? (a redraw now would wipe it)
 * f: { tagName, type, disabled, readOnly, value, checked, fileCount, init } — init = the value when drawn (data-init).
 * The search box is never "typing": its words are kept (state.searchQ) and redrawn with the screen.
 */
export function fieldChanged(f) {
  if (f.disabled || f.readOnly) return false;
  if (f.type === 'file') return !!f.fileCount;
  if (['radio', 'hidden', 'submit', 'button', 'password', 'search'].includes(f.type)) return false;
  const now = f.type === 'checkbox' ? String(!!f.checked) : String(f.value ?? '');
  if (f.init !== undefined) return now !== f.init; // changed since the screen was drawn
  return f.type !== 'checkbox' && f.tagName !== 'SELECT' && now.trim() !== '';
}

/** A value that arrives after the field was drawn: taken only if the person has not changed the field meanwhile. */
export const lateValue = (value, init, answer) => (init === undefined || value === init ? answer : value);

/**
 * After the outbox was sent: what to redraw. sent = items that went, gaveBack = items refused and given back.
 * 'reload' (the list and the open task), 'later' (they are typing: once they stop), 'bar' (only the waiting bar).
 */
export function afterFlush({ sent = 0, gaveBack = 0, typing = false, view = '' }) {
  if (!sent && !gaveBack) return 'bar';
  if (typing) return 'later';
  return ['today', 'tasks'].includes(view) || view.startsWith('task:') || view.startsWith('project:') ? 'reload' : 'bar';
}

/** A refused update or message: is there still a box this person can open to find the words? (else they are shown in full) */
export const boxStillThere = (task, userId) => !!task && task.status === 'open' && (!task.assignee || task.assignee.id === userId);

/**
 * The body of an update.save. Every save carries a clientId (online too), so a save whose answer was lost and that
 * then went to the outbox is seen by the server as the same save. The "Finished" after the photos has its own id.
 */
export function updateSaveBody({ taskId, note, state, clientId, day, writtenAt, finish = false }) {
  const b = { taskId, note, state: finish ? 'finished' : state };
  if (day) b.day = day;
  if (writtenAt && !finish) b.writtenAt = writtenAt;
  if (clientId) b.clientId = finish ? clientId + '-f' : clientId;
  return b;
}

/**
 * A redraw asked for by a click in the menu or the list (a person filter, "Show everyone", the notifications banner):
 * 'all' (nothing typed), 'lists' (something typed in the open form on the right: redraw only the menu and the list),
 * 'later' (the typing is in the list itself, or there is no right column: redrawn once they stop).
 */
export function redrawHow({ typed = false, listTyped = false, hasDetail = false }) {
  if (!typed) return 'all';
  return hasDetail && !listTyped ? 'lists' : 'later';
}

/**
 * Manager's projects list: the dot and the "now / all done" words for one project.
 * A project given as one task (no steps yet) comes with open=0 but an open current task: it is live work, not done.
 */
export function projectRowState(p) {
  const live = !!(p.open || p.current);
  const dot = p.stuck ? 'red' : !live ? 'green' : p.current && p.current.sentToday ? 'green' : 'orange';
  const now = p.current ? `now: ${p.open ? p.current.title : 'whole project'}` : !p.open ? 'all done ✓' : '';
  return { dot, now };
}

/**
 * A waiting item the server refused: what to show. { sticky: true, title, body } = the notice that stays (words to copy),
 * or { sticky: false, text, ms } = a short toast. boxThere = the box the words went back to can still be opened.
 * Updates, messages, steps and suggestions show their whole words in the notice that stays (nothing written is lost).
 */
export function giveBackShow(it, why, boxThere) {
  const reason = String(why).replace(/\.$/, '');
  const words = it.note || it.text || it.title || '';
  const full = it.kind === 'suggest' && it.details ? `${words}\n${it.details}` : words;
  if ((['comment', 'step', 'suggest'].includes(it.kind) || (it.kind === 'update' && !it.updateId)) && full) {
    const tail = boxThere ? (it.kind === 'step' ? 'It is also back in the Add a step box.' : 'They are also back in the box.') : 'Copy them if you need them.';
    return { sticky: true, title: `Could not send: ${reason}.`, body: `Your words:\n${full}\n\n${tail}` };
  }
  return { sticky: false, text: `Could not send "${words.slice(0, 60)}": ${reason}.`, ms: 10000 };
}

/** The notice that stays: each refused item is added under the earlier ones (a second one never wipes the first). */
export const keptNotice = (list) => (list.length === 1 ? { title: list[0].title, body: list[0].body }
  : { title: `Could not send ${list.length} items.`, body: list.map((x) => `${x.title}\n${x.body}`).join('\n\n———\n\n') });

/** A new notice while the one with words to copy is open: it waits ('hold') until that one is closed. */
export const noticeHow = ({ copyOpen = false, copy = false }) => (copy ? 'add' : copyOpen ? 'hold' : 'show');

/** Ctrl+V of a photo on a task whose update waits on the phone (and is not being changed): refused, it would go nowhere. */
export const pasteWaits = (outbox, taskId, editing) => !editing && (outbox || []).some((x) => (x.kind === 'update' || x.kind === 'photos') && x.taskId === taskId);
