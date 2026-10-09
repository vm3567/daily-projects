// Pure logic behind search, the Diary, Today's summary and the backup file.
// No screen code here, so it is covered by automatic tests (tests/reports.test.mjs).

import { indiaDate, monthOf, nextStep, personStatus } from './rules.js';

/** Search: project name, notes, steps (text, note, waiting on) and work notes. `q` is lower-case. */
export function projectMatches(p, q) {
  const hay = [p.name, p.notes, ...p.steps.map((s) => `${s.text} ${s.note || ''} ${s.waitingOn || ''}`), ...p.workNotes.map((n) => n.text)]
    .join('\n').toLowerCase();
  return hay.includes(q);
}

const DIARY_WORDS = {
  step_ticked: '✓', paused: 'Paused', unpaused: 'Unpaused', finished: 'Finished', reopened: 'Reopened', reviewed: 'Reviewed — nothing today',
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
      text: `${DIARY_WORDS[e.kind]} ${e.kind === 'step_ticked' ? e.detail : ''}`.trim(),
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
  for (const p of data.projects) for (const n of p.workNotes) if (indiaDate(n.createdAt) === today) entry(p.id).notes.push(n.text);
  const title = `Daily update — ${dateText}`;
  let doneCount = 0;
  const blocks = [];
  for (const [pid, x] of byProject) {
    const p = data.projects.find((q) => q.id === pid);
    if (!p || (!x.done.length && !x.notes.length)) continue;
    doneCount += x.done.length;
    const b = [`• ${p.name}`];
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
