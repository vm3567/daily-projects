// The Claude commands helper (tools/tracker.mjs) on a throwaway practice repository.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let dir;
let work;

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tracker = (...args) => execFileSync(process.execPath, [join(ROOT, 'tools/tracker.mjs'), ...args], {
  encoding: 'utf8', env: { ...process.env, DP_DATA_DIR: work }, stdio: ['ignore', 'pipe', 'pipe'],
});
const data = () => JSON.parse(readFileSync(join(work, 'data.json'), 'utf8'));

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dp-tracker-'));
  sh('git', ['init', '-q', '--bare', '-b', 'main', 'remote.git'], dir);
  sh('git', ['clone', '-q', 'remote.git', 'work'], dir);
  work = join(dir, 'work');
  sh('git', ['config', 'user.email', 'test@example.com'], work);
  sh('git', ['config', 'user.name', 'Test'], work);
  writeFileSync(join(work, 'README.md'), '# test\n');
  sh('git', ['add', '.'], work);
  sh('git', ['commit', '-qm', 'init'], work);
  sh('git', ['push', '-q', 'origin', 'main'], work);
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('new project with group and steps, then add, tick and note', () => {
  tracker('new-project', 'Electric kiln', '--group', 'Acton', '--priority', 'high', '--steps', 'Check heaters', 'Call service');
  let p = data().projects[0];
  assert.equal(p.name, 'Electric kiln');
  assert.equal(data().groups.find((g) => g.id === p.groupId).name, 'Acton');
  assert.equal(p.steps.length, 2);
  tracker('add-steps', 'kiln', 'Order new element');
  tracker('tick', 'kiln', 'heaters');
  tracker('add-note', 'kiln', 'Element 3 is broken');
  p = data().projects[0];
  assert.equal(p.steps.length, 3);
  assert.ok(p.steps.find((s) => s.text === 'Check heaters').done);
  assert.equal(p.workNotes[0].text, 'Element 3 is broken');
  // every change is a commit on GitHub (here: the practice remote)
  assert.match(sh('git', ['log', '--oneline', '-1'], work), /via Claude/);
});

test('edit-step changes an open step\'s words, and refuses when several steps match', () => {
  tracker('add-steps', 'kiln', 'Ask for quote A', 'Ask for quote B');
  tracker('edit-step', 'kiln', 'Order new element', 'Order 2 new elements');
  const p = data().projects[0];
  assert.ok(p.steps.some((s) => s.text === 'Order 2 new elements') && !p.steps.some((s) => s.text === 'Order new element'));
  assert.throws(() => tracker('edit-step', 'kiln', 'quote', 'x'), /Several steps match/);
});

test('only-on sets the days and the phone reminder; "every" clears; a wrong day is refused', () => {
  tracker('only-on', 'kiln', 'Mon,Thu', '--remind', '09:30');
  let p = data().projects[0];
  assert.deepEqual(p.onlyDays, [1, 4]);
  assert.equal(p.remindAt, '09:30');
  tracker('only-on', 'kiln', 'every', '--remind', 'off');
  p = data().projects[0];
  assert.ok(!(p.onlyDays || []).length && !p.remindAt, 'cleared');
  assert.throws(() => tracker('only-on', 'kiln', 'Funday'), /Not a day/);
});

test('set-about saves the project\'s short description (cut to 1000 letters)', () => {
  tracker('set-about', 'kiln', 'Find', 'why', 'element', '3', 'keeps', 'failing');
  assert.equal(data().projects[0].about, 'Find why element 3 keeps failing');
  tracker('set-about', 'kiln', 'x'.repeat(1200));
  assert.equal(data().projects[0].about.length, 1000);
});

test('summary, today list and show are readable', () => {
  assert.match(tracker('summary'), /1 active tasks/);
  assert.match(tracker('list', '--today'), /All active tasks are green today/, 'worked on today = green, so nothing left');
  const show = tracker('show', 'kiln');
  assert.match(show, /Open steps:/);
  assert.match(show, /Element 3 is broken/);
});

test('unknown group or project gives a clear error', () => {
  assert.throws(() => tracker('new-project', 'X', '--group', 'Nope'), /No group called "Nope"/);
  assert.throws(() => tracker('add-steps', 'nothing-like-this', 'a'), /No task or project matches/);
});

test('restore: shows first, changes only with --yes, keeps today\'s AI keys', () => {
  const firstCommit = sh('git', ['rev-list', '-1', 'HEAD'], work).trim();
  // later: AI key added and a new step
  const d = data();
  d.secrets = { claude: 'today-key' };
  writeFileSync(join(work, 'data.json'), JSON.stringify(d));
  sh('git', ['commit', '-qam', 'key'], work);
  sh('git', ['push', '-q', 'origin', 'HEAD:main'], work);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const preview = tracker('restore', today);
  assert.match(preview, /Nothing changed yet/);
  assert.equal(data().secrets.claude, 'today-key');
  tracker('restore', today, '--yes');
  assert.equal(data().secrets.claude, 'today-key', 'keys are never rolled back');
  assert.ok(firstCommit);
});

test('"📅 Only on": on a rest day the project is left out of list --today and summary counts it as resting; show says the days', async () => {
  const { todayIndia, weekdayOf } = await import('../docs/rules.js');
  tracker('new-project', 'Weekly glaze check', '--group', 'Acton', '--steps', 'Check glaze');
  const today = todayIndia();
  const rest = [0, 1, 2, 3, 4, 5, 6].filter((n) => n !== weekdayOf(today)).slice(0, 1); // one day that is not today
  const d = data();
  d.projects.find((p) => p.name === 'Weekly glaze check').onlyDays = rest;
  writeFileSync(join(work, 'data.json'), JSON.stringify(d, null, 2));
  sh('git', ['commit', '-qam', 'only on'], work);
  sh('git', ['push', '-q', 'origin', 'main'], work);
  assert.doesNotMatch(tracker('list', '--today'), /Weekly glaze check/, 'a rest day: not on today\'s list');
  assert.match(tracker('summary'), /1 snoozed/);
  const show = tracker('show', 'glaze check');
  assert.match(show, /^SNOOZE/);
  assert.match(show, /only on: \w+days/);
});

test('📂 add-to puts a task into a project (by name; a task can be in several), --create makes the project, remove-from takes it out of one; set-main is the older name ("none" = out of all); summary / show / list say it', () => {
  tracker('new-task', 'Dryer 1', '--group', 'Acton', '--steps', 'Check fan');
  tracker('new-project', 'Dryer 2', '--group', 'Personal', '--steps', 'Check belt'); // the older name still works
  assert.throws(() => tracker('add-to', 'Dryer 1', 'Dryers'), /No task or project matches "Dryers"/, 'no --create: never made by guess');
  assert.match(tracker('add-to', 'Dryer 1', 'Dryers', '--create'), /New project Dryers; Dryer 1 is in it/);
  const P = (name) => data().projects.find((p) => p.name === name);
  const main = P('Dryers');
  assert.ok(main && main.isMain, 'made as a project');
  assert.equal(main.groupId, P('Dryer 1').groupId, 'in the same group as the task');
  assert.deepEqual(P('Dryer 1').parentIds, [main.id]);
  tracker('set-main', 'Dryer 2', 'dryers'); // the older name = add-to
  assert.deepEqual(P('Dryer 2').parentIds, [main.id], 'an existing project, by a part of its name');
  assert.match(tracker('add-to', 'Dryer 2', 'Heat', '--create'), /New project Heat; Dryer 2 is in it/);
  const heat = P('Heat');
  assert.deepEqual(P('Dryer 2').parentIds, [main.id, heat.id], 'in two projects');
  assert.throws(() => tracker('add-to', 'Dryer 2', 'Heat'), /already in Heat/);
  assert.throws(() => tracker('add-to', 'Dryers', 'Heat'), /Dryers is a project, so it cannot go into another project/, 'a project is never inside another');
  assert.throws(() => tracker('add-to', 'Electric kiln', 'Dryer 1'), /a task in a project, so it cannot hold tasks/);
  assert.match(tracker('show', 'Dryer 2'), /in: Dryers, Heat/);
  assert.match(tracker('summary'), /📂 Dryers \[[^\]]+\] \| PROJECT — tasks: (Dryer 2, Dryer 1|Dryer 1, Dryer 2)/);
  const list = tracker('list').split('\n');
  assert.equal(list.filter((l) => /^\S+\s+Dryer 2 \[/.test(l)).length, 1, 'a task in two projects is listed once');
  const at = list.indexOf('📂 Projects:');
  assert.ok(at >= 0, 'then the projects');
  assert.ok(list.slice(at).some((l) => /^ {4}↳ Dryer 2 \[/.test(l)), 'with their tasks');
  assert.match(tracker('remove-from', 'Dryer 2', 'Dryers'), /Dryer 2 is no longer in Dryers/);
  assert.deepEqual(P('Dryer 2').parentIds, [heat.id], 'still in Heat');
  assert.throws(() => tracker('remove-from', 'Dryer 2', 'Dryers'), /Dryer 2 is not in Dryers/);
  tracker('set-main', 'Dryer 2', 'none');
  assert.equal(P('Dryer 2').parentIds, undefined, 'out of every project');
  assert.throws(() => tracker('set-main', 'Dryer 2', 'none'), /not in any project/);
  tracker('new-task', 'Dryer 3', '--project', 'Dryers', '--steps', 'Check door');
  assert.deepEqual(P('Dryer 3').parentIds, [main.id], 'new-task --project: made in it');
});

test('skills text: /add uses new-task and add-to (a task can be in several 📂 projects); /today reads the new list; no "main project" words left', async () => {
  const { readFileSync } = await import('node:fs');
  const skill = (n) => readFileSync(new URL(`../.claude/skills/${n}/SKILL.md`, import.meta.url), 'utf8');
  assert.match(skill('add'), /tracker\.mjs new-task "<name>"/);
  assert.match(skill('add'), /tracker\.mjs add-to "<task>" "<📂 project>"/);
  assert.match(skill('today'), /📂 Projects:/);
  for (const n of ['add', 'today', 'review-projects', 'replies', 'restore']) assert.doesNotMatch(skill(n), /main project|sub-project/i, n);
  const usage = readFileSync(new URL('../tools/tracker.mjs', import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//   node tools/tracker.mjs'));
  for (const cmd of ['add-to', 'remove-from', 'set-main', 'new-task']) assert.ok(usage.some((l) => l.includes(` ${cmd} `)), cmd);
});
