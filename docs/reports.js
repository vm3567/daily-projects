// Pure logic behind search, the Diary, Today's summary and the backup file.
// No screen code here, so it is covered by automatic tests (tests/reports.test.mjs).

import { indiaDate, monthOf, nextStep, personStatus, minutesBetween, fmtMinutes, personSteps, waitingDays, replaceMentions } from './rules.js';

/** Search: project name, notes, steps (text, note, waiting on) and work notes. `q` is lower-case. */
export function projectMatches(p, q) {
  const hay = [p.name, p.notes, ...p.steps.map((s) => `${s.text} ${s.note || ''} ${s.waitingOn || ''}`), ...p.workNotes.map((n) => n.text)]
    .join('\n').toLowerCase();
  return hay.includes(q);
}

const DIARY_WORDS = {
  step_ticked: '✓', paused: 'Paused', unpaused: 'Unpaused', finished: 'Finished', reopened: 'Reopened', reviewed: 'Reviewed — nothing today',
  snoozed: '💤 Snoozed', woke: 'Back from snooze',
};

/**
 * Diary lines grouped by India day: Map(day -> [{ at, projectId, name, text, exists }]), newest first.
 * Work notes come from the projects (so edits and deletes show), and from history only for deleted projects.
 */
export function diaryEntries(data, history) {
  const byDay = new Map();
  const add = (date, line) => { if (!byDay.has(date)) byDay.set(date, []); byDay.get(date).push(line); };
  const exists = new Set(data.projects.map((p) => p.id));
  const nameOf = (e) => {
    const p = data.projects.find((x) => x.id === e.projectId);
    return p ? p.name : `${e.projectName || ''} (deleted project)`;
  };
  const events = Object.values(history).flat();
  for (const e of events) {
    if (!DIARY_WORDS[e.kind]) continue;
    add(indiaDate(e.at), {
      at: e.at, projectId: e.projectId, name: nameOf(e), exists: exists.has(e.projectId),
      text: `${DIARY_WORDS[e.kind]} ${e.kind === 'step_ticked' || e.kind === 'snoozed' ? e.detail : ''}`.trim(),
    });
  }
  for (const p of data.projects) {
    for (const n of p.workNotes) {
      const st = n.stepId && p.steps.find((s) => s.id === n.stepId);
      add(indiaDate(n.createdAt), { at: n.createdAt, projectId: p.id, name: p.name, exists: true, text: `📝 ${n.text}${st ? `  (on: ${st.text})` : ''}` });
    }
  }
  for (const e of events) {
    if (e.kind === 'note_added' && !exists.has(e.projectId)) {
      add(indiaDate(e.at), { at: e.at, projectId: e.projectId, name: nameOf(e), exists: false, text: `📝 ${e.detail}` });
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
      if (indiaDate(n.createdAt) !== today) continue;
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
  const lines = [title, `${doneCount} step${doneCount === 1 ? '' : 's'} done across ${blocks.length} project${blocks.length === 1 ? '' : 's'}.`, '', ...blocks];
  const waiting = (data.people || []).filter((person) => personStatus(data, person, today).waiting > 0);
  if (waiting.length) lines.push('', `⏳ Waiting on: ${waiting.map((x) => x.name).join(', ')}`);
  return lines.join('\n');
}

const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * A message to one person with everything open between you: what you are waiting on from them,
 * and what you need to discuss with them. "@Name" becomes just "Name".
 */
export function personMessageText(data, person, today) {
  const { waiting, discuss } = personSteps(data, person, { openOnly: true });
  const first = person.name.split(/\s+/)[0];
  // The message goes TO this person, so their own "@Name" is taken out; other "@Names" just lose the "@".
  // (matched like the app matches "@names": the longest name wins, so "@Ravi Kumar Sharma" is not cut to "Sharma")
  const plain = (t) => replaceMentions(t, data.people, (who, written) => (who.id === person.id ? ' ' : written))
    .replace(/@(\S)/g, '$1')
    .replace(/\s+(to|with|for|from|by|and|ask|tell)\s*$/i, '') // a word left dangling at the end ("... with")
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .trim();
  const line = ({ step, project }, i, showWait) => {
    const bits = [`${i + 1}. ${plain(step.text)}`, `(${project.name})`];
    if (step.dueDate) bits.push(`— by ${shortDate.format(new Date(step.dueDate + 'T00:00:00Z'))}`);
    if (showWait) { const d = waitingDays(step, today); if (d >= 1) bits.push(`— pending ${d} day${d === 1 ? '' : 's'}`); }
    return bits.join(' ');
  };
  if (!waiting.length && !discuss.length) return `Hi ${first},\n\nNothing is pending between us right now. Thank you!`;
  const lines = [`Hi ${first},`, '', 'Here are the open items between us:'];
  if (waiting.length) lines.push('', 'Waiting on you:', ...waiting.map((it, i) => line(it, i, true)));
  if (discuss.length) lines.push('', 'To discuss:', ...discuss.map((it, i) => line(it, i, false)));
  lines.push('', 'Could you please share an update on these? Thank you.');
  return lines.join('\n');
}

/**
 * Work finished in a group between two India dates, grouped by the project's tag:
 * [{ key, name, items: [{ text, project, day }] }], most items first, "No tag" last.
 */
export function workDoneByTag(data, history, groupId, fromDay, toDay) {
  const g = data.groups.find((x) => x.id === groupId);
  const tags = (g && g.tags) || [];
  const projects = new Map(data.projects.filter((p) => p.groupId === groupId).map((p) => [p.id, p]));
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
