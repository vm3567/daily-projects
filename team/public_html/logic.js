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

/** The notice that stays: each refused item is added under the earlier ones (a second one never wipes the first). */
export const keptNotice = (list) => (list.length === 1 ? { title: list[0].title, body: list[0].body }
  : { title: `Could not send ${list.length} items.`, body: list.map((x) => `${x.title}\n${x.body}`).join('\n\n———\n\n') });

/** A new notice while the one with words to copy is open: it waits ('hold') until that one is closed. */
export const noticeHow = ({ copyOpen = false, copy = false }) => (copy ? 'add' : copyOpen ? 'hold' : 'show');

/** Ctrl+V of a photo on a task whose update waits on the phone (and is not being changed): refused, it would go nowhere. */
export const pasteWaits = (outbox, taskId, editing) => !editing && (outbox || []).some((x) => (x.kind === 'update' || x.kind === 'photos') && x.taskId === taskId);

/** A photo message went: the box is emptied only if it still holds just the words that went with the photo (more typed since: kept). */
export const msgBoxSent = (boxValue, sentText) => String(sentText || '') !== '' && boxValue === sentText;

/** An update Send whose button was redrawn meanwhile: redraw (the new Send button is no longer grey) if the task is still open, on any list. */
export const redrawAfterSend = ({ view = '', sel = '', taskId }) => view === 'today' || sel === 'task:' + taskId;

/** The body of task.save: a new task carries the form's clientId (a second tap after a lost answer gives it once); a change never does. */
export function taskSaveBody(fields, clientId) {
  const b = { ...fields };
  if (!b.id && clientId) b.clientId = clientId;
  return b;
}

/** Words safe to put inside HTML (names, titles and notes are typed by people). */
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MAIL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAIL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mailDate = (day) => `${Number(day.slice(8, 10))} ${MAIL_MONTHS[Number(day.slice(5, 7)) - 1]}`; // '20 Oct'

/**
 * The manager's morning email to one person: all their pending work in a table they fill in and send back.
 * items: from the server's morning.mail. Returns { subject, html, text }. Inline styles only (Outlook drops <style>).
 * Order: late first, then stuck, then the rest (projects before tasks, then by title).
 */
export function morningMail({ person, manager, items, today }) {
  const rank = (x) => (x.lateSince ? 0 : x.stuck ? 1 : 2);
  const list = [...(items || [])].sort((a, b) => rank(a) - rank(b) || (a.kind === 'project' ? 0 : 1) - (b.kind === 'project' ? 0 : 1)
    || String(a.title || '').localeCompare(String(b.title || '')));
  const name = (person && person.name) || '';
  const subject = `Your work for ${MAIL_DAYS[weekdayOf(today)]} ${mailDate(today)} – please reply by evening`;
  const late = list.filter((x) => x.lateSince).length;
  const stuck = list.filter((x) => x.stuck).length;
  const summary = [`${list.length} item${list.length === 1 ? '' : 's'}`, late ? `${late} late` : '', stuck ? `${stuck} stuck` : ''].filter(Boolean).join(' · ');
  const title = (x) => (x.kind === 'project' ? '📁 ' : '') + (x.title || '');
  const lastText = (x) => (x.lastUpdate ? `${mailDate(x.lastUpdate.day)}: ${x.lastUpdate.note || ''}` : '—');
  const STATUS = 'Done / Going on / Stuck';
  const end = ['Status: keep one of Done / Going on / Stuck.', 'Any problem or help needed: write below.'];

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
    + (x.now ? small('#666', `Now: ${x.now}`) : '')
    + (x.repeat ? small('#666', x.repeat) : '')
    + '</td>'
    + `<td style="${cell}color:#666;">${escHtml(lastText(x))}</td>`
    + `<td style="${cell}min-width:220px;height:40px;">&nbsp;</td>`
    + `<td style="${cell}color:#888;white-space:nowrap;">${STATUS}</td>`
    + '</tr>').join('');
  const head = ['#', 'Work', 'Last update', 'What I did today', 'Status'].map((h) => `<th style="${cell}background:#f2f2f2;font-weight:bold;">${h}</th>`).join('');
  const p = (words, extra = '') => `<p style="margin:0 0 10px 0;${extra}">${words}</p>`;
  const html = `<div style="${font}">`
    + p(`Hi ${escHtml(name)}, good morning.${list.length ? ' Here is your pending work. Please fill the last two columns and reply by evening.' : ''}`)
    + (list.length
      ? p(escHtml(summary), 'color:#666;')
        + `<table style="border-collapse:collapse;${font}" cellpadding="0" cellspacing="0"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
        + `<p style="margin:10px 0 4px 0;">${end[0]}</p>` + p(end[1])
      : p('No pending work today.'))
    + p(`Thanks,<br>${escHtml(manager || '')}`)
    + '</div>';

  // the plain words (when the phone or browser cannot copy a table)
  const text = [`Hi ${name}, good morning.${list.length ? ' Here is your pending work. Under each item, write what you did today and keep one status, then reply by evening.' : ''}`, ''];
  if (list.length) {
    text.push(summary, '');
    list.forEach((x, i) => {
      text.push(`${i + 1}. ${title(x)}`);
      if (x.kind === 'project' && x.about) text.push(`   ${x.about}`);
      if (x.lateSince) text.push(`   Late since ${mailDate(x.lateSince)}`);
      if (x.stuck) text.push('   Stuck');
      if (x.now) text.push(`   Now: ${x.now}`);
      if (x.repeat) text.push(`   ${x.repeat}`);
      text.push(`   Last update: ${lastText(x)}`, '   What I did today: ', `   Status: ${STATUS}`, '');
    });
    text.push(...end, '');
  } else text.push('No pending work today.', '');
  text.push('Thanks,', manager || '');
  return { subject, html, text: text.join('\n') };
}
