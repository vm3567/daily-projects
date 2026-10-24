// Pure logic behind search, the Diary, Today's summary and the backup file.
// No screen code here, so it is covered by automatic tests (tests/reports.test.mjs).

import { indiaDate, monthOf, nextStep, personStatus, minutesBetween, fmtMinutes, personSteps, waitingDays, replaceMentions, givenProjectsOf, sameTeamName } from './rules.js';

/** Search: project name, notes, steps (text, note, waiting on) and work notes. `q` is lower-case. */
export function projectMatches(p, q) {
  const hay = [p.name, p.notes, ...p.steps.map((s) => `${s.text} ${s.note || ''} ${s.waitingOn || ''}`), ...p.workNotes.map((n) => n.text)]
    .join('\n').toLowerCase();
  return hay.includes(q);
}

const DIARY_WORDS = {
  step_ticked: '✓', paused: 'Paused', unpaused: 'Unpaused', finished: 'Finished', reopened: 'Reopened', reviewed: 'Reviewed — nothing today',
  snoozed: '💤 Snoozed', woke: 'Back from snooze', step_remind: '⏰ Remind me:',
};

/**
 * Diary lines grouped by India day: Map(day -> [{ at, projectId, name, text, exists }]), newest first.
 * Work notes come from the projects (so edits and deletes show), and from history only for deleted projects.
 */
export function diaryEntries(data, history, teamTasks = []) {
  const byDay = new Map();
  const add = (date, line) => { if (!byDay.has(date)) byDay.set(date, []); byDay.get(date).push(line); };
  const exists = new Set(data.projects.map((p) => p.id));
  const nameOf = (e) => {
    const p = data.projects.find((x) => x.id === e.projectId);
    return p ? p.name : `${e.projectName || ''} (deleted task)`;
  };
  const events = Object.values(history).flat();
  for (const e of events) {
    if (!DIARY_WORDS[e.kind]) continue;
    add(indiaDate(e.at), {
      at: e.at, projectId: e.projectId, name: nameOf(e), exists: exists.has(e.projectId),
      text: `${DIARY_WORDS[e.kind]} ${e.kind === 'step_ticked' || e.kind === 'snoozed' || e.kind === 'step_remind' ? e.detail : ''}`.trim(),
    });
  }
  for (const p of data.projects) {
    for (const n of p.workNotes) {
      const st = n.stepId && p.steps.find((s) => s.id === n.stepId);
      add(indiaDate(n.createdAt), { at: n.createdAt, projectId: p.id, name: p.name, exists: true, text: `📝 ${n.text}${st ? `  (on: ${st.text})` : ''}`, ...(n.html ? { html: n.html, onStep: st ? st.text : null } : {}) });
    }
  }
  for (const e of events) {
    if (e.kind === 'note_added' && !exists.has(e.projectId)) {
      add(indiaDate(e.at), { at: e.at, projectId: e.projectId, name: nameOf(e), exists: false, text: `📝 ${e.detail}` });
    }
  }
  // 👥 the team's newest updates on the tasks you gave (today's and the one before, each once) — owner, 24 Oct
  const seen = new Set();
  for (const t of teamTasks || []) {
    for (const u of [t.today, t.last]) {
      if (!u || !u.day || !u.note || seen.has(u.id)) continue;
      seen.add(u.id);
      const p = data.projects.find((x) => x.id === t.projectRef);
      add(u.day, { at: u.at || u.day + 'T12:00:00', projectId: p ? p.id : '', name: p ? p.name : t.project || t.title, exists: !!p, text: `👥 ${(t.assignee && t.assignee.name) || 'Team'}${p && t.title !== p.name ? ` (${t.title})` : ''}: ${u.note}` });
    }
  }
  const sorted = new Map();
  for (const day of [...byDay.keys()].sort().reverse()) sorted.set(day, byDay.get(day).sort((a, b) => (a.at < b.at ? 1 : -1)));
  return sorted;
}

/** The "Download backup" file: all data and history, WITHOUT the AI keys. */
export function backupPayload(data, history, madeAt = new Date().toISOString()) {
  const { secrets, ...dataWithoutKeys } = data;
  return { app: 'daily-projects', madeAt, data: dataWithoutKeys, history };
}

/** Today's summary text: done steps and notes per project, next steps, and who you are waiting on. */
export function summaryText(data, history, today, dateText) {
  const events = (history[monthOf(today)] || []).filter((e) => indiaDate(e.at) === today && e.projectId);
  const byProject = new Map();
  const entry = (pid) => { if (!byProject.has(pid)) byProject.set(pid, { done: [], notes: [] }); return byProject.get(pid); };
  for (const e of events) if (e.kind === 'step_ticked') entry(e.projectId).done.push(e.detail);
  for (const p of data.projects) {
    const mins = minutesBetween(p, today, today, data.timer);
    if (mins > 0) entry(p.id).mins = mins;
    for (const n of p.workNotes) {
      if (indiaDate(n.createdAt) !== today || n.mail || n.app) continue; // (an email reply, or a note from a connected app, is not something you did)
      const st = n.stepId && p.steps.find((s) => s.id === n.stepId);
      entry(p.id).notes.push(st ? `${n.text} (on: ${st.text})` : n.text);
    }
  }
  const title = `Daily update — ${dateText}`;
  let doneCount = 0;
  const blocks = [];
  for (const [pid, x] of byProject) {
    const p = data.projects.find((q) => q.id === pid);
    if (!p || (!x.done.length && !x.notes.length && !x.mins)) continue;
    doneCount += x.done.length;
    const b = [`• ${p.name}${x.mins ? `  (⏱ ${fmtMinutes(x.mins)})` : ''}`];
    for (const d of x.done) b.push(`   ✅ ${d}`);
    for (const n of x.notes) b.push(`   📝 ${n}`);
    const ns = p.state === 'active' && nextStep(p, today, { dueOnly: true });
    if (ns) b.push(`   → Next: ${ns.text}`);
    blocks.push(b.join('\n'));
  }
  if (!blocks.length) return `${title}\n\nNothing recorded yet today.`;
  const lines = [title, `${doneCount} step${doneCount === 1 ? '' : 's'} done across ${blocks.length} task${blocks.length === 1 ? '' : 's'}.`, '', ...blocks];
  const waiting = (data.people || []).filter((person) => personStatus(data, person, today).waiting > 0);
  if (waiting.length) lines.push('', `⏳ Waiting on: ${waiting.map((x) => x.name).join(', ')}`);
  return lines.join('\n');
}

const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A person's own "@Name" taken out of a text that goes TO them; other "@Names" just lose the "@". */
function plainFor(data, person) {
  // (matched like the app matches "@names": the longest name wins, so "@Ravi Kumar Sharma" is not cut to "Sharma")
  return (t) => replaceMentions(t, data.people, (who, written) => (who.id === person.id ? ' ' : written))
    .replace(/@(\S)/g, '$1')
    .replace(/\s+(to|with|for|from|by|and|ask|tell)\s*$/i, '') // a word left dangling at the end ("... with")
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .trim();
}

const MAIL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAIL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-21' -> '21 Oct' */
export const mailDate = (day) => `${Number(String(day).slice(8, 10))} ${MAIL_MONTHS[Number(String(day).slice(5, 7)) - 1]}`;
/** Words safe to put inside HTML (names, steps and notes are typed by people). */
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cut = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };

/** The newest work note on a step (or on the project when the step has none): { day, note }, or null. */
function lastNoteOf(project, stepId = null) {
  const notes = (project.workNotes || []).filter((n) => n && n.text && n.createdAt && !n.mail && !n.app); // real progress: never an email that came in or a note from an app
  const newest = (list) => list.reduce((a, n) => (!a || n.createdAt > a.createdAt ? n : a), null);
  const n = (stepId && newest(notes.filter((x) => x.stepId === stepId))) || newest(notes);
  return n ? { day: indiaDate(n.createdAt), note: n.text } : null;
}

/** Work Task order (same as the morning email): late first, then stuck, then the rest (projects before tasks, then by title). */
export function teamOrder(items) {
  const rank = (x) => (x.lateSince ? 0 : x.stuck ? 1 : 2);
  return [...(items || [])].sort((a, b) => rank(a) - rank(b) || (a.kind === 'project' ? 0 : 1) - (b.kind === 'project' ? 0 : 1)
    || String(a.title || '').localeCompare(String(b.title || '')));
}

/** Steps of a project given to this person (on Work Task) are covered by the project's own row: not listed again. */
function notInGivenProject(person) {
  return ({ project }) => !(project && project.team && sameTeamName(person, project.team.name));
}

/**
 * Every pending row for one person, in the order of the list and the email:
 *  1. Work Task: the server's items (people.morning / morning.mail) when given; else the projects given to them here
 *     ("Give project to…"), in the morning email's order;
 *  2. steps waiting on them; 3. steps to discuss (@name).
 * Row: { group: 'team'|'waiting'|'discuss', kind, title, project, about, now, repeat, lateSince, stuck, waiting, lastUpdate {day, note}|null }
 */
export function pendingRows(data, person, today, serverItems = null) {
  const plain = plainFor(data, person);
  const team = serverItems
    ? (serverItems || []).map((x) => ({ group: 'team', kind: x.kind === 'project' ? 'project' : 'task', title: x.title || '', project: '', about: x.about || '',
      now: x.now || '', repeat: x.repeat || '', lateSince: x.lateSince || null, stuck: !!x.stuck, waiting: '', lastUpdate: x.lastUpdate && x.lastUpdate.day ? x.lastUpdate : null }))
    : givenProjectsOf(data, person).map((p) => {
      const next = nextStep(p, today);
      return { group: 'team', kind: 'project', title: p.name, project: '', about: p.about || '', now: next ? plain(next.text) : '', repeat: '',
        lateSince: p.deadline && p.deadline < today ? p.deadline : null, stuck: false, waiting: '', lastUpdate: lastNoteOf(p) };
    });
  const own = personSteps(data, person, { openOnly: true });
  const waiting = own.waiting.filter(notInGivenProject(person));
  const discuss = own.discuss.filter(notInGivenProject(person));
  const step = (group) => ({ step: s, project: p }) => {
    const lateSince = s.dueDate && s.dueDate < today ? s.dueDate : p.deadline && p.deadline < today ? p.deadline : null;
    let wait = '';
    if (s.waiting) { const d = waitingDays(s, today); wait = `Waiting on ${s.waitingOn || person.name}${d >= 1 ? ` · ${d} day${d === 1 ? '' : 's'}` : ''}`; }
    return { group, kind: 'step', title: plain(s.text), project: p.name, about: '', now: '', repeat: '', lateSince, stuck: false, waiting: wait, lastUpdate: lastNoteOf(p, s.id) };
  };
  return [...teamOrder(team), ...waiting.map(step('waiting')), ...discuss.map(step('discuss'))];
}

/**
 * A message to one person with everything open between you: their Work Task projects and tasks, what you are
 * waiting on from them, and what you need to discuss with them. "@Name" becomes just "Name".
 * serverItems: the Work Task items from the server (null = use the projects given here).
 */
export function personMessageText(data, person, today, serverItems = null) {
  const own = personSteps(data, person, { openOnly: true });
  const waiting = own.waiting.filter(notInGivenProject(person));
  const discuss = own.discuss.filter(notInGivenProject(person));
  const team = pendingRows(data, person, today, serverItems).filter((r) => r.group === 'team');
  const first = person.name.split(/\s+/)[0];
  const plain = plainFor(data, person);
  const line = ({ step, project }, i, showWait) => {
    const bits = [`${i + 1}. ${plain(step.text)}`, `(${project.name})`];
    if (step.dueDate) bits.push(`— by ${shortDate.format(new Date(step.dueDate + 'T00:00:00Z'))}`);
    if (showWait) { const d = waitingDays(step, today); if (d >= 1) bits.push(`— pending ${d} day${d === 1 ? '' : 's'}`); }
    return bits.join(' ');
  };
  const teamLine = (r, i) => [`${i + 1}. ${r.kind === 'project' ? '📁 ' : ''}${r.title}`, '', // (the email shows a project's title and description only, not its steps)
    r.lateSince ? `— late since ${mailDate(r.lateSince)}` : '', r.stuck ? '— stuck' : ''].filter(Boolean).join(' ');
  if (!team.length && !waiting.length && !discuss.length) return `Hi ${first},\n\nNothing is pending between us right now. Thank you!`;
  const lines = [`Hi ${first},`, '', 'Here are the open items between us:'];
  if (team.length) lines.push('', serverItems ? 'Projects and tasks (team):' : 'Projects given:', ...team.map(teamLine));
  if (waiting.length) lines.push('', 'Waiting on you:', ...waiting.map((it, i) => line(it, i, true)));
  if (discuss.length) lines.push('', 'To discuss:', ...discuss.map((it, i) => line(it, i, false)));
  lines.push('', 'Could you please share an update on these? Thank you.');
  return lines.join('\n');
}

/**
 * The pending list as an email table (the same look as the Work Task morning email): { subject, html, text }.
 * Inline styles only (Outlook drops <style>). Columns: # | Work | Last update | What I did today | Status.
 * opts: { items: the server's Work Task items or null, owner: your name for the sign-off ('' = just "Thanks") }.
 */
export function personMessageHtml(data, person, today, opts = {}) {
  const rows = pendingRows(data, person, today, opts.items || null);
  const name = String(person.name || '').split(/\s+/)[0];
  const owner = String(opts.owner || '').trim();
  const weekday = MAIL_DAYS[new Date(today + 'T00:00:00Z').getUTCDay()];
  const subject = `Your work for ${weekday} ${mailDate(today)} – please reply by evening`;
  const late = rows.filter((r) => r.lateSince).length;
  const stuck = rows.filter((r) => r.stuck).length;
  const summary = [`${rows.length} item${rows.length === 1 ? '' : 's'}`, late ? `${late} late` : '', stuck ? `${stuck} stuck` : ''].filter(Boolean).join(' · ');
  const title = (r) => (r.kind === 'project' ? '📁 ' : '') + r.title;
  const last = (r) => (r.lastUpdate ? `${mailDate(r.lastUpdate.day)}: ${cut(r.lastUpdate.note, 80)}` : '—');
  const extras = (r) => [
    r.project ? ['#666', r.project] : null,
    r.about ? ['#666', r.about] : null,
    r.lateSince ? ['#c62828', `Late since ${mailDate(r.lateSince)}`] : null,
    r.stuck ? ['#e65100', 'Stuck'] : null,
    // (no 'Now: step' line: the email shows a project's title and description only)
    r.repeat ? ['#666', r.repeat] : null,
    r.waiting ? ['#666', r.waiting] : null,
  ].filter(Boolean);
  const STATUS = 'Done / Going on / Stuck';
  const end = ['Status: keep one of Done / Going on / Stuck.']; // (no 'Any problem…' line and no sign-off: the owner's Outlook template adds them)
  const dear = `Dear Mr. ${name},`;
  const hello = `Good morning.${rows.length ? ' Here is your pending work. Please fill the last two columns and reply by evening.' : ''}`;

  const font = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;';
  const cell = 'border:1px solid #bbb;padding:6px 8px;vertical-align:top;text-align:left;';
  const small = ([colour, words]) => `<div style="color:${colour};font-size:12px;margin-top:2px;">${escHtml(words)}</div>`;
  const body = rows.map((r, i) => '<tr>'
    + `<td style="${cell}">${i + 1}</td>`
    + `<td style="${cell}"><b>${escHtml(title(r))}</b>${extras(r).map(small).join('')}</td>`
    + `<td style="${cell}color:#666;">${escHtml(last(r))}</td>`
    + `<td style="${cell}min-width:220px;height:40px;">&nbsp;</td>`
    + `<td style="${cell}color:#888;white-space:nowrap;">${STATUS}</td>`
    + '</tr>').join('');
  const head = ['#', 'Work', 'Last update', 'What I did today', 'Status'].map((x) => `<th style="${cell}background:#f2f2f2;font-weight:bold;">${x}</th>`).join('');
  const p = (words, extra = '') => `<p style="margin:0 0 10px 0;${extra}">${words}</p>`;
  const html = `<div style="${font}">`
    + p(escHtml(dear)) + p(escHtml(hello))
    + (rows.length
      ? `<table style="border-collapse:collapse;${font}" cellpadding="0" cellspacing="0"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
        + `<p style="margin:10px 0 4px 0;">${end[0]}</p>`
      : p('No pending work today.'))
    + '</div>';

  const text = [dear, '', hello, ''];
  if (rows.length) {
    rows.forEach((r, i) => {
      text.push(`${i + 1}. ${title(r)}`, ...extras(r).map(([, w]) => `   ${w}`));
      text.push(`   Last update: ${last(r)}`, '   What I did today: ', `   Status: ${STATUS}`, '');
    });
    text.push(...end);
  } else text.push('No pending work today.');
  return { subject, html, text: text.join('\n') };
}

/** The time a pending list was sent, only if that was today (India): '9:05', else ''.
 *  Takes this app's saved time (ISO, UTC) or the Work Task server's ('2026-10-22 09:05:00', already India time). */
export function sentTodayTime(sentAt, today) {
  const s = String(sentAt || '');
  if (!s || !today) return '';
  if (s.includes('T')) {
    const ms = Date.parse(s);
    if (Number.isNaN(ms)) return '';
    const d = new Date(ms + 330 * 60000);
    return d.toISOString().slice(0, 10) === today ? `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}` : '';
  }
  if (s.length < 16 || s.slice(0, 10) !== today) return '';
  return `${Number(s.slice(11, 13))}:${s.slice(14, 16)}`;
}

/** Where a person's "sent today" mark lives: a person with a Work Task account (member = their people.morning entry)
 *  uses the SERVER's time (so it matches the Work Task app); everyone else this app's own mark (person.sentAt). */
export function sentMarkOf(person, member, today) {
  if (member) return { source: 'server', time: sentTodayTime(member.sentAt, today) };
  return { source: 'op', time: sentTodayTime(person && person.sentAt, today) };
}

/** The honest words after a copy: 'html' = the table was copied, 'text' = only plain lines, else nothing. */
export function copyNotice(how) {
  if (how === 'html') return 'Table copied — click in the email and paste (⌘ Cmd+V on Mac, Ctrl+V on Windows), then Send.';
  if (how === 'text') return 'Your browser copied plain lines, not the table — paste them in the email (⌘ Cmd+V on Mac, Ctrl+V on Windows).';
  return 'Could not copy — select the words in the box and copy them.';
}

/**
 * Work finished between two India dates, grouped by the project's tag:
 * [{ key, name, items: [{ text, project, day }] }], most items first, "No tag" last.
 */
export function workDoneByTag(data, history, fromDay, toDay) {
  const tags = data.tags || [];
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const groups = new Map();
  for (const e of Object.values(history).flat()) {
    if (e.kind !== 'step_ticked' || !projects.has(e.projectId)) continue;
    const day = indiaDate(e.at);
    if (day < fromDay || day > toDay) continue;
    const p = projects.get(e.projectId);
    const t = tags.find((x) => x.id === p.tagId);
    const key = t ? t.id : 'none';
    if (!groups.has(key)) groups.set(key, { key, name: t ? t.name : 'No tag', items: [] });
    groups.get(key).items.push({ text: e.detail.replace(/@(\S)/g, '$1'), project: p.name, day, at: e.at });
  }
  for (const grp of groups.values()) grp.items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || (a.key === 'none') - (b.key === 'none') || a.name.localeCompare(b.name));
}

/**
 * "📋 Copy list": just the task names, numbered (owner asked: no other details), to paste into an AI chat or an email.
 * Returns { text, html }.
 */
export function tasksListText(tasks) {
  const names = (tasks || []).map((p) => p.name);
  const text = names.length ? names.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'No tasks.';
  const html = names.length
    ? `<ol style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;margin:0;padding-left:22px;">${names.map((n) => `<li>${escHtml(n)}</li>`).join('')}</ol>`
    : '<p>No tasks.</p>';
  return { text, html };
}
