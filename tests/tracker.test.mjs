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

test('summary, today list and show are readable', () => {
  assert.match(tracker('summary'), /1 active projects/);
  assert.match(tracker('list', '--today'), /All active projects are green today/, 'worked on today = green, so nothing left');
  const show = tracker('show', 'kiln');
  assert.match(show, /Open steps:/);
  assert.match(show, /Element 3 is broken/);
});

test('unknown group or project gives a clear error', () => {
  assert.throws(() => tracker('new-project', 'X', '--group', 'Nope'), /No group called "Nope"/);
  assert.throws(() => tracker('add-steps', 'nothing-like-this', 'a'), /No project matches/);
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
