// Tests for the shared rules and operations. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotColour, indiaDate, addDays, daysBetween, nextStep } from '../docs/rules.js';
import { applyOp, applyOps, emptyData, makeOp, clone, filePath, cleanUrl } from '../docs/ops.js';

const T = (date, time = '10:00:00') => new Date(`${date}T${time}+05:30`).toISOString();
const op = (type, args, date, time) => makeOp(type, args, T(date, time));
const fresh = () => ({ data: emptyData(), history: {} });

function withProject(date = '2026-10-01') {
  const s = fresh();
  applyOp(s, op('createProject', { projectId: 'p1', name: 'Kiln trial', groupId: 'g2' }, date));
  applyOp(s, op('addStep', { projectId: 'p1', stepId: 's1', text: 'Order clay' }, date));
  applyOp(s, op('addStep', { projectId: 'p1', stepId: 's2', text: 'Call supplier' }, date));
  return s;
}

test('India date is used, not UTC', () => {
  // 11:30 PM UTC on 9 Oct is 5 AM on 10 Oct in India
  assert.equal(indiaDate('2026-10-09T23:30:00Z'), '2026-10-10');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(daysBetween('2026-10-01', '2026-10-03'), 2);
});

test('daily dots: red each new day, yellow when opened, green after a change or OK', async () => {
  const { daysWithoutWork } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  const p = s.data.projects[0];
  assert.equal(dotColour(p, '2026-10-01'), 'green'); // created + steps added today
  assert.equal(dotColour(p, '2026-10-02'), 'red', 'resets at midnight');
  applyOp(s, op('markOpened', { projectId: 'p1' }, '2026-10-02'));
  assert.equal(dotColour(p, '2026-10-02'), 'yellow', 'opened');
  assert.equal(applyOp(s, op('markOpened', { projectId: 'p1' }, '2026-10-02', '11:00:00')), false, 'once a day');
  applyOp(s, op('addWorkNote', { projectId: 'p1', noteId: 'n1', text: 'Called Ravi' }, '2026-10-02'));
  assert.equal(dotColour(p, '2026-10-02'), 'green', 'a change');
  assert.equal(dotColour(p, '2026-10-03'), 'red');
  applyOp(s, op('okForToday', { projectId: 'p1' }, '2026-10-03'));
  assert.equal(dotColour(p, '2026-10-03'), 'green', 'OK for today');
  assert.ok(s.history['2026-10'].some((e) => e.kind === 'reviewed'));
  applyOp(s, op('undoOkForToday', { projectId: 'p1' }, '2026-10-03', '11:00:00'));
  assert.equal(dotColour(p, '2026-10-03'), 'yellow', 'undo OK goes back to opened');
  // OK does not count as real work
  applyOp(s, op('okForToday', { projectId: 'p1' }, '2026-10-06'));
  assert.equal(daysWithoutWork(p, '2026-10-06'), 4);
  // a passed target date no longer forces red (it shows as "Overdue" instead)
  applyOp(s, op('setProjectField', { projectId: 'p1', field: 'deadline', value: '2026-10-05' }, '2026-10-07'));
  assert.equal(dotColour(p, '2026-10-07'), 'green');
});

test('old data without lastActivityDate still works (uses lastTickDate)', () => {
  const p = { state: 'active', deadline: null, lastTickDate: '2026-10-05', activeSince: '2026-10-01' };
  assert.equal(dotColour(p, '2026-10-05'), 'green');
  assert.equal(dotColour(p, '2026-10-06'), 'red');
});

test('paused is grey; opening a paused project does not mark it', () => {
  const s = withProject('2026-10-01');
  const p = s.data.projects[0];
  applyOp(s, op('pause', { projectId: 'p1' }, '2026-10-05'));
  assert.equal(dotColour(p, '2026-10-20'), 'grey');
  assert.equal(applyOp(s, op('markOpened', { projectId: 'p1' }, '2026-10-20')), false);
  applyOp(s, op('unpause', { projectId: 'p1' }, '2026-10-20'));
  assert.equal(dotColour(p, '2026-10-20'), 'green', 'unpausing is a change');
});

test('replay on fresh data: both devices\' changes survive, deleted items stay deleted', () => {
  const server = withProject('2026-10-01');
  // device A and B both start from the same data
  const aOps = [op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02')];
  const bOps = [
    op('deleteStep', { projectId: 'p1', stepId: 's2' }, '2026-10-02', '10:01:00'),
    op('addStep', { projectId: 'p1', stepId: 's3', text: 'Fire sample' }, '2026-10-02', '10:02:00'),
  ];
  // B saves first
  applyOps(server, bOps);
  // A clashes, reloads, and replays on top
  const next = clone(server);
  applyOps(next, aOps);
  const p = next.data.projects[0];
  assert.deepEqual(p.steps.map((x) => x.id).sort(), ['s1', 's3']);
  assert.ok(p.steps.find((x) => x.id === 's1').done, 'A\'s tick kept');
  assert.ok(!p.steps.find((x) => x.id === 's2'), 'B\'s delete kept');
  assert.ok(p.steps.find((x) => x.id === 's3'), 'B\'s new step kept');
  // replaying the same ops again changes nothing (no doubled history)
  const before = JSON.stringify(next);
  applyOps(next, aOps);
  assert.equal(JSON.stringify(next), before);
});

test('operation on a deleted item is skipped', () => {
  const s = withProject();
  applyOp(s, op('deleteStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02'));
  assert.equal(applyOp(s, op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02')), false);
});

test('history goes to the month of the operation, never doubled', () => {
  const s = withProject('2026-10-31');
  const o = op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-11-01', '00:30:00');
  applyOp(s, o);
  assert.ok(s.history['2026-11'].some((e) => e.id === o.id));
  assert.equal(s.history['2026-10'].filter((e) => e.kind === 'step_added').length, 2);
});

test('move uses after/before ids', () => {
  const s = fresh();
  for (const id of ['a', 'b', 'c']) applyOp(s, op('createProject', { projectId: id, name: id }, '2026-10-01'));
  // new projects go on top: c, b, a
  assert.deepEqual(s.data.projects.map((p) => p.id), ['c', 'b', 'a']);
  applyOp(s, op('moveProject', { projectId: 'c', afterId: 'a' }, '2026-10-01'));
  assert.deepEqual(s.data.projects.map((p) => p.id), ['b', 'a', 'c']);
  applyOp(s, op('moveProject', { projectId: 'c', beforeId: 'b' }, '2026-10-01'));
  assert.deepEqual(s.data.projects.map((p) => p.id), ['c', 'b', 'a']);
});

test('groups: cannot delete a group in use', () => {
  const s = withProject();
  assert.equal(applyOp(s, op('deleteGroup', { groupId: 'g2' }, '2026-10-02')), false);
  assert.equal(applyOp(s, op('deleteGroup', { groupId: 'g3' }, '2026-10-02')), true);
  const ev = s.history['2026-10'].find((e) => e.kind === 'group_deleted');
  assert.equal(ev.projectId, null);
});

test('links: only http and https', () => {
  assert.equal(cleanUrl('javascript:alert(1)'), null);
  assert.equal(cleanUrl('https://example.com/a'), 'https://example.com/a');
  const s = withProject();
  assert.equal(applyOp(s, op('addLink', { projectId: 'p1', linkId: 'l1', title: 'x', url: 'javascript:alert(1)' }, '2026-10-02')), false);
});

test('AI daily limit and brief claims', () => {
  const s = fresh();
  for (let i = 0; i < 50; i++) assert.equal(applyOp(s, op('incrementAiUsage', {}, '2026-10-02')), true);
  assert.equal(applyOp(s, op('incrementAiUsage', {}, '2026-10-02')), false);
  assert.equal(applyOp(s, op('incrementAiUsage', {}, '2026-10-03')), true); // new day
  const c1 = op('claimBrief', { kind: 'morning', date: '2026-10-03' }, '2026-10-03', '09:00:00');
  const c2 = op('claimBrief', { kind: 'morning', date: '2026-10-03' }, '2026-10-03', '09:01:00');
  assert.equal(applyOp(s, c1), true);
  assert.equal(applyOp(s, c2), false, 'fresh claim by another device wins');
  const c3 = op('claimBrief', { kind: 'morning', date: '2026-10-03' }, '2026-10-03', '09:07:00');
  assert.equal(applyOp(s, c3), true, 'stale claim (over 5 min) can be taken over');
  applyOp(s, op('setBriefReady', { kind: 'morning', date: '2026-10-03', content: { items: [] } }, '2026-10-03', '09:08:00'));
  assert.equal(applyOp(s, op('claimBrief', { kind: 'morning', date: '2026-10-03' }, '2026-10-03', '10:00:00')), false, 'ready brief is kept');
  assert.equal(applyOp(s, op('claimBrief', { kind: 'morning', date: '2026-10-03', force: true }, '2026-10-03', '10:00:00')), true, 'Make again');
});

test('files: path has file id and safe name; delete project keeps history', () => {
  assert.equal(filePath('p1', 'f1', 'My report (v2).pdf'), 'files/p1/f1-My_report_v2_.pdf');
  const s = withProject();
  applyOp(s, op('addFile', { projectId: 'p1', fileId: 'f1', name: 'a.png', sha: 'abc', size: 10, type: 'image/png' }, '2026-10-02'));
  applyOp(s, op('finish', { projectId: 'p1' }, '2026-10-02'));
  applyOp(s, op('deleteProject', { projectId: 'p1' }, '2026-10-02'));
  assert.equal(s.data.projects.length, 0);
  assert.ok(s.history['2026-10'].some((e) => e.kind === 'deleted' && e.projectName === 'Kiln trial'));
});

test('new projects get a target date 30 days ahead (India date)', () => {
  const s = fresh();
  applyOp(s, op('createProject', { projectId: 'p1', name: 'A' }, '2026-10-09'));
  assert.equal(s.data.projects[0].deadline, '2026-11-08');
  applyOp(s, op('createProject', { projectId: 'p2', name: 'B', deadline: null }, '2026-10-09'));
  assert.equal(s.data.projects[0].deadline, null, 'an explicit "no date" is kept');
});

test('people: @mentions link to the longest matching name', async () => {
  const { mentionedPeople, stepLinkedTo } = await import('../docs/rules.js');
  const people = [{ id: 'a', name: 'Ravi' }, { id: 'b', name: 'Ravi Kumar' }, { id: 'c', name: 'Sandeep' }];
  assert.deepEqual([...mentionedPeople('Ask @Ravi Kumar for price', people)], ['b']);
  assert.deepEqual([...mentionedPeople('Call @ravi today', people)], ['a']);
  assert.deepEqual([...mentionedPeople('Mail @Sandeep and @Ravi', people)].sort(), ['a', 'c']);
  assert.equal(mentionedPeople('email me@Ravish.com', people).size, 0);
  assert.ok(stepLinkedTo({ text: 'Quote', waitingOn: 'sandeep', note: '' }, people[2], people));
});

test('people: add, rename keeps links, delete', () => {
  const s = withProject();
  applyOp(s, op('addPerson', { personId: 'r', name: 'Ravi' }, '2026-10-02'));
  assert.equal(applyOp(s, op('addPerson', { personId: 'x', name: 'ravi' }, '2026-10-02')), false, 'no duplicates');
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's2', field: 'text', value: 'Call @Ravi for frit' }, '2026-10-02'));
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's2', field: 'waitingOn', value: 'Ravi' }, '2026-10-02'));
  applyOp(s, op('renamePerson', { personId: 'r', name: 'Ravi Kumar' }, '2026-10-03'));
  const st = s.data.projects[0].steps.find((x) => x.id === 's2');
  assert.equal(st.text, 'Call @Ravi Kumar for frit');
  assert.equal(st.waitingOn, 'Ravi Kumar');
  applyOp(s, op('deletePerson', { personId: 'r' }, '2026-10-03'));
  assert.equal(s.data.people.length, 0);
});

test('people follow-up colours: waiting 2+ days is red, discuss is orange, nothing open is green', async () => {
  const { personStatus, waitingDays } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  applyOp(s, op('addPerson', { personId: 'r', name: 'Ravi' }, '2026-10-01'));
  applyOp(s, op('addPerson', { personId: 'm', name: 'Meena' }, '2026-10-01'));
  const ravi = s.data.people.find((x) => x.id === 'r');
  const meena = s.data.people.find((x) => x.id === 'm');
  assert.equal(personStatus(s.data, ravi, '2026-10-01').colour, 'green');
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's1', field: 'text', value: 'Tell @Meena the size' }, '2026-10-01'));
  assert.equal(personStatus(s.data, meena, '2026-10-09').colour, 'orange', 'discuss stays orange');
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's2', field: 'waiting', value: true }, '2026-10-01'));
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's2', field: 'waitingOn', value: 'Ravi' }, '2026-10-01'));
  const step = s.data.projects[0].steps.find((x) => x.id === 's2');
  assert.equal(waitingDays(step, '2026-10-02'), 1);
  assert.equal(personStatus(s.data, ravi, '2026-10-02').colour, 'orange');
  assert.equal(personStatus(s.data, ravi, '2026-10-03').colour, 'red', '2 days waiting = chase');
  applyOp(s, op('tickStep', { projectId: 'p1', stepId: 's2' }, '2026-10-03'));
  assert.equal(personStatus(s.data, ravi, '2026-10-03').colour, 'green', 'done = green');
});

test('rename does not touch a longer name of someone else, and keeps "$" as typed', () => {
  const s = withProject();
  applyOp(s, op('addPerson', { personId: 'r', name: 'Ravi' }, '2026-10-02'));
  applyOp(s, op('addPerson', { personId: 'k', name: 'Ravi Kumar' }, '2026-10-02'));
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's1', field: 'text', value: 'Ask @Ravi Kumar and @Ravi' }, '2026-10-02'));
  applyOp(s, op('renamePerson', { personId: 'r', name: 'Ravindra' }, '2026-10-03'));
  assert.equal(s.data.projects[0].steps.find((x) => x.id === 's1').text, 'Ask @Ravi Kumar and @Ravindra');
  applyOp(s, op('renamePerson', { personId: 'r', name: 'Mr $1 Ravi' }, '2026-10-03'));
  assert.equal(s.data.projects[0].steps.find((x) => x.id === 's1').text, 'Ask @Ravi Kumar and @Mr $1 Ravi');
});

test('chased: note, restarts waiting count, green, once a day', async () => {
  const { waitingDays } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's2', field: 'waiting', value: true }, '2026-10-01'));
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's2', field: 'waitingOn', value: 'Ravi' }, '2026-10-01'));
  const p = s.data.projects[0];
  const st = p.steps.find((x) => x.id === 's2');
  assert.equal(waitingDays(st, '2026-10-04'), 3);
  assert.equal(dotColour(p, '2026-10-04'), 'red');
  assert.equal(applyOp(s, op('chased', { projectId: 'p1', stepId: 's2' }, '2026-10-04')), true);
  assert.equal(waitingDays(st, '2026-10-04'), 0);
  assert.equal(dotColour(p, '2026-10-04'), 'green');
  assert.match(p.workNotes[0].text, /Followed up with @Ravi/);
  assert.equal(applyOp(s, op('chased', { projectId: 'p1', stepId: 's2' }, '2026-10-04', '15:00:00')), false);
});

test('repeating steps come back on the next date', async () => {
  const { nextRepeatDate } = await import('../docs/rules.js');
  assert.equal(nextRepeatDate('daily', null, '2026-10-09'), '2026-10-10');
  assert.equal(nextRepeatDate('weekly', '2026-10-05', '2026-10-09'), '2026-10-12', 'keeps the weekday (Monday)');
  assert.equal(nextRepeatDate('monthly', '2026-01-31', '2026-02-01'), '2026-02-28', 'short month');
  const s = withProject('2026-10-01');
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's1', field: 'repeat', value: 'weekly' }, '2026-10-01'));
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's1', field: 'dueDate', value: '2026-10-05' }, '2026-10-01'));
  const t = op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-05');
  applyOp(s, t);
  const p = s.data.projects[0];
  const copy = p.steps.find((x) => x.id === t.id + 'r');
  assert.equal(copy.dueDate, '2026-10-12');
  assert.equal(nextStep(p, '2026-10-06').id, 's2', 'the copy waits; the other step is next');
  applyOp(s, t); // replay: no second copy
  assert.equal(p.steps.filter((x) => x.text === 'Order clay' && !x.done).length, 1);
});

test('undo puts the project back and removes the history line', () => {
  const s = withProject('2026-10-01');
  const before = clone(s.data.projects[0]);
  const t = op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02');
  applyOp(s, t);
  applyOp(s, op('restoreProject', { project: before, undoOpId: t.id }, '2026-10-02', '10:01:00'));
  assert.equal(s.data.projects[0].steps[0].done, false);
  assert.equal(dotColour(s.data.projects[0], '2026-10-02'), 'red');
  assert.ok(!s.history['2026-10'].some((e) => e.id === t.id));
  // undo a delete puts it back at its place
  const snap = clone(s.data.projects[0]);
  applyOp(s, op('finish', { projectId: 'p1' }, '2026-10-02'));
  applyOp(s, op('deleteProject', { projectId: 'p1' }, '2026-10-02'));
  applyOp(s, op('restoreProject', { project: snap, index: 0 }, '2026-10-02'));
  assert.equal(s.data.projects[0].id, 'p1');
});

test('day score and streak', async () => {
  const { dayScore, greenStreak } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  applyOp(s, op('createProject', { projectId: 'p2', name: 'B' }, '2026-10-01'));
  applyOp(s, op('addWorkNote', { projectId: 'p1', noteId: 'n', text: 'x' }, '2026-10-02'));
  assert.deepEqual(dayScore(s.data, s.history, '2026-10-02'), { green: 1, total: 2 });
  applyOp(s, op('okForToday', { projectId: 'p2' }, '2026-10-02'));
  assert.deepEqual(dayScore(s.data, s.history, '2026-10-02'), { green: 2, total: 2 });
  const scores = { '2026-10-07': { green: 2, total: 2 }, '2026-10-08': { green: 3, total: 3 }, '2026-10-06': { green: 1, total: 3 } };
  assert.equal(greenStreak(scores, { green: 1, total: 3 }, '2026-10-09'), 2);
  assert.equal(greenStreak(scores, { green: 3, total: 3 }, '2026-10-09'), 3);
});

test('repeat fixes: early tick moves on, untick removes the copy, date change follows', async () => {
  const { nextRepeatDate } = await import('../docs/rules.js');
  assert.equal(nextRepeatDate('weekly', '2026-10-09', '2026-10-05'), '2026-10-16', 'ticked early: next week, not the same Friday');
  const s = withProject('2026-10-01');
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's1', field: 'repeat', value: 'daily' }, '2026-10-01'));
  applyOp(s, op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02'));
  const p = s.data.projects[0];
  assert.equal(p.steps.filter((x) => x.text === 'Order clay' && !x.done).length, 1);
  assert.equal(nextStep(p, '2026-10-02', { dueOnly: true }).id, 's2');
  const copy = p.steps.find((x) => x.text === 'Order clay' && !x.done);
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: copy.id, field: 'repeat', value: null }, '2026-10-02'));
  assert.equal(copy.snoozedUntil, null, 'no repeat = show it now');
  applyOp(s, op('untickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02', '11:00:00'));
  assert.equal(p.steps.filter((x) => x.text === 'Order clay').length, 1, 'copy removed on untick');
});

test('undo OK removes the Reviewed line', () => {
  const s = withProject('2026-10-01');
  const ok = op('okForToday', { projectId: 'p1' }, '2026-10-02');
  applyOp(s, ok);
  applyOp(s, op('undoOkForToday', { projectId: 'p1' }, '2026-10-02', '10:05:00'));
  assert.ok(!s.history['2026-10'].some((e) => e.id === ok.id));
});

test("today's update: note linked to the step, tick, next step, one undo for all", () => {
  const s = withProject('2026-10-01');
  const before = clone(s.data.projects[0]);
  const a = op('addWorkNote', { projectId: 'p1', noteId: 'n1', text: 'Called supplier', stepId: 's1' }, '2026-10-02');
  const b = op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02', '10:00:01');
  const c = op('addStep', { projectId: 'p1', stepId: 's9', text: 'Order frit' }, '2026-10-02', '10:00:02');
  applyOps(s, [a, b, c]);
  const p = s.data.projects[0];
  assert.equal(p.workNotes[0].stepId, 's1');
  assert.ok(p.steps.find((x) => x.id === 's1').done);
  applyOp(s, op('restoreProject', { project: before, undoOpIds: [a.id, b.id, c.id] }, '2026-10-02', '10:01:00'));
  assert.equal(s.data.projects[0].workNotes.length, 0);
  assert.ok(![a.id, b.id, c.id].some((id) => s.history['2026-10'].some((e) => e.id === id)), 'all three history lines removed');
  // a note for a step that no longer exists is kept, without the link
  applyOp(s, op('addWorkNote', { projectId: 'p1', noteId: 'n2', text: 'x', stepId: 'gone' }, '2026-10-02'));
  assert.equal(s.data.projects[0].workNotes[0].stepId, null);
});

test('un-tick removes the "✓ step" line, so nothing counts a step that is not done', () => {
  const s = withProject('2026-10-01');
  applyOp(s, op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02'));
  applyOp(s, op('untickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02', '10:05:00'));
  applyOp(s, op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02', '10:10:00'));
  const ticks = s.history['2026-10'].filter((e) => e.kind === 'step_ticked');
  assert.equal(ticks.length, 1, 'tick, untick, tick again = counted once');
  assert.equal(ticks[0].stepId, 's1');
});

test('a repeating step keeps only its latest finished copy (data stays small)', () => {
  const s = withProject('2026-10-01');
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's1', field: 'repeat', value: 'daily' }, '2026-10-01'));
  for (let d = 2; d <= 9; d++) {
    const p = s.data.projects[0];
    const open = p.steps.find((x) => !x.done && x.text === 'Order clay');
    applyOp(s, op('tickStep', { projectId: 'p1', stepId: open.id }, `2026-10-0${d}`));
  }
  const p = s.data.projects[0];
  assert.equal(p.steps.filter((x) => x.text === 'Order clay' && x.done).length, 1);
  assert.equal(p.steps.filter((x) => x.text === 'Order clay' && !x.done).length, 1);
  assert.equal(s.history['2026-10'].filter((e) => e.kind === 'step_ticked').length, 8, 'the Diary keeps every day');
});

test('@name matching follows people added or renamed later', async () => {
  const { mentionedPeople } = await import('../docs/rules.js');
  const people = [{ id: 'a', name: 'Ravi' }];
  assert.equal(mentionedPeople('@Meena hi', people).size, 0);
  people.push({ id: 'b', name: 'Meena' });
  assert.deepEqual([...mentionedPeople('@Meena hi', people)], ['b']);
  people[0].name = 'Ravi Kumar';
  assert.deepEqual([...mentionedPeople('ask @Ravi Kumar', people)], ['a']);
});

test('time log: start, stop, switching projects, 10-hour cut, manual time, totals', async () => {
  const { minutesBetween, fmtMinutes, weekStart } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  applyOp(s, op('setProjectField', { projectId: 'p1', field: 'groupId', value: 'g1' }, '2026-10-01')); // Acton has the timer
  applyOp(s, op('createProject', { projectId: 'p2', name: 'B' }, '2026-10-01'));
  applyOp(s, op('startTimer', { projectId: 'p1' }, '2026-10-05', '09:00:00'));
  assert.equal(applyOp(s, op('startTimer', { projectId: 'p1' }, '2026-10-05', '09:10:00')), false, 'already running');
  applyOp(s, op('startTimer', { projectId: 'p2' }, '2026-10-05', '09:45:00')); // stops p1 first
  applyOp(s, op('stopTimer', {}, '2026-10-05', '10:15:00'));
  const p1 = s.data.projects.find((p) => p.id === 'p1');
  const p2 = s.data.projects.find((p) => p.id === 'p2');
  assert.equal(p1.timeLogs[0].minutes, 45);
  assert.equal(p2.timeLogs[0].minutes, 30);
  assert.equal(s.data.timer, null);
  // forgotten timer is cut to 10 hours
  applyOp(s, op('startTimer', { projectId: 'p1' }, '2026-10-06', '08:00:00'));
  applyOp(s, op('stopTimer', {}, '2026-10-07', '08:00:00'));
  assert.equal(p1.timeLogs[1].minutes, 600);
  assert.ok(p1.timeLogs[1].capped);
  // manual time
  applyOp(s, op('addTime', { projectId: 'p1', minutes: 90 }, '2026-10-07', '18:00:00'));
  assert.equal(minutesBetween(p1, '2026-10-05', '2026-10-05'), 45);
  assert.equal(minutesBetween(p1, '2026-10-01', '2026-10-31'), 45 + 600 + 90);
  assert.equal(fmtMinutes(135), '2h 15m');
  assert.equal(fmtMinutes(45), '45m');
  assert.equal(weekStart('2026-10-09'), '2026-10-05', 'Friday 9 Oct is in the week of Monday 5 Oct');
  // pausing a project stops its timer
  applyOp(s, op('startTimer', { projectId: 'p2' }, '2026-10-08', '09:00:00'));
  applyOp(s, op('pause', { projectId: 'p2' }, '2026-10-08', '09:20:00'));
  assert.equal(s.data.timer, null);
  assert.equal(p2.timeLogs[1].minutes, 20);
  // remove an entry
  applyOp(s, op('removeTime', { projectId: 'p1', logId: p1.timeLogs[2].id }, '2026-10-08'));
  assert.equal(p1.timeLogs.length, 2);
});

test('tags per group, one tag per project, timer only in timer groups, time split by tag', async () => {
  const { timeSplit, percents } = await import('../docs/rules.js');
  const s = { data: emptyData(), history: {} };
  const [acton, personal] = [s.data.groups[0], s.data.groups[1]]; // Acton, Personal
  applyOps(s, [
    op('addTag', { groupId: acton.id, tagId: 'kiln', name: 'Kiln' }, '2026-10-05'),
    op('addTag', { groupId: acton.id, tagId: 'glaze', name: 'Glaze' }, '2026-10-05'),
    op('createProject', { projectId: 'a1', name: 'Electric kiln', groupId: acton.id }, '2026-10-05'),
    op('createProject', { projectId: 'a2', name: 'New glaze', groupId: acton.id }, '2026-10-05'),
    op('createProject', { projectId: 'a3', name: 'Misc', groupId: acton.id }, '2026-10-05'),
    op('createProject', { projectId: 'h1', name: 'Home', groupId: personal.id }, '2026-10-05'),
    op('setProjectField', { projectId: 'a1', field: 'tagId', value: 'kiln' }, '2026-10-05'),
    op('setProjectField', { projectId: 'a2', field: 'tagId', value: 'glaze' }, '2026-10-05'),
  ]);
  assert.equal(applyOp(s, op('setProjectField', { projectId: 'h1', field: 'tagId', value: 'kiln' }, '2026-10-05')), false, 'tag from another group refused');
  assert.equal(applyOp(s, op('addTag', { groupId: acton.id, tagId: 'x', name: 'kiln' }, '2026-10-05')), false, 'no duplicate names');
  assert.equal(applyOp(s, op('startTimer', { projectId: 'h1' }, '2026-10-05')), false, 'Personal has no timer');
  applyOps(s, [
    op('addTime', { projectId: 'a1', minutes: 120 }, '2026-10-06'),
    op('addTime', { projectId: 'a2', minutes: 60 }, '2026-10-06'),
    op('addTime', { projectId: 'a3', minutes: 60 }, '2026-10-07'),
    op('addTime', { projectId: 'a1', minutes: 60 }, '2026-09-20'), // outside the range
  ]);
  const byTag = timeSplit(s.data, acton.id, '2026-10-01', '2026-10-31');
  assert.deepEqual(byTag.map((r) => [r.name, r.minutes]), [['Kiln', 120], ['Glaze', 60], ['No tag', 60]]);
  assert.deepEqual(percents(byTag), [50, 25, 25]);
  assert.equal(percents([{ minutes: 1 }, { minutes: 1 }, { minutes: 1 }]).reduce((a, b) => a + b, 0), 100, 'always adds up to 100');
  assert.equal(timeSplit(s.data, acton.id, '2026-10-01', '2026-10-31', 'project')[0].name, 'Electric kiln');
  // moving a project to another group clears its tag; deleting a tag leaves projects untagged
  applyOp(s, op('setProjectField', { projectId: 'a2', field: 'groupId', value: personal.id }, '2026-10-08'));
  assert.equal(s.data.projects.find((p) => p.id === 'a2').tagId, null);
  applyOp(s, op('deleteTag', { groupId: acton.id, tagId: 'kiln' }, '2026-10-08'));
  assert.equal(s.data.projects.find((p) => p.id === 'a1').tagId, null);
  applyOp(s, op('setGroupTimer', { groupId: personal.id, on: true }, '2026-10-08'));
  assert.equal(applyOp(s, op('startTimer', { projectId: 'h1' }, '2026-10-08')), true, 'switched on in Settings');
});

test('snooze: hidden for N days (grey, not counted), back by itself, wake early', async () => {
  const { isSnoozed, colourCounts, dayScore } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  assert.equal(applyOp(s, op('snooze', { projectId: 'p1', days: 0 }, '2026-10-05')), false, 'needs at least 1 day');
  assert.ok(applyOp(s, op('snooze', { projectId: 'p1', days: 5 }, '2026-10-05')));
  const p = s.data.projects[0];
  assert.equal(p.snoozedUntil, '2026-10-10');
  assert.equal(p.lastActivityDate, '2026-10-01', 'snoozing is not work');
  assert.ok(isSnoozed(p, '2026-10-09'));
  assert.equal(dotColour(p, '2026-10-09'), 'grey');
  assert.deepEqual(colourCounts(s.data, '2026-10-09'), { green: 0, yellow: 0, red: 0 });
  assert.equal(dayScore(s.data, s.history, '2026-10-07').total, 0, 'a snoozed day does not break the streak');
  assert.ok(!isSnoozed(p, '2026-10-10'), 'back on the return day');
  assert.equal(dotColour(p, '2026-10-10'), 'red');
  assert.ok(applyOp(s, op('wake', { projectId: 'p1' }, '2026-10-06')));
  assert.ok(!isSnoozed(p, '2026-10-06'));
  assert.equal(applyOp(s, op('wake', { projectId: 'p1' }, '2026-10-06')), false, 'already awake');
});

test('status line: one short line with its date', () => {
  const s = withProject('2026-10-01');
  assert.ok(applyOp(s, op('setProjectField', { projectId: 'p1', field: 'status', value: '  Waiting for   mould\n from Ravi ' }, '2026-10-03')));
  const p = s.data.projects[0];
  assert.equal(p.status, 'Waiting for mould from Ravi');
  assert.equal(indiaDate(p.statusAt), '2026-10-03');
});

test('inbox: capture, turn into a step or a new project, delete', () => {
  const s = withProject('2026-10-01');
  assert.ok(applyOp(s, op('addInbox', { itemId: 'i1', text: 'Ask Sandeep about kiln quote' }, '2026-10-02')));
  assert.ok(applyOp(s, op('addInbox', { itemId: 'i2', text: 'Video on pinholes' }, '2026-10-02')));
  assert.ok(applyOp(s, op('addInbox', { itemId: 'i3', text: 'junk' }, '2026-10-02')));
  assert.equal(applyOp(s, op('addInbox', { itemId: 'i4', text: '   ' }, '2026-10-02')), false);
  assert.ok(applyOp(s, op('inboxToStep', { itemId: 'i1', projectId: 'p1', stepId: 'sx' }, '2026-10-03')));
  assert.ok(s.data.projects[0].steps.some((x) => x.id === 'sx' && x.text === 'Ask Sandeep about kiln quote'));
  assert.ok(applyOp(s, op('inboxToProject', { itemId: 'i2', projectId: 'pn', groupId: 'g1' }, '2026-10-03')));
  assert.equal(s.data.projects.find((x) => x.id === 'pn').name, 'Video on pinholes');
  assert.equal(applyOp(s, op('inboxToStep', { itemId: 'i3', projectId: 'nope', stepId: 'sy' }, '2026-10-03')), false, 'item kept if the project is gone');
  assert.ok(applyOp(s, op('removeInbox', { itemId: 'i3' }, '2026-10-03')));
  assert.deepEqual(s.data.inbox, []);
});
