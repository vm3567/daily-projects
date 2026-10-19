// The Work Task PHP server, tested for real: each run starts its own throwaway MySQL and PHP server,
// runs the one-time setup, then checks sign-in, tasks, messages, photos, projects storage and the command tool.
// Needs php and mysqld on this computer; without them these tests are skipped (the rest still run).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
const READY = has('php') && has('mysqld') && has('mysql') && has('mysqladmin');
const skip = READY ? false : 'php / mysqld not installed on this computer';

const DB_PORT = 20000 + (process.pid % 5000);
const WEB_PORT = DB_PORT + 5000;
const SOCK = `/tmp/wtt-${process.pid}.sock`; // short: MySQL refuses long socket paths
const B = `http://127.0.0.1:${WEB_PORT}/api/?a=`;
let dir; let mysqld; let web;
const tok = {}; const id = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return; } catch { /* not yet */ } await wait(250); }
  throw new Error(`timed out waiting for ${what}`);
}
const sql = (q) => execFileSync('mysql', ['-u', 'root', `--socket=${SOCK}`, '-e', q], { stdio: 'pipe' });
const env = () => ({ ...process.env, WT_TEST_DIR: dir, WT_DB_HOST: `127.0.0.1;port=${DB_PORT}`, WT_PUSH_LOG: join(dir, 'push.log') });

async function call(a, body = {}, t, form) {
  const h = {};
  if (t) h.Authorization = 'Bearer ' + t;
  if (!form) h['Content-Type'] = 'application/json';
  const r = await fetch(B + a, { method: 'POST', headers: h, body: form ? body : JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, ...j };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
function photo(updateId, t, clientId) {
  const fd = new FormData();
  fd.append('updateId', String(updateId));
  fd.append('file', new Blob([png], { type: 'image/png' }), 'p.png');
  if (clientId) fd.append('clientId', clientId);
  return call('photo.add', fd, t, true);
}
const istDay = (back = 0) => new Date(Date.now() + 5.5 * 3600e3 - back * 86400e3).toISOString().slice(0, 10);
const cli = (args, input) => execFileSync('php', [join(ROOT, 'team', 'app', 'dp-cli.php'), ...args], { env: env(), input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

before(async () => {
  if (!READY) return;
  dir = mkdtempSync(join(tmpdir(), 'wt-srv-'));
  mkdirSync(join(dir, 'db'));
  execFileSync('mysqld', ['--initialize-insecure', `--datadir=${join(dir, 'db')}`, `--user=${process.env.USER || 'root'}`], { stdio: 'ignore' });
  mysqld = spawn('mysqld', [`--datadir=${join(dir, 'db')}`, `--port=${DB_PORT}`, `--socket=${SOCK}`, '--mysqlx=OFF', '--bind-address=127.0.0.1', `--user=${process.env.USER || 'root'}`], { stdio: 'ignore' });
  await until(() => { sql('SELECT 1'); return true; }, 'MySQL');
  sql("CREATE DATABASE wt CHARACTER SET utf8mb4; CREATE USER 'wt'@'127.0.0.1' IDENTIFIED BY 'throwaway-db-pass'; GRANT ALL ON wt.* TO 'wt'@'127.0.0.1';");
  writeFileSync(join(dir, 'setup-code.txt'), 'test-setup-code-123');
  web = spawn('php', ['-S', `127.0.0.1:${WEB_PORT}`, '-t', join(ROOT, 'team', 'public_html')], { env: env(), stdio: 'ignore' });
  await until(async () => (await fetch(B + 'ping', { method: 'POST', body: '{}' })).ok, 'PHP server');
});

after(() => {
  if (!READY) return;
  try { web?.kill(); } catch { /* gone */ }
  try { execFileSync('mysqladmin', ['-u', 'root', `--socket=${SOCK}`, 'shutdown'], { stdio: 'ignore' }); } catch { mysqld?.kill(); }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* left in the temp folder */ }
});

async function setup(code) {
  const body = new URLSearchParams({ code, db_name: 'wt', db_user: 'wt', db_pass: 'throwaway-db-pass', name: 'Boss', username: 'boss', password: 'boss-pass-123', password2: 'boss-pass-123' });
  const r = await fetch(`http://127.0.0.1:${WEB_PORT}/setup.php`, { method: 'POST', body });
  return r.text();
}

test('server: one-time setup (wrong code refused, then done once)', { skip }, async () => {
  assert.match(await setup('wrong-code'), /setup code is not right/);
  assert.match(await setup('test-setup-code-123'), /All set/);
  assert.ok(!existsSync(join(dir, 'setup-code.txt')), 'the setup code is deleted after use');
  assert.match(await setup('test-setup-code-123'), /already set up/);
  assert.equal((await call('ping')).setUp, true);
});

test('server: sign-in, people, first password, lockout', { skip }, async () => {
  const boss = await call('login', { username: 'Boss', password: 'boss-pass-123' });
  assert.ok(boss.ok && boss.user.role === 'admin');
  tok.boss = boss.token; id.boss = boss.user.id;
  for (const [u, n] of [['suresh', 'Suresh'], ['anita', 'Anita']]) {
    const r = await call('user.save', { name: n, username: u, password: 'first-pass-123' }, tok.boss);
    assert.ok(r.ok, r.error); id[u] = r.user.id;
    const l = await call('login', { username: u, password: 'first-pass-123' });
    assert.ok(l.user.mustChange);
    assert.equal((await call('my.today', {}, l.token)).s, 428, 'first password must be changed before work');
    assert.ok((await call('password', { old: 'first-pass-123', new: `${u}-own-pass` }, l.token)).ok);
    tok[u] = l.token;
  }
  assert.ok(!(await call('user.save', { name: 'X', username: 'suresh', password: 'abcdefgh' }, tok.boss)).ok, 'username taken');
  assert.ok(!(await call('user.save', { name: 'X', username: 'a b', password: 'abcdefgh' }, tok.boss)).ok, 'bad username');
  assert.equal((await call('me')).s, 401);
  assert.equal((await call('team.today', {}, tok.suresh)).s, 403, 'staff cannot see the team');
  await call('user.save', { name: 'Lock', username: 'lockme', password: 'lock-pass-123' }, tok.boss);
  for (let i = 0; i < 5; i++) await call('login', { username: i % 2 ? 'LOCKME' : 'lockme', password: 'wrong' });
  assert.equal((await call('login', { username: 'lockme', password: 'lock-pass-123' })).s, 429, 'locked after 5 wrong (any capitals)');
  assert.ok((await call('user.reset', { id: (await call('users.list', {}, tok.boss)).users.find((u) => u.username === 'lockme').id, password: 'new-lock-pass1' }, tok.boss)).ok);
  assert.ok((await call('login', { username: 'lockme', password: 'new-lock-pass1' })).ok, 'a new password clears the lock');
});

test('server: tasks, updates, photos, stuck and messages', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Kiln temp', repeat: 'daily', skipSunday: false }, tok.boss)).task;
  assert.ok(t.dueToday);
  assert.equal((await call('task.get', { id: t.id }, tok.anita)).s, 404, 'other staff cannot open it');
  assert.ok(!(await call('update.save', { taskId: t.id, note: '  ' }, tok.suresh)).ok, 'empty update refused');
  const u = (await call('update.save', { taskId: t.id, note: '1180 top', state: 'stuck' }, tok.suresh)).update;
  const p1 = await photo(u.id, tok.suresh, 'cid12345-p0');
  const p2 = await photo(u.id, tok.suresh, 'cid12345-p0');
  assert.ok(p1.ok && p1.photoId === p2.photoId, 'the same photo sent twice is kept once');
  const fake = new FormData(); fake.append('updateId', String(u.id)); fake.append('file', new Blob([Buffer.from('<?php echo 1;')], { type: 'image/png' }), 'x.png');
  assert.ok(!(await call('photo.add', fake, tok.suresh, true)).ok, 'a fake photo is refused');
  assert.equal((await fetch(`${B}photo&id=${p1.photoId}`, { headers: { Authorization: 'Bearer ' + tok.anita } })).status, 404, 'other staff cannot see the photo');
  assert.equal((await fetch(`${B}photo&id=${p1.photoId}`, { headers: { Authorization: 'Bearer ' + tok.boss } })).headers.get('content-type'), 'image/jpeg');
  let tt = await call('team.today', {}, tok.boss);
  assert.ok(tt.stuck.some((x) => x.id === t.id), 'stuck shows in Needs you');
  const m1 = await call('comment.add', { taskId: t.id, text: 'once', clientId: 'msg12345-1' }, tok.suresh);
  const m2 = await call('comment.add', { taskId: t.id, text: 'once', clientId: 'msg12345-1' }, tok.suresh);
  assert.equal(m2.comments.filter((c) => c.text === 'once').length, 1, 'the same message sent twice is kept once');
  assert.ok(m1.ok);
  await call('comment.add', { taskId: t.id, text: 'Use the spare' }, tok.boss);
  tt = await call('team.today', {}, tok.boss);
  assert.ok(!tt.stuck.some((x) => x.id === t.id), 'answered = not stuck');
  const my = await call('my.today', {}, tok.suresh);
  assert.equal(my.tasks.find((x) => x.id === t.id).unread, 1, 'staff sees the reply as new');
  id.task = t.id;
});

test('server: photo needed, closed tasks, late offline updates', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Fix pump', repeat: 'once', needsPhoto: true }, tok.boss)).task;
  assert.ok(!(await call('update.save', { taskId: t.id, note: 'done', state: 'finished' }, tok.suresh)).ok, 'Finished needs a photo');
  const u = (await call('update.save', { taskId: t.id, note: 'done', state: 'progress' }, tok.suresh)).update;
  await photo(u.id, tok.suresh);
  assert.ok((await call('update.save', { taskId: t.id, note: 'done', state: 'finished' }, tok.suresh)).ok);
  await call('update.save', { taskId: t.id, note: 'old', state: 'progress', day: istDay(1) }, tok.suresh);
  assert.equal((await call('task.get', { id: t.id }, tok.boss)).task.status, 'done', 'an old offline update does not reopen it');
  const c = (await call('task.save', { assigneeId: id.suresh, title: 'Cancelled one', repeat: 'once' }, tok.boss)).task;
  await call('task.status', { id: c.id, status: 'cancelled' }, tok.boss);
  assert.ok(!(await call('update.save', { taskId: c.id, note: 'x', state: 'finished' }, tok.suresh)).ok, 'a cancelled task takes no updates');
  const d = (await call('task.save', { assigneeId: id.suresh, title: 'Daily log', repeat: 'daily', skipSunday: false }, tok.boss)).task;
  assert.equal((await call('update.save', { taskId: d.id, note: 'yesterday', day: istDay(1) }, tok.suresh)).update.day, istDay(1), 'written yesterday counts for yesterday');
  assert.match((await call('update.save', { taskId: d.id, note: 'old', day: istDay(5) }, tok.suresh)).error || '', /more than 2 days/);
  assert.equal((await call('task.save', { assigneeId: id.suresh, title: 'bad date', repeat: 'once', dueDate: '2026-02-30' }, tok.boss)).s, 400);
});

test('server: move, suggestions, give a whole project', { skip }, async () => {
  assert.equal((await call('task.move', { id: id.task, toId: id.anita }, tok.boss)).moved, 1);
  assert.equal((await call('task.move', { id: id.task, toId: id.suresh }, tok.anita)).s, 403, 'staff cannot move tasks');
  const u = await call('update.save', { taskId: id.task, note: 'Anita part', state: 'progress' }, tok.anita);
  assert.ok(u.ok && u.update.note.includes('1180 top') && u.update.note.includes('Anita part'), 'the earlier person\'s words are kept');
  assert.ok(!(await call('update.save', { taskId: id.task, note: 'x' }, tok.suresh)).ok, 'the old person can no longer write');
  const sg = (await call('suggest', { title: 'Clean filters', repeat: 'once', dueDate: '2026-12-01' }, tok.suresh)).task;
  assert.equal((await call('task.approve', { id: sg.id }, tok.suresh)).s, 403);
  assert.equal((await call('task.approve', { id: sg.id }, tok.boss)).task.dueDate, '2026-12-01', 'approving keeps the date');
  const steps = [{ stepRef: 's1', title: 'A' }, { stepRef: 's2', title: 'B' }];
  await Promise.all([1, 2].map(() => call('project.sync', { projectRef: 'p1', project: 'P', assigneeId: id.suresh, steps }, tok.boss)));
  let my = await call('my.today', {}, tok.suresh);
  const mine = [...my.tasks, ...my.other].filter((x) => x.project === 'P' && x.status === 'open');
  assert.equal(mine.length, 2, 'giving twice at once makes no duplicates');
  assert.equal(my.tasks.filter((x) => x.project === 'P').length, 1, 'only the current step is due');
  await call('project.sync', { projectRef: 'p1', project: 'P', assigneeId: id.suresh, steps: [steps[1]] }, tok.boss);
  const a = (await call('tasks.linked', {}, tok.boss)).tasks.find((x) => x.stepRef === 's1');
  assert.ok(!a || a.status !== 'done', 'a step the owner ticked is not reported as finished by the person');
  await call('project.sync', { projectRef: 'p1', project: 'P', assigneeId: 0, steps: [] }, tok.boss);
  my = await call('my.today', {}, tok.suresh);
  assert.ok(![...my.tasks, ...my.other].some((x) => x.project === 'P' && x.status === 'open'), 'take back clears the list');
});

test('server: project daily updates (day by day, for the project page)', { skip }, async () => {
  const steps = [{ stepRef: 'd1', title: 'Mix glaze' }, { stepRef: 'd2', title: 'Fire kiln' }];
  await call('project.sync', { projectRef: 'pd', project: 'Daily P', assigneeId: id.suresh, steps }, tok.boss);
  const cur = (await call('my.today', {}, tok.suresh)).tasks.find((x) => x.project === 'Daily P');
  await call('update.save', { taskId: cur.id, note: 'Mixed 20 kg', state: 'progress', day: istDay(1) }, tok.suresh);
  await call('update.save', { taskId: cur.id, note: 'Viscosity ok', state: 'progress' }, tok.suresh);
  const d = await call('project.updates', { projectRef: 'pd', days: 7 }, tok.boss);
  assert.ok(d.ok && d.tasks.length === 2 && d.since === istDay(0));
  assert.deepEqual(d.updates.map((u) => [u.day, u.note, u.by]), [[istDay(0), 'Viscosity ok', 'Suresh'], [istDay(1), 'Mixed 20 kg', 'Suresh']], 'newest first, with the day it was written');
  assert.equal((await call('project.updates', { projectRef: 'pd' }, tok.suresh)).s, 403, 'staff cannot read the whole project log');
  assert.deepEqual((await call('project.updates', { projectRef: 'none' }, tok.boss)).tasks, [], 'a project with no team work has an empty log');
});

test('server: owner protection and instruction files', { skip }, async () => {
  await call('user.save', { name: 'Other manager', username: 'mgr2', password: 'mgr2-pass-123', role: 'admin' }, tok.boss);
  const m = (await call('login', { username: 'mgr2', password: 'mgr2-pass-123' })).token;
  await call('password', { old: 'mgr2-pass-123', new: 'mgr2-pass-456' }, m);
  assert.ok(!(await call('user.reset', { id: id.boss, password: 'hijack-pass-1' }, m)).ok, 'another manager cannot reset the owner');
  assert.ok(!(await call('user.active', { id: id.boss, active: false }, m)).ok, 'cannot switch the owner off');
  const fd = new FormData(); fd.append('taskId', String(id.task)); fd.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'manual.pdf');
  const f = await call('task.file.add', fd, tok.boss, true);
  assert.ok(f.ok);
  // the task was moved to Anita above: she sees the file, Suresh no longer does
  assert.equal((await fetch(`${B}task.file&id=${f.fileId}`, { headers: { Authorization: 'Bearer ' + tok.suresh } })).status, 404);
  assert.equal((await fetch(`${B}task.file&id=${f.fileId}`, { headers: { Authorization: 'Bearer ' + tok.anita } })).headers.get('content-type'), 'application/pdf');
  assert.ok((await call('logout', {}, m)).ok && (await call('me', {}, m)).s === 401, 'sign out ends the session');
});

test('server: phone notifications go to the right person, once', { skip }, async () => {
  const log = join(dir, 'push.log');
  const sent = () => { try { return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  let seen = 0;
  const fresh = () => { const all = sent(); const out = all.slice(seen); seen = all.length; return out; };
  const keys = { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'), auth: randomBytes(16).toString('base64url') };
  assert.ok(!(await call('push.subscribe', { endpoint: 'https://evil.example/x', keys }, tok.suresh)).ok, 'only real push services');
  assert.ok((await call('push.subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/suresh-phone', keys }, tok.suresh)).ok);
  assert.ok((await call('push.subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/boss-phone', keys }, tok.boss)).ok);
  assert.match((await call('push.key', {}, tok.suresh)).key, /^[A-Za-z0-9_-]{87}$/, 'the public key only (65 bytes)');
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Check moulds', repeat: 'once' }, tok.boss)).task;
  let m = fresh();
  assert.deepEqual(m.map((x) => [x.user, x.msg.title, x.msg.body, x.msg.kind]), [[id.suresh, '📥 New task for you', 'Check moulds', 'task']]);
  assert.equal(m[0].msg.url, '/#open=' + t.id);
  const steps = [{ stepRef: 'n1', title: 'Weigh clay' }, { stepRef: 'n2', title: 'Mix slip' }];
  await call('project.sync', { projectRef: 'pn', project: 'New body', assigneeId: id.suresh, steps }, tok.boss);
  assert.deepEqual(fresh().map((x) => [x.user, x.msg.title, x.msg.body]), [[id.suresh, '📁 New project for you: New body', '2 steps. First: Weigh clay']]);
  await call('project.sync', { projectRef: 'pn', project: 'New body', assigneeId: id.suresh, steps }, tok.boss);
  assert.deepEqual(fresh(), [], 'nothing new = no notification (Daily Projects sends this often)');
  await call('project.sync', { projectRef: 'pn', project: 'New body', assigneeId: id.suresh, steps: [...steps, { stepRef: 'n3', title: 'Cast trial' }] }, tok.boss);
  assert.deepEqual(fresh().map((x) => [x.user, x.msg.title, x.msg.body]), [[id.suresh, '➕ New step in New body', 'Cast trial']]);
  await call('update.save', { taskId: t.id, note: 'Half done', state: 'progress' }, tok.suresh);
  m = fresh();
  assert.deepEqual(m.map((x) => [x.user, x.msg.title, x.msg.kind]), [[id.boss, '✓ Suresh sent an update', 'update']], 'the manager hears (on the phone that is on), not Suresh');
  await call('update.save', { taskId: t.id, note: 'Half done, fixed a word', state: 'progress' }, tok.suresh);
  assert.deepEqual(fresh(), [], 'a small fix of the same update is not news');
  await call('update.save', { taskId: t.id, note: 'Mould cracked', state: 'stuck' }, tok.suresh);
  assert.deepEqual(fresh().map((x) => [x.user, x.msg.title, x.msg.kind]), [[id.boss, '⚠️ Suresh is stuck', 'stuck']]);
  await call('comment.add', { taskId: t.id, text: 'Use mould 4' }, tok.boss);
  assert.deepEqual(fresh().map((x) => [x.user, x.msg.title, x.msg.body]), [[id.suresh, '💬 Boss · Check moulds', 'Use mould 4']]);
  assert.ok((await call('push.test', {}, tok.suresh)).ok);
  assert.deepEqual(fresh().map((x) => [x.user, x.msg.tag]), [[id.suresh, 'test']]);
  await call('push.unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/suresh-phone' }, tok.suresh);
  await call('task.save', { assigneeId: id.suresh, title: 'After sign out', repeat: 'once' }, tok.boss);
  assert.deepEqual(fresh(), [], 'a phone that signed out gets nothing');
  assert.equal((await call('push.test', {}, tok.suresh)).s, 400);
});

test('server: the person adds steps to a project given to them', { skip }, async () => {
  const before = readFileSync(join(dir, 'push.log'), 'utf8');
  await call('project.sync', { projectRef: 'pw', project: 'Servo', assigneeId: id.suresh, steps: [{ stepRef: 'pw:whole', title: 'Servo' }] }, tok.boss);
  const open = async () => [...(await call('my.today', {}, tok.suresh)).tasks, ...(await call('my.today', {}, tok.suresh)).other].filter((t) => t.projectRef === 'pw' && t.status === 'open');
  assert.deepEqual((await open()).map((t) => t.title), ['Servo'], 'no steps yet: the whole project as one task');
  assert.equal((await call('project.addStep', { projectRef: 'pw', title: 'Nope' }, tok.anita)).s, 403, 'only the person it was given to');
  const a1 = await call('project.addStep', { projectRef: 'pw', title: 'Order spare', clientId: 'c1234567-aa' }, tok.suresh);
  const a2 = await call('project.addStep', { projectRef: 'pw', title: 'Order spare', clientId: 'c1234567-aa' }, tok.suresh);
  assert.ok(a1.ok && a1.task.id === a2.task.id && a1.task.fromStaff, 'sent twice = kept once');
  assert.deepEqual((await open()).map((t) => t.title), ['Order spare'], 'the steps take the place of the whole-project task');
  assert.match(readFileSync(join(dir, 'push.log'), 'utf8').slice(before.length), /➕ Suresh added a step/);
  await call('project.sync', { projectRef: 'pw', project: 'Servo', assigneeId: id.suresh, steps: [{ stepRef: 'pw:whole', title: 'Servo' }] }, tok.boss);
  assert.deepEqual((await open()).map((t) => t.title), ['Order spare'], 'before the owner\'s app has it, a sync keeps it (and no whole task again)');
  const linked = (await call('tasks.linked', {}, tok.boss)).tasks.find((t) => t.id === a1.task.id);
  assert.ok(linked && linked.fromStaff, 'Daily Projects sees it as a step to add');
  assert.ok((await call('tasks.adopted', { ids: [a1.task.id] }, tok.boss)).ok);
  await call('project.sync', { projectRef: 'pw', project: 'Servo', assigneeId: id.suresh, steps: [{ stepRef: a1.task.stepRef, title: 'Order spare' }, { stepRef: 'pw2', title: 'Fit it' }] }, tok.boss);
  assert.deepEqual((await open()).map((t) => t.title), ['Order spare', 'Fit it']);
  await call('project.sync', { projectRef: 'pw', project: 'Servo', assigneeId: id.suresh, steps: [{ stepRef: 'pw2', title: 'Fit it' }] }, tok.boss);
  assert.deepEqual((await open()).map((t) => t.title), ['Fit it'], 'once in the project, deleting it there removes it');
});

test('server: team logic fixes (whole project, take-back, telling people)', { skip }, async () => {
  const log = join(dir, 'push.log');
  const keys = { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'), auth: randomBytes(16).toString('base64url') };
  await call('push.subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/suresh-2', keys }, tok.suresh);
  await call('push.subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/anita-2', keys }, tok.anita);
  let seen = readFileSync(log, 'utf8').length;
  const fresh = () => { const all = readFileSync(log, 'utf8'); const out = all.slice(seen).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); seen = all.length; return out; };
  const mine = async (ref) => { const m = await call('my.today', {}, tok.suresh); return [...m.tasks, ...m.other].filter((t) => t.projectRef === ref && t.status === 'open'); };

  // a project with no steps, finished as one task, is never made again
  const whole = [{ stepRef: 'pz:whole', title: 'Clean kiln' }];
  await call('project.sync', { projectRef: 'pz', project: 'Clean kiln', assigneeId: id.suresh, steps: whole }, tok.boss);
  const w = (await mine('pz'))[0];
  await call('update.save', { taskId: w.id, note: 'All clean', state: 'finished' }, tok.suresh);
  await sql("UPDATE wt.tasks SET done_at = NOW() - INTERVAL 1 HOUR WHERE id = " + w.id);
  await call('project.sync', { projectRef: 'pz', project: 'Clean kiln', assigneeId: id.suresh, steps: whole }, tok.boss);
  assert.deepEqual(await mine('pz'), [], 'finished whole-project task does not come back');
  const done = await call('project.mine', { projectRef: 'pz' }, tok.suresh);
  assert.deepEqual(done.tasks.map((t) => t.status), ['done'], 'the person still sees what they finished');
  assert.ok((await call('update.save', { taskId: w.id, note: 'Oops, not yet', state: 'progress' }, tok.suresh)).ok, 'Finished can be undone within 12 hours (not only until midnight)');

  // a step the person added just before the project is taken back is not lost
  await call('project.sync', { projectRef: 'pt', project: 'Glaze line', assigneeId: id.suresh, steps: [{ stepRef: 'pt1', title: 'Sieve' }] }, tok.boss);
  fresh();
  const add = await call('project.addStep', { projectRef: 'pt', title: 'Check sieve mesh', clientId: 'c7654321-bb' }, tok.suresh);
  await call('project.sync', { projectRef: 'pt', project: 'Glaze line', assigneeId: 0, steps: [], reason: 'paused' }, tok.boss);
  const after = fresh().filter((x) => x.user === id.suresh);
  assert.ok(after.some((x) => x.msg.title === '📁 Off your list: Glaze line' && /paused/.test(x.msg.body)), 'the person is told why');
  const linked = (await call('tasks.linked', {}, tok.boss)).tasks.find((t) => t.id === add.task.id);
  assert.ok(linked && linked.fromStaff && linked.status === 'cancelled', 'still offered to Daily Projects to add');
  await call('project.sync', { projectRef: 'pt', project: 'Glaze line', assigneeId: id.suresh, steps: [{ stepRef: 'pt1', title: 'Sieve' }, { stepRef: add.task.stepRef, title: 'Check sieve mesh' }] }, tok.boss);
  assert.deepEqual((await mine('pt')).map((t) => [t.title, t.fromStaff]), [['Sieve', false], ['Check sieve mesh', false]], 'given again: back with its history');

  // closing a step, a moved task, files, cancelled tasks: the person hears
  fresh();
  await call('project.sync', { projectRef: 'pt', project: 'Glaze line', assigneeId: id.suresh, steps: [{ stepRef: add.task.stepRef, title: 'Check sieve mesh' }] }, tok.boss);
  assert.deepEqual(fresh().map((x) => [x.user, x.msg.title]), [[id.suresh, '✓ Step closed in Glaze line']]);
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Count saggars', repeat: 'once' }, tok.boss)).task;
  fresh();
  await call('task.save', { id: t.id, assigneeId: id.anita, title: 'Count saggars', repeat: 'once' }, tok.boss);
  assert.deepEqual(fresh().map((x) => [x.user, x.msg.title]).sort(), [[id.anita, '↔ A task was moved to you'], [id.suresh, '↔ A task was moved to Anita']].sort());
  const fd = new FormData(); fd.append('taskId', String(t.id)); fd.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'how.pdf');
  await call('task.file.add', fd, tok.boss, true);
  await call('task.status', { id: t.id, status: 'cancelled' }, tok.boss);
  assert.deepEqual(fresh().map((x) => [x.user, x.msg.title]), [[id.anita, '📎 New instruction file'], [id.anita, '✖️ A task was cancelled']], 'the person doing it hears');
  const sg = (await call('suggest', { title: 'New shelf' }, tok.suresh)).task;
  assert.equal((await call('task.status', { id: sg.id, status: 'open' }, tok.boss)).s, 400, 'a suggestion is answered with Yes / Not now');
});

test('server: Daily Projects storage (import, owner-only, versions, clashes)', { skip }, async () => {
  const src = join(dir, 'import'); mkdirSync(join(src, 'history'), { recursive: true });
  writeFileSync(join(src, 'data.json'), JSON.stringify({ projects: [{ id: 'x1', name: 'Kiln' }] }));
  writeFileSync(join(src, 'history', '2026-10.json'), '[]');
  assert.match(execFileSync('php', [join(ROOT, 'team', 'app', 'dp-import.php'), src, 'boss'], { env: env(), encoding: 'utf8' }), /Imported 2 files/);
  assert.equal((await call('dp.head', {}, tok.suresh)).s, 403, 'staff cannot open the projects');
  const snap = await call('dp.snapshot', {}, tok.boss);
  const blob = await fetch(`${B}dp.blob&sha=${snap.entries['data.json']}`, { headers: { Authorization: 'Bearer ' + tok.boss } });
  assert.equal(JSON.parse(await blob.text()).projects[0].name, 'Kiln');
  const c1 = await call('dp.commit', { parent: snap.commit, changes: [{ path: 'notes/a.txt', content: 'hello' }], message: 'm1' }, tok.boss);
  assert.ok(c1.ok);
  assert.equal((await call('dp.commit', { parent: snap.commit, changes: [{ path: 'notes/a.txt', content: 'x' }] }, tok.boss)).s, 409, 'another device first');
  assert.ok(!(await call('dp.commit', { parent: c1.commit, changes: [{ path: '../x', content: 'x' }] }, tok.boss)).ok, 'bad file name refused');
  assert.ok(!(await call('dp.blobPut', {}, tok.boss)).ok, 'empty upload refused');
  const head = (await call('dp.head', {}, tok.boss)).head;
  const race = await Promise.all([1, 2, 3].map((i) => call('dp.commit', { parent: head, changes: [{ path: 'notes/a.txt', content: 'r' + i }] }, tok.boss)));
  assert.equal(race.filter((r) => r.ok).length, 1, 'saves at the same moment: exactly one wins');
});

test('server: command tool (dp-cli) for /today, /add and /restore', { skip }, () => {
  const ex = JSON.parse(cli(['export']));
  assert.ok(ex.head && 'data.json' in ex.files);
  const out = JSON.parse(cli(['commit'], JSON.stringify({ parent: ex.head, changes: [{ path: 'data.json', content: JSON.stringify({ projects: [] }) }], message: 'via test' })));
  assert.ok(out.commit);
  assert.throws(() => cli(['commit'], JSON.stringify({ parent: ex.head, changes: [] })), (e) => e.status === 3, 'clash = exit code 3');
  const v = JSON.parse(cli(['before', istDay(0)]));
  assert.equal(v.commit, out.commit, 'newest version of today');
  assert.ok('data.json' in JSON.parse(cli(['tree', out.commit])));
  assert.equal(cli(['cat', ex.head, 'data.json']), ex.files['data.json'], 'an older version reads back exactly');
  assert.equal(JSON.parse(cli(['before', '2000-01-01'])), null, 'nothing that old');
});
