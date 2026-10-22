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

// ---------------------------------------------------------------- /replies: list, read the email, prepare a draft (never send)
function withMailData(t) {
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400e3).toISOString();
  const d = emptyData();
  d.inbox = [{ id: 'mi1', text: '📧 Glaze order — from Anil', createdAt: iso(2), note: 'Please confirm the glaze order', mail: { conversationId: 'C1', count: 1, messageId: 'M1', fromName: 'Anil', fromAddress: 'anil@x.test', subject: 'Glaze order', at: iso(2) } }];
  d.projects = [{ id: 'mp1', name: 'Kiln repair', groupId: d.groups[0].id, priority: 'medium', state: 'active', createdAt: iso(9), notes: '', links: [], files: [],
    workNotes: [{ id: 'n1', text: 'Called the kiln fitter', stepId: null, createdAt: iso(1), updatedAt: iso(1) }],
    steps: [{ id: 'ms1', text: 'Answer the fitter', done: false, createdAt: iso(5), note: 'Can we come on Monday?', mail: { conversationId: 'C2', messageId: 'M2', fromName: 'Ravi', subject: 'Kiln repair visit', at: iso(4) } },
      { id: 'ms2', text: 'Answer about the glaze kiln', done: false, createdAt: iso(5), mail: { conversationId: 'C3', messageId: 'M3', fromName: 'Meena', subject: 'Glaze kiln price', at: iso(0) } }] }];
  const s = JSON.parse(readFileSync(t.state, 'utf8'));
  s.files['data.json'] = JSON.stringify(d);
  s.bodies = { ms1: { subject: 'Kiln repair visit', from: 'Ravi', fromAddress: 'ravi@x.test', received: '2026-10-18T05:00:00Z', body: 'Dear Venkat,\nCan we come on Monday?', cut: false } };
  writeFileSync(t.state, JSON.stringify(s));
}

test('replies: lists every email waiting for a reply (oldest first) with its place, notes and newest lines', () => {
  const t = setup();
  withMailData(t);
  const r = t.run('replies');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /Replies: 3 waiting for a reply · 0 ready to send\./);
  assert.ok(r.out.indexOf('[ms1]') < r.out.indexOf('[mi1]') && r.out.indexOf('[mi1]') < r.out.indexOf('[ms2]'), 'longest waiting first');
  assert.match(r.out, /\[ms1\] Kiln repair visit\n {2}from: Ravi · waiting 4 day\(s\) · in: Kiln repair → Answer the fitter/);
  assert.match(r.out, /newest email: Can we come on Monday\?/);
  assert.match(r.out, /recent notes:\n {4}\d{4}-\d\d-\d\d: Called the kiln fitter/);
});

test('replies: mail-body prints the newest email; set-reply saves a draft by Claude; a ref matching several emails is refused', () => {
  const t = setup();
  withMailData(t);
  const b = t.run('mail-body', 'kiln repair visit');
  assert.ok(b.ok, b.out);
  assert.match(b.out, /Subject: Kiln repair visit\nFrom: Ravi <ravi@x\.test>[\s\S]*Can we come on Monday\?/);
  const bad = t.run('set-reply', 'glaze', 'Dear Anil, confirmed.');
  assert.equal(bad.ok, false);
  assert.match(bad.out, /Several emails match "glaze": Glaze order \[mi1\], Glaze kiln price \[ms2\]/);
  assert.equal(t.read().commits, 0, 'nothing saved');
  assert.equal(t.run('set-reply', 'mi1').ok, false, 'needs the text');
  const ok = t.run('set-reply', 'mi1', 'Dear Anil,\nConfirmed.\nRegards, Venkat');
  assert.ok(ok.ok, ok.out);
  assert.match(ok.out, /Saved to worktask\.in: Reply prepared/);
  const reply = t.read().data.inbox[0].reply;
  assert.deepEqual([reply.text, reply.by, reply.state, reply.forMessageId], ['Dear Anil,\nConfirmed.\nRegards, Venkat', 'claude', 'ready', 'M1']);
  assert.match(t.run('replies').out, /Replies: 2 waiting for a reply · 1 ready to send[\s\S]*READY TO SEND[\s\S]*draft \(claude, ready\): Dear Anil,/);
});
