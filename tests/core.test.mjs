// Tests for the shared rules and operations. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotColour, indiaDate, addDays, daysBetween } from '../docs/rules.js';
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

test('dot colours: any activity today is green', () => {
  const s = withProject('2026-10-01');
  const p = s.data.projects[0];
  assert.equal(dotColour(p, '2026-10-01'), 'green'); // created + steps added today
  assert.equal(dotColour(p, '2026-10-02'), 'orange');
  assert.equal(dotColour(p, '2026-10-03'), 'red'); // 2 days, nothing done
  applyOp(s, op('addWorkNote', { projectId: 'p1', noteId: 'n1', text: 'Called Ravi' }, '2026-10-03'));
  assert.equal(dotColour(p, '2026-10-03'), 'green', 'a note counts');
  applyOp(s, op('addStep', { projectId: 'p1', stepId: 's9', text: 'New step' }, '2026-10-05'));
  assert.equal(dotColour(p, '2026-10-05'), 'green', 'adding a step counts');
  applyOp(s, op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-06'));
  assert.equal(dotColour(p, '2026-10-06'), 'green', 'ticking counts');
  assert.equal(dotColour(p, '2026-10-07'), 'orange');
  assert.equal(dotColour(p, '2026-10-08'), 'red');
  // a passed target date is red even after activity today
  applyOp(s, op('setProjectField', { projectId: 'p1', field: 'deadline', value: '2026-10-07' }, '2026-10-08'));
  assert.equal(dotColour(p, '2026-10-08'), 'red');
});

test('old data without lastActivityDate still works (uses lastTickDate)', () => {
  const p = { state: 'active', deadline: null, lastTickDate: '2026-10-05', activeSince: '2026-10-01' };
  assert.equal(dotColour(p, '2026-10-05'), 'green');
  assert.equal(dotColour(p, '2026-10-06'), 'orange');
  assert.equal(dotColour(p, '2026-10-07'), 'red');
});

test('pause hides the dot; unpause restarts the count', () => {
  const s = withProject('2026-10-01');
  const p = s.data.projects[0];
  applyOp(s, op('pause', { projectId: 'p1' }, '2026-10-05'));
  assert.equal(dotColour(p, '2026-10-20'), 'grey');
  applyOp(s, op('unpause', { projectId: 'p1' }, '2026-10-20'));
  assert.equal(dotColour(p, '2026-10-20'), 'green');
  assert.equal(dotColour(p, '2026-10-21'), 'orange');
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
