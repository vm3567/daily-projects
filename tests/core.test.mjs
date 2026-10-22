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

test('daily dots: red each new day, yellow when opened, green only after a real update', async () => {
  const { daysWithoutWork, greenByTeamOnly } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  const p = s.data.projects[0];
  assert.notEqual(dotColour(p, '2026-10-01'), 'green', 'creating a project and adding steps is not an update');
  assert.equal(dotColour(p, '2026-10-02'), 'red', 'resets at midnight');
  applyOp(s, op('markOpened', { projectId: 'p1' }, '2026-10-02'));
  assert.equal(dotColour(p, '2026-10-02'), 'yellow', 'opened');
  assert.equal(applyOp(s, op('markOpened', { projectId: 'p1' }, '2026-10-02', '11:00:00')), false, 'once a day');
  applyOp(s, op('setProjectField', { projectId: 'p1', field: 'priority', value: 'high' }, '2026-10-02'));
  applyOp(s, op('addStep', { projectId: 'p1', stepId: 's9', text: 'More' }, '2026-10-02'));
  assert.equal(dotColour(p, '2026-10-02'), 'yellow', 'edits are not an update');
  applyOp(s, op('addWorkNote', { projectId: 'p1', noteId: 'n1', text: 'Called Ravi' }, '2026-10-02'));
  assert.equal(dotColour(p, '2026-10-02'), 'green', 'a written update');
  applyOp(s, op('deleteWorkNote', { projectId: 'p1', noteId: 'n1' }, '2026-10-02', '12:00:00'));
  assert.equal(dotColour(p, '2026-10-02'), 'yellow', 'deleting the only update takes the green away');
  applyOp(s, op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-03'));
  assert.equal(dotColour(p, '2026-10-03'), 'green', 'a ticked step');
  applyOp(s, op('addTime', { projectId: 'p1', minutes: 30 }, '2026-10-04'));
  assert.equal(dotColour(p, '2026-10-04'), 'green', 'time worked today');
  applyOp(s, op('okForToday', { projectId: 'p1' }, '2026-10-05')); // old changes from before still replay…
  assert.notEqual(dotColour(p, '2026-10-05'), 'green', '…but "OK for today" no longer makes it green');
  assert.ok(applyOp(s, op('teamWorked', { projectId: 'p1', day: '2026-10-06' }, '2026-10-06')));
  assert.equal(dotColour(p, '2026-10-06'), 'green', 'the team sent an update');
  assert.ok(greenByTeamOnly(p, '2026-10-06'), 'shown with 👥');
  assert.equal(applyOp(s, op('teamWorked', { projectId: 'p1', day: '2026-10-06' }, '2026-10-06', '12:00:00')), false, 'once a day');
  assert.equal(applyOp(s, op('teamWorked', { projectId: 'p1', day: '2026-10-09' }, '2026-10-06')), false, 'never a future day');
  assert.equal(daysWithoutWork(p, '2026-10-09'), 3);
});

test('a step ticked for the team is their work on their day, not your work today', async () => {
  const { lastWorkDate } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  const p = s.data.projects[0];
  applyOp(s, op('tickStep', { projectId: 'p1', stepId: 's1', byTeam: true, at: '2026-10-02T10:00:00.000Z' }, '2026-10-05'));
  applyOp(s, op('addWorkNote', { projectId: 'p1', noteId: 'tn9', team: true, at: '2026-10-02T10:00:00.000Z', text: '👥 Ravi finished “Order clay”' }, '2026-10-05'));
  assert.ok(p.steps.find((x) => x.id === 's1').done);
  assert.equal(p.steps.find((x) => x.id === 's1').doneAt, '2026-10-02T10:00:00.000Z', 'done on their day');
  assert.equal(p.workNotes[0].createdAt, '2026-10-02T10:00:00.000Z');
  assert.notEqual(lastWorkDate(p), '2026-10-05', 'not your work on the day the tick arrived');
  applyOp(s, op('untickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-05', '11:00:00'));
  assert.ok(!p.steps.find((x) => x.id === 's1').done && !p.steps.find((x) => x.id === 's1').byTeam, 'opened again by the person: unticked');
});

test('team work on an earlier day (page closed that day) counts for that day box, and raises its score', async () => {
  const { dayScore } = await import('../docs/rules.js');
  const s = fresh();
  applyOp(s, op('createProject', { projectId: 'p1', name: 'Kiln', groupId: 'g2' }, '2026-10-01'));
  applyOp(s, op('recordScores', { scores: { '2026-10-03': { green: 0, total: 1 } } }, '2026-10-06'));
  assert.ok(applyOp(s, op('teamWorked', { projectId: 'p1', day: '2026-10-05' }, '2026-10-06')));
  assert.ok(applyOp(s, op('teamWorked', { projectId: 'p1', day: '2026-10-03' }, '2026-10-06')), 'an older day is still added');
  const p = s.data.projects[0];
  assert.deepEqual([p.teamDays, p.teamWorkDate], [['2026-10-03', '2026-10-05'], '2026-10-05'], 'the newest work day stays the newest');
  assert.deepEqual(dayScore(s.data, {}, '2026-10-03'), { green: 1, total: 1 });
  applyOp(s, op('recordScores', { scores: { '2026-10-03': { green: 1, total: 1 } } }, '2026-10-06'));
  assert.equal(s.data.dayScores['2026-10-03'].green, 0, 'a saved score is kept…');
  applyOp(s, op('recordScores', { scores: { '2026-10-03': { green: 1, total: 1 } }, raise: true }, '2026-10-06'));
  assert.equal(s.data.dayScores['2026-10-03'].green, 1, '…unless the team\'s work raises it');
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
  assert.notEqual(dotColour(p, '2026-10-20'), 'grey', 'unpaused: back in colour (green only after an update)');
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
  assert.deepEqual(dayScore(s.data, s.history, '2026-10-02'), { green: 1, total: 2 }, '"OK for today" (old changes) is not work, as on the dot');
  applyOp(s, op('setProjectField', { projectId: 'p2', field: 'priority', value: 'high' }, '2026-10-02'));
  assert.deepEqual(dayScore(s.data, s.history, '2026-10-02'), { green: 1, total: 2 }, 'an edit is not work either');
  applyOp(s, op('addWorkNote', { projectId: 'p2', noteId: 'n2', text: 'y' }, '2026-10-02'));
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

test('review fixes: timer + pause keeps both history lines; undo removes both', async () => {
  const s = withProject('2026-10-01');
  s.data.groups.find((g) => g.id === 'g2').timer = true;
  applyOp(s, op('startTimer', { projectId: 'p1' }, '2026-10-05', '10:00:00'));
  const pause = op('pause', { projectId: 'p1' }, '2026-10-05', '11:00:00');
  applyOp(s, pause);
  const kinds = (s.history['2026-10'] || []).map((e) => e.kind);
  assert.ok(kinds.includes('time_logged') && kinds.includes('paused'), kinds.join());
  applyOp(s, op('restoreProject', { project: { ...s.data.projects[0], state: 'active' }, undoOpId: pause.id }, '2026-10-05', '11:01:00'));
  const after = (s.history['2026-10'] || []).map((e) => e.kind);
  assert.ok(!after.includes('paused') && !after.includes('time_logged'));
});

test('review fixes: empty status is not a change; addTime replay is not doubled', () => {
  const s = withProject('2026-10-01');
  assert.equal(applyOp(s, op('setProjectField', { projectId: 'p1', field: 'status', value: '' }, '2026-10-05')), false);
  assert.equal(s.data.projects[0].lastActivityDate, '2026-10-01', 'not counted as work');
  const t = op('addTime', { projectId: 'p1', minutes: 30 }, '2026-10-05');
  assert.ok(applyOp(s, t));
  assert.equal(applyOp(s, t), false);
  assert.equal(s.data.projects[0].timeLogs.length, 1);
});

test('review fixes: monthly repeat on the 31st stays on the 31st (last day in short months)', () => {
  const s = withProject('2026-01-01');
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's1', field: 'repeat', value: 'monthly' }, '2026-01-01'));
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's1', field: 'dueDate', value: '2026-01-31' }, '2026-01-01'));
  const t1 = op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-01-31');
  applyOp(s, t1);
  const c1 = s.data.projects[0].steps.find((x) => x.id === t1.id + 'r');
  assert.equal(c1.dueDate, '2026-02-28');
  const t2 = op('tickStep', { projectId: 'p1', stepId: c1.id }, '2026-02-28');
  applyOp(s, t2);
  assert.equal(s.data.projects[0].steps.find((x) => x.id === t2.id + 'r').dueDate, '2026-03-31');
});

test('review fixes: wake is not work in past scores; unpause ends a snooze', async () => {
  const { dayScore, isSnoozed } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  applyOp(s, op('snooze', { projectId: 'p1', days: 10 }, '2026-10-02'));
  applyOp(s, op('wake', { projectId: 'p1' }, '2026-10-03'));
  assert.equal(dayScore(s.data, s.history, '2026-10-03').green, 0);
  applyOp(s, op('snooze', { projectId: 'p1', days: 10 }, '2026-10-04'));
  applyOp(s, op('pause', { projectId: 'p1' }, '2026-10-04'));
  applyOp(s, op('unpause', { projectId: 'p1' }, '2026-10-06'));
  assert.ok(!isSnoozed(s.data.projects[0], '2026-10-06'));
});

test('review fixes: long inbox text keeps everything; inbox undo puts the item back', () => {
  const s = withProject('2026-10-01');
  const long = 'Idea '.repeat(60).trim();
  applyOp(s, op('addInbox', { itemId: 'i1', text: long }, '2026-10-02'));
  applyOp(s, op('addInbox', { itemId: 'i2', text: 'Ask Ravi' }, '2026-10-02'));
  applyOp(s, op('inboxToProject', { itemId: 'i1', projectId: 'pn', groupId: 'g1' }, '2026-10-03'));
  const pn = s.data.projects.find((x) => x.id === 'pn');
  assert.ok(pn.name.length <= 120);
  assert.equal(pn.notes, long);
  const before = clone(s.data.projects.find((x) => x.id === 'p1'));
  const move = op('inboxToStep', { itemId: 'i2', projectId: 'p1', stepId: 'sx' }, '2026-10-03');
  applyOp(s, move);
  assert.ok(applyOp(s, op('inboxUndo', { item: { id: 'i2', text: 'Ask Ravi', createdAt: 'x' }, index: 0, undoOpId: move.id, project: before }, '2026-10-03')));
  assert.deepEqual(s.data.inbox.map((x) => x.id), ['i2']);
  assert.ok(!s.data.projects.find((x) => x.id === 'p1').steps.some((x) => x.id === 'sx'));
});

test('review fixes: a removed AI key is remembered as removed', () => {
  const s = fresh();
  applyOp(s, op('setAiKey', { provider: 'claude', key: 'k1' }, '2026-10-01'));
  applyOp(s, op('setAiKey', { provider: 'claude', key: '' }, '2026-10-02'));
  assert.equal(s.data.secrets.claude, undefined);
  assert.equal(s.data.secrets.removed.claude, true);
  applyOp(s, op('setAiKey', { provider: 'claude', key: 'k2' }, '2026-10-03'));
  assert.equal(s.data.secrets.claude, 'k2');
  assert.ok(!s.data.secrets.removed.claude);
});

test('remind me: a step hides until its day, then comes back first; all steps waiting = project rests', async () => {
  const { isSnoozed, restUntil, dayScore } = await import('../docs/rules.js');
  const s = withProject('2026-10-01'); // steps s1 "Order clay", s2 "Call supplier"
  assert.equal(applyOp(s, op('remindStep', { projectId: 'p1', stepId: 's1', date: '2026-10-05' }, '2026-10-05')), false, 'must be a later day');
  assert.ok(applyOp(s, op('remindStep', { projectId: 'p1', stepId: 's1', date: '2026-10-07' }, '2026-10-05')));
  const p = s.data.projects[0];
  assert.equal(p.lastActivityDate, '2026-10-01', 'setting a reminder is not work');
  assert.equal(nextStep(p, '2026-10-06').id, 's2', 'the reminded step waits');
  assert.ok(!isSnoozed(p, '2026-10-06'), 'another step still needs work');
  assert.ok(applyOp(s, op('remindStep', { projectId: 'p1', stepId: 's2', date: '2026-10-09' }, '2026-10-05')));
  assert.equal(restUntil(p, '2026-10-06'), '2026-10-07', 'all steps waiting: project rests until the first reminder');
  assert.equal(dotColour(p, '2026-10-06'), 'grey');
  assert.equal(dayScore(s.data, s.history, '2026-10-06').total, 0, 'a resting day does not break the streak');
  assert.equal(nextStep(p, '2026-10-07').id, 's1', 'on its day the reminded step is next');
  assert.equal(dotColour(p, '2026-10-07'), 'red');
  // cancel brings it back now
  assert.ok(applyOp(s, op('remindStep', { projectId: 'p1', stepId: 's2', date: null }, '2026-10-06')));
  assert.equal(nextStep(p, '2026-10-06').id, 's2');
  // changing the due date does not cancel a reminder
  applyOp(s, op('remindStep', { projectId: 'p1', stepId: 's2', date: '2026-10-20' }, '2026-10-06'));
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 's2', field: 'dueDate', value: '2026-10-25' }, '2026-10-06'));
  assert.equal(p.steps.find((x) => x.id === 's2').snoozedUntil, '2026-10-20');
});

test('Chrome button: a step, Inbox item and new project keep the mail link; bad links are dropped', () => {
  const s = withProject();
  const mail = { url: 'https://outlook.office.com/mail/inbox/id/AAQkAD%2Fx', title: 'Glaze results – batch 14' };
  assert.equal(applyOp(s, op('addStep', { projectId: 'p1', stepId: 's9', text: 'Confirm firing curve', link: mail }, '2026-10-02')), true);
  assert.deepEqual(s.data.projects[0].steps.find((x) => x.id === 's9').link, mail);
  applyOp(s, op('addStep', { projectId: 'p1', stepId: 's10', text: 'Bad', link: { url: 'javascript:alert(1)', title: 'x' } }, '2026-10-02'));
  assert.equal(s.data.projects[0].steps.find((x) => x.id === 's10').link, undefined);
  applyOp(s, op('addInbox', { itemId: 'i1', text: 'Reply to Ravi', link: mail }, '2026-10-02'));
  applyOp(s, op('inboxToStep', { itemId: 'i1', projectId: 'p1', stepId: 's11' }, '2026-10-02'));
  assert.deepEqual(s.data.projects[0].steps.find((x) => x.id === 's11').link, mail);
  applyOp(s, op('addInbox', { itemId: 'i2', text: 'New kiln quote', link: mail }, '2026-10-02'));
  applyOp(s, op('inboxToProject', { itemId: 'i2', projectId: 'p2', groupId: 'g2' }, '2026-10-02'));
  assert.equal(s.data.projects.find((p) => p.id === 'p2').links[0].url, mail.url);
});

test('person phone and email: cleaned, India code added, bad values refused', () => {
  const s = fresh();
  applyOp(s, op('addPerson', { personId: 'r', name: 'Ravi' }, '2026-10-02'));
  assert.equal(applyOp(s, op('setPersonContact', { personId: 'r', phone: '98450 12345' }, '2026-10-02')), true);
  assert.equal(s.data.people[0].phone, '919845012345');
  assert.equal(applyOp(s, op('setPersonContact', { personId: 'r', phone: '+44 7700 900123' }, '2026-10-02')), true);
  assert.equal(s.data.people[0].phone, '447700900123');
  assert.equal(applyOp(s, op('setPersonContact', { personId: 'r', phone: 'abc' }, '2026-10-02')), false);
  assert.equal(applyOp(s, op('setPersonContact', { personId: 'r', email: 'not-an-email' }, '2026-10-02')), false);
  assert.equal(applyOp(s, op('setPersonContact', { personId: 'r', email: 'ravi@acton.in' }, '2026-10-02')), true);
  assert.equal(applyOp(s, op('setPersonContact', { personId: 'r', email: 'ravi@acton.in' }, '2026-10-02')), false, 'no change');
  assert.equal(applyOp(s, op('setPersonContact', { personId: 'r', phone: '' }, '2026-10-02')), true);
  assert.equal(s.data.people[0].phone, '');
});

test('a whole project can be given to a team member and taken back', () => {
  const s = withProject();
  assert.ok(applyOp(s, op('setProjectTeam', { projectId: 'p1', userId: 2, name: 'Valar' }, '2026-10-17')));
  assert.deepEqual(s.data.projects[0].team, { userId: 2, name: 'Valar', since: '2026-10-17' });
  assert.equal(applyOp(s, op('setProjectTeam', { projectId: 'p1', userId: 2, name: 'Valar' }, '2026-10-17')), false); // same again = no change
  assert.ok(applyOp(s, op('setProjectTeam', { projectId: 'p1', userId: null }, '2026-10-18')));
  assert.equal(s.data.projects[0].team, undefined);
  assert.equal(applyOp(s, op('setProjectTeam', { projectId: 'p1', userId: 'x', name: 'Bad' }, '2026-10-18')), false);
});

test('unknown or broken changes are skipped, never stop the app', async () => {
  const state = { data: emptyData(), history: {} };
  for (const type of ['__proto__', 'valueOf', 'constructor', 'toString', 'nothing']) assert.equal(applyOp(state, { type, args: {} }), false);
  assert.equal(applyOp(state, null), false);
  const { carriedOps } = await import('../docs/ops.js');
  const at = '2026-10-17T05:00:00.000Z';
  const r = carriedOps([
    { id: 'a', type: 'addStep', at, args: { projectId: 'p', stepId: 's', text: 'x' } },
    { id: 'b', type: 'deleteProject', at, args: { projectId: 'p' } },
    { id: 'c', type: 'setAiKey', at, args: { provider: 'claude', key: 'k' } },
    { id: 'd', type: 'setProjectTeam', at, args: { projectId: 'p', userId: 9 } },
    { id: 'e', type: 'addFile', at, args: { projectId: 'p', sha: 'abc' } },
    { id: 'f', type: '__proto__', at, args: {} },
    { id: 'g', type: 'addStep', args: {} },
  ]);
  assert.deepEqual(r.ok.map((o) => o.id), ['a']);
  assert.equal(r.files, 1);
  assert.equal(carriedOps('nope').ok.length, 0);
});

test('regression: automatic team changes are never counted as your own work; a raised score keeps its total', async () => {
  const { dayScore } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  applyOp(s, op('addStep', { projectId: 'p1', stepId: 'st9', text: 'Team step', byTeam: true }, '2026-10-03'));
  applyOp(s, op('setProjectTeam', { projectId: 'p1', userId: 3, name: 'Valar', byTeam: true }, '2026-10-03'));
  applyOp(s, op('tickStep', { projectId: 'p1', stepId: 'st9', byTeam: true, at: '2026-10-03T05:00:00.000Z' }, '2026-10-03'));
  applyOp(s, op('untickStep', { projectId: 'p1', stepId: 'st9', byTeam: true }, '2026-10-03', '11:00:00'));
  assert.deepEqual(dayScore(s.data, s.history, '2026-10-03'), { green: 0, total: 1 }, 'none of these is your work');
  applyOp(s, op('recordScores', { scores: { '2026-10-03': { green: 0, total: 3 } } }, '2026-10-04'));
  applyOp(s, op('recordScores', { scores: { '2026-10-03': { green: 2, total: 1 } }, raise: true }, '2026-10-05'));
  assert.deepEqual(s.data.dayScores['2026-10-03'], { green: 2, total: 3 }, 'only green goes up; the saved total stays');
});

// ---------------------------------------------------------------- review round 9 (projects page + Work Task)

test('a team-added step you delete or undo stays away on every device (kept in the data, not per device)', async () => {
  const { staffStepAction } = await import('../docs/rules.js');
  // Undo of the adoption toast: the step is remembered as deleted in the project itself
  const s = withProject('2026-10-01');
  const before = clone(s.data.projects[0]);
  const add = op('addStep', { projectId: 'p1', stepId: 'st1', text: 'Fix kiln door', byTeam: true }, '2026-10-02');
  assert.equal(applyOp(s, add), true);
  assert.equal(s.data.projects[0].steps.find((x) => x.id === 'st1').addedByTeam, true);
  applyOp(s, op('restoreProject', { project: before, index: 0, undoOpIds: [add.id], dropTeamSteps: ['st1'] }, '2026-10-02', '10:00:05'));
  assert.ok(!s.data.projects[0].steps.some((x) => x.id === 'st1'), 'undone');
  assert.deepEqual(s.data.projects[0].teamDropped, ['st1'], 'remembered in the shared data');
  // another device (or tab) sees the task still waiting on the server: it must not add the step again
  assert.equal(applyOp(s, op('addStep', { projectId: 'p1', stepId: 'st1', text: 'Fix kiln door', byTeam: true }, '2026-10-02', '10:01:00')), false);
  assert.equal(staffStepAction('st1', s.data.projects[0], null), 'wait', 'the server is told only once the drop is saved');
  assert.equal(staffStepAction('st1', s.data.projects[0], clone(s.data.projects[0])), 'adopted');
  // a step you delete by hand: same
  const s2 = withProject('2026-10-01');
  applyOp(s2, op('addStep', { projectId: 'p1', stepId: 'st2', text: 'Glaze test', byTeam: true }, '2026-10-02'));
  const del = op('deleteStep', { projectId: 'p1', stepId: 'st2' }, '2026-10-02', '11:00:00');
  applyOp(s2, del);
  assert.deepEqual(s2.data.projects[0].teamDropped, ['st2']);
  assert.equal(applyOp(s2, op('addStep', { projectId: 'p1', stepId: 'st2', text: 'Glaze test', byTeam: true }, '2026-10-02', '11:01:00')), false);
  assert.equal(staffStepAction('st2', s2.data.projects[0], null), 'wait');
  // ... and Undo of that delete brings it back and forgets the drop
  const s3 = withProject('2026-10-01');
  applyOp(s3, op('addStep', { projectId: 'p1', stepId: 'st3', text: 'Order frit', byTeam: true }, '2026-10-02'));
  const snap = clone(s3.data.projects[0]);
  const d3 = op('deleteStep', { projectId: 'p1', stepId: 'st3' }, '2026-10-02', '11:00:00');
  applyOp(s3, d3);
  applyOp(s3, op('restoreProject', { project: snap, index: 0, undoOpId: d3.id }, '2026-10-02', '11:00:03'));
  assert.ok(s3.data.projects[0].steps.some((x) => x.id === 'st3'));
  assert.equal(s3.data.projects[0].teamDropped, undefined);
  // a new staff step that was never added here: add it
  assert.equal(staffStepAction('new', s3.data.projects[0], null), 'add');
  // a plain (not team) step you delete is not remembered
  const s4 = withProject('2026-10-01');
  applyOp(s4, op('deleteStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02'));
  assert.equal(s4.data.projects[0].teamDropped, undefined);
});

test('Undo of another change keeps a team step added meanwhile (no silent cancel of the person\'s step)', async () => {
  const { staffStepAction } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  const before = clone(s.data.projects[0]);
  const tick = op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02');
  applyOp(s, tick);
  // the laptop adopted the person's step and saved it; the phone's waiting tick + Undo are replayed on top
  applyOp(s, op('addStep', { projectId: 'p1', stepId: 'st1', text: 'Fix kiln door', byTeam: true }, '2026-10-02', '10:00:02'));
  applyOp(s, op('restoreProject', { project: before, index: 0, undoOpId: tick.id }, '2026-10-02', '10:00:04'));
  const p = s.data.projects[0];
  assert.equal(p.steps.find((x) => x.id === 's1').done, false, 'the tick is undone');
  assert.ok(p.steps.some((x) => x.id === 'st1'), 'the person\'s step stays');
  assert.equal(p.teamDropped, undefined, 'and is not counted as deleted by you');
  assert.equal(staffStepAction('st1', p, clone(p)), 'adopted');
});

test('a single given step: its task is not closed while the tick or delete can still be undone', async () => {
  const { singleStepCloseWaits, UNDO_GRACE_MS } = await import('../docs/rules.js');
  const now = Date.parse('2026-10-02T10:00:10+05:30');
  const tickedAt = new Date(now - 5000).toISOString();
  assert.equal(singleStepCloseWaits({ id: 's1', done: true, doneAt: tickedAt }, 's1', {}, now), true, 'ticked 5 s ago: Undo still on screen');
  assert.equal(singleStepCloseWaits({ id: 's1', done: true, doneAt: tickedAt }, 's1', {}, now + UNDO_GRACE_MS), false, 'later: close it');
  // deleted: the delete is found in the history (by step id)
  const s = withProject('2026-10-01');
  const del = makeOp('deleteStep', { projectId: 'p1', stepId: 's1' }, new Date(now - 3000).toISOString());
  applyOp(s, del);
  assert.equal(singleStepCloseWaits(null, 's1', s.history, now), true, 'deleted 3 s ago: wait');
  assert.equal(singleStepCloseWaits(null, 's1', s.history, now + UNDO_GRACE_MS), false, 'later: cancel it');
  assert.equal(singleStepCloseWaits(null, 's2', s.history, now), false, 'another step: no wait');
});

test('a deleted given project is taken back only once the delete is saved and Undo is gone', async () => {
  const { takeBackWaits, UNDO_GRACE_MS } = await import('../docs/rules.js');
  const now = Date.parse('2026-10-02T10:00:10+05:30');
  const s = withProject('2026-10-01');
  applyOp(s, makeOp('deleteProject', { projectId: 'p1' }, new Date(now - 4000).toISOString()));
  assert.equal(takeBackWaits('p1', new Set(['p1']), s.history, now), true, 'still in the saved data (only a waiting change)');
  assert.equal(takeBackWaits('p1', null, s.history, now), true, 'saved data not loaded');
  assert.equal(takeBackWaits('p1', new Set(), s.history, now), true, 'saved, but Undo is still on screen');
  assert.equal(takeBackWaits('p1', new Set(), s.history, now + UNDO_GRACE_MS), false, 'later: take it back');
  assert.equal(takeBackWaits('gone', new Set(), {}, now), false, 'deleted long ago (no recent delete): take it back');
});

test('Ctrl+V picture goes to the project only when its page is on screen (not under a sheet)', async () => {
  const { pasteGoesToProject } = await import('../docs/rules.js');
  const ui = { selected: 'p1', view: 'all', search: '', mobile: 'detail' };
  assert.equal(pasteGoesToProject(ui), true);
  assert.equal(pasteGoesToProject(ui, { viewerOpen: true }), false, 'Ctrl+K Jump / a draft sheet is open');
  assert.equal(pasteGoesToProject({ ...ui, showKeys: true }), false, 'the shortcuts list is open');
  assert.equal(pasteGoesToProject({ ...ui, selected: null }), false);
  assert.equal(pasteGoesToProject({ ...ui, view: 'diary' }), false);
  assert.equal(pasteGoesToProject({ ...ui, mobile: 'list' }, { narrow: true }), false);
});

test('a single given step whose whole project was deleted: its task is cancelled once the delete is saved and Undo is gone', async () => {
  const { singleStepClose, UNDO_GRACE_MS } = await import('../docs/rules.js');
  const now = Date.parse('2026-10-02T10:00:10+05:30');
  const s = withProject('2026-10-01');
  const t = { id: 9, status: 'open', seq: null, stepRef: 's1', projectRef: 'p1' };
  assert.equal(singleStepClose(t, s.data.projects, new Set(['p1']), s.history, now), null, 'step still open: leave it');
  applyOp(s, makeOp('deleteProject', { projectId: 'p1' }, new Date(now - 4000).toISOString()));
  const projects = s.data.projects;
  assert.equal(singleStepClose(t, projects, new Set(['p1']), s.history, now), null, 'delete not saved yet');
  assert.equal(singleStepClose(t, projects, null, s.history, now), null, 'saved data not loaded');
  assert.equal(singleStepClose(t, projects, new Set(), s.history, now), null, 'Undo still on screen');
  assert.equal(singleStepClose(t, projects, new Set(), s.history, now + UNDO_GRACE_MS), 'cancelled', 'later: cancelled (it was left open for good before)');
  assert.equal(singleStepClose({ ...t, projectRef: null }, projects, new Set(), s.history, now + UNDO_GRACE_MS), null, 'no project known: leave it');
  assert.equal(singleStepClose({ ...t, seq: 1 }, projects, new Set(), s.history, now + UNDO_GRACE_MS), null, 'part of a whole project: not this path');
  assert.equal(singleStepClose({ ...t, status: 'done' }, projects, new Set(), s.history, now + UNDO_GRACE_MS), null, 'already closed');
  // the old paths still work: ticked step = done, deleted step = cancelled
  const s2 = withProject('2026-10-01');
  applyOp(s2, makeOp('tickStep', { projectId: 'p1', stepId: 's1' }, new Date(now - 60000).toISOString()));
  assert.equal(singleStepClose(t, s2.data.projects, new Set(['p1']), s2.history, now), 'done');
  applyOp(s2, makeOp('deleteStep', { projectId: 'p1', stepId: 's2' }, new Date(now - 60000).toISOString()));
  assert.equal(singleStepClose({ ...t, stepRef: 's2' }, s2.data.projects, new Set(['p1']), s2.history, now), 'cancelled');
});

test('team messages: read only up to the newest one shown', async () => {
  const { seenUpTo } = await import('../docs/rules.js');
  assert.equal(seenUpTo([{ id: 41 }, { id: 39 }, { id: '45' }]), 45);
  assert.equal(seenUpTo([]), 0);
  assert.equal(seenUpTo(null), 0);
});

test('version check: the first stamp is never taken from the browser store; later ones are never stored', async () => {
  const { versionRequest } = await import('../docs/rules.js');
  assert.deepEqual(versionRequest(null, 5), { url: 'version.txt', init: { cache: 'no-cache' } });
  assert.deepEqual(versionRequest('abc', 5), { url: 'version.txt?check=5', init: { cache: 'no-store' } });
});

test('diary: an "again at once" asked while a fetch is on its way is not lost when that fetch ends', async () => {
  const { askDiaryAgain, diaryLoadedAt } = await import('../docs/rules.js');
  const e = { days: 30, wantDays: 0, loading: true, at: 1000 };
  askDiaryAgain(e); // a reply finished while the older fetch was on its way
  e.loading = false;
  assert.equal(diaryLoadedAt(e, 2000), 0, 'fetched again at once');
  assert.equal(diaryLoadedAt(e, 3000), 3000, 'the next one counts as fresh');
  const f = { days: 30, wantDays: 60, loading: false, at: 0 };
  assert.equal(diaryLoadedAt(f, 2000), 0, 'more days asked for: fetched again');
  const g = { days: 30, loading: false, at: 500 };
  askDiaryAgain(g);
  assert.equal(g.at, 0); assert.ok(!g.stale, 'not loading: just fetched on the next draw');
  askDiaryAgain(undefined);
});

test('a team photo that failed is not fetched again on every redraw (only after a minute)', async () => {
  const { photoNeedsFetch, PHOTO_RETRY_MS } = await import('../docs/rules.js');
  assert.equal(photoNeedsFetch(undefined, 1000), true, 'never fetched');
  assert.equal(photoNeedsFetch('loading', 1000), false);
  assert.equal(photoNeedsFetch(null, 1000), false, 'loading (messages)');
  assert.equal(photoNeedsFetch('blob:x', 1000), false, 'shown');
  assert.equal(photoNeedsFetch({ failedAt: 1000 }, 1000 + 5000), false, 'failed 5 s ago: wait');
  assert.equal(photoNeedsFetch({ failedAt: 1000 }, 1000 + PHOTO_RETRY_MS), true, 'a minute later: try again');
});

test('Undo of a team tick (or untick) is remembered, so the next team load does not do it again', async () => {
  const { teamUndoKey, teamActionUndone } = await import('../docs/rules.js');
  const s = withProject('2026-10-01');
  const t = { id: 7, status: 'done', doneAt: '2026-10-02 09:00:00', stepRef: 's1' };
  const before = clone(s.data.projects[0]);
  const tick = op('tickStep', { projectId: 'p1', stepId: 's1', byTeam: true }, '2026-10-02');
  const note = op('addWorkNote', { projectId: 'p1', noteId: 'tn7', stepId: 's1', team: true, text: 'Ravi finished' }, '2026-10-02');
  applyOps(s, [tick, note]);
  assert.equal(teamActionUndone(s.data.projects[0], t), false, 'not undone yet');
  applyOp(s, op('restoreProject', { project: before, index: 0, undoOpIds: [tick.id, note.id], teamUndone: teamUndoKey(t) }, '2026-10-02', '10:00:05'));
  const p = s.data.projects[0];
  assert.equal(p.steps[0].done, false);
  assert.ok(!(p.workNotes || []).some((n) => n.id === 'tn7'));
  assert.equal(teamActionUndone(p, t), true, 'the same finished task is not ticked again');
  assert.equal(teamActionUndone(p, { ...t, doneAt: '2026-10-05 09:00:00' }), false, 'finished again later: new');
  assert.equal(teamActionUndone(p, { ...t, status: 'open', reopenedAt: '2026-10-03 09:00:00' }), false, 'a re-open is its own action');
  // a later, unrelated Undo (an older snapshot) keeps the mark
  const snap = clone(p);
  delete snap.teamUndone;
  const pr = op('setProjectField', { projectId: 'p1', field: 'priority', value: 'high' }, '2026-10-02', '11:00:00');
  applyOp(s, pr);
  applyOp(s, op('restoreProject', { project: snap, index: 0, undoOpId: pr.id }, '2026-10-02', '11:00:02'));
  assert.equal(teamActionUndone(s.data.projects[0], t), true, 'kept through another Undo');
  // a normal Undo leaves no mark
  const s2 = withProject('2026-10-01');
  const b2 = clone(s2.data.projects[0]);
  const t2 = op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-02');
  applyOp(s2, t2);
  applyOp(s2, op('restoreProject', { project: b2, index: 0, undoOpId: t2.id }, '2026-10-02', '10:00:03'));
  assert.equal(s2.data.projects[0].teamUndone, undefined);
});

test('a project given as one task (no steps) shows stuck when that task is stuck', async () => {
  const { teamProgressOf } = await import('../docs/rules.js');
  const whole = { id: 1, projectRef: 'p1', stepRef: 'p1:whole', seq: 1, status: 'open', stuck: true, today: { day: '2026-10-21', state: 'stuck' } };
  const tp = teamProgressOf([whole], 'p1');
  assert.equal(tp.stuck, true);
  assert.equal(tp.lastUpdate, '2026-10-21');
  assert.equal(tp.open, 0, 'step counts leave the whole task out');
  assert.equal(teamProgressOf([{ ...whole, stuck: false }], 'p1').stuck, false);
  assert.equal(teamProgressOf([{ ...whole, status: 'done' }], 'p1').stuck, false, 'finished: not stuck');
  assert.equal(teamProgressOf([{ id: 2, projectRef: 'p1', stepRef: 's1', seq: 1, status: 'open', stuck: true }], 'p1').stuck, true, 'a stuck step still counts');
});

test('project keys (x s w) do nothing where the open project is not on screen', async () => {
  const { projectKeyIgnored } = await import('../docs/rules.js');
  for (const view of ['diary', 'settings', 'dashboard', 'time']) {
    for (const k of 'xsw') assert.equal(projectKeyIgnored({ view, search: '' }, k), true, `${view} ${k}`);
    assert.equal(projectKeyIgnored({ view, search: 'kiln' }, 'x'), false, 'a search shows the project column');
    assert.equal(projectKeyIgnored({ view, search: '' }, 'n'), false);
  }
  for (const k of 'xswi') assert.equal(projectKeyIgnored({ view: 'people', search: '' }, k), true);
  assert.equal(projectKeyIgnored({ view: 'today', search: '' }, 'x'), false);
  assert.equal(projectKeyIgnored({ view: 'group:g1', search: '' }, 'x'), false);
});

test('a Work Task move is followed even when the new person has finished every step', async () => {
  const { teamMovedTo } = await import('../docs/rules.js');
  const A = { id: 2, name: 'Arun' }, B = { id: 3, name: 'Bala' };
  const p = { id: 'p1', team: { userId: 2, name: 'Arun', since: '2026-10-10' } };
  const task = (id, assignee, status, doneAt = null) => ({ id, projectRef: 'p1', stepRef: 's' + id, seq: id, assignee, status, doneAt });
  // open steps with B: B
  assert.deepEqual(teamMovedTo(p, [task(1, A, 'done', '2026-10-11 10:00:00'), task(2, B, 'open')]), B);
  // moved to B, B finished them all: still B
  assert.deepEqual(teamMovedTo(p, [task(1, A, 'done', '2026-10-11 10:00:00'), task(2, B, 'done', '2026-10-15 10:00:00')]), B);
  // all finished by the one on record: no move
  assert.equal(teamMovedTo(p, [task(1, A, 'done', '2026-10-11 10:00:00'), task(2, A, 'done', '2026-10-12 10:00:00')]), null);
  // you gave it to A after B had finished everything (A has nothing yet): stays with A
  assert.equal(teamMovedTo({ ...p, team: { ...p.team, since: '2026-10-16' } }, [task(2, B, 'done', '2026-10-15 10:00:00')]), null);
  assert.equal(teamMovedTo({ ...p, team: { ...p.team, since: '2026-10-15' } }, [task(2, B, 'done', '2026-10-15 10:00:00')]), null, 'same day: not sure, left alone');
  // open steps with two people, or with the one on record: no move
  assert.equal(teamMovedTo(p, [task(1, A, 'open'), task(2, B, 'open')]), null);
  assert.equal(teamMovedTo(p, [task(1, A, 'open'), task(2, B, 'done', '2026-10-15 10:00:00')]), null);
  assert.equal(teamMovedTo({ id: 'p1' }, [task(2, B, 'open')]), null, 'not given');
  assert.equal(teamMovedTo(p, [{ ...task(2, B, 'open'), seq: null }]), null, 'a single step is not the project');
});

test('after project.sync the app follows the person the server names (a Work Task move it had not seen)', async () => {
  const { serverHolder } = await import('../docs/rules.js');
  const people = [{ id: 3, name: 'Valar' }, { id: 4, name: 'Ruthuraj' }];
  assert.deepEqual(serverHolder({ assigneeId: 4 }, 3, people), { id: 4, name: 'Ruthuraj' }, 'moved on Work Task: follow the new person');
  assert.equal(serverHolder({ assigneeId: 3 }, 3, people), null, 'same person: nothing to do');
  assert.equal(serverHolder({ assigneeId: 0 }, 3, people), null, 'taken back as sent');
  assert.equal(serverHolder({ assigneeId: 4 }, 0, people), null, 'the app took it back: never re-give');
  assert.equal(serverHolder({}, 3, people), null, 'an older server without the field: nothing changes');
  assert.equal(serverHolder({ assigneeId: 9 }, 3, people).id, 9, 'followed even when the name is not loaded yet');
});

test('project description (about): saves trimmed, one line, at most 300; empty clears; no history line', () => {
  const s = withProject('2026-10-01');
  const p = s.data.projects[0];
  assert.equal(p.about, undefined, 'a new project has no description yet (older saved data has none either)');
  const before = (s.history['2026-10'] || []).length;
  assert.ok(applyOp(s, op('setProjectField', { projectId: 'p1', field: 'about', value: '  New  glaze\n for the\t basin line  ' }, '2026-10-02')));
  assert.equal(p.about, 'New glaze for the basin line', 'spaces collapsed, trimmed');
  assert.equal((s.history['2026-10'] || []).length, before, 'no history line (it saves while typing)');
  assert.equal(applyOp(s, op('setProjectField', { projectId: 'p1', field: 'about', value: 'New glaze for the basin line ' }, '2026-10-02')), false, 'the same words: not a change');
  assert.ok(applyOp(s, op('setProjectField', { projectId: 'p1', field: 'about', value: 'x'.repeat(400) }, '2026-10-02')));
  assert.equal(p.about.length, 300, 'cut to 300');
  assert.ok(applyOp(s, op('setProjectField', { projectId: 'p1', field: 'about', value: '   ' }, '2026-10-02')));
  assert.equal(p.about, '', 'empty clears it');
  assert.equal(applyOp(s, op('setProjectField', { projectId: 'nope', field: 'about', value: 'Hi' }, '2026-10-02')), false, 'unknown project refused');
});

test('project description: older saved data without about still loads and works', () => {
  const s = withProject('2026-10-01');
  const old = clone(s);
  delete old.data.projects[0].about; // saved before the description existed
  assert.equal(applyOp(old, op('setProjectField', { projectId: 'p1', field: 'about', value: '' }, '2026-10-02')), false, 'missing counts as empty');
  assert.ok(applyOp(old, op('setProjectField', { projectId: 'p1', field: 'name', value: 'Kiln trial 2' }, '2026-10-02')));
  assert.ok(applyOp(old, op('setProjectField', { projectId: 'p1', field: 'about', value: 'Test firing' }, '2026-10-02')));
  assert.equal(old.data.projects[0].about, 'Test firing');
});

// ---------------------------------------------------------------- Outlook emails in the Inbox (worktask.in reads the owner's Outlook)
const MAIL = { conversationId: 'conv-AAA', count: 1 };
const OUTLOOK = 'https://outlook.office365.com/owa/?ItemID=abc&exvsurl=1';

test('inbox from email: an item keeps its link, note and thread (mail); bad links and empty parts are dropped', () => {
  const s = fresh();
  assert.ok(applyOp(s, op('addInbox', { itemId: 'm1', text: '📧 Kiln quote — from Ravi', link: { url: OUTLOOK, title: 'Kiln quote' }, note: '22 Oct 10:15 · Please see the price', mail: MAIL }, '2026-10-22')));
  assert.deepEqual(s.data.inbox[0], { id: 'm1', text: '📧 Kiln quote — from Ravi', createdAt: T('2026-10-22'), link: { url: OUTLOOK, title: 'Kiln quote' }, note: '22 Oct 10:15 · Please see the price', mail: { conversationId: 'conv-AAA', count: 1 } });
  assert.ok(applyOp(s, op('addInbox', { itemId: 'm2', text: 'Plain idea', link: { url: 'javascript:alert(1)' }, note: '  ', mail: { conversationId: 5 } }, '2026-10-22')));
  assert.deepEqual(s.data.inbox[1], { id: 'm2', text: 'Plain idea', createdAt: T('2026-10-22') }, 'no link, note or mail when they are not right');
});

test('inbox from email: updateInbox (a reply in the same thread) changes the note, link and count; nothing when the item is gone', () => {
  const s = fresh();
  applyOp(s, op('addInbox', { itemId: 'm1', text: '📧 Kiln quote — from Ravi', link: { url: OUTLOOK, title: 'Kiln quote' }, note: 'first', mail: MAIL }, '2026-10-22'));
  assert.ok(applyOp(s, op('updateInbox', { itemId: 'm1', note: '💬 2 emails · latest from Anil 22 Oct 14:05\nOK go ahead', link: { url: OUTLOOK + '2', title: 'Kiln quote' }, count: 2 }, '2026-10-22')));
  const it = s.data.inbox[0];
  assert.equal(it.text, '📧 Kiln quote — from Ravi', 'the subject stays');
  assert.equal(it.note, '💬 2 emails · latest from Anil 22 Oct 14:05\nOK go ahead');
  assert.equal(it.link.url, OUTLOOK + '2');
  assert.deepEqual(it.mail, { conversationId: 'conv-AAA', count: 2 });
  assert.equal(applyOp(s, op('updateInbox', { itemId: 'gone', note: 'x' }, '2026-10-22')), false);
});

test('inbox from email: made into a step or a project, the thread (mail) and the note go with it; Undo puts them back', () => {
  const s = withProject('2026-10-01');
  applyOp(s, op('addInbox', { itemId: 'm1', text: '📧 Kiln quote — from Ravi', note: 'first lines', link: { url: OUTLOOK, title: 'Kiln quote' }, mail: MAIL }, '2026-10-22'));
  applyOp(s, op('addInbox', { itemId: 'm2', text: '📧 New glaze — from Anil', note: 'glaze lines', mail: { conversationId: 'conv-BBB', count: 3 } }, '2026-10-22'));
  assert.ok(applyOp(s, op('inboxToStep', { itemId: 'm1', projectId: 'p1', stepId: 'sm' }, '2026-10-22')));
  const step = s.data.projects.find((p) => p.id === 'p1').steps.find((x) => x.id === 'sm');
  assert.deepEqual(step.mail, { conversationId: 'conv-AAA' });
  assert.equal(step.note, 'first lines');
  assert.equal(step.link.url, OUTLOOK);
  assert.ok(applyOp(s, op('inboxToProject', { itemId: 'm2', projectId: 'pm', groupId: 'g1' }, '2026-10-22')));
  const made = s.data.projects.find((p) => p.id === 'pm');
  assert.deepEqual(made.mail, { conversationId: 'conv-BBB' });
  assert.match(made.notes, /glaze lines/);
  assert.ok(applyOp(s, op('inboxUndo', { item: { id: 'm2', text: '📧 New glaze — from Anil', createdAt: T('2026-10-22'), note: 'glaze lines', mail: { conversationId: 'conv-BBB', count: 3 } }, index: 0, removeProjectId: 'pm' }, '2026-10-22')));
  assert.deepEqual(s.data.inbox[0].mail, { conversationId: 'conv-BBB', count: 3 }, 'Undo keeps the thread');
  assert.equal(s.data.inbox[0].note, 'glaze lines');
});

test('inbox from email: a reply note on a project (addMailNote) is not your work — the dot and the day score do not change', async () => {
  const { dayScore, lastWorkDate, dotColour } = await import('../docs/rules.js');
  const { summaryText } = await import('../docs/reports.js');
  const s = withProject('2026-10-01');
  const before = [dotColour(s.data.projects[0], '2026-10-22'), lastWorkDate(s.data.projects[0]), JSON.stringify(dayScore(s.data, s.history, '2026-10-22'))];
  assert.ok(applyOp(s, op('addMailNote', { projectId: 'p1', noteId: 'ml1', stepId: 's1', text: '📧 New reply from Anil 22 Oct 14:05 (step: Order clay): sent', link: { url: OUTLOOK, title: 'Kiln quote' } }, '2026-10-22')));
  const p = s.data.projects[0];
  assert.deepEqual([p.workNotes[0].mail, p.workNotes[0].stepId, p.workNotes[0].link.url], [true, 's1', OUTLOOK]);
  assert.equal(Object.values(s.history).flat().at(-1).kind, 'mail_note');
  assert.deepEqual([dotColour(p, '2026-10-22'), lastWorkDate(p), JSON.stringify(dayScore(s.data, s.history, '2026-10-22'))], before, 'not counted as work');
  assert.equal(p.state, 'active');
  assert.ok(!summaryText(s.data, s.history, '2026-10-22', '22 Oct').includes('New reply'), 'not in "what I did today"');
  assert.equal(applyOp(s, op('addMailNote', { projectId: 'nope', noteId: 'ml2', text: 'x' }, '2026-10-22')), false);
});

test('inbox from email: the Inbox shows the note and "Open in Outlook"; a reply note shows its email link', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const fn = APP.slice(APP.indexOf('function renderInbox('), APP.indexOf('function inboxReminder('));
  assert.match(fn, /linkChip\(item\.link, item\.mail \? '✉ Open in Outlook' : null\)/);
  assert.match(fn, /item\.note \? h\('div', \{ class: 'inbox-note muted small'[^)]*\}, item\.note\) : null/);
  const DETAIL = readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8');
  assert.match(DETAIL, /n\.mail \? linkChip\(n\.link\) : null/);
  assert.match(DETAIL, /mail_note: 'Email reply'/);
});

// ---------- Send pending list: the email table, the sent mark, one People page with Work Task ----------

function pendingState() {
  const s = fresh();
  applyOp(s, op('addPerson', { personId: 'r', name: 'Ravi Kumar' }, '2026-10-01'));
  applyOp(s, op('createProject', { projectId: 'p1', name: 'Kiln trial', groupId: 'g2' }, '2026-10-01'));
  applyOp(s, op('setProjectField', { projectId: 'p1', field: 'deadline', value: '2026-11-30' }, '2026-10-01'));
  applyOp(s, op('addStep', { projectId: 'p1', stepId: 'd1', text: 'Check <b>glaze</b> & "fit" with @Ravi Kumar' }, '2026-10-01'));
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 'd1', field: 'dueDate', value: '2026-10-20' }, '2026-10-01'));
  applyOp(s, op('addStep', { projectId: 'p1', stepId: 'w1', text: 'Send burner quote' }, '2026-10-01'));
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 'w1', field: 'waiting', value: true }, '2026-10-19'));
  applyOp(s, op('setStepField', { projectId: 'p1', stepId: 'w1', field: 'waitingOn', value: 'Ravi Kumar' }, '2026-10-19'));
  applyOp(s, op('addWorkNote', { projectId: 'p1', noteId: 'n1', stepId: 'd1', text: 'Glaze looked thin on the rim, asked for a new batch ' + 'x'.repeat(100) }, '2026-10-21'));
  // a project given to him on Work Task ("Give project to…")
  applyOp(s, op('createProject', { projectId: 'p2', name: 'Basin mould', groupId: 'g2' }, '2026-10-01'));
  applyOp(s, op('setProjectField', { projectId: 'p2', field: 'deadline', value: '2026-10-15' }, '2026-10-01'));
  applyOp(s, op('addStep', { projectId: 'p2', stepId: 'g1', text: 'Cast 3 trial moulds' }, '2026-10-01'));
  applyOp(s, op('setProjectTeam', { projectId: 'p2', userId: 7, name: 'Ravi' }, '2026-10-02'));
  return s;
}

test('givenProjectsOf: projects given on Work Task match the person by name, first name and any case; finished and others left out', async () => {
  const { givenProjectsOf, sameTeamName, teamMemberFor } = await import('../docs/rules.js');
  const s = pendingState();
  const ravi = s.data.people[0];
  assert.deepEqual(givenProjectsOf(s.data, ravi).map((p) => p.id), ['p2'], 'first name "Ravi" matches "Ravi Kumar"');
  applyOp(s, op('setProjectTeam', { projectId: 'p2', userId: 7, name: '  ravi KUMAR ' }, '2026-10-03'));
  assert.deepEqual(givenProjectsOf(s.data, ravi).map((p) => p.id), ['p2'], 'full name, any case, extra spaces');
  applyOp(s, op('pause', { projectId: 'p2' }, '2026-10-04'));
  assert.equal(givenProjectsOf(s.data, ravi).length, 1, 'paused still shows');
  applyOp(s, op('createProject', { projectId: 'p3', name: 'Other', groupId: 'g2' }, '2026-10-01'));
  applyOp(s, op('setProjectTeam', { projectId: 'p3', userId: 8, name: 'Valar' }, '2026-10-02'));
  applyOp(s, op('createProject', { projectId: 'p4', name: 'Old', groupId: 'g2' }, '2026-10-01'));
  applyOp(s, op('setProjectTeam', { projectId: 'p4', userId: 7, name: 'Ravi' }, '2026-10-02'));
  applyOp(s, op('finish', { projectId: 'p4' }, '2026-10-05'));
  assert.deepEqual(givenProjectsOf(s.data, ravi).map((p) => p.id), ['p2'], 'another person and a finished project are left out');
  assert.equal(sameTeamName({ name: 'Ravi' }, 'Ravi Kumar'), false, 'a longer team name is not a match for a short person name');
  assert.equal(sameTeamName({ name: 'Ravi Kumar' }, 'Ravichandran'), false);
  assert.equal(teamMemberFor({ name: 'Ravi Kumar' }, [{ id: 1, name: 'Ravi' }, { id: 2, name: 'ravi kumar' }]).id, 2, 'the full name wins');
  assert.equal(teamMemberFor({ name: 'Mani' }, [{ id: 1, name: 'Ravi' }]), null);
});

test('pending list as an email table: columns, order, late / waiting / last update lines, escaping, subject', async () => {
  const { personMessageHtml } = await import('../docs/reports.js');
  const s = pendingState();
  const m = personMessageHtml(s.data, s.data.people[0], '2026-10-22', { owner: 'Venkat' });
  assert.equal(m.subject, 'Your work for Thu 22 Oct – please reply by evening');
  const heads = ['>#</th>', '>Work</th>', '>Last update</th>', '>What I did today</th>', '>Status</th>'].map((x) => m.html.indexOf(x));
  assert.ok(heads.every((x, i) => x > 0 && (i === 0 || x > heads[i - 1])), 'five columns in order');
  assert.match(m.html, /^<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;/);
  assert.ok(!/<style|class=/.test(m.html), 'inline styles only');
  assert.match(m.html, /Hi Ravi, good morning\. Here is your pending work\. Please fill the last two columns and reply by evening\./);
  assert.match(m.html, /3 items · 2 late/);
  // order: the given project, then waiting on him, then to discuss
  const at = (t) => m.html.indexOf(t);
  assert.ok(at('📁 Basin mould') > 0 && at('📁 Basin mould') < at('Send burner quote') && at('Send burner quote') < at('Check &lt;b&gt;glaze'), 'given, waiting, discuss');
  assert.match(m.html, /Now: Cast 3 trial moulds/);
  assert.match(m.html, /color:#c62828;[^>]*>Late since 15 Oct</, 'project past its target date');
  assert.match(m.html, /Late since 20 Oct/, 'step past its date');
  assert.match(m.html, /Waiting on Ravi Kumar · 3 days/);
  assert.match(m.html, /<b>Check &lt;b&gt;glaze&lt;\/b&gt; &amp; &quot;fit&quot;<\/b><div style="color:#666;font-size:12px;margin-top:2px;">Kiln trial<\/div>/, 'step bold, project grey under it, @Ravi Kumar taken out');
  assert.ok(!m.html.includes('<b>glaze</b>'), 'typed HTML is escaped');
  assert.match(m.html, /21 Oct: Glaze looked thin on the rim, asked for a new batch[^<]{0,40}…/, 'newest note on the step, cut short');
  assert.ok(m.html.includes('>—</td>'), 'no update: a dash');
  assert.match(m.html, /Done \/ Going on \/ Stuck/);
  assert.match(m.html, /Status: keep one of Done \/ Going on \/ Stuck\.<\/p>.*Any problem or help needed: write below\./);
  assert.match(m.html, /Thanks,<br>Venkat<\/p><\/div>$/);
  assert.match(personMessageHtml(s.data, s.data.people[0], '2026-10-22').html, />Thanks<\/p><\/div>$/, 'no owner name: just Thanks');
  assert.match(m.text, /1\. 📁 Basin mould\n {3}Late since 15 Oct\n {3}Now: Cast 3 trial moulds\n {3}Last update: —/);
  // nothing pending
  applyOp(s, op('addPerson', { personId: 'n', name: 'Nobody' }, '2026-10-01'));
  const none = personMessageHtml(s.data, s.data.people.find((x) => x.id === 'n'), '2026-10-22');
  assert.ok(!none.html.includes('<table') && none.html.includes('No pending work today.'));
});

test('pending list for a Work Task person: the server items first (late, stuck, then the rest), then the steps; text too', async () => {
  const { personMessageHtml, personMessageText, pendingRows } = await import('../docs/reports.js');
  const s = pendingState();
  const items = [
    { kind: 'task', title: 'Clean dryer', now: '', repeat: 'Every day', lateSince: null, stuck: false, lastUpdate: null },
    { kind: 'task', title: 'Stuck <job>', now: '', lateSince: null, stuck: true, lastUpdate: { day: '2026-10-21', note: 'No clay' } },
    { kind: 'project', title: 'Basin mould', about: 'New line', now: 'Cast 3 trial moulds', lateSince: '2026-10-18', stuck: false, lastUpdate: null },
  ];
  const rows = pendingRows(s.data, s.data.people[0], '2026-10-22', items);
  assert.deepEqual(rows.map((r) => r.title.slice(0, 11)), ['Basin mould', 'Stuck <job>', 'Clean dryer', 'Send burner', 'Check <b>gl']);
  const m = personMessageHtml(s.data, s.data.people[0], '2026-10-22', { items });
  assert.match(m.html, /Stuck &lt;job&gt;<\/b><div style="color:#e65100;[^>]*>Stuck</);
  assert.match(m.html, /Every day/);
  assert.match(m.html, /21 Oct: No clay/);
  assert.ok(!m.html.includes('Kiln trial</div><div style="color:#666;font-size:12px;margin-top:2px;">Now'), 'the given project here is not added twice');
  const text = personMessageText(s.data, s.data.people[0], '2026-10-22', items);
  assert.ok(text.indexOf('Projects and tasks (Work Task):') < text.indexOf('Waiting on you:'));
  const own = personMessageText(s.data, s.data.people[0], '2026-10-22');
  assert.match(own, /Projects given:\n1\. 📁 Basin mould — Now: Cast 3 trial moulds — late since 15 Oct/);
  assert.ok(own.indexOf('Projects given:') < own.indexOf('To discuss:'));
});

test('markPersonSent: saved on the person, not counted as work; "sent today" shows only today (India time)', async () => {
  const { dayScore, dotColour } = await import('../docs/rules.js');
  const { sentTodayTime, sentMarkOf, copyNotice } = await import('../docs/reports.js');
  const s = pendingState();
  const before = JSON.stringify(s.history);
  const score = dayScore(s.data, s.history, '2026-10-22');
  const dot = dotColour(s.data.projects[0], '2026-10-22');
  assert.equal(applyOp(s, op('markPersonSent', { personId: 'r', at: '2026-10-22T03:35:00.000Z' }, '2026-10-22', '09:05:00')), true);
  assert.equal(s.data.people[0].sentAt, '2026-10-22T03:35:00.000Z');
  assert.equal(JSON.stringify(s.history), before, 'no history line');
  assert.deepEqual(dayScore(s.data, s.history, '2026-10-22'), score, 'not work');
  assert.equal(dotColour(s.data.projects[0], '2026-10-22'), dot);
  assert.equal(applyOp(s, op('markPersonSent', { personId: 'nobody' }, '2026-10-22')), false);
  assert.equal(sentTodayTime('2026-10-22T03:35:00.000Z', '2026-10-22'), '9:05');
  assert.equal(sentTodayTime('2026-10-21T19:00:00.000Z', '2026-10-22'), '0:30', 'after midnight in India is today');
  assert.equal(sentTodayTime('2026-10-21T03:35:00.000Z', '2026-10-22'), '', "yesterday's send is not shown");
  assert.equal(sentTodayTime('2026-10-22 09:05:00', '2026-10-22'), '9:05', "the Work Task server's time (India)");
  assert.equal(sentTodayTime('', '2026-10-22'), '');
  // where the mark comes from: the server for a Work Task person, this app's data for everyone else
  assert.deepEqual(sentMarkOf(s.data.people[0], { id: 7, sentAt: '2026-10-22 10:15:00' }, '2026-10-22'), { source: 'server', time: '10:15' });
  assert.deepEqual(sentMarkOf(s.data.people[0], { id: 7, sentAt: null }, '2026-10-22'), { source: 'server', time: '' }, 'own mark ignored when linked');
  assert.deepEqual(sentMarkOf(s.data.people[0], null, '2026-10-22'), { source: 'op', time: '9:05' });
  // the copy notice never claims a table it did not copy
  assert.match(copyNotice('html'), /^Table copied — click in the email and paste \(⌘ Cmd\+V on Mac, Ctrl\+V on Windows\), then Send\.$/);
  assert.match(copyNotice('text'), /plain lines, not the table/);
  assert.ok(!/Table copied/.test(copyNotice('text')) && !/Table copied/.test(copyNotice('none')));
});

test('inbox from email: the thread (mail) keeps the newest email\'s id, sender and subject — on the item, a reply, the step / project made from it', () => {
  const s = withProject('2026-10-01');
  const m1 = { conversationId: 'conv-CCC', count: 1, messageId: 'AAMk-1', fromName: 'Ravi  K', fromAddress: 'ravi@acton.test', subject: 'Kiln quote' };
  applyOp(s, op('addInbox', { itemId: 'm1', text: '📧 Kiln quote — from Ravi', mail: { ...m1, junk: 'x', fromAddress: 'not an address' } }, '2026-10-22'));
  assert.deepEqual(s.data.inbox[0].mail, { conversationId: 'conv-CCC', count: 1, messageId: 'AAMk-1', fromName: 'Ravi K', subject: 'Kiln quote' }, 'only clean parts');
  applyOp(s, op('updateInbox', { itemId: 'm1', count: 2, mail: { conversationId: 'other', messageId: 'AAMk-2', fromName: 'Anil', fromAddress: 'anil@acton.test', subject: 'RE: Kiln quote' } }, '2026-10-22'));
  assert.deepEqual(s.data.inbox[0].mail, { conversationId: 'conv-CCC', count: 2, messageId: 'AAMk-2', fromName: 'Anil', subject: 'RE: Kiln quote', fromAddress: 'anil@acton.test' }, 'the newest email; the thread never changes');
  applyOp(s, op('inboxToStep', { itemId: 'm1', projectId: 'p1', stepId: 'sm' }, '2026-10-22'));
  const step = s.data.projects[0].steps.find((x) => x.id === 'sm');
  assert.deepEqual(step.mail, { conversationId: 'conv-CCC', messageId: 'AAMk-2', fromName: 'Anil', subject: 'RE: Kiln quote', fromAddress: 'anil@acton.test' });
  applyOp(s, op('addMailNote', { projectId: 'p1', noteId: 'ml9', stepId: 'sm', text: 'reply', mail: { messageId: 'AAMk-3', fromName: 'Ravi', fromAddress: 'ravi@acton.test', subject: 'RE: RE: Kiln quote' } }, '2026-10-22'));
  assert.deepEqual([step.mail.conversationId, step.mail.messageId, step.mail.fromAddress], ['conv-CCC', 'AAMk-3', 'ravi@acton.test'], 'a reply note moves it to the newest email');
});

// ---------------------------------------------------------------- Email replies (✉ Reply ready, ✉ Replies page)
const rmail = (id, at, extra = {}) => ({ conversationId: 'C-' + id, count: 1, messageId: 'msg-' + id, fromName: 'Ravi Kumar', fromAddress: 'ravi@x.test', subject: 'Kiln quote ' + id, at, ...extra });
function withMails() {
  const s = withProject('2026-10-15');
  applyOp(s, op('addInbox', { itemId: 'i1', text: '📧 Kiln quote i1 — from Ravi', note: '20 Oct · Please send the price', mail: rmail('i1', T('2026-10-20')) }, '2026-10-20'));
  applyOp(s, op('addInbox', { itemId: 'i2', text: '📧 Glaze — from Anil', mail: rmail('i2', T('2026-10-22', '09:00:00'), { fromName: 'Anil' }) }, '2026-10-22'));
  applyOp(s, op('addInbox', { itemId: 'i3', text: '📧 Step mail', mail: rmail('i3', T('2026-10-21')) }, '2026-10-21'));
  applyOp(s, op('inboxToStep', { itemId: 'i3', projectId: 'p1', stepId: 's3' }, '2026-10-21'));
  return s;
}

test('replies: setReply saves the draft where the email lives (Inbox item, step, project); limits; not work', async () => {
  const { dayScore, lastWorkDate } = await import('../docs/rules.js');
  const { REPLY_MAX } = await import('../docs/ops.js');
  const s = withMails();
  assert.equal(applyOp(s, op('setReply', { itemId: 'i1', text: 'Dear Ravi,\n\nNoted.', by: 'claude' }, '2026-10-22', '15:10:00')), true);
  assert.deepEqual(s.data.inbox[0].reply, { text: 'Dear Ravi,\n\nNoted.', at: T('2026-10-22', '15:10:00'), by: 'claude', forMessageId: 'msg-i1', state: 'ready' });
  assert.equal(applyOp(s, op('setReply', { itemId: 'i1', text: 'Dear Ravi,\n\nNoted.', by: 'you' }, '2026-10-22')), false, 'same text: no change');
  assert.equal(applyOp(s, op('setReply', { itemId: 'i1', text: '   ' }, '2026-10-22')), false, 'empty refused');
  assert.equal(applyOp(s, op('setReply', { projectId: 'p1', stepId: 's1', text: 'x' }, '2026-10-22')), false, 'a step without an email: refused');
  assert.equal(applyOp(s, op('setReply', { projectId: 'p1', text: 'x' }, '2026-10-22')), false, 'a project without an email: refused');
  assert.equal(applyOp(s, op('setReply', { itemId: 'nope', text: 'x' }, '2026-10-22')), false);
  assert.ok(applyOp(s, op('setReply', { projectId: 'p1', stepId: 's3', text: 'y'.repeat(REPLY_MAX + 50), by: 'hacker' }, '2026-10-22')));
  const st = s.data.projects[0].steps.find((x) => x.id === 's3');
  assert.equal(st.reply.text.length, REPLY_MAX, 'cut to 5000 letters');
  assert.equal(st.reply.by, 'you', 'only claude or you');
  assert.ok(applyOp(s, op('setReply', { projectId: 'p1', stepId: 's3', text: 'Edited by me', by: 'you' }, '2026-10-22')));
  const ev = s.history['2026-10'].filter((e) => e.kind === 'reply_prepared' && e.projectId === 'p1');
  assert.equal(ev.length, 1, 'one short history line ("Reply prepared"), not one per edit');
  assert.equal(dayScore(s.data, s.history, '2026-10-22').green, 0, 'preparing a reply is not work');
  assert.equal(lastWorkDate(s.data.projects[0]), null);
});

test('replies: an Inbox item\'s draft goes with it to a step or project', () => {
  const s = withMails();
  applyOp(s, op('setReply', { itemId: 'i2', text: 'Thanks Anil', by: 'claude' }, '2026-10-22'));
  applyOp(s, op('inboxToProject', { itemId: 'i2', projectId: 'p9', groupId: 'g2' }, '2026-10-22'));
  assert.equal(s.data.projects.find((p) => p.id === 'p9').reply.text, 'Thanks Anil');
});

test('replies: Later (tomorrow by default, never today or before), Clear, and ✓ Sent is your work', async () => {
  const { dayScore, lastWorkDate } = await import('../docs/rules.js');
  const s = withMails();
  assert.equal(applyOp(s, op('replyLater', { itemId: 'i1' }, '2026-10-22')), false, 'nothing to put off');
  applyOp(s, op('setReply', { projectId: 'p1', stepId: 's3', text: 'Will do', by: 'claude' }, '2026-10-22'));
  assert.equal(applyOp(s, op('replyLater', { projectId: 'p1', stepId: 's3', until: '2026-10-22' }, '2026-10-22')), false, 'not today');
  assert.ok(applyOp(s, op('replyLater', { projectId: 'p1', stepId: 's3' }, '2026-10-22')));
  const step = () => s.data.projects[0].steps.find((x) => x.id === 's3');
  assert.deepEqual([step().reply.state, step().reply.laterUntil], ['later', '2026-10-23']);
  assert.ok(applyOp(s, op('setReply', { projectId: 'p1', stepId: 's3', text: 'Will do soon', by: 'you' }, '2026-10-22')));
  assert.deepEqual([step().reply.state, step().reply.laterUntil], ['later', '2026-10-23'], 'an edit keeps it for later');
  assert.ok(applyOp(s, op('markReplySent', { projectId: 'p1', stepId: 's3' }, '2026-10-22', '16:00:00')));
  assert.deepEqual([step().reply.state, step().reply.sentAt, 'laterUntil' in step().reply], ['sent', T('2026-10-22', '16:00:00'), false]);
  assert.equal(applyOp(s, op('markReplySent', { projectId: 'p1', stepId: 's3' }, '2026-10-22')), false, 'once');
  assert.equal(lastWorkDate(s.data.projects[0]), '2026-10-22', '✓ Sent counts like a note');
  assert.equal(dayScore(s.data, s.history, '2026-10-22').green, 1);
  assert.ok(s.history['2026-10'].some((e) => e.kind === 'reply_sent' && e.detail === 'Reply sent: Kiln quote i3'));
  assert.equal(applyOp(s, op('clearReply', { projectId: 'p1', stepId: 's3' }, '2026-10-22')), false, 'a sent reply is not cleared');
  applyOp(s, op('setReply', { itemId: 'i1', text: 'Hello', by: 'you' }, '2026-10-22'));
  assert.ok(applyOp(s, op('clearReply', { itemId: 'i1' }, '2026-10-22')));
  assert.equal('reply' in s.data.inbox[0], false);
});

test('replies: mailReplied (seen in Sent Items) — not work; never for a reply sent before the newest email', async () => {
  const { dayScore, lastWorkDate } = await import('../docs/rules.js');
  const s = withMails();
  assert.equal(applyOp(s, op('mailReplied', { projectId: 'p1', stepId: 's3', sentAt: T('2026-10-20') }, '2026-10-22')), false, 'sent before the newest email (21 Oct)');
  assert.equal(applyOp(s, op('mailReplied', { projectId: 'p1', stepId: 's3', sentAt: 'soon' }, '2026-10-22')), false);
  assert.ok(applyOp(s, op('mailReplied', { projectId: 'p1', stepId: 's3', sentAt: T('2026-10-22', '11:00:00') }, '2026-10-22')));
  const r = s.data.projects[0].steps.find((x) => x.id === 's3').reply;
  assert.deepEqual([r.state, r.sentAt, r.text], ['sent', T('2026-10-22', '11:00:00'), '']);
  assert.equal(applyOp(s, op('mailReplied', { projectId: 'p1', stepId: 's3', sentAt: T('2026-10-22', '12:00:00') }, '2026-10-22')), false, 'already replied');
  assert.ok(s.history['2026-10'].some((e) => e.kind === 'mail_replied'));
  assert.equal(lastWorkDate(s.data.projects[0]), null, 'not your work');
  assert.equal(dayScore(s.data, s.history, '2026-10-22').green, 0);
});

test('repliesOf: ready / waiting lists, days and colours, later until its day, sent before a newer email = waiting again', async () => {
  const { repliesOf, replyState } = await import('../docs/rules.js');
  const s = withMails();
  // project with its own email, and one from yourself, and a finished project
  applyOp(s, op('addInbox', { itemId: 'i4', text: 'Me', mail: rmail('i4', T('2026-10-18'), { fromMe: true }) }, '2026-10-18'));
  applyOp(s, op('addInbox', { itemId: 'i5', text: 'Old', mail: rmail('i5', T('2026-10-10')) }, '2026-10-10'));
  applyOp(s, op('inboxToProject', { itemId: 'i5', projectId: 'pf', groupId: 'g2' }, '2026-10-10'));
  applyOp(s, op('finish', { projectId: 'pf' }, '2026-10-11'));
  let r = repliesOf(s.data, '2026-10-22');
  assert.deepEqual(r.waiting.map((m) => [m.id, m.days, m.colour]), [['i1', 2, 'orange'], ['s3', 1, 'orange'], ['i2', 0, 'grey']], 'longest first; your own email and finished projects left out');
  assert.equal(r.ready.length, 0);
  assert.deepEqual(r.waiting.find((m) => m.id === 's3').ref, { projectId: 'p1', stepId: 's3' });
  assert.equal(repliesOf(s.data, '2026-10-24').waiting[0].colour, 'red', '3+ days: red');
  applyOp(s, op('setReply', { itemId: 'i1', text: 'Price attached', by: 'claude' }, '2026-10-22'));
  applyOp(s, op('setReply', { itemId: 'i2', text: 'OK', by: 'claude' }, '2026-10-22'));
  applyOp(s, op('replyLater', { itemId: 'i2', until: '2026-10-24' }, '2026-10-22'));
  r = repliesOf(s.data, '2026-10-22');
  assert.deepEqual([r.ready.map((m) => m.id), r.waiting.map((m) => m.id), r.later.map((m) => m.id)], [['i1'], ['s3'], ['i2']]);
  assert.deepEqual(repliesOf(s.data, '2026-10-24').ready.map((m) => m.id), ['i1', 'i2'], 'later comes back on its day');
  // sent, then a newer email in the thread: waiting again
  applyOp(s, op('markReplySent', { itemId: 'i1' }, '2026-10-22', '12:00:00'));
  assert.equal(replyState({ mail: s.data.inbox[0].mail, reply: s.data.inbox[0].reply }, '2026-10-22'), 'done');
  assert.ok(!repliesOf(s.data, '2026-10-22').waiting.some((m) => m.id === 'i1'), 'replied: not waiting');
  applyOp(s, op('updateInbox', { itemId: 'i1', mail: { messageId: 'msg-i1b', at: T('2026-10-22', '14:00:00') }, count: 2 }, '2026-10-22'));
  assert.ok(repliesOf(s.data, '2026-10-22').waiting.some((m) => m.id === 'i1'), 'a newer email after your reply: waiting again');
  // a draft made for an older email says so
  applyOp(s, op('setReply', { projectId: 'p1', stepId: 's3', text: 'Draft', by: 'claude' }, '2026-10-22'));
  s.data.projects.find((p) => p.id === 'p1').steps.find((x) => x.id === 's3').mail.messageId = 'msg-newer';
  assert.equal(repliesOf(s.data, '2026-10-22').ready.find((m) => m.id === 's3').newer, true);
});

test('replies round: Reply n of N, passes over replies no longer ready, ends', async () => {
  const { replyRoundAt } = await import('../docs/rules.js');
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(replyRoundAt(ids, 0, new Set(ids)), { pos: 0, done: false, n: 1, of: 3, progress: 0 });
  assert.deepEqual(replyRoundAt(ids, 1, new Set(['a', 'c'])), { pos: 2, done: false, n: 3, of: 3, progress: 2 / 3 }, 'b was sent elsewhere: skipped');
  assert.deepEqual(replyRoundAt(ids, 3, new Set(ids)), { pos: 3, done: true, n: 3, of: 3, progress: 1 });
});

test('replies: mailto fallback (Re: subject, cut long text and say so) and refs (id or unique part, refused when several match)', async () => {
  const { replyMailto, MAILTO_BODY_MAX, findMailThread } = await import('../docs/rules.js');
  const a = replyMailto({ fromAddress: 'ravi@x.test', subject: 'RE: Kiln & price' }, 'Dear Ravi,\nOK');
  assert.equal(a.url, 'mailto:ravi@x.test?subject=Re%3A%20Kiln%20%26%20price&body=Dear%20Ravi%2C%0AOK');
  assert.equal(a.cut, false);
  const b = replyMailto({ subject: 'X' }, 'z'.repeat(MAILTO_BODY_MAX + 10));
  assert.equal(b.cut, true);
  assert.ok(b.url.startsWith('mailto:?subject='));
  const s = withMails();
  assert.equal(findMailThread(s.data, 's3').kind, 'step');
  assert.equal(findMailThread(s.data, 'quote i2').id, 'i2');
  assert.throws(() => findMailThread(s.data, 'kiln quote'), /Several emails match/);
  assert.throws(() => findMailThread(s.data, 'zzz'), /No email matches/);
});

test('people give: which steps can go to the person\'s Work Task list (linked, open, active project not given whole, not already a team task)', async () => {
  const { canGiveStep, givableSteps } = await import('../docs/rules.js');
  const member = { id: 7, name: 'Ravi' };
  const p = { id: 'p1', state: 'active' };
  const open = { id: 's1', done: false };
  assert.equal(canGiveStep(member, p, open, null), true);
  assert.equal(canGiveStep(null, p, open, null), false, 'not linked to Work Task');
  assert.equal(canGiveStep(member, p, { ...open, done: true }, null), false, 'done');
  assert.equal(canGiveStep(member, { ...p, state: 'paused' }, open, null), false, 'paused project');
  assert.equal(canGiveStep(member, { ...p, team: { name: 'Ravi' } }, open, null), false, 'project given as a whole');
  assert.equal(canGiveStep(member, p, open, { status: 'open' }), false, 'already an open team task');
  assert.equal(canGiveStep(member, p, open, { status: 'done' }), true, 'a finished task: can be given again');
  const items = [{ project: p, step: open }, { project: p, step: { id: 's2', done: false } }, { project: p, step: { id: 's3', done: true } }];
  assert.deepEqual(givableSteps(items, member, (id) => (id === 's2' ? { status: 'open' } : null)).map((x) => x.step.id), ['s1']);
});
