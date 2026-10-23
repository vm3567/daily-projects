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
  if (['radio', 'hidden', 'submit', 'button', 'search'].includes(f.type)) return false;
  // a password box counts only once drawn and then typed in (Change password); never an empty or never-drawn one (sign-in)
  if (f.type === 'password') return f.init !== undefined && String(f.value ?? '') !== f.init && String(f.value ?? '') !== '';
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

// ---------- Stage of a staff task: ⚪ Not started · 🔵 In progress · 🟠 Waiting · ✅ Done ----------
export const WAIT_FOR_MAX = 80;
/** "Waiting for what?" when Stuck: the quick choices (Manager = the manager / owner: they see "Waiting: you"). */
export const WAIT_FOR_PICKS = ['Manager', 'Material', 'Another person', 'Other'];
/** The words saved: the choice, and the short text after it ("Material: clay from Morbi"); '' when nothing chosen. */
export function waitForText(pick, text) {
  const p = WAIT_FOR_PICKS.includes(pick) ? pick : '';
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return (p && t ? `${p}: ${t}` : p || t).slice(0, WAIT_FOR_MAX);
}
/** Waiting for the manager (the choice "Manager"): the owner / manager sees "Waiting: you". */
export const waitsForManager = (wf) => /^manager\b/i.test(String(wf || '').trim());
/**
 * The stage of a team task, from its newest update: none yet → notstarted; Working on it → inprogress;
 * Stuck → waiting (for what they chose); Finished, or closed → done. Returns { stage, waitingFor, since, you }.
 */
export function teamStage(t) {
  if (!t) return { stage: 'notstarted', waitingFor: '', since: null, you: false };
  const u = t.today || t.last || null;
  if (t.status === 'done' || t.status === 'cancelled') return { stage: 'done', waitingFor: '', since: null, you: false };
  if (!u) return { stage: 'notstarted', waitingFor: '', since: null, you: false };
  if (u.state === 'finished') return { stage: 'done', waitingFor: '', since: u.day || null, you: false };
  if (u.state === 'stuck') { const wf = u.waitingFor || t.waitingFor || ''; return { stage: 'waiting', waitingFor: wf, since: u.day || null, you: waitsForManager(wf) }; }
  return { stage: 'inprogress', waitingFor: '', since: null, you: false };
}

/**
 * The body of an update.save. Every save carries a clientId (online too), so a save whose answer was lost and that
 * then went to the outbox is seen by the server as the same save. The "Finished" after the photos has its own id.
 */
export function updateSaveBody({ taskId, note, state, clientId, day, writtenAt, finish = false, waitingFor = '' }) {
  const b = { taskId, note, state: finish ? 'finished' : state };
  const wf = String(waitingFor || '').replace(/\s+/g, ' ').trim().slice(0, WAIT_FOR_MAX);
  if (b.state === 'stuck' && wf) b.waitingFor = wf; // Stuck: "Waiting for what?" goes with it (only with Stuck)
  if (day) b.day = day;
  if (writtenAt && !finish) { b.writtenAt = writtenAt; b.sentAt = new Date().toISOString(); } // (sentAt: the server puts a wrong phone clock right)
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

/** A project's short description for a list row: one line, cut to `max` letters with … ('' = nothing to show). */
export function aboutShort(text, max = 90) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** The short description of a given project, from its tasks (the first one that has it). */
export function projectAboutOf(tasks) {
  for (const t of tasks || []) if (t && t.projectAbout) return t.projectAbout;
  return '';
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

/** A waiting update the server kept out (a newer update of theirs for that day stays): its words, to copy; null if the same. */
export function olderShow(it, saved) {
  const words = String(it.note || '');
  if (!words.trim() || words === String((saved && saved.note) || '')) return null;
  return { title: 'Not saved: a newer update for that day is already there.', body: `Your words:\n${words}\n\nCopy them if you need them.` };
}

/** The notice that stays: each refused item is added under the earlier ones (a second one never wipes the first). */
export const keptNotice = (list) => (list.length === 1 ? { title: list[0].title, body: list[0].body }
  : { title: `Could not send ${list.length} items.`, body: list.map((x) => `${x.title}\n${x.body}`).join('\n\n———\n\n') });

/** A new notice while the one with words to copy is open: it waits ('hold') until that one is closed. */
export const noticeHow = ({ copyOpen = false, copy = false }) => (copy ? 'add' : copyOpen ? 'hold' : 'show');

/** Ctrl+V of a photo on a task whose update waits on the phone (and is not being changed): refused, it would go nowhere. */
export const pasteWaits = (outbox, taskId, editing) => !editing && (outbox || []).some((x) => (x.kind === 'update' || x.kind === 'photos') && x.taskId === taskId);

/** A photo message went: the box is emptied only if it still holds just the words that went with the photo (more typed since: kept). */
export const msgBoxSent = (boxValue, sentText) => String(sentText || '') !== '' && boxValue === sentText;

/** A message sent (or queued) while the person kept typing: what stays in the box (the words typed after the sent ones). */
export function msgBoxLeft(draft, sentText) {
  const d = String(draft || ''), t = String(sentText || '');
  if (!t || d === t) return '';
  return d.startsWith(t) ? d.slice(t.length).replace(/^\s+/, '') : d;
}

/** An update sent (or queued) while the person kept typing in its box: the words to keep in the box, opened again as a change ('' = just what went). */
export const updateBoxLeft = (draftNote, sentNote) => { const d = String(draftNote || ''); return d.trim() && d !== String(sentNote || '') ? d : ''; };

/** An update Send whose button was redrawn meanwhile: redraw (the new Send button is no longer grey) if the task is still open, on any list. */
export const redrawAfterSend = ({ view = '', sel = '', taskId }) => view === 'today' || sel === 'task:' + taskId;

/** The body of task.save: a new task carries the form's clientId (a second tap after a lost answer gives it once); a change never does. */
export function taskSaveBody(fields, clientId) {
  const b = { ...fields };
  if (!b.id && clientId) b.clientId = clientId;
  return b;
}

/**
 * The clientId of a Give a task: the same task given again after a failed try keeps its id (the server makes it once),
 * even when the form was drawn again in between; anything changed gets a new id. saved: { id, words } or null.
 */
export function giveId(saved, fields, make) {
  const words = JSON.stringify(fields);
  return saved && saved.words === words ? saved : { id: make(), words };
}

/** Words safe to put inside HTML (names, titles and notes are typed by people). */
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MAIL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAIL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mailDate = (day) => `${Number(day.slice(8, 10))} ${MAIL_MONTHS[Number(day.slice(5, 7)) - 1]}`; // '20 Oct'

/**
 * The morning email's order (the email and the People page use this one rule):
 * late first, then stuck, then the rest (projects before tasks, then by title).
 */
export function morningOrder(items) {
  const rank = (x) => (x.lateSince ? 0 : x.stuck ? 1 : 2);
  return [...(items || [])].sort((a, b) => rank(a) - rank(b) || (a.kind === 'project' ? 0 : 1) - (b.kind === 'project' ? 0 : 1)
    || String(a.title || '').localeCompare(String(b.title || '')));
}

/** The summary line: '4 items · 1 late · 1 stuck'. */
export function morningSummary(items) {
  const list = items || [];
  const late = list.filter((x) => x.lateSince).length;
  const stuck = list.filter((x) => x.stuck).length;
  return [`${list.length} item${list.length === 1 ? '' : 's'}`, late ? `${late} late` : '', stuck ? `${stuck} stuck` : ''].filter(Boolean).join(' · ');
}

/** One item's bold title (📁 for a project) and its last update ('21 Oct: note', or '—'). */
export const morningTitle = (x) => (x.kind === 'project' ? '📁 ' : '') + (x.title || '');
export const morningLast = (x) => (x.lastUpdate ? `${mailDate(x.lastUpdate.day)}: ${x.lastUpdate.note || ''}` : '—');
export { mailDate };

/** The time of the last morning-email press, only if it was today: '9:05' (24-hour clock, no leading 0), else ''. */
export function sentTime(sentAt, today) {
  const at = String(sentAt || '');
  if (!today || at.slice(0, 10) !== today || at.length < 16) return '';
  return `${Number(at.slice(11, 13))}:${at.slice(14, 16)}`;
}

/** The People page's tag: 'Sent today 9:05', or 'Not sent yet' (yesterday's press counts as not sent). */
export const sentTag = (sentAt, today) => { const t = sentTime(sentAt, today); return t ? `Sent today ${t}` : 'Not sent yet'; };

/**
 * The manager's morning email to one person: all their pending work in a table they fill in and send back.
 * items: from the server's morning.mail. Returns { subject, html, text }. Inline styles only (Outlook drops <style>).
 * Order: late first, then stuck, then the rest (projects before tasks, then by title).
 */
export function morningMail({ person, manager, items, today }) {
  const list = morningOrder(items);
  const name = (person && person.name) || '';
  const subject = `Your work for ${MAIL_DAYS[weekdayOf(today)]} ${mailDate(today)} – please reply by evening`;
  const summary = morningSummary(list);
  const title = morningTitle;
  const lastText = morningLast;
  const STATUS = 'Done / Going on / Stuck';
  const end = ['Status: keep one of Done / Going on / Stuck.']; // (no 'Any problem…' line and no sign-off: the owner's Outlook template adds them)

  // the HTML (pasted into Outlook)
  const font = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;';
  const cell = 'border:1px solid #bbb;padding:6px 8px;vertical-align:top;text-align:left;';
  const small = (colour, words) => `<div style="color:${colour};font-size:12px;margin-top:2px;">${escHtml(words)}</div>`;
  const rows = list.map((x, i) => '<tr>'
    + `<td style="${cell}">${i + 1}</td>`
    + `<td style="${cell}"><b>${escHtml(title(x))}</b>`
    + (x.kind === 'project' && x.about ? `<div style="color:#666;font-size:13px;margin-top:2px;">${escHtml(x.about)}</div>` : '')
    + (x.lateSince ? small('#c62828', `Late since ${mailDate(x.lateSince)}`) : '')
    + (x.stuck ? small('#e65100', 'Stuck') : '')
    // (no 'Now: step' line: the email shows a project's title and description only)
    + (x.repeat ? small('#666', x.repeat) : '')
    + '</td>'
    + `<td style="${cell}color:#666;">${escHtml(lastText(x))}</td>`
    + `<td style="${cell}min-width:220px;height:40px;">&nbsp;</td>`
    + `<td style="${cell}color:#888;white-space:nowrap;">${STATUS}</td>`
    + '</tr>').join('');
  const head = ['#', 'Work', 'Last update', 'What I did today', 'Status'].map((h) => `<th style="${cell}background:#f2f2f2;font-weight:bold;">${h}</th>`).join('');
  const p = (words, extra = '') => `<p style="margin:0 0 10px 0;${extra}">${words}</p>`;
  const html = `<div style="${font}">`
    + p(`Dear Mr. ${escHtml(name)},`)
    + p(`Good morning.${list.length ? ' Here is your pending work. Please fill the last two columns and reply by evening.' : ''}`)
    + (list.length
      ? `<table style="border-collapse:collapse;${font}" cellpadding="0" cellspacing="0"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
        + `<p style="margin:10px 0 4px 0;">${end[0]}</p>`
      : p('No pending work today.'))
    + '</div>';

  // the plain words (when the phone or browser cannot copy a table)
  const text = [`Dear Mr. ${name},`, '', `Good morning.${list.length ? ' Here is your pending work. Under each item, write what you did today and keep one status, then reply by evening.' : ''}`, ''];
  if (list.length) {
    list.forEach((x, i) => {
      text.push(`${i + 1}. ${title(x)}`);
      if (x.kind === 'project' && x.about) text.push(`   ${x.about}`);
      if (x.lateSince) text.push(`   Late since ${mailDate(x.lateSince)}`);
      if (x.stuck) text.push('   Stuck');
      if (x.repeat) text.push(`   ${x.repeat}`);
      text.push(`   Last update: ${lastText(x)}`, '   What I did today: ', `   Status: ${STATUS}`, '');
    });
    text.push(...end);
  } else text.push('No pending work today.');
  return { subject, html, text: text.join('\n') };
}

/** Days from day a to day b ('YYYY-MM-DD'; b later = more than 0). */
export const daysBetweenDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/**
 * Follow-up: one row's colour, its reason line and how bad it is (0 = worst). r: a row from the server's followup.list
 * ({ dueDate, lastUpdate {day, note}, silentDays (due days gone by with no update, Sundays off for Mon–Sat work), stuck, chasedAt }).
 *  red    — stuck, past its by-date, or silent for 2+ due days
 *  orange — by-date within the next 2 days, or 1 due day with no update
 *  green  — updated today
 *  grey   — nothing to chase yet (on track)
 */
export function followupRule(r, today) {
  const last = r.lastUpdate || null;
  const note = last ? String(last.note || '').trim() : '';
  const lastText = last ? `last: ${last.day === today ? 'today' : mailDate(last.day)}${note ? ' ' + note : ''}` : 'no update yet';
  const silent = Number(r.silentDays) || 0;
  const was = r.dueDate ? `was due ${mailDate(r.dueDate)}` : '';
  const overdue = !!r.dueDate && r.dueDate < today;
  const daysLeft = r.dueDate && !overdue ? daysBetweenDays(today, r.dueDate) : null;
  const sd = (n) => `Silent ${n} day${n === 1 ? '' : 's'}`;
  let colour, reason;
  if (r.stuck) { colour = 'red'; reason = ['Stuck', note || 'no words given', overdue ? was : ''].filter(Boolean).join(' · '); }
  else if (overdue && silent) { colour = 'red'; reason = `${sd(silent)} · ${was}`; }
  else if (overdue) { colour = 'red'; reason = `Overdue · ${was} · ${lastText}`; }
  else if (silent >= 2) { colour = 'red'; reason = `${sd(silent)} · ${lastText}`; }
  else if (daysLeft !== null && daysLeft <= 2) { colour = 'orange'; reason = `${daysLeft === 0 ? 'Due today' : daysLeft === 1 ? 'Due tomorrow' : `Due in ${daysLeft} days`} · ${lastText}`; }
  else if (silent === 1) { colour = 'orange'; reason = `${sd(1)} · ${lastText}`; }
  else if (last && last.day === today) { colour = 'green'; reason = `Updated today${note ? ' · ' + note : ''}`; }
  else { colour = 'grey'; reason = `On track · ${lastText}`; }
  if (r.chasedAt && String(r.chasedAt).slice(0, 10) === today) reason += ` · 🔔 chased ${String(r.chasedAt).slice(11, 16)}`;
  return { colour, reason, rank: { red: 0, orange: 1, grey: 2, green: 3 }[colour] };
}

/** The follow-up rows with their colour and reason, worst first (then the longest silent, the earliest by-date, the title). */
export function followupRows(rows, today) {
  const far = '9999-12-31';
  return (rows || []).map((r) => ({ ...r, ...followupRule(r, today) })).sort((a, b) => a.rank - b.rank
    || (b.stuck ? 1 : 0) - (a.stuck ? 1 : 0) || (b.silentDays || 0) - (a.silentDays || 0)
    || (a.dueDate || far).localeCompare(b.dueDate || far) || String(a.title || '').localeCompare(String(b.title || '')));
}

/** The rows by person (each person's rows in the same order); the person with the worst row first. */
export function followupGroups(sorted) {
  const groups = new Map();
  for (const r of sorted || []) {
    const k = r.person ? r.person.id : 0;
    if (!groups.has(k)) groups.set(k, { person: r.person || { id: 0, name: '' }, rows: [] });
    groups.get(k).rows.push(r);
  }
  return [...groups.values()];
}

/** The top line: "7 given out · 2 silent · 2 due soon" (silent = 2+ due days with no update; due soon = by-date today to 2 days on). */
export function followupSummary(rows, today) {
  const list = rows || [];
  const silent = list.filter((r) => (Number(r.silentDays) || 0) >= 2).length;
  const soon = list.filter((r) => r.dueDate && r.dueDate >= today && daysBetweenDays(today, r.dueDate) <= 2).length;
  return `${list.length} given out · ${silent} silent · ${soon} due soon`;
}

/** The daily follow-up round: what one row is known by (a project once, by its ref). */
export const roundKey = (r) => (r.kind === 'project' ? 'p:' + r.projectRef : 't:' + r.taskId);

/** The round's saved state for today (a new day starts a new round). saved: what this device kept, or nothing. */
export function roundSaved(saved, today) {
  const s = saved && typeof saved === 'object' && saved.day === today ? saved : {};
  return { day: today, seen: Array.isArray(s.seen) ? s.seen.map(String) : [], chased: Number(s.chased) || 0, changed: Number(s.changed) || 0, closed: Number(s.closed) || 0 };
}

/**
 * Where the round is: queue = the rows not looked at yet today (in the order given: worst first),
 * total = every row of the round (rows looked at and then closed count too), pos = this item's number ("Item 3 of 7").
 */
export function roundPlan(sorted, saved, today) {
  const s = roundSaved(saved, today);
  const seen = new Set(s.seen);
  const list = sorted || [];
  const queue = list.filter((r) => !seen.has(roundKey(r)));
  const keys = new Set(list.map(roundKey));
  const gone = s.seen.filter((k) => !keys.has(k)).length; // looked at and since closed or taken back
  const total = list.length + gone;
  return { queue, total, pos: total - queue.length + 1, saved: s };
}

/** One item looked at in the round: what = 'ok' | 'chased' | 'changed' | 'closed'. Returns the new saved state (the old one is not changed). */
export function roundMark(saved, key, what, today) {
  const s = roundSaved(saved, today);
  const out = { ...s, seen: s.seen.includes(key) ? s.seen : [...s.seen, key] };
  if (['chased', 'changed', 'closed'].includes(what)) out[what] = s[what] + 1;
  return out;
}

const QT_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const QT_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const QT_PRE = '(?:\\b(?:by|on|before|till|until|due|this|next|coming)\\s+)?';
const QT_PRE_WORD = /^\s*(?:by|on|before|till|until|due|this|next|coming)\s/i;
/** 'YYYY-MM-DD' for that day, or '' if there is no such day (30 Feb). */
const realDay = (y, m, d) => {
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : '';
};
/** A day and month with no year: this year, or next year if that day has already gone. */
const comingDay = (today, m, d, y) => {
  if (y) return realDay(y < 100 ? 2000 + y : y, m, d);
  const t = realDay(Number(today.slice(0, 4)), m, d);
  return t && t < today ? realDay(Number(today.slice(0, 4)) + 1, m, d) : t;
};
/** The next such weekday after today (today itself never: that is 'today'). */
const nextWeekday = (today, name) => addDay(today, (QT_DAYS.indexOf(name.slice(0, 3).toLowerCase()) - weekdayOf(today) + 7) % 7 || 7);
// the date words, each with the day it means; the first that is found is used (and taken out of the title)
const QT_DATES = [
  [/\b(?:by|on|before|till|until|due)?\s*day after tomorrow\b/i, (m, today) => addDay(today, 2)],
  [/\b(?:by|on|before|till|until|due)?\s*(?:tomorrow|tmrw)\b/i, (m, today) => addDay(today, 1)],
  [/\b(?:by|on|before|till|until|due)?\s*(?:end of )?today\b/i, (m, today) => today],
  [/\b(?:by|before|till|until|due)?\s*next week\b/i, (m, today) => addDay(today, (1 - weekdayOf(today) + 7) % 7 || 7)],
  [/\b(?:by|before|till|until|due)?\s*in (\d{1,2}) days?\b/i, (m, today) => addDay(today, Number(m[1]))],
  [new RegExp(QT_PRE + '\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?(?:\\s+(\\d{4}))?\\b', 'i'),
    (m, today) => comingDay(today, QT_MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]), m[3] ? Number(m[3]) : 0), true],
  [new RegExp(QT_PRE + '\\b(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{4}|\\d{2}))?\\b', 'i'), // dd/mm (India)
    (m, today) => comingDay(today, Number(m[2]), Number(m[1]), m[3] ? Number(m[3]) : 0), true],
  [new RegExp(QT_PRE + '\\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\\b', 'i'), (m, today) => nextWeekday(today, m[1])],
  // short names only after by / on … ("check sun dryer" is not a date)
  [/\b(?:by|on|before|till|until|due|this|next|coming)\s+(sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\b\.?/i, (m, today) => nextWeekday(today, m[1])],
];

/**
 * Hand out work in one line: "Valar: send kiln photos by Friday" → { person {id, name}, title, dueDate, error }.
 * people: the team (only active staff are matched). The name: before ':' (or the first word), whole or a unique start ("val").
 * Date words are taken out of the title; no date = no by-date. error = what to fix ('' when it is fine).
 */
export function parseQuickTask(text, people, today) {
  const out = { person: null, title: '', dueDate: '', error: '' };
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return { ...out, error: "Type the work, like 'Valar: send kiln photos by Friday'." };
  const colon = s.indexOf(':');
  const before = colon > 0 ? s.slice(0, colon).trim() : '';
  let who, rest;
  if (before && before.split(' ').length <= 3 && !/\d/.test(before)) { who = before; rest = s.slice(colon + 1); } // (a time like 10:30 is not a name)
  else { const m = s.match(/^(\S+)\s*(.*)$/); who = m[1]; rest = m[2]; }
  const w = who.toLowerCase().replace(/^@/, '').replace(/[,.;-]+$/, '');
  const staff = (people || []).filter((p) => p && p.name && p.active !== false && p.role !== 'admin');
  const words = (p) => p.name.toLowerCase().split(/\s+/);
  let hits = staff.filter((p) => p.name.toLowerCase() === w);
  if (!hits.length) hits = staff.filter((p) => words(p)[0] === w);
  if (!hits.length && w) hits = staff.filter((p) => p.name.toLowerCase().startsWith(w) || words(p).some((x) => x.startsWith(w)));
  if (hits.length > 1) return { ...out, error: `"${who}" could be ${hits.map((p) => p.name).join(' or ')}. Type more of the name.` };
  if (!hits.length) return { ...out, error: "Who should do it? Start with their name, like 'Valar: …'" };
  out.person = { id: hits[0].id, name: hits[0].name };
  for (const [re, when, num] of QT_DATES) {
    // a date in numbers ("24/10", "2 May") counts after by / on … or at the very end; in the middle it is a
    // quantity or a size ("3/4 inch valve", "2-3 bags", "2 may photos")
    const all = [...rest.matchAll(new RegExp(re.source, 'gi'))].filter((x) => !num || QT_PRE_WORD.test(x[0])
      || !rest.slice(x.index + x[0].length).replace(/[\s.,;:!?)]+/g, ''));
    const m = all[all.length - 1]; // the last one: the date is usually at the end ("Sunday cleaning by Sunday")
    if (!m) continue;
    const day = when(m, today);
    if (!day) return { ...out, error: `That date is not right: "${m[0].trim()}".` };
    out.dueDate = day;
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    break;
  }
  let title = rest.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) title = title.replace(/^[-–,:;.\s]+/, '').replace(/[-–,:;.\s]+$/, '').replace(/\s*\b(?:by|on|before|till|until|due)$/i, '').trim();
  if (!title) return { ...out, error: 'What should they do? Write it after the name.' };
  out.title = title[0].toUpperCase() + title.slice(1);
  return out;
}


/**
 * Settings → 📧 Outlook: the status line. "Connected as name@company.com · last check 10:42 · 3 emails added today",
 * or the last problem in plain words, or how to start.
 */
export function outlookLine(o, today) {
  if (!o) return '';
  const hm = (at) => (at && at.length >= 16 ? `${at.slice(0, 10) === today ? '' : `${at.slice(8, 10)}/${at.slice(5, 7)} `}${at.slice(11, 16)}` : '');
  if (!o.connected) {
    if (o.error) return `Not connected — ${o.error}`;
    return o.clientId && o.secretEnd ? 'Not connected yet — press Connect Outlook.' : 'Not set up yet — fill in the three details from Azure and press Save.';
  }
  const parts = [`Connected as ${o.account || 'your Outlook'}`];
  parts.push(o.lastCheck ? `last check ${hm(o.lastCheck)}` : 'not checked yet');
  parts.push(`${o.addedToday || 0} email${o.addedToday === 1 ? '' : 's'} added today`);
  return parts.join(' · ') + (o.error ? ` — ${o.error}` : '');
}

/**
 * "No paste" morning email: 'draft' = the finished email goes straight into the owner's Outlook Drafts
 * (outlook.compose, never sent); 'paste' = the old way (table copied, the email opens, you paste it).
 * Draft only when Outlook is connected AND the person has an email saved. (Same rule as docs/rules.js emailPath.)
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

/** One app: a team member (signed in, own password chosen) works in the staff view of the projects app. */
export const staffGoes = (u) => !!u && u.role !== 'admin' && !u.mustChange;

/**
 * One app: an old Work Task address (worktask.in/…, an installed app, an old notification or link) → the same place in
 * the one app (worktask.in/projects/…): "#open=<id>" / "#task=<id>" a team task, "#new=…" Give a task, "?team" the team pages.
 */
export function oneAppAddress(search, hash) {
  const n = /^#(?:open|task)=(\d+)$/.exec(hash || '');
  if (n) return 'projects/#team-task=' + n[1];
  if (String(hash || '').startsWith('#new=')) return 'projects/#team-new=' + hash.slice(5);
  if (new URLSearchParams(search || '').has('team')) return 'projects/#team';
  return 'projects/';
}

/**
 * Team today as one table (owner, 23 Oct): every task of today, red first, with its status — sent, stuck, late (a
 * one-time task past its by-date, not sent today) or not yet (red once the fill-by time has passed) — the counts for
 * the strip on top (each a filter), and the rows grouped by person or by 📂 project (the owner's 📂 project, else the
 * work it is a step of, else 📂 Misc). The team's suggestions are rows too (they wait for a yes or no). 20 rows a page
 * (page: 1, 2, …; a person's or project's line comes again on the next page). filter: '' | 'sent' | 'notyet' |
 * 'stuck' | 'late' | 'msg' | 'sugg' | 'you' (stuck, waiting for the manager). Each row has its stage (teamStage). Pure: tested.
 */
export const BOARD_PAGE = 20;
export function teamBoard(d, { filter = '', group = 'person', person = 0, page = 1 } = {}) {
  const today = d.today, RANK = { red: 0, yellow: 1, green: 2 };
  const all = [...(d.tasks || []), ...(d.suggestions || []).filter((s) => !(d.tasks || []).some((t) => t.id === s.id))];
  const rows = all.filter((t) => !person || t.assignee.id === person).map((t, i) => {
    const late = t.status === 'open' && t.repeat === 'once' && !!t.dueDate && t.dueDate < today && !t.today;
    const status = t.status === 'suggested' ? 'sugg' : t.stuck ? 'stuck' : late ? 'late' : t.today ? 'sent' : 'notyet';
    const colour = status === 'sent' ? 'green' : status === 'sugg' || (status === 'notyet' && !d.late) ? 'yellow' : 'red';
    const project = t.folder || t.project || 'Misc';
    const stage = t.status === 'suggested' ? null : teamStage(t); // (a suggestion has no stage yet)
    return { t, status, colour, project, msg: (t.unread || 0) > 0, stage, you: !!(stage && stage.you), i };
  });
  const counts = { sent: 0, notyet: 0, stuck: 0, late: 0, msg: 0, sugg: 0 };
  let you = 0; // waiting for you (stuck, waiting for "Manager"): its own count, beside the others
  for (const r of rows) { counts[r.status]++; if (r.msg) counts.msg++; if (r.you) you++; }
  const shown = rows.filter((r) => !filter || (filter === 'msg' ? r.msg : filter === 'you' ? r.you : r.status === filter))
    .sort((a, b) => RANK[a.colour] - RANK[b.colour] || a.i - b.i);
  const key = (r) => (group === 'project' ? r.project : r.t.assignee.name);
  const groups = new Map();
  for (const r of shown) { if (!groups.has(key(r))) groups.set(key(r), []); groups.get(key(r)).push(r); }
  const list = [...groups].map(([name, rs]) => ({ name, rows: rs, all: rs.filter((r) => r.status !== 'sugg').length, sent: rs.filter((r) => r.status === 'sent').length, person: group === 'person' ? rs[0].t.assignee : null }))
    .sort((a, b) => (group === 'project' && (a.name === 'Misc') - (b.name === 'Misc')) || RANK[a.rows[0].colour] - RANK[b.rows[0].colour] || a.name.localeCompare(b.name));
  // this page's 20 rows, each under its line (the line's "x of y sent" counts the whole group)
  const flat = list.flatMap((g) => g.rows.map((r) => [g, r]));
  const pages = Math.max(1, Math.ceil(flat.length / BOARD_PAGE));
  const at = Math.min(Math.max(1, page | 0), pages);
  const onPage = [];
  for (const [g, r] of flat.slice((at - 1) * BOARD_PAGE, at * BOARD_PAGE)) {
    if (!onPage.length || onPage[onPage.length - 1].name !== g.name) onPage.push({ ...g, rows: [] });
    onPage[onPage.length - 1].rows.push(r);
  }
  return { counts, you, total: rows.length, shown: flat.length, page: at, pages, groups: onPage };
}
