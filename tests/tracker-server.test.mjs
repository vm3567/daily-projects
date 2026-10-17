// Claude's commands (/add, /review-projects …) saving to worktask.in, against a pretend server.
// The important case: the line drops after the server saved — it must say "Saved" and not add twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { emptyData } from '../docs/ops.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = join(ROOT, 'tests', 'fake-dp-server.mjs');

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'dp-fake-'));
  const state = join(dir, 'state.json');
  writeFileSync(state, JSON.stringify({ head: 'c0', n: 0, commits: 0, files: { 'data.json': JSON.stringify(emptyData()) } }));
  const run = (...args) => {
    try {
      return { ok: true, out: execFileSync(process.execPath, [join(ROOT, 'tools', 'tracker.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DP_SERVER_CMD: FAKE, FAKE_DP_STATE: state, DP_DATA_DIR: '' } }) };
    } catch (e) { return { ok: false, out: `${e.stdout}${e.stderr}` }; }
  };
  const trouble = (word) => writeFileSync(state + '.trouble', word);
  const read = () => { const s = JSON.parse(readFileSync(state, 'utf8')); return { ...s, data: JSON.parse(s.files['data.json']) }; };
  return { run, trouble, read, state };
}
const stepCount = (data, text) => data.projects.flatMap((p) => p.steps).filter((s) => s.text === text).length;

test('server: a normal save goes through once', () => {
  const t = setup();
  const r = t.run('new-project', 'Kiln trial', '--steps', 'Order clay');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /Saved to worktask\.in/);
  assert.equal(t.read().commits, 1);
  assert.equal(stepCount(t.read().data, 'Order clay'), 1);
});

test('server: line drops AFTER the save — says Saved, and the step is there only once', () => {
  const t = setup();
  t.run('new-project', 'Kiln trial');
  t.trouble('drop-after');
  const r = t.run('add-steps', 'Kiln trial', 'Call supplier');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /Saved to worktask\.in/);
  assert.equal(stepCount(t.read().data, 'Call supplier'), 1);
  assert.equal(t.read().commits, 2); // the project + this one save: no second save
});

test('server: line drops BEFORE the save — says it failed, and nothing changed', () => {
  const t = setup();
  t.run('new-project', 'Kiln trial');
  const before = t.read();
  t.trouble('drop-before');
  const r = t.run('add-steps', 'Kiln trial', 'Call supplier');
  assert.equal(r.ok, false);
  assert.match(r.out, /Connection reset|not saved|did not answer/i);
  assert.equal(stepCount(t.read().data, 'Call supplier'), 0);
  assert.equal(t.read().head, before.head);
});

test('server: another device saved first — the change is replayed on top, both are kept', () => {
  const t = setup();
  t.run('new-project', 'Kiln trial');
  t.trouble('clash');
  const r = t.run('add-steps', 'Kiln trial', 'Call supplier');
  assert.ok(r.ok, r.out);
  const { data } = t.read();
  assert.equal(stepCount(data, 'Call supplier'), 1);
  assert.ok(data.inbox.some((x) => x.id === 'other-device')); // the other device's change was not lost
});

test('server: an empty data file is refused, never read as "no projects"', () => {
  const t = setup();
  t.run('new-project', 'Kiln trial');
  const st = JSON.parse(readFileSync(t.state, 'utf8'));
  st.files['data.json'] = ''; // damaged on the server
  writeFileSync(t.state, JSON.stringify(st));
  const r = t.run('add-steps', 'Kiln trial', 'Call supplier');
  assert.equal(r.ok, false); // stops with an error …
  assert.equal(JSON.parse(readFileSync(t.state, 'utf8')).files['data.json'], ''); // … and saves nothing over it
});

test('server: tick needs step words, and never guesses when several steps match', () => {
  const t = setup();
  t.run('new-project', 'Kiln trial', '--steps', 'Call Ravi about clay', 'Call supplier');
  let r = t.run('tick', 'Kiln trial', 'call');
  assert.equal(r.ok, false);
  assert.match(r.out, /Several steps match "call": Call Ravi about clay \[.+\], Call supplier \[.+\]/);
  r = t.run('tick', 'Kiln trial', '  ');
  assert.equal(r.ok, false);
  assert.match(r.out, /Give the step text or id/);
  assert.equal(t.read().commits, 1); // nothing was ticked
  r = t.run('tick', 'Kiln trial', 'call supplier'); // exact text wins
  assert.ok(r.ok, r.out);
  const steps = t.read().data.projects[0].steps;
  assert.deepEqual(steps.map((s) => !!s.done), [false, true]);
});

test('server: new-project --steps stops at the next flag', () => {
  const t = setup();
  const r = t.run('new-project', 'Kiln trial', '--steps', 'Call Ravi', 'Call supplier', '--group', 'Personal', '--priority', 'high');
  assert.ok(r.ok, r.out);
  const p = t.read().data.projects[0];
  assert.deepEqual(p.steps.map((s) => s.text), ['Call Ravi', 'Call supplier']);
  assert.equal(p.groupId, emptyData().groups.find((g) => g.name === 'Personal').id);
  assert.equal(p.priority, 'high');
});

// /restore: three versions — 1 Oct (empty), 5 Oct 23:59:59, and 6 Oct 00:00:00 (just after midnight India time)
function restoreSetup() {
  const t = setup();
  const save = (at, files) => { // a version saved at that India time, made straight on the pretend server
    const st = JSON.parse(readFileSync(t.state, 'utf8'));
    st.now = at;
    writeFileSync(t.state, JSON.stringify(st));
    const changes = Object.entries(files).map(([path, content]) => (content === null ? { path, sha: null } : { path, content }));
    execFileSync(process.execPath, [FAKE, 'commit'], { input: JSON.stringify({ parent: st.head, changes }), env: { ...process.env, FAKE_DP_STATE: t.state } });
  };
  const data = (names, key) => JSON.stringify({ ...emptyData(), projects: names.map((name, i) => ({ id: 'p' + i, name })), secrets: { gemini: key } });
  save('2026-10-05 23:59:59', { 'data.json': data(['Kiln trial'], 'old-key'), 'history/2026-10.json': '["old"]', 'files/a.jpg': 'photo A', 'files/keep.pdf': 'pdf' });
  save('2026-10-06 00:00:00', { 'data.json': data(['Kiln trial', 'Glaze test'], 'new-key'), 'history/2026-10.json': '["old","new"]', 'history/2026-11.json': '["later"]', 'files/a.jpg': null, 'files/b.jpg': 'photo B' });
  return t;
}

test('server restore: brings back that day exactly, keeps today\'s AI keys', () => {
  const t = restoreSetup();
  const r = t.run('restore', '2026-10-05', '--yes');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /Restored to the version from 2026-10-05/);
  const s = t.read();
  assert.deepEqual(s.data.projects.map((p) => p.name), ['Kiln trial']); // the 6 Oct 00:00 version is NOT 5 Oct
  assert.deepEqual(s.data.secrets, { gemini: 'new-key' });
  assert.equal(s.files['history/2026-10.json'], '["old"]');
  assert.equal(s.files['files/a.jpg'], 'photo A'); // deleted after that day: back
  assert.equal(s.files['files/keep.pdf'], 'pdf');
  assert.ok(!('history/2026-11.json' in s.files)); // added after that day: gone
  assert.ok(!('files/b.jpg' in s.files));
  assert.equal(s.log.length, 4); // saved as a NEW version, the old ones are still there
});

test('server restore: without --yes it only shows that version', () => {
  const t = restoreSetup();
  const before = t.read();
  const r = t.run('restore', '2026-10-05');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /1 projects: Kiln trial/);
  assert.match(r.out, /Nothing changed yet/);
  assert.equal(t.read().head, before.head);
});

test('server restore: a date before the first version says so and changes nothing', () => {
  const t = restoreSetup();
  const before = t.read();
  const r = t.run('restore', '2026-09-30', '--yes');
  assert.equal(r.ok, false);
  assert.match(r.out, /No saved version on or before 2026-09-30/);
  assert.equal(t.read().head, before.head);
});

test('server restore: another device saved first — asks to run it again, nothing restored', () => {
  const t = restoreSetup();
  t.trouble('clash');
  const r = t.run('restore', '2026-10-05', '--yes');
  assert.equal(r.ok, false);
  assert.match(r.out, /Run the restore again/);
  assert.equal(t.read().data.projects.length, 2);
});
