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
