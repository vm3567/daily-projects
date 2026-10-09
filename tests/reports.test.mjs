// Search, Diary, Today's summary, backup file, @names and device storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installStorage } from './helpers.mjs';
import { projectMatches, diaryEntries, backupPayload, summaryText } from '../docs/reports.js';
import { mentionQuery, matchPeople } from '../docs/ui/mention.js';
import { applyOp, applyOps, emptyData, makeOp } from '../docs/ops.js';

const T = (date, time = '10:00:00') => new Date(`${date}T${time}+05:30`).toISOString();
const op = (type, args, date, time) => makeOp(type, args, T(date, time));

function sample() {
  const s = { data: emptyData(), history: {} };
  applyOps(s, [
    op('createProject', { projectId: 'p1', name: 'Kiln trial' }, '2026-10-09'),
    op('addStep', { projectId: 'p1', stepId: 's1', text: 'Call supplier' }, '2026-10-09'),
    op('addStep', { projectId: 'p1', stepId: 's2', text: 'Order frit' }, '2026-10-09'),
    op('addWorkNote', { projectId: 'p1', noteId: 'n1', text: 'Spoke to Ravi', stepId: 's1' }, '2026-10-09', '11:00:00'),
    op('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-10-09', '11:01:00'),
    op('createProject', { projectId: 'p2', name: 'Old test' }, '2026-10-09'),
    op('addWorkNote', { projectId: 'p2', noteId: 'n2', text: 'Gone note' }, '2026-10-09', '12:00:00'),
    op('finish', { projectId: 'p2' }, '2026-10-09', '12:01:00'),
    op('deleteProject', { projectId: 'p2' }, '2026-10-09', '12:02:00'),
    op('addPerson', { personId: 'r', name: 'Ravi' }, '2026-10-09'),
    op('setStepField', { projectId: 'p1', stepId: 's2', field: 'waiting', value: true }, '2026-10-09'),
    op('setStepField', { projectId: 'p1', stepId: 's2', field: 'waitingOn', value: 'Ravi' }, '2026-10-09'),
  ]);
  s.data.secrets = { claude: 'secret-test-value' };
  return s;
}

test('search finds names, steps, waiting names and work notes (case does not matter)', () => {
  const { data } = sample();
  const p = data.projects[0];
  for (const q of ['kiln', 'order frit', 'ravi', 'spoke to']) assert.ok(projectMatches(p, q), q);
  assert.ok(!projectMatches(p, 'glaze'));
});

test('Diary: ticks, notes with their step, and deleted projects marked', () => {
  const { data, history } = sample();
  const day = diaryEntries(data, history).get('2026-10-09');
  const texts = day.map((l) => `${l.name}: ${l.text}`);
  assert.ok(texts.includes('Kiln trial: ✓ Call supplier'));
  assert.ok(texts.some((t) => t.startsWith('Kiln trial: 📝 Spoke to Ravi') && t.includes('(on: Call supplier)')));
  assert.ok(texts.some((t) => t === 'Old test (deleted project): 📝 Gone note'));
  assert.ok(day.every((l, i) => i === 0 || day[i - 1].at >= l.at), 'newest first');
});

test('Today\'s summary: done steps, notes, next step and who you wait on', () => {
  const { data, history } = sample();
  const text = summaryText(data, history, '2026-10-09', 'Fri, 9 Oct 2026');
  assert.match(text, /^Daily update — Fri, 9 Oct 2026/);
  assert.match(text, /1 step done across 1 project\./);
  assert.match(text, /✅ Call supplier/);
  assert.match(text, /📝 Spoke to Ravi \(on: Call supplier\)/, 'each note says which step it is about');
  assert.match(text, /→ Next: Order frit/);
  assert.match(text, /⏳ Waiting on: Ravi/);
  assert.match(summaryText(emptyData(), {}, '2026-10-10', 'x'), /Nothing recorded yet today/);
});

test('the backup file never contains the AI keys', () => {
  const { data, history } = sample();
  const b = backupPayload(data, history, '2026-10-09T00:00:00Z');
  assert.equal(b.data.secrets, undefined);
  assert.ok(!JSON.stringify(b).includes('secret-test-value'));
  assert.equal(b.data.projects.length, 1);
  assert.equal(data.secrets.claude, 'secret-test-value', 'the real data is not changed');
});

test('@names: what is being typed, and who matches', () => {
  assert.deepEqual(mentionQuery('Ask @Ra', 7, false), { query: 'Ra', start: 4, end: 7, plain: false });
  assert.equal(mentionQuery('email me@ravi.com', 17, false), null, 'not inside an email address');
  assert.deepEqual(mentionQuery('San', 3, true), { query: 'San', start: 0, end: 3, plain: true });
  const people = [{ id: 'a', name: 'Ravi Kumar' }, { id: 'b', name: 'Sandeep sir' }, { id: 'c', name: 'Niketan' }];
  assert.deepEqual(matchPeople(people, 'ku').map((p) => p.id), ['a'], 'matches a later word');
  assert.deepEqual(matchPeople(people, 'S').map((p) => p.id), ['b']);
  assert.equal(matchPeople(people, '').length, 3);
});

test('"Forget this device" removes only this app\'s things', async () => {
  const ls = installStorage();
  const { device } = await import('../docs/device.js');
  ls.setItem('dp.githubKey', 'x'); ls.setItem('dp.pending', '[]'); ls.setItem('other-site', 'keep');
  device.setAiKey('claude', '  key-with-spaces  ');
  assert.equal(device.aiKey('claude'), 'key-with-spaces');
  device.forgetAll();
  assert.deepEqual(Object.keys(ls), ['other-site']);
});

test('pending list message for one person: waiting and to-discuss items, no "@"', async () => {
  const { personMessageText } = await import('../docs/reports.js');
  const s = sample();
  applyOps(s, [
    op('addStep', { projectId: 'p1', stepId: 's3', text: 'Tell @Ravi the new tile size' }, '2026-10-09'),
    op('addStep', { projectId: 'p1', stepId: 's4', text: 'Prepare the mould for MOR testing @Ravi' }, '2026-10-09'),
    op('addPerson', { personId: 'm', name: 'Meena' }, '2026-10-09'),
    op('addStep', { projectId: 'p1', stepId: 's5', text: 'Share @Meena report with @Ravi' }, '2026-10-09'),
    op('setStepField', { projectId: 'p1', stepId: 's2', field: 'dueDate', value: '2026-10-15' }, '2026-10-09'),
  ]);
  const ravi = s.data.people.find((p) => p.name === 'Ravi');
  const text = personMessageText(s.data, ravi, '2026-10-12');
  assert.match(text, /^Hi Ravi,/);
  assert.match(text, /Waiting on you:\n1\. Order frit \(Kiln trial\) — by 15 Oct — pending 3 days/);
  assert.match(text, /To discuss:\n1\. Tell the new tile size \(Kiln trial\)/, 'his own name is taken out');
  assert.ok(!/Ravi \(/.test(text.split('\n').slice(1).join('\n')), 'no "Ravi" inside the list lines');
  assert.ok(!text.includes('@'));
  assert.match(text, /\d\. Prepare the mould for MOR testing \(Kiln trial\)/);
  assert.match(text, /\d\. Share Meena report \(Kiln trial\)/, 'other names stay, dangling "with" removed');
  const nobody = { id: 'x', name: 'Niketan' };
  assert.match(personMessageText({ ...s.data, people: [...s.data.people, nobody] }, nobody, '2026-10-12'), /Nothing is pending/);
});

test('work done by tag for the owner report', async () => {
  const { workDoneByTag } = await import('../docs/reports.js');
  const s = { data: emptyData(), history: {} };
  const acton = s.data.groups[0];
  applyOps(s, [
    op('addTag', { groupId: acton.id, tagId: 'kiln', name: 'Kiln' }, '2026-10-01'),
    op('createProject', { projectId: 'a1', name: 'Electric kiln', groupId: acton.id }, '2026-10-01'),
    op('createProject', { projectId: 'a2', name: 'Misc', groupId: acton.id }, '2026-10-01'),
    op('createProject', { projectId: 'h1', name: 'Home', groupId: s.data.groups[1].id }, '2026-10-01'),
    op('setProjectField', { projectId: 'a1', field: 'tagId', value: 'kiln' }, '2026-10-01'),
    op('addStep', { projectId: 'a1', stepId: 'x1', text: 'Replace element with @Ravi' }, '2026-10-01'),
    op('addStep', { projectId: 'a1', stepId: 'x2', text: 'Test firing' }, '2026-10-01'),
    op('addStep', { projectId: 'a2', stepId: 'y1', text: 'Order gloves' }, '2026-10-01'),
    op('addStep', { projectId: 'h1', stepId: 'z1', text: 'Pay bill' }, '2026-10-01'),
    op('tickStep', { projectId: 'a1', stepId: 'x1' }, '2026-10-03'),
    op('tickStep', { projectId: 'a1', stepId: 'x2' }, '2026-10-05'),
    op('tickStep', { projectId: 'a2', stepId: 'y1' }, '2026-10-04'),
    op('tickStep', { projectId: 'h1', stepId: 'z1' }, '2026-10-04'),
  ]);
  const out = workDoneByTag(s.data, s.history, acton.id, '2026-10-01', '2026-10-31');
  assert.deepEqual(out.map((g) => [g.name, g.items.length]), [['Kiln', 2], ['No tag', 1]]);
  assert.equal(out[0].items[0].text, 'Test firing', 'newest first');
  assert.equal(out[0].items[1].text, 'Replace element with Ravi');
  assert.equal(workDoneByTag(s.data, s.history, acton.id, '2026-10-04', '2026-10-04').length, 1, 'date range respected');
});

test('pending list: a longer name that starts with the person\'s name is kept whole', async () => {
  const { personMessageText } = await import('../docs/reports.js');
  const data = { people: [{ id: 'a', name: 'Ravi Kumar' }, { id: 'b', name: 'Ravi Kumar Sharma' }], projects: [{ id: 'p', name: 'P', state: 'active', steps: [
    { id: 's', text: 'Get sign-off from @Ravi Kumar Sharma', done: false, waiting: true, waitingOn: 'Ravi Kumar' },
    { id: 't', text: 'Tell @Ravi Kumar the size', done: false }] }] };
  const text = personMessageText(data, data.people[0], '2026-10-12');
  assert.match(text, /Get sign-off from Ravi Kumar Sharma \(P\)/);
  assert.match(text, /Tell the size \(P\)/);
});

test('auto-correct: common mistakes fixed, case kept, real words and names left alone', async () => {
  const { fixWord } = await import('../docs/ui/autocorrect.js');
  assert.equal(fixWord('teh'), 'the');
  assert.equal(fixWord('Teh'), 'The');
  assert.equal(fixWord('becasue'), 'because');
  assert.equal(fixWord('shoudl'), 'should');
  assert.equal(fixWord('dont'), "don't");
  assert.equal(fixWord('i'), 'I');
  for (const ok of ['the', 'form', 'its', 'lets', 'kiln', 'Ravi', 'id', 'I']) assert.equal(fixWord(ok), null, ok);
  assert.equal(fixWord('teh2'), null, 'words with numbers are left alone');
});
