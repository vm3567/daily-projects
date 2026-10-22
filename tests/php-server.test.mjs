// The Work Task PHP server, tested for real: each run starts its own throwaway MySQL and PHP server,
// runs the one-time setup, then checks sign-in, tasks, messages, photos, projects storage and the command tool.
// Needs php and mysqld on this computer; without them these tests are skipped (the rest still run).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes, createHash, createHmac } from 'node:crypto';
const md5 = (x) => createHash('md5').update(x).digest('hex');
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
const MS_PORT = DB_PORT + 10000; // a fake Microsoft (sign-in and Graph) for the Outlook checks
const MS = `http://127.0.0.1:${MS_PORT}`;
const env = () => ({ ...process.env, WT_TEST_DIR: dir, WT_DB_HOST: `127.0.0.1;port=${DB_PORT}`, WT_PUSH_LOG: join(dir, 'push.log'), WT_MS_BASE: MS });

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
  sql(`UPDATE wt.tasks SET created_at = NOW() - INTERVAL 3 DAY, start_date = CURDATE() - INTERVAL 3 DAY WHERE id = ${d.id}`); // (a task that was already there yesterday)
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
  sql(`UPDATE wt.tasks SET created_at = NOW() - INTERVAL 1 DAY, start_date = CURDATE() - INTERVAL 1 DAY WHERE project_ref = 'pd'`); // (given yesterday)
  await call('update.save', { taskId: cur.id, note: 'Mixed 20 kg', state: 'progress', day: istDay(1) }, tok.suresh);
  await call('update.save', { taskId: cur.id, note: 'Viscosity ok', state: 'progress' }, tok.suresh);
  const d = await call('project.updates', { projectRef: 'pd', days: 7 }, tok.boss);
  assert.ok(d.ok && d.tasks.length === 2 && d.since === istDay(1));
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

test('server: given projects follow the saved projects by themselves; messages, search, report', { skip }, async () => {
  const save = async (projects) => {
    const head = (await call('dp.head', {}, tok.boss)).head;
    const r = await call('dp.commit', { parent: head, changes: [{ path: 'data.json', content: JSON.stringify({ projects }) }], message: 'test' }, tok.boss);
    assert.ok(r.ok, r.error);
  };
  const mine = async (ref) => { const m = await call('my.today', {}, tok.suresh); return [...m.tasks, ...m.other].filter((t) => t.projectRef === ref && t.status === 'open'); };
  const tomorrow = istDay(-1);
  const proj = (steps, extra = {}) => ({ id: 'ps1', name: 'Saggar trial', state: 'active', team: { userId: id.suresh, name: 'Suresh' }, steps, ...extra });
  // saved on another device (no project.sync from the app): the list follows at once
  await save([proj([{ id: 'a1', text: 'Mix body', done: false, dueDate: '2026-11-02' }, { id: 'a2', text: 'Press', done: false, snoozedUntil: tomorrow }])]);
  let m = await mine('ps1');
  assert.deepEqual(m.map((t) => [t.title, t.dueDate]), [['Mix body', '2026-11-02']], 'open steps arrive (with their date); a snoozed one waits');
  await save([proj([{ id: 'a1', text: 'Mix body', done: true }, { id: 'a2', text: 'Press', done: false }])]);
  assert.deepEqual((await mine('ps1')).map((t) => t.title), ['Press'], 'ticked = closed, back from snooze = on the list');
  await save([proj([{ id: 'a2', text: 'Press', done: false }], { state: 'paused' })]);
  assert.deepEqual(await mine('ps1'), [], 'paused: off the list');
  await save([proj([{ id: 'a2', text: 'Press', done: false }])]);
  assert.deepEqual((await mine('ps1')).map((t) => t.title), ['Press'], 'started again: back');
  await save([]);
  assert.equal((await mine('ps1')).length, 1, 'deleted just now: kept for the Undo wait');
  sql("USE wt; UPDATE wt.dp_commits SET at = at - INTERVAL 30 SECOND WHERE id = (SELECT v FROM wt.settings WHERE k = 'dp_head'); UPDATE wt.settings SET v = UNIX_TIMESTAMP() - 1 WHERE k = 'sync_retry'");
  await call('me', {}, tok.anita); // the Undo wait is over: the owed sync runs
  assert.deepEqual(await mine('ps1'), [], 'deleted: off the list');

  // future start, overview, project page for the manager
  const fut = (await call('task.save', { assigneeId: id.suresh, title: 'Next week job', repeat: 'once', startDate: istDay(-7) }, tok.boss)).task;
  assert.equal(fut.startDate, istDay(-7));
  m = await call('my.today', {}, tok.suresh);
  assert.ok(!m.tasks.some((t) => t.id === fut.id) && m.other.some((t) => t.id === fut.id), 'not due before its start day: in Coming next');
  await call('project.sync', { projectRef: 'po', project: 'Overview P', assigneeId: id.suresh, steps: [{ stepRef: 'o1', title: 'One' }, { stepRef: 'o2', title: 'Two' }] }, tok.boss);
  const ov = (await call('projects.overview', {}, tok.boss)).projects.find((p) => p.ref === 'po');
  assert.ok(ov && ov.open === 2 && ov.current.title === 'One' && ov.people[0] === 'Suresh');
  assert.equal((await call('projects.overview', {}, tok.suresh)).s, 403);
  assert.equal((await call('project.team', { projectRef: 'po' }, tok.boss)).tasks.length, 2);

  // messages: photo, edit, delete (own only)
  const fd = new FormData(); fd.append('taskId', String(ov.current.id)); fd.append('text', 'See crack'); fd.append('file', new Blob([png], { type: 'image/png' }), 'p.png');
  const ph = await call('comment.photo', fd, tok.suresh, true);
  assert.ok(ph.ok, ph.error);
  const c = ph.comments.find((x) => x.photo);
  assert.equal((await fetch(`${B}comment.photo&id=${c.id}`, { headers: { Authorization: 'Bearer ' + tok.boss } })).headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${B}comment.photo&id=${c.id}`, { headers: { Authorization: 'Bearer ' + tok.anita } })).status, 404, 'others cannot see it');
  assert.equal((await call('comment.edit', { id: c.id, text: 'x' }, tok.boss)).s, 403, 'only your own message');
  assert.equal((await call('comment.edit', { id: c.id, text: 'See the crack here' }, tok.suresh)).comments.find((x) => x.id === c.id).text, 'See the crack here');
  assert.ok(!(await call('comment.delete', { id: c.id }, tok.suresh)).comments.some((x) => x.id === c.id));

  // search: staff only find their own
  await call('comment.add', { taskId: ov.current.id, text: 'zirconium shortage' }, tok.boss);
  assert.ok((await call('search', { q: 'zirconium' }, tok.suresh)).results.some((r) => r.kind === 'message'));
  assert.deepEqual((await call('search', { q: 'zirconium' }, tok.anita)).results, [], 'not someone else\'s task');

  // a suggestion sent twice from the outbox is kept once
  const s1 = await call('suggest', { title: 'Twice', clientId: 'sg123456-aa' }, tok.suresh);
  const s2 = await call('suggest', { title: 'Twice', clientId: 'sg123456-aa' }, tok.suresh);
  assert.equal(s1.task.id, s2.task.id);

  // weekly report
  const rep = await call('report.week', {}, tok.boss);
  const su = rep.people.find((p) => p.name === 'Suresh');
  assert.ok(rep.days.length === 7 && su && su.updates > 0 && su.workDays >= 1);

  // still stuck after a day, nobody answered: one more alert; and the evening summary
  const st = (await call('task.save', { assigneeId: id.suresh, title: 'Stuck one', repeat: 'once' }, tok.boss)).task;
  const u = (await call('update.save', { taskId: st.id, note: 'No clay', state: 'stuck' }, tok.suresh)).update;
  sql(`UPDATE wt.updates SET updated_at = NOW() - INTERVAL 25 HOUR WHERE id = ${u.id}; UPDATE wt.settings SET v = '0' WHERE k = 'jobs_at'; INSERT INTO wt.settings (k, v) VALUES ('fill_by', '00:00') ON DUPLICATE KEY UPDATE v = '00:00'; DELETE FROM wt.settings WHERE k = 'sum_day';`);
  const before = readFileSync(join(dir, 'push.log'), 'utf8').length;
  await call('me', {}, tok.anita); // any request: the server's own work runs after it
  const sent = readFileSync(join(dir, 'push.log'), 'utf8').slice(before);
  assert.match(sent, /still stuck/, 'second alert');
  assert.match(sent, /📊 Today: \d+ of \d+ updates in/, 'evening summary');
  await call('me', {}, tok.anita);
  assert.equal(readFileSync(join(dir, 'push.log'), 'utf8').slice(before), sent, 'each only once');
  const tt = await call('team.today', {}, tok.boss);
  assert.ok(tt.people.find((p) => p.name === 'Suresh').lastUpdate, 'last update day per person');
});

test('server: review fixes — finished step not made again, a move is followed, project steps not cancelled here', { skip }, async () => {
  const save = async (projects) => {
    const head = (await call('dp.head', {}, tok.boss)).head;
    assert.ok((await call('dp.commit', { parent: head, changes: [{ path: 'data.json', content: JSON.stringify({ projects }) }], message: 'test' }, tok.boss)).ok);
  };
  const open = async (who, ref) => { const m = await call('my.today', {}, tok[who]); return [...m.tasks, ...m.other].filter((t) => t.projectRef === ref && t.status === 'open'); };
  const proj = (userId, steps) => ({ id: 'rv1', name: 'Review P', state: 'active', team: { userId, name: 'x' }, steps });
  await save([proj(id.suresh, [{ id: 'r1', text: 'One', done: false }, { id: 'r2', text: 'Two', done: false }])]);
  const one = (await open('suresh', 'rv1')).find((t) => t.title === 'One');
  await call('update.save', { taskId: one.id, note: 'done', state: 'finished' }, tok.suresh);
  sql(`UPDATE wt.tasks SET done_at = NOW() - INTERVAL 2 HOUR WHERE id = ${one.id}`);
  await save([proj(id.suresh, [{ id: 'r1', text: 'One', done: false }, { id: 'r2', text: 'Two', done: false }, { id: 'r3', text: 'Three', done: false }])]);
  assert.deepEqual((await open('suresh', 'rv1')).map((t) => t.title), ['Two', 'Three'], 'the finished step (not ticked yet in the projects) is not made again');
  const two = (await open('suresh', 'rv1'))[0];
  assert.equal((await call('task.status', { id: two.id, status: 'cancelled' }, tok.boss)).s, 400, 'a project step is deleted in the projects app, not cancelled here');
  await call('task.move', { id: two.id, toId: id.anita }, tok.boss);
  await save([proj(id.suresh, [{ id: 'r2', text: 'Two', done: false }, { id: 'r3', text: 'Three (edited)', done: false }])]);
  assert.deepEqual((await open('suresh', 'rv1')), [], 'not moved back to Suresh');
  assert.deepEqual((await open('anita', 'rv1')).map((t) => t.title), ['Two', 'Three (edited)'], 'Anita keeps it, with the change');
  await save([]);
});

test('server: review round 2 — an undone Finished survives the server sync; the old holder is told; old holders cannot write history', { skip }, async () => {
  const save = async (projects) => {
    const head = (await call('dp.head', {}, tok.boss)).head;
    assert.ok((await call('dp.commit', { parent: head, changes: [{ path: 'data.json', content: JSON.stringify({ projects }) }], message: 'test' }, tok.boss)).ok);
  };
  const open = async (who, ref) => { const m = await call('my.today', {}, tok[who]); return [...m.tasks, ...m.other].filter((t) => t.projectRef === ref && t.status === 'open'); };
  const P = (userId, steps) => ({ id: 'rv2', name: 'Round two', state: 'active', team: { userId, name: 'x' }, steps });
  await save([P(id.suresh, [{ id: 'q1', text: 'Q one', done: false }, { id: 'q2', text: 'Q two', done: false }])]);
  const q1 = (await open('suresh', 'rv2'))[0];
  await call('update.save', { taskId: q1.id, note: 'oops', state: 'finished' }, tok.suresh);
  const tickedAt = new Date(Date.now() - 60000).toISOString();
  await save([P(id.suresh, [{ id: 'q1', text: 'Q one', done: true, doneAt: tickedAt }, { id: 'q2', text: 'Q two', done: false }])]); // the owner's app ticked it
  assert.ok((await call('update.save', { taskId: q1.id, note: 'not yet', state: 'progress' }, tok.suresh)).ok, 'undo');
  await save([P(id.suresh, [{ id: 'q1', text: 'Q one', done: true, doneAt: tickedAt }, { id: 'q2', text: 'Q two (edit)', done: false }])]);
  assert.ok((await open('suresh', 'rv2')).some((t) => t.id === q1.id), 'the opened-again step is not closed before the owner\'s app unticks it');
  // the owner gives it to Anita: Suresh is told it left his list
  const before = readFileSync(join(dir, 'push.log'), 'utf8').length;
  await call('project.sync', { projectRef: 'rv2', project: 'Round two', assigneeId: id.anita, steps: [{ stepRef: 'q1', title: 'Q one' }, { stepRef: 'q2', title: 'Q two (edit)' }] }, tok.boss);
  assert.match(readFileSync(join(dir, 'push.log'), 'utf8').slice(before), /Off your list: Round two/);
  // Suresh can no longer write history into it for a day before... it was moved today, so yesterday is allowed; a task he never had is not
  const other = (await call('task.save', { assigneeId: id.anita, title: 'Never Suresh', repeat: 'daily' }, tok.boss)).task;
  assert.ok(!(await call('update.save', { taskId: other.id, note: 'x', day: istDay(1) }, tok.suresh)).ok, 'not his task on that day');
  await save([]);
});

test('server: review round 3/5 — move notes cannot be faked; a late same-day update never lands on the new holder\'s task', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Round three', repeat: 'daily' }, tok.boss)).task;
  const fake = await call('comment.add', { taskId: t.id, text: '↔ Moved from Anita to Suresh.' }, tok.suresh);
  assert.equal(fake.comments.at(-1).text, 'Moved from Anita to Suresh.', 'the sign of a real move note is taken off');
  const writtenAt = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 1100));
  await call('task.move', { id: t.id, toId: id.anita }, tok.boss);
  const late = await call('update.save', { taskId: t.id, note: 'written before the move', writtenAt }, tok.suresh);
  assert.ok(!late.ok && /moved to Anita/.test(late.error), 'today\'s words never go on the new holder\'s task: refused with a clear reason (his text goes back to his box)');
  const after = await call('update.save', { taskId: t.id, note: 'after the move', writtenAt: new Date().toISOString() }, tok.suresh);
  assert.ok(!after.ok, 'written after the move: refused');
  assert.equal((await call('task.get', { id: t.id }, tok.anita)).updates.length, 0, 'nothing was put on Anita\'s task');
  const rep = (await call('report.week', {}, tok.boss)).people;
  assert.ok(rep.find((p) => p.name === 'Anita'), 'report still works');
});

test('server: review round 4 — an older offline update never undoes the person\'s newer Finished; old-holder photos visible after a move', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Round four', repeat: 'once' }, tok.boss)).task;
  const earlier = new Date(Date.now() - 2000).toISOString();
  await new Promise((r) => setTimeout(r, 1100));
  assert.ok((await call('update.save', { taskId: t.id, note: 'all done', state: 'finished' }, tok.suresh)).ok);
  const late = await call('update.save', { taskId: t.id, note: 'half done (tablet, offline)', state: 'progress', writtenAt: earlier }, tok.suresh);
  assert.equal(late.history, 'older');
  const back = await call('task.get', { id: t.id }, tok.suresh);
  assert.equal(back.task.status, 'done', 'still done');
  assert.equal(back.updates[0].note, 'all done', 'the newer update stays');
  assert.ok(!(await call('update.save', { taskId: t.id, note: 'x', writtenAt: '2000-01-01T00:00:00Z' }, tok.anita)).ok, 'a made-up time does not open a door');
});

test('server: review round 5 — a resend after a lost answer is the same save (photos and Finished still go)', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Round five', repeat: 'once' }, tok.boss)).task;
  const writtenAt = new Date(Date.now() - 5000).toISOString();
  const first = await call('update.save', { taskId: t.id, note: 'offline words', state: 'progress', writtenAt, clientId: 'up12345-r5' }, tok.suresh);
  const again = await call('update.save', { taskId: t.id, note: 'offline words', state: 'progress', writtenAt, clientId: 'up12345-r5' }, tok.suresh);
  assert.ok(first.ok && again.ok && !again.history, 'the resend is not "older"');
  assert.equal(again.update.id, first.update.id);
  assert.ok((await photo(again.update.id, tok.suresh, 'up12345-r5-p0')).ok, 'its photo still goes on');
});

test('server: review round 7 — a project whose steps are all done is not put back as a whole-project task', { skip }, async () => {
  const save = async (projects) => {
    const head = (await call('dp.head', {}, tok.boss)).head;
    assert.ok((await call('dp.commit', { parent: head, changes: [{ path: 'data.json', content: JSON.stringify({ projects }) }], message: 'test' }, tok.boss)).ok);
  };
  const open = async () => { const m = await call('my.today', {}, tok.suresh); return [...m.tasks, ...m.other].filter((t) => t.projectRef === 'rv7' && t.status === 'open'); };
  await save([{ id: 'rv7', name: 'Last step', state: 'active', team: { userId: id.suresh, name: 'Suresh' }, steps: [{ id: 'z1', text: 'Only step', done: false }] }]);
  assert.equal((await open()).length, 1);
  await save([{ id: 'rv7', name: 'Last step', state: 'active', team: { userId: id.suresh, name: 'Suresh' }, steps: [{ id: 'z1', text: 'Only step', done: true, doneAt: new Date().toISOString() }] }]);
  assert.deepEqual(await open(), [], 'nothing on the list (no "Last step" whole-project task)');
  await save([]);
});

// ---------------------------------------------------------------- regression checks for the review rounds (one per fix)
const saveProjects = async (projects) => {
  const head = (await call('dp.head', {}, tok.boss)).head;
  const r = await call('dp.commit', { parent: head, changes: [{ path: 'data.json', content: JSON.stringify({ projects }) }], message: 'test' }, tok.boss);
  assert.ok(r.ok, r.error);
};
const openOf = async (who, ref) => { const m = await call('my.today', {}, tok[who]); return [...m.tasks, ...m.other].filter((t) => t.projectRef === ref && t.status === 'open'); };
const pushSince = (n) => readFileSync(join(dir, 'push.log'), 'utf8').slice(n);
const pushLen = () => readFileSync(join(dir, 'push.log'), 'utf8').length;

test('regression: a project skipped because the owner\'s app just sent it is synced once the 5 minutes are over', { skip }, async () => {
  await saveProjects([{ id: 'rg1', name: 'Retry P', state: 'active', team: { userId: id.suresh, name: 'S' }, steps: [{ id: 'g1', text: 'One', done: false }] }]);
  await call('project.sync', { projectRef: 'rg1', project: 'Retry P', assigneeId: id.suresh, steps: [{ stepRef: 'g1', title: 'One' }] }, tok.boss); // owner's app: psc now
  await saveProjects([{ id: 'rg1', name: 'Retry P', state: 'active', team: { userId: id.suresh, name: 'S' }, steps: [{ id: 'g1', text: 'One', done: false }, { id: 'g2', text: 'Two', done: false }] }]);
  assert.deepEqual((await openOf('suresh', 'rg1')).map((t) => t.title), ['One'], 'skipped for now (the owner\'s app knows best)');
  sql(`USE wt; UPDATE wt.settings SET v = UNIX_TIMESTAMP() - 400 WHERE k = '${'psc:' + md5('rg1')}'; UPDATE wt.settings SET v = UNIX_TIMESTAMP() - 1 WHERE k = 'sync_retry'`);
  await call('me', {}, tok.anita); // any request runs the owed sync
  assert.deepEqual((await openOf('suresh', 'rg1')).map((t) => t.title), ['One', 'Two'], 'synced after the wait');
  await saveProjects([]);
});

test('regression: the whole-project update is carried once, and only onto the same person\'s step', { skip }, async () => {
  const W = (who, steps) => ({ id: 'rg2', name: 'Carry P', state: 'active', team: { userId: who, name: 'x' }, steps });
  await saveProjects([W(id.suresh, [])]);
  const whole = (await openOf('suresh', 'rg2'))[0];
  await call('update.save', { taskId: whole.id, note: 'whole-day words', state: 'progress' }, tok.suresh);
  await saveProjects([W(id.anita, [{ id: 'c1', text: 'C one', done: false }])]); // given to Anita with steps
  const a1 = (await openOf('anita', 'rg2'))[0];
  assert.equal((await call('task.get', { id: a1.id }, tok.anita)).task.today, null, 'Anita does not start with Suresh\'s words');
  await saveProjects([]);
  sql("DELETE FROM wt.settings WHERE k LIKE 'cw:%'");
  await saveProjects([W(id.suresh, [])]);
  const w2 = (await openOf('suresh', 'rg2'))[0];
  await call('update.save', { taskId: w2.id, note: 'mine', state: 'progress' }, tok.suresh);
  await saveProjects([W(id.suresh, [{ id: 'd1', text: 'D one', done: false }, { id: 'd2', text: 'D two', done: false }])]);
  const [d1, d2] = await openOf('suresh', 'rg2');
  assert.equal((await call('task.get', { id: d1.id }, tok.suresh)).task.today.note, 'mine', 'his own words count for his first step');
  await call('update.save', { taskId: d1.id, note: 'done', state: 'finished' }, tok.suresh);
  await saveProjects([W(id.suresh, [{ id: 'd1', text: 'D one', done: true, doneAt: new Date().toISOString() }, { id: 'd2', text: 'D two', done: false }])]);
  assert.equal((await call('task.get', { id: d2.id }, tok.suresh)).task.today, null, 'not copied again onto the next step');
  await saveProjects([]);
});

test('regression: staff cannot pick a step\'s id; two people with the same phone id get different steps', { skip }, async () => {
  await call('project.sync', { projectRef: 'rg3a', project: 'A', assigneeId: id.suresh, steps: [{ stepRef: 'h1', title: 'H' }] }, tok.boss);
  await call('project.sync', { projectRef: 'rg3b', project: 'B', assigneeId: id.anita, steps: [{ stepRef: 'h2', title: 'H2' }] }, tok.boss);
  const s1 = (await call('project.addStep', { projectRef: 'rg3a', title: 'X', clientId: 'h2xxxxxx-1' }, tok.suresh)).task;
  const s2 = (await call('project.addStep', { projectRef: 'rg3b', title: 'Y', clientId: 'h2xxxxxx-1' }, tok.anita)).task;
  assert.ok(s1.stepRef !== s2.stepRef && !s1.stepRef.includes('h2xxxxxx'), 'made by the server');
  await call('project.sync', { projectRef: 'rg3a', project: '', assigneeId: 0, steps: [] }, tok.boss);
  await call('project.sync', { projectRef: 'rg3b', project: '', assigneeId: 0, steps: [] }, tok.boss);
});

test('regression: giving a project again after a take-back is not a move away from the old person', { skip }, async () => {
  const steps = [{ stepRef: 'k1', title: 'K one' }];
  await call('project.sync', { projectRef: 'rg4', project: 'Regive P', assigneeId: id.suresh, steps }, tok.boss);
  await call('project.sync', { projectRef: 'rg4', project: 'Regive P', assigneeId: 0, steps: [], reason: 'taken' }, tok.boss);
  const n = pushLen();
  await call('project.sync', { projectRef: 'rg4', project: 'Regive P', assigneeId: id.anita, steps }, tok.boss);
  assert.ok(!/Off your list: Regive P/.test(pushSince(n)), 'Suresh is not told again');
  assert.equal((await openOf('anita', 'rg4')).length, 1);
  const t = (await openOf('anita', 'rg4'))[0];
  assert.ok(!(await call('update.save', { taskId: t.id, note: 'x', day: istDay(1) }, tok.suresh)).ok, 'Suresh cannot write into it now');
  await call('project.sync', { projectRef: 'rg4', project: '', assigneeId: 0, steps: [] }, tok.boss);
});

test('regression: the owner\'s unsaved change of person is not undone by another device\'s save', { skip }, async () => {
  const P = (who) => ({ id: 'rg5', name: 'Unsaved P', state: 'active', team: { userId: who, name: 'x' }, steps: [{ id: 'm1', text: 'M', done: false }] });
  await saveProjects([P(id.suresh)]);
  const base = (await call('dp.head', {}, tok.boss)).head;
  await call('project.sync', { projectRef: 'rg5', project: 'Unsaved P', assigneeId: id.anita, steps: [{ stepRef: 'm1', title: 'M' }], baseCommit: base, pending: true }, tok.boss);
  sql(`USE wt; UPDATE wt.settings SET v = UNIX_TIMESTAMP() - 400 WHERE k = '${'psc:' + md5('rg5')}'`);
  await saveProjects([P(id.suresh)]); // another device saves (still says Suresh)
  assert.equal((await openOf('anita', 'rg5')).length, 1, 'still with Anita');
  await saveProjects([P(id.anita)]); // the change of person is saved
  assert.equal((await openOf('anita', 'rg5')).length, 1);
  await saveProjects([]);
});

test('regression: the second Stuck alert names who wrote Stuck, and stops once the task is moved', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Stuck check', repeat: 'once' }, tok.boss)).task;
  const u = (await call('update.save', { taskId: t.id, note: 'No clay', state: 'stuck' }, tok.suresh)).update;
  await call('task.move', { id: t.id, toId: id.anita }, tok.boss);
  sql(`UPDATE wt.updates SET updated_at = NOW() - INTERVAL 25 HOUR WHERE id = ${u.id}; UPDATE wt.settings SET v = '0' WHERE k = 'jobs_at'`);
  const n = pushLen();
  await call('me', {}, tok.anita);
  assert.ok(!/Stuck check/.test(pushSince(n)), 'moved to Anita: no "still stuck" alert about Suresh\'s old Stuck');
});

test('regression: messages — a "moved" note is not a message to answer; an edit cannot empty a message or change a move note', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Msg check', repeat: 'once', project: 'Msg P', projectRef: 'rg7', stepRef: 'rg7s' }, tok.boss)).task;
  await call('task.move', { id: t.id, toId: id.anita }, tok.boss);
  const d = await call('project.updates', { projectRef: 'rg7' }, tok.boss);
  assert.ok(d.comments.some((c) => c.kind === 'move') && !d.comments.some((c) => c.unread), 'the move note is not "new"');
  const c = (await call('comment.add', { taskId: t.id, text: 'hello' }, tok.anita)).comments.at(-1);
  assert.ok(!(await call('comment.edit', { id: c.id, text: '↔ ' }, tok.anita)).ok, 'empty after the sign is refused');
  const moveNote = (await call('task.get', { id: t.id }, tok.boss)).comments.find((x) => x.text.startsWith('↔ Moved'));
  assert.ok(!(await call('comment.edit', { id: moveNote.id, text: 'changed' }, tok.boss)).ok, 'a move note cannot be changed');
});

test('regression: updates for an earlier day — only by who had the task that day; moved away and back is fine', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Earlier day', repeat: 'daily', skipSunday: false }, tok.boss)).task;
  sql(`UPDATE wt.tasks SET created_at = NOW() - INTERVAL 3 DAY, start_date = CURDATE() - INTERVAL 3 DAY WHERE id = ${t.id}`);
  await call('task.move', { id: t.id, toId: id.anita }, tok.boss);
  assert.ok(!(await call('update.save', { taskId: t.id, note: 'x', day: istDay(1) }, tok.anita)).ok, 'Anita got it today: yesterday was not hers');
  await call('task.move', { id: t.id, toId: id.suresh }, tok.boss);
  const r = await call('update.save', { taskId: t.id, note: 'yesterday, offline', day: istDay(1) }, tok.suresh);
  assert.ok(r.ok, 'Suresh had it yesterday (moved away and back today)');
});

test('regression: photos — kept by the browser only for the same sign-in; the new holder sees earlier photos', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Photo check', repeat: 'once' }, tok.boss)).task;
  const u = (await call('update.save', { taskId: t.id, note: 'with photo', state: 'progress' }, tok.suresh)).update;
  const p = await photo(u.id, tok.suresh);
  await call('task.move', { id: t.id, toId: id.anita }, tok.boss);
  const r = await fetch(`${B}photo&id=${p.photoId}`, { headers: { Authorization: 'Bearer ' + tok.anita } });
  assert.equal(r.status, 200, 'Anita (holds it now) sees Suresh\'s earlier photo');
  assert.match(r.headers.get('vary') || '', /Authorization/, 'browser copy tied to the sign-in');
  assert.equal((await fetch(`${B}photo&id=${p.photoId}`)).status, 401, 'no sign-in: refused');
});

test('regression: suggestions — only real ones in My suggestions; declined ones never count as missed work', { skip }, async () => {
  const sg = (await call('suggest', { title: 'Declined one', clientId: 'sgdecl-0001' }, tok.anita)).task;
  await call('task.decline', { id: sg.id, reason: 'later' }, tok.boss);
  const mine = await call('my.today', {}, tok.anita);
  assert.ok(mine.suggestions.some((x) => x.id === sg.id && x.declined), 'declined: shown as declined');
  assert.ok(!mine.suggestions.some((x) => x.fromStaff), 'a step added to a project is never listed as a suggestion');
  const anita = (await call('report.week', {}, tok.boss)).people.find((p) => p.name === 'Anita');
  assert.ok(anita, 'report works');
});

test('regression: the evening summary counts a replaced whole-project task once', { skip }, async () => {
  await call('project.sync', { projectRef: 'rg11', project: 'Sum P', assigneeId: id.suresh, steps: [{ stepRef: 'rg11:whole', title: 'Sum P' }] }, tok.boss);
  const w = (await openOf('suresh', 'rg11'))[0];
  await call('update.save', { taskId: w.id, note: 'today', state: 'progress' }, tok.suresh);
  await call('project.addStep', { projectRef: 'rg11', title: 'Real step', clientId: 'sumstep-0001' }, tok.suresh);
  const tt = await call('team.today', {}, tok.boss);
  assert.ok(!tt.tasks.some((t) => t.projectRef === 'rg11' && t.status === 'cancelled'), 'the replaced whole task is not listed next to its step');
  await call('project.sync', { projectRef: 'rg11', project: '', assigneeId: 0, steps: [] }, tok.boss);
});

test('regression: finished staff-added steps keep the whole-project task from coming back', { skip }, async () => {
  await call('project.sync', { projectRef: 'rg12', project: 'Own steps P', assigneeId: id.suresh, steps: [{ stepRef: 'rg12:whole', title: 'Own steps P' }] }, tok.boss);
  const s = (await call('project.addStep', { projectRef: 'rg12', title: 'My step', clientId: 'ownstep-0001' }, tok.suresh)).task;
  await call('update.save', { taskId: s.id, note: 'done', state: 'finished' }, tok.suresh);
  await call('project.sync', { projectRef: 'rg12', project: 'Own steps P', assigneeId: id.suresh, steps: [{ stepRef: 'rg12:whole', title: 'Own steps P' }], _server: true }, tok.boss);
  sql(`USE wt; UPDATE wt.settings SET v = '0' WHERE k = '${'psc:' + md5('rg12')}'`);
  assert.deepEqual((await openOf('suresh', 'rg12')).filter((t) => t.stepRef === 'rg12:whole'), [], 'no whole-project task again');
  await call('project.sync', { projectRef: 'rg12', project: '', assigneeId: 0, steps: [] }, tok.boss);
});

const pspRows = (ref) => Number(sql(`USE wt; SELECT COUNT(*) FROM wt.settings WHERE k = '${'psp:' + md5(ref)}'`).toString().trim().split('\n').pop());

test('regression: another device\'s save does not undo the owner\'s unsaved tick (the marker waits for the step change to be saved)', { skip }, async () => {
  const P = (done) => ({ id: 'rg15', name: 'Tick P', state: 'active', team: { userId: id.suresh, name: 'S' }, steps: [{ id: 'q1', text: 'Q one', done, ...(done ? { doneAt: new Date().toISOString() } : {}) }] });
  await saveProjects([P(false)]);
  assert.equal((await openOf('suresh', 'rg15')).length, 1);
  const base = (await call('dp.head', {}, tok.boss)).head;
  await call('project.sync', { projectRef: 'rg15', project: 'Tick P', assigneeId: id.suresh, steps: [], baseCommit: base, pending: true }, tok.boss); // ticked on the laptop, not saved yet
  assert.deepEqual(await openOf('suresh', 'rg15'), []);
  sql(`USE wt; UPDATE wt.settings SET v = UNIX_TIMESTAMP() - 400 WHERE k = '${'psc:' + md5('rg15')}'`);
  const n = pushLen();
  await saveProjects([P(false)]); // the phone saves something else (the tick is not in it)
  assert.deepEqual(await openOf('suresh', 'rg15'), [], 'the ticked step does not come back');
  assert.ok(!/New step in Tick P/.test(pushSince(n)), 'no "New step" news');
  assert.equal(pspRows('rg15'), 1, 'the marker stays');
  await saveProjects([P(true)]); // the laptop's tick is saved
  assert.equal(pspRows('rg15'), 0, 'cleared once the tick is saved');
  await saveProjects([]);
});

test('regression: a project.sync that fails does not leave the "unsaved changes" marker behind', { skip }, async () => {
  const P = (steps) => ({ id: 'rg16', name: 'Fail P', state: 'active', team: { userId: id.suresh, name: 'S' }, steps });
  await saveProjects([P([{ id: 'r1', text: 'R one', done: false }])]);
  const base = (await call('dp.head', {}, tok.boss)).head;
  const r = await call('project.sync', { projectRef: 'rg16', project: 'Fail P', assigneeId: 999999, steps: [{ stepRef: 'r1', title: 'R one' }], baseCommit: base, pending: true }, tok.boss);
  assert.ok(!r.ok, 'refused (no such person)');
  assert.equal(pspRows('rg16'), 0, 'no marker left');
  sql(`USE wt; UPDATE wt.settings SET v = UNIX_TIMESTAMP() - 400 WHERE k = '${'psc:' + md5('rg16')}'`);
  await saveProjects([P([{ id: 'r1', text: 'R one', done: false }, { id: 'r2', text: 'R two', done: false }])]); // e.g. /add
  assert.deepEqual((await openOf('suresh', 'rg16')).map((t) => t.title), ['R one', 'R two'], 'the server still delivers the new step');
  await saveProjects([]);
});

test('regression: the old holder is told when their step is closed as the project goes to someone else', { skip }, async () => {
  await call('project.sync', { projectRef: 'rg17', project: 'Handover P', assigneeId: id.suresh, steps: [{ stepRef: 'n1', title: 'N one' }] }, tok.boss);
  const n = pushLen();
  await call('project.sync', { projectRef: 'rg17', project: 'Handover P', assigneeId: id.anita, steps: [{ stepRef: 'n2', title: 'N two' }] }, tok.boss); // n1 ticked, n2 added, given to Anita
  assert.deepEqual(await openOf('suresh', 'rg17'), []);
  const toSuresh = pushSince(n).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.user === id.suresh);
  assert.ok(toSuresh.some((x) => /Off your list: Handover P/.test(JSON.stringify(x.msg))), 'Suresh is told it is off his list');
  await call('project.sync', { projectRef: 'rg17', project: '', assigneeId: 0, steps: [] }, tok.boss);
});

test('regression: an offline update on the whole-project task, sent after steps replaced it, counts for the first step', { skip }, async () => {
  await call('project.sync', { projectRef: 'rg18', project: 'Late whole P', assigneeId: id.suresh, steps: [{ stepRef: 'rg18:whole', title: 'Late whole P' }] }, tok.boss);
  const w = (await openOf('suresh', 'rg18'))[0];
  const writtenAt = new Date(Date.now() - 120000).toISOString(); // written offline before the steps came
  await call('project.sync', { projectRef: 'rg18', project: 'Late whole P', assigneeId: id.suresh, steps: [{ stepRef: 'lw1', title: 'LW one' }] }, tok.boss);
  const s1 = (await openOf('suresh', 'rg18'))[0];
  assert.equal(s1.title, 'LW one');
  const r = await call('update.save', { taskId: w.id, note: 'offline whole words', state: 'progress', writtenAt, clientId: 'lwhole-0001' }, tok.suresh);
  assert.ok(r.ok, r.error);
  assert.equal((await call('task.get', { id: s1.id }, tok.suresh)).task.today?.note, 'offline whole words', 'the first step has today\'s update');
  await call('project.sync', { projectRef: 'rg18', project: '', assigneeId: 0, steps: [] }, tok.boss);
});

test('regression: an earlier day\'s history update only by who held the task that day', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.anita, title: 'Held then', repeat: 'daily', skipSunday: false }, tok.boss)).task;
  sql(`UPDATE wt.tasks SET created_at = NOW() - INTERVAL 3 DAY, start_date = CURDATE() - INTERVAL 3 DAY WHERE id = ${t.id};
    INSERT INTO wt.updates (task_id, user_id, day, note, state, created_at, updated_at) VALUES (${t.id}, ${id.anita}, '${istDay(2)}', 'Anita words', 'progress', NOW(), NOW())`);
  await call('task.move', { id: t.id, toId: id.suresh }, tok.boss);
  await call('task.move', { id: t.id, toId: id.boss }, tok.boss);
  const r = await call('update.save', { taskId: t.id, note: 'not mine that day', day: istDay(2) }, tok.suresh);
  assert.ok(!r.ok, 'Suresh got it today: two days ago was not his');
  assert.equal(String(sql(`USE wt; SELECT note FROM wt.updates WHERE task_id = ${t.id} AND day = '${istDay(2)}'`)).trim().split('\n').pop(), 'Anita words', 'Anita\'s update is unchanged');
  // made for him yesterday and closed today: the day before it existed is refused too
  const c = (await call('task.save', { assigneeId: id.suresh, title: 'Closed later', repeat: 'once' }, tok.boss)).task;
  sql(`UPDATE wt.tasks SET created_at = NOW() - INTERVAL 1 DAY, start_date = CURDATE() - INTERVAL 1 DAY WHERE id = ${c.id}`);
  await call('task.status', { id: c.id, status: 'cancelled' }, tok.boss);
  assert.ok(!(await call('update.save', { taskId: c.id, note: 'before it existed', day: istDay(2) }, tok.suresh)).ok, 'refused');
  assert.equal(Number(String(sql(`USE wt; SELECT COUNT(*) FROM wt.updates WHERE task_id = ${c.id}`)).trim().split('\n').pop()), 0, 'no row saved');
});

test('regression: a project given as one task counts as open, and stays listed once finished', { skip }, async () => {
  await call('project.sync', { projectRef: 'rg19', project: 'One task P', assigneeId: id.suresh, steps: [{ stepRef: 'rg19:whole', title: 'One task P' }] }, tok.boss);
  let ov = (await call('projects.overview', {}, tok.boss)).projects.find((p) => p.ref === 'rg19');
  assert.ok(ov && ov.open >= 1, 'not "all done" while its task is open');
  const w = (await openOf('suresh', 'rg19'))[0];
  assert.ok((await call('update.save', { taskId: w.id, note: 'done', state: 'finished' }, tok.suresh)).ok);
  ov = (await call('projects.overview', {}, tok.boss)).projects.find((p) => p.ref === 'rg19');
  assert.ok(ov, 'still listed after it is finished');
});

test('regression: a project deleted and put back with Undo is never taken back by the server', { skip }, async () => {
  const P = { id: 'rg20', name: 'Undo P', state: 'active', team: { userId: id.suresh, name: 'S' }, steps: [{ id: 'u1', text: 'U one', done: false }] };
  await saveProjects([P]);
  const before = (await openOf('suresh', 'rg20')).map((t) => t.id);
  assert.equal(before.length, 1);
  const n = pushLen();
  await saveProjects([]); // deleted in the projects app
  assert.deepEqual((await openOf('suresh', 'rg20')).map((t) => t.id), before, 'kept during the Undo wait');
  await saveProjects([P]); // Undo
  assert.deepEqual((await openOf('suresh', 'rg20')).map((t) => t.id), before, 'the same step, never cancelled');
  assert.ok(!/Off your list: Undo P/.test(pushSince(n)), 'Suresh is not told it went');
  await saveProjects([]);
  sql("USE wt; UPDATE wt.dp_commits SET at = at - INTERVAL 30 SECOND WHERE id = (SELECT v FROM wt.settings WHERE k = 'dp_head'); UPDATE wt.settings SET v = UNIX_TIMESTAMP() - 1 WHERE k = 'sync_retry'");
  await call('me', {}, tok.anita);
  assert.deepEqual(await openOf('suresh', 'rg20'), [], 'taken back once the wait is over');
});

test('regression: "Seen" and Send mark messages read only up to the newest one shown', { skip }, async () => {
  const t = (await call('task.save', { assigneeId: id.suresh, title: 'Seen check', repeat: 'once', project: 'Seen P', projectRef: 'rs10', stepRef: 'rs10s' }, tok.boss)).task;
  const shown = (await call('comment.add', { taskId: t.id, text: 'first' }, tok.suresh)).comments.at(-1);
  await call('comment.add', { taskId: t.id, text: 'came later' }, tok.suresh);
  await call('tasks.read', { ids: [t.id], upTo: shown.id }, tok.boss);
  let d = await call('project.updates', { projectRef: 'rs10' }, tok.boss);
  assert.deepEqual(d.comments.filter((c) => c.unread).map((c) => c.text), ['came later'], 'the message that came after the box was drawn stays new');
  const later = d.comments.find((c) => c.text === 'came later');
  await call('comment.add', { taskId: t.id, text: 'ok', upTo: shown.id }, tok.boss);
  d = await call('project.updates', { projectRef: 'rs10' }, tok.boss);
  assert.ok(d.comments.find((c) => c.id === later.id).unread, 'Send also leaves it new');
  await call('tasks.read', { ids: [t.id] }, tok.boss);
  d = await call('project.updates', { projectRef: 'rs10' }, tok.boss);
  assert.ok(!d.comments.some((c) => c.unread), 'without upTo: all read, as before');
});

test('regression: a step\'s turn still starts when the step before it finished, after the project is sent again without it', { skip }, async () => {
  const S = (...r) => r.map((x) => ({ stepRef: x, title: 'Turn ' + x }));
  await call('project.sync', { projectRef: 'rg21', project: 'Turn P', assigneeId: id.suresh, steps: S('rg21a', 'rg21b', 'rg21c') }, tok.boss);
  const [a, b] = await openOf('suresh', 'rg21');
  sql(`UPDATE wt.tasks SET created_at = NOW() - INTERVAL 6 DAY, start_date = CURDATE() - INTERVAL 6 DAY WHERE project_ref = 'rg21'`);
  assert.ok((await call('update.save', { taskId: a.id, note: 'done', state: 'finished' }, tok.suresh)).ok);
  sql(`UPDATE wt.tasks SET done_at = '${istDay(2)} 10:00:00' WHERE id = ${a.id}`);
  await call('project.sync', { projectRef: 'rg21', project: 'Turn P', assigneeId: id.suresh, steps: S('rg21b', 'rg21c') }, tok.boss); // a ticked
  assert.equal((await call('task.get', { id: b.id }, tok.suresh)).task.turnSince, istDay(2), 'b\'s turn began when a finished');
  await call('project.sync', { projectRef: 'rg21', project: 'Turn P', assigneeId: id.suresh, steps: S('rg21b') }, tok.boss); // c (waiting) deleted
  await call('project.sync', { projectRef: 'rg21', project: 'Turn P', assigneeId: id.suresh, steps: S('rg21b', 'rg21d') }, tok.boss); // d added
  assert.equal((await call('task.get', { id: b.id }, tok.suresh)).task.turnSince, istDay(2), 'a waiting step deleted later does not move b\'s turn');
  const d = (await openOf('suresh', 'rg21')).find((t) => t.stepRef === 'rg21d');
  assert.ok(d.queued && d.seq > b.seq, 'd waits after b');
  await call('project.sync', { projectRef: 'rg21', project: '', assigneeId: 0, steps: [] }, tok.boss);
});

test('regression: my.today does not list a whole-project task that steps replaced today', { skip }, async () => {
  await call('project.sync', { projectRef: 'rg22', project: 'Replaced P', assigneeId: id.suresh, steps: [{ stepRef: 'rg22:whole', title: 'Replaced P' }] }, tok.boss);
  const w = (await openOf('suresh', 'rg22'))[0];
  assert.ok((await call('update.save', { taskId: w.id, note: 'whole words', state: 'progress' }, tok.suresh)).ok);
  await call('project.sync', { projectRef: 'rg22', project: 'Replaced P', assigneeId: id.suresh, steps: [{ stepRef: 'rg22s', title: 'R one' }] }, tok.boss);
  const m = await call('my.today', {}, tok.suresh);
  const mine = [...m.tasks, ...m.other].filter((t) => t.projectRef === 'rg22');
  assert.deepEqual(mine.map((t) => t.stepRef), ['rg22s'], 'only the step (it carries the words)');
  assert.equal(mine[0].today?.note, 'whole words');
  await call('project.sync', { projectRef: 'rg22', project: '', assigneeId: 0, steps: [] }, tok.boss);
});

test('regression: "Give task" sent twice with the same clientId makes one task', { skip }, async () => {
  const body = { assigneeId: id.anita, title: 'Give once check', repeat: 'once', clientId: 'give-form-0001' };
  const n = pushLen();
  const one = await call('task.save', body, tok.boss);
  const two = await call('task.save', body, tok.boss); // the answer was lost, tapped again
  assert.ok(one.task && two.task);
  assert.equal(two.task.id, one.task.id, 'the same task comes back');
  assert.equal(Number(String(sql("USE wt; SELECT COUNT(*) FROM wt.tasks WHERE title = 'Give once check'")).trim().split('\n').pop()), 1);
  assert.equal(pushSince(n).split('\n').filter((l) => l.includes('Give once check')).length, 1, 'one notice');
  const other = await call('task.save', { ...body, clientId: 'give-form-0002' }, tok.boss);
  assert.notEqual(other.task.id, one.task.id, 'a new form is a new task');
  const plain = await call('task.save', { assigneeId: id.anita, title: 'Give once check' }, tok.boss);
  assert.ok(plain.task.id !== one.task.id && plain.task.id !== other.task.id, 'no clientId: made as before');
});

test('regression: the projects app naming the old person after a Work Task move keeps the project with the new person', { skip }, async () => {
  const psc = 'psc:' + md5('rg23');
  const r0 = await call('project.sync', { projectRef: 'rg23', project: 'Moved P', assigneeId: id.suresh, steps: [{ stepRef: 'rg23a', title: 'M one' }] }, tok.boss);
  assert.equal(r0.assigneeId, id.suresh);
  sql(`USE wt; UPDATE wt.settings SET v = v - 10 WHERE k = '${psc}'`); // given a little while ago
  const a = (await openOf('suresh', 'rg23'))[0];
  await call('task.move', { id: a.id, toId: id.anita }, tok.boss); // Move to… in Work Task
  assert.ok((await call('update.save', { taskId: a.id, note: 'all done', state: 'finished' }, tok.anita)).ok); // no open steps left
  const r = await call('project.sync', { projectRef: 'rg23', project: 'Moved P', assigneeId: id.suresh, steps: [{ stepRef: 'rg23b', title: 'M two' }] }, tok.boss);
  assert.equal(r.assigneeId, id.anita, 'the answer names who has it now');
  assert.deepEqual((await openOf('anita', 'rg23')).map((t) => t.stepRef), ['rg23b'], 'the new step goes to Anita');
  assert.deepEqual(await openOf('suresh', 'rg23'), [], 'not to Suresh');
  const back = await call('project.sync', { projectRef: 'rg23', project: 'Moved P', assigneeId: id.suresh, steps: [{ stepRef: 'rg23b', title: 'M two' }] }, tok.boss);
  assert.equal(back.assigneeId, id.suresh, 'given back by the owner after that: honoured');
  assert.deepEqual((await openOf('suresh', 'rg23')).map((t) => t.stepRef), ['rg23b']);
  await call('project.sync', { projectRef: 'rg23', project: '', assigneeId: 0, steps: [] }, tok.boss);
});

test('project description: project.sync stores about; the team sees it as projectAbout (overview, project pages, tasks); cut to 1000', { skip }, async () => {
  const pab = () => String(sql(`USE wt; SELECT COUNT(*) FROM wt.settings WHERE k = '${'pab:' + md5('ab1')}'`)).trim().split('\n').pop();
  const sync = (about) => call('project.sync', { projectRef: 'ab1', project: 'About P', about, assigneeId: id.suresh, steps: [{ stepRef: 'ab1a', title: 'A one' }, { stepRef: 'ab1b', title: 'A two' }] }, tok.boss);
  const r = await sync('  Glaze  for the\nnew basin line ');
  assert.equal(r.tasks[0].projectAbout, 'Glaze for the new basin line', 'one line, trimmed');
  const row = (await call('projects.overview', {}, tok.boss)).projects.find((p) => p.ref === 'ab1');
  assert.equal(row.projectAbout, 'Glaze for the new basin line', 'the manager\'s Projects list');
  assert.equal((await call('project.team', { projectRef: 'ab1' }, tok.boss)).tasks[0].projectAbout, 'Glaze for the new basin line');
  assert.ok((await call('project.mine', { projectRef: 'ab1' }, tok.suresh)).tasks.every((t) => t.projectAbout === 'Glaze for the new basin line'), 'the person\'s project page');
  const mine = await openOf('suresh', 'ab1');
  assert.ok(mine.length === 2 && mine.every((t) => t.projectAbout === 'Glaze for the new basin line'), 'my.today tasks');
  assert.equal((await call('task.get', { id: mine[0].id }, tok.suresh)).task.projectAbout, 'Glaze for the new basin line', 'the task page');
  await sync('y'.repeat(1200));
  assert.equal((await openOf('suresh', 'ab1'))[0].projectAbout.length, 1000, 'cut to 1000 (owner asked for 1000 letters, 22 Oct)');
  await sync('Changed words');
  assert.equal((await openOf('suresh', 'ab1'))[0].projectAbout, 'Changed words', 'a change is sent again');
  await call('project.sync', { projectRef: 'ab1', project: 'About P', assigneeId: id.suresh, steps: [{ stepRef: 'ab1a', title: 'A one' }, { stepRef: 'ab1b', title: 'A two' }] }, tok.boss);
  assert.equal((await openOf('suresh', 'ab1'))[0].projectAbout, 'Changed words', 'a sync without about (an older app) keeps it');
  await sync('');
  assert.equal((await openOf('suresh', 'ab1'))[0].projectAbout, '', 'emptied');
  assert.equal(pab(), '0', 'no empty row kept');
  const plain = await call('task.save', { assigneeId: id.anita, title: 'Not a project step' }, tok.boss);
  assert.equal(plain.task.projectAbout, '', 'a task that is not a project step has none');
  await call('project.sync', { projectRef: 'ab1', project: '', assigneeId: 0, steps: [] }, tok.boss);
});

test('project description: the server-side sync from saved projects carries about, and a change updates it', { skip }, async () => {
  const P = (about) => ({ id: 'ab2', name: 'Saved About P', state: 'active', about, team: { userId: id.suresh, name: 'S' }, steps: [{ id: 'ab2a', text: 'S one', done: false }] });
  await saveProjects([P('Kiln rebuild for line 2')]);
  assert.equal((await openOf('suresh', 'ab2'))[0].projectAbout, 'Kiln rebuild for line 2');
  await saveProjects([P('Kiln rebuild, now line 3')]);
  assert.equal((await openOf('suresh', 'ab2'))[0].projectAbout, 'Kiln rebuild, now line 3', 'changed');
  await saveProjects([{ ...P(''), about: undefined }]);
  assert.equal((await openOf('suresh', 'ab2'))[0].projectAbout, '', 'saved data without about: none');
  await saveProjects([]);
});

// ---------------------------------------------------------------- 📧 morning email
test('morning email: user.save keeps a valid email and refuses a bad one; only the manager can read it', { skip }, async () => {
  const r = await call('user.save', { name: 'Mira', username: 'mira', password: 'first-pass-123', email: 'mira@example.com' }, tok.boss);
  assert.ok(r.ok, r.error); id.mira = r.user.id;
  assert.equal(r.user.email, 'mira@example.com');
  const l = await call('login', { username: 'mira', password: 'first-pass-123' });
  assert.ok((await call('password', { old: 'first-pass-123', new: 'mira-own-pass' }, l.token)).ok);
  tok.mira = l.token;
  const listed = async () => (await call('users.list', {}, tok.boss)).users.find((u) => u.id === id.mira);
  assert.equal((await listed()).email, 'mira@example.com', 'the manager sees it');
  assert.match((await call('user.save', { id: id.mira, name: 'Mira', email: 'not an email' }, tok.boss)).error || '', /email address is not right/);
  assert.match((await call('user.save', { name: 'Bad', username: 'bademail', password: 'first-pass-123', email: 'a@b' }, tok.boss)).error || '', /email address is not right/, 'a new person too');
  assert.ok(!(await call('users.list', {}, tok.boss)).users.some((u) => u.username === 'bademail'), 'not added');
  assert.ok(!(await call('user.save', { id: id.mira, name: 'Mira', email: 'x'.repeat(115) + '@example.com' }, tok.boss)).ok, 'more than 120 letters is cut, and then not right');
  assert.equal((await listed()).email, 'mira@example.com', 'a refused email changes nothing');
  assert.ok((await call('user.save', { id: id.mira, name: 'Mira K' }, tok.boss)).ok);
  assert.equal((await listed()).email, 'mira@example.com', 'a rename (no email sent) keeps it');
  assert.ok((await call('user.save', { id: id.mira, name: 'Mira', email: ' mira.k@example.com ' }, tok.boss)).ok);
  assert.equal((await listed()).email, 'mira.k@example.com', 'changed (spaces trimmed)');
  assert.equal((await call('users.list', {}, tok.mira)).s, 403, 'staff cannot list people or their emails');
  const me = await call('me', {}, tok.mira);
  assert.ok(me.ok && !('email' in me.user), 'not in what staff get back');
  assert.ok(!(await call('team.today', {}, tok.boss)).people.some((p) => 'email' in p), 'not in the team list either');
});

test('morning email: morning.mail is manager-only and lists late, stuck, a given project as one row, never done/cancelled or someone else\'s', { skip }, async () => {
  assert.equal((await call('morning.mail', { userId: id.mira }, tok.mira)).s, 403, 'staff refused');
  assert.equal((await call('morning.mail', { userId: id.mira }, tok.anita)).s, 403, 'other staff refused');
  assert.equal((await call('morning.mail', { userId: 999999 }, tok.boss)).s, 404);
  const give = async (title, extra = {}) => (await call('task.save', { assigneeId: id.mira, title, ...extra }, tok.boss)).task;
  const late = await give('MM late job', { repeat: 'once', dueDate: istDay(2) });
  const stuck = await give('MM stuck job', { repeat: 'daily', skipSunday: false });
  await call('update.save', { taskId: stuck.id, note: 'No spare brush', state: 'stuck' }, tok.mira);
  const daily = await give('MM daily check', { repeat: 'daily', skipSunday: false });
  const long = 'Checked all ten kilns and wrote the numbers in the book, top zone 1180, bottom zone 1150, all fine today';
  await call('update.save', { taskId: daily.id, note: long, state: 'progress' }, tok.mira);
  const notToday = (new Date(istDay(0) + 'T00:00:00Z').getUTCDay() + 1) % 7;
  await give('MM weekly not today', { repeat: 'weekly', weekday: notToday });
  const done = await give('MM done job', { repeat: 'once' });
  await call('task.status', { id: done.id, status: 'done' }, tok.boss);
  const gone = await give('MM cancelled job', { repeat: 'once' });
  await call('task.status', { id: gone.id, status: 'cancelled' }, tok.boss);
  await call('task.save', { assigneeId: id.anita, title: 'MM anita job', repeat: 'daily', skipSunday: false }, tok.boss);
  await saveProjects([{ id: 'mm1', name: 'MM Basin glaze', state: 'active', about: 'New glaze for line 2', team: { userId: id.mira, name: 'Mira' },
    steps: [{ id: 'mm1a', text: 'Mix glaze', done: false }, { id: 'mm1b', text: 'Fire test', done: false }] }]);
  const steps = await openOf('mira', 'mm1');
  assert.equal(steps.length, 2);
  await call('update.save', { taskId: steps[0].id, note: 'Mixed 20 kg', state: 'progress' }, tok.mira);

  const r = await call('morning.mail', { userId: id.mira }, tok.boss);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.person, { id: id.mira, name: 'Mira', email: 'mira.k@example.com' });
  assert.equal(r.manager, 'Boss'); assert.equal(r.today, istDay(0));
  const by = Object.fromEntries(r.items.map((x) => [x.title, x]));
  assert.deepEqual(Object.keys(by).sort(), ['MM Basin glaze', 'MM daily check', 'MM late job', 'MM stuck job'], 'no done, cancelled, weekly-not-today or other person\'s work');
  assert.equal(by['MM late job'].lateSince, istDay(2)); assert.equal(by['MM late job'].lastUpdate, null);
  assert.equal(by['MM late job'].kind, 'task'); assert.equal(by['MM late job'].repeat, '');
  assert.equal(by['MM stuck job'].stuck, true); assert.equal(by['MM stuck job'].lateSince, null); assert.equal(by['MM stuck job'].repeat, 'Daily');
  assert.deepEqual(by['MM stuck job'].lastUpdate, { day: istDay(0), note: 'No spare brush' });
  assert.equal(by['MM daily check'].stuck, false);
  assert.ok(by['MM daily check'].lastUpdate.note.length <= 80 && by['MM daily check'].lastUpdate.note.endsWith('…'), 'a long note is cut');
  const p = by['MM Basin glaze'];
  assert.deepEqual([p.kind, p.about, p.now, p.stuck, p.lateSince], ['project', 'New glaze for line 2', 'Mix glaze', false, null], 'the project as one row, with its current step');
  assert.deepEqual(p.lastUpdate, { day: istDay(0), note: 'Mixed 20 kg' });
  assert.equal(r.items.filter((x) => x.kind === 'project').length, 1, 'one row for the project, not one per step');
  const anita = await call('morning.mail', { userId: id.anita }, tok.boss);
  assert.ok(anita.items.some((x) => x.title === 'MM anita job') && !anita.items.some((x) => x.title.startsWith('MM ') && x.title !== 'MM anita job'), 'each person only their own');
  await saveProjects([]);
});

test('morning email on People: people.morning and morning.sent are manager-only; each active staff person with the same items as morning.mail and today\'s send (yesterday\'s counts as not sent)', { skip }, async () => {
  assert.equal((await call('people.morning', {}, tok.mira)).s, 403, 'staff cannot read the page');
  assert.equal((await call('morning.sent', { userId: id.mira }, tok.mira)).s, 403, 'staff cannot mark it sent');
  assert.equal((await call('morning.sent', { userId: id.mira }, tok.anita)).s, 403, 'other staff refused too');
  assert.equal((await call('morning.sent', { userId: 999999 }, tok.boss)).s, 404);
  // someone switched off: not on the list
  const off = await call('user.save', { name: 'PM Off', username: 'pmoff', password: 'first-pass-123' }, tok.boss);
  assert.ok(off.ok, off.error);
  await call('task.save', { assigneeId: off.user.id, title: 'PM off job', repeat: 'daily', skipSunday: false }, tok.boss);
  await call('user.active', { id: off.user.id, active: false }, tok.boss);
  await call('task.save', { assigneeId: id.mira, title: 'PM late job', repeat: 'once', dueDate: istDay(1) }, tok.boss);

  const r = await call('people.morning', {}, tok.boss);
  assert.ok(r.ok, r.error);
  assert.equal(r.today, istDay(0));
  const staff = (await call('users.list', {}, tok.boss)).users.filter((u) => u.active && u.role === 'staff').map((u) => u.id).sort((a, b) => a - b);
  assert.deepEqual(r.people.map((p) => p.id).sort((a, b) => a - b), staff, 'every active staff person, never the manager or a switched-off person');
  const mira = r.people.find((p) => p.id === id.mira);
  assert.equal(mira.name, 'Mira'); assert.equal(mira.email, 'mira.k@example.com');
  assert.deepEqual(mira.items, (await call('morning.mail', { userId: id.mira }, tok.boss)).items, 'the same items as the morning email');
  assert.ok(mira.items.some((x) => x.title === 'PM late job' && x.lateSince === istDay(1) && x.taskId > 0), 'with the task to open');
  assert.equal(mira.sentAt, null, 'not sent yet');

  const sent = await call('morning.sent', { userId: id.mira }, tok.boss);
  assert.ok(sent.ok, sent.error);
  assert.equal(sent.sentAt.slice(0, 10), istDay(0));
  const again = (await call('people.morning', {}, tok.boss)).people.find((p) => p.id === id.mira);
  assert.equal(again.sentAt, sent.sentAt, 'today\'s time, on every device');
  assert.equal((await call('team.today', {}, tok.boss)).people.find((p) => p.id === id.mira).morningSentAt, sent.sentAt, 'on Team today too');
  assert.equal((await call('people.morning', {}, tok.boss)).people.find((p) => p.id === id.anita).sentAt, null, 'only that person');

  sql(`USE wt; UPDATE settings SET v = '${istDay(1)} 09:05:00' WHERE k = 'ms:${id.mira}';`);
  assert.equal((await call('people.morning', {}, tok.boss)).people.find((p) => p.id === id.mira).sentAt, null, 'yesterday\'s send shows as not sent today');
  assert.equal((await call('team.today', {}, tok.boss)).people.find((p) => p.id === id.mira).morningSentAt, null);
});

// ---------------------------------------------------------------- 🔁 Follow-up, 🔔 Chase, work in one line
test('follow-up: followup.list is manager-only and lists every open task given to staff, with by-date, silent days (Sundays off), stuck, newest update; a project once; never done/cancelled', { skip }, async () => {
  for (const [u, n] of [['kavi', 'Kavi'], ['nila', 'Nila']]) {
    const r = await call('user.save', { name: n, username: u, password: 'first-pass-123' }, tok.boss);
    assert.ok(r.ok, r.error); id[u] = r.user.id;
    const l = await call('login', { username: u, password: 'first-pass-123' });
    await call('password', { old: 'first-pass-123', new: `${u}-own-pass` }, l.token);
    tok[u] = l.token;
  }
  assert.equal((await call('followup.list', {}, tok.kavi)).s, 403, 'staff refused');
  const give = async (title, extra = {}) => (await call('task.save', { assigneeId: id.kavi, title, ...extra }, tok.boss)).task;
  const silent = await give('FU silent', { repeat: 'daily', skipSunday: true });
  const every = await give('FU every day', { repeat: 'daily', skipSunday: false });
  const overdue = await give('FU overdue', { repeat: 'once', skipSunday: true, dueDate: istDay(2) });
  const stuck = await give('FU stuck', { repeat: 'daily', skipSunday: true });
  const soon = await give('FU soon', { repeat: 'once', skipSunday: true, dueDate: istDay(-2) });
  const fresh = await give('FU updated today', { repeat: 'daily', skipSunday: true });
  const done = await give('FU done', { repeat: 'once' });
  const gone = await give('FU cancelled', { repeat: 'once' });
  await call('task.status', { id: done.id, status: 'done' }, tok.boss);
  await call('task.status', { id: gone.id, status: 'cancelled' }, tok.boss);
  await call('task.save', { assigneeId: id.boss, title: 'FU boss own', repeat: 'daily' }, tok.boss);
  // given some days ago: silent counts the due days since the newest update (Mon–Sat work: Sundays are off)
  sql(`USE wt; UPDATE tasks SET created_at = '${istDay(6)} 09:00:00', start_date = '${istDay(6)}' WHERE id = ${silent.id};
    UPDATE tasks SET created_at = '${istDay(4)} 09:00:00', start_date = '${istDay(4)}' WHERE id = ${every.id};
    INSERT INTO updates (task_id, user_id, day, note, state, created_at, updated_at) VALUES (${silent.id}, ${id.kavi}, '${istDay(5)}', 'started', 'progress', NOW(), NOW());`);
  await call('update.save', { taskId: stuck.id, note: 'Waiting for nozzle', state: 'stuck' }, tok.kavi);
  await call('update.save', { taskId: fresh.id, note: '42 s, ok', state: 'progress' }, tok.kavi);
  await saveProjects([{ id: 'fu1', name: 'FU Glaze line', state: 'active', team: { userId: id.kavi, name: 'Kavi' },
    steps: [{ id: 'fu1a', text: 'Mix glaze', done: false }, { id: 'fu1b', text: 'Fire test', done: false }] }]);
  const steps = await openOf('kavi', 'fu1');
  assert.equal(steps.length, 2);

  const r = await call('followup.list', {}, tok.boss);
  assert.ok(r.ok, r.error); assert.equal(r.today, istDay(0));
  const mine = r.rows.filter((x) => x.person.id === id.kavi);
  const by = Object.fromEntries(mine.map((x) => [x.title, x]));
  assert.deepEqual(Object.keys(by).sort(), ['FU Glaze line', 'FU every day', 'FU overdue', 'FU silent', 'FU soon', 'FU stuck', 'FU updated today'], 'no done or cancelled');
  assert.ok(!r.rows.some((x) => x.title === 'FU boss own'), 'only work given to staff');
  const sunday = (d) => new Date(d + 'T00:00:00Z').getUTCDay() === 0;
  const dueDays = (from, skipSun) => { let n = 0; for (let b = from; b >= 1; b--) if (!(skipSun && sunday(istDay(b)))) n++; return n; };
  assert.equal(by['FU silent'].silentDays, dueDays(4, true), 'silent: due days after the last update, Sundays off');
  assert.deepEqual(by['FU silent'].lastUpdate, { day: istDay(5), note: 'started' });
  assert.equal(by['FU every day'].silentDays, 4, 'every day incl. Sunday: 4 days with no update');
  assert.equal(by['FU every day'].lastUpdate, null);
  assert.deepEqual([by['FU overdue'].dueDate, by['FU overdue'].silentDays], [istDay(2), 0], 'overdue (given today: nothing missed yet)');
  assert.deepEqual([by['FU stuck'].stuck, by['FU stuck'].lastUpdate.note], [true, 'Waiting for nozzle']);
  assert.equal(by['FU soon'].dueDate, istDay(-2));
  assert.deepEqual([by['FU updated today'].lastUpdate, by['FU updated today'].silentDays, by['FU updated today'].stuck], [{ day: istDay(0), note: '42 s, ok' }, 0, false]);
  const p = by['FU Glaze line'];
  assert.deepEqual([p.kind, p.projectRef, p.step, p.taskId], ['project', 'fu1', 'Mix glaze', steps[0].id], 'the project once, its current step');
  assert.equal(mine.filter((x) => x.projectRef === 'fu1').length, 1, 'one row, not one per step');
  assert.deepEqual([by['FU silent'].kind, by['FU silent'].taskId, by['FU silent'].person, by['FU silent'].chasedAt], ['task', silent.id, { id: id.kavi, name: 'Kavi' }, null]);
  id.fuSilent = silent.id; id.fuStep = steps[0].id;
});

test('follow-up: task.chase is manager-only, adds the message, sends the alert, and refuses a second chase within an hour', { skip }, async () => {
  const keys = { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'), auth: randomBytes(16).toString('base64url') };
  assert.ok((await call('push.subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/kavi-phone', keys }, tok.kavi)).ok);
  assert.equal((await call('task.chase', { id: id.fuSilent }, tok.kavi)).s, 403, 'staff cannot chase');
  const n = pushLen();
  const c = await call('task.chase', { id: id.fuSilent }, tok.boss);
  assert.ok(c.ok, c.error);
  assert.ok(c.comments.some((m) => m.text === '🔔 Boss asks for an update on this.' && m.byId === id.boss), 'a message on the task');
  const alerts = pushSince(n).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.user === id.kavi);
  assert.equal(alerts.length, 1, 'one alert to the person');
  assert.match(alerts[0].msg.title, /🔔 Boss · FU silent/);
  const g = await call('task.get', { id: id.fuSilent }, tok.kavi);
  assert.ok(g.comments.some((m) => m.text === '🔔 Boss asks for an update on this.'), 'the person sees it in the messages');
  const again = await call('task.chase', { id: id.fuSilent }, tok.boss);
  assert.match(again.error || '', /^Already chased at \d\d:\d\d\.$/, 'refused within the hour');
  assert.equal((await call('task.get', { id: id.fuSilent }, tok.boss)).comments.filter((m) => m.text.startsWith('🔔 Boss asks')).length, 1, 'no second message');
  const row = (await call('followup.list', {}, tok.boss)).rows.find((x) => x.taskId === id.fuSilent);
  assert.equal(row.chasedAt.slice(0, 10), istDay(0), 'the list knows when it was chased');
  sql(`USE wt; UPDATE comments SET at = DATE_SUB(at, INTERVAL 61 MINUTE) WHERE task_id = ${id.fuSilent} AND kind = 'chase';`);
  assert.ok((await call('task.chase', { id: id.fuSilent }, tok.boss)).ok, 'after an hour it can be chased again');
  assert.ok((await call('task.chase', { id: id.fuStep }, tok.boss)).ok, 'a project step can be chased');
  // ✓ Done on a project step is the usual Mark done; it leaves the list
  assert.ok((await call('task.status', { id: id.fuStep, status: 'done' }, tok.boss)).ok);
  const after = (await call('followup.list', {}, tok.boss)).rows.find((x) => x.projectRef === 'fu1');
  assert.deepEqual([after.step, after.taskId === id.fuStep], ['Fire test', false], 'the next step is now the project\'s row');
  assert.match((await call('task.chase', { id: id.fuStep }, tok.boss)).error || '', /closed/, 'a closed task is not chased');
  await saveProjects([]);
});

test('work in one line: giving the same quick task twice (same clientId) makes one task, a one-time task with its by-date', { skip }, async () => {
  const body = { assigneeId: id.nila, title: 'Send kiln photos', details: '', project: '', repeat: 'once', skipSunday: true, dueDate: istDay(-1), clientId: 'quick-0001-abcdef' };
  const a = await call('task.save', body, tok.boss);
  const b = await call('task.save', body, tok.boss);
  assert.ok(a.ok && b.ok, a.error || b.error);
  assert.equal(a.task.id, b.task.id, 'the second tap gives back the same task');
  assert.deepEqual([a.task.repeat, a.task.dueDate, a.task.skipSunday], ['once', istDay(-1), true]);
  assert.equal((await call('followup.list', {}, tok.boss)).rows.filter((x) => x.title === 'Send kiln photos' && x.person.id === id.nila).length, 1, 'one row');
});

// ---------------------------------------------------------------- Outlook → Daily Projects Inbox (against a fake Microsoft)
const ms = { reqs: [], token: null, pages: [[]], sent: [], bodies: {}, draftCode: 201, composeCode: 201, server: null };
async function fakeMicrosoft() {
  if (ms.server) return;
  ms.server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, MS);
      const form = Object.fromEntries(new URLSearchParams(body));
      ms.reqs.push({ method: req.method, path: u.pathname, url: req.url, auth: req.headers.authorization || '', form, body, prefer: req.headers.prefer || '' });
      const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (u.pathname.endsWith('/oauth2/v2.0/token')) { const [code, j] = ms.token(form); return send(code, j); }
      if (u.pathname === '/v1.0/me') return send(200, { mail: 'venkat@acton.test', userPrincipalName: 'venkat@acton.test' });
      if (u.pathname === '/v1.0/me/mailFolders/inbox/messages' || u.pathname === '/v1.0/next') {
        const n = Number(u.searchParams.get('page') || 0);
        return send(200, { value: ms.pages[n] || [], ...(ms.pages[n + 1] ? { '@odata.nextLink': `${MS}/v1.0/next?page=${n + 1}` } : {}) });
      }
      if (u.pathname === '/v1.0/me/mailFolders/sentitems/messages') return send(200, { value: ms.sent });
      if (u.pathname === '/v1.0/me/messages' && req.method === 'POST') { // a new draft (outlook.compose)
        if (ms.composeCode !== 201) return send(ms.composeCode, { error: { code: 'x' } });
        return send(201, { id: 'new-draft-1', isDraft: true, webLink: 'https://outlook.office365.com/owa/?ItemID=new-draft-1&exvsurl=1' });
      }
      let mm = /^\/v1\.0\/me\/messages\/([^/]+)\/createReply$/.exec(u.pathname);
      if (mm && req.method === 'POST') {
        if (ms.draftCode !== 201) return send(ms.draftCode, { error: { code: 'x' } });
        return send(201, { id: 'draft-' + decodeURIComponent(mm[1]), webLink: `https://outlook.office365.com/owa/?ItemID=draft-${mm[1]}&exvsurl=1` });
      }
      mm = /^\/v1\.0\/me\/messages\/([^/]+)$/.exec(u.pathname);
      if (mm && ms.bodies[decodeURIComponent(mm[1])]) return send(200, ms.bodies[decodeURIComponent(mm[1])]);
      send(404, { error: 'not_found' });
    });
  });
  await new Promise((r) => ms.server.listen(MS_PORT, '127.0.0.1', r));
}
after(() => { try { ms.server?.close(); } catch { /* gone */ } });

const OL = { clientId: '11111111-2222-3333-4444-555555555555', tenantId: 'acton.onmicrosoft.com', secret: 'Sec~ret.Value_9xAB12' };
const mail = (id, conv, subject, from, minsAgo, preview) => ({
  id, conversationId: conv, subject, from: { emailAddress: { name: from, address: `${from.toLowerCase()}@x.test` } },
  receivedDateTime: new Date(Date.now() - minsAgo * 60000).toISOString().replace(/\.\d+Z$/, 'Z'), bodyPreview: preview,
  webLink: `https://outlook.office365.com/owa/?ItemID=${id}&exvsurl=1`,
});
async function dpNow() {
  const snap = await call('dp.snapshot', {}, tok.boss);
  const get = async (path) => (snap.entries[path] ? JSON.parse(await (await fetch(`${B}dp.blob&sha=${snap.entries[path]}`, { headers: { Authorization: 'Bearer ' + tok.boss } })).text()) : null);
  const month = istDay(0).slice(0, 7);
  return { head: snap.commit, data: await get('data.json'), history: { [month]: (await get(`history/${month}.json`)) || [] } };
}
const callback = async (q) => { const r = await fetch(`http://127.0.0.1:${WEB_PORT}/outlook.php?${new URLSearchParams(q)}`); return { s: r.status, text: await r.text() }; };
const stateOf = (url) => new URL(url).searchParams.get('state');

test('outlook: only the owner can set it up; the client secret is saved locked and never sent back (only its last 4 letters)', { skip }, async () => {
  const m = (await call('login', { username: 'mgr2', password: 'mgr2-pass-456' })).token;
  assert.ok(m, 'the other manager signs in');
  assert.equal((await call('outlook.save', OL, m)).s, 403, 'another manager cannot');
  assert.equal((await call('outlook.status', {}, m)).s, 403);
  assert.equal((await call('outlook.save', OL, tok.suresh)).s, 403, 'staff cannot');
  assert.match((await call('outlook.save', { ...OL, clientId: 'not-an-id' }, tok.boss)).error, /Application \(client\) ID/);
  assert.match((await call('outlook.save', { ...OL, secret: '' }, tok.boss)).error, /client secret/, 'the secret is needed the first time');
  const r = await call('outlook.save', OL, tok.boss);
  assert.ok(r.ok, r.error);
  assert.equal(r.outlook.secretEnd, 'AB12');
  assert.equal(r.outlook.redirectUri, `http://127.0.0.1:${WEB_PORT}/outlook.php`, 'built from the address the app is opened on');
  assert.equal(r.outlook.scopes, 'offline_access User.Read Mail.ReadWrite');
  const st = await call('outlook.status', {}, tok.boss);
  for (const x of [r, st]) assert.ok(!JSON.stringify(x).includes(OL.secret), 'never sent back');
  assert.deepEqual([st.outlook.clientId, st.outlook.tenantId, st.outlook.connected], [OL.clientId, OL.tenantId, false]);
  const stored = execFileSync('mysql', ['-u', 'root', `--socket=${SOCK}`, '-N', '-e', "SELECT GROUP_CONCAT(v) FROM wt.settings WHERE k LIKE 'ol\\_%'; SELECT GROUP_CONCAT(detail) FROM wt.audit"], { encoding: 'utf8' });
  assert.ok(!stored.includes(OL.secret), 'locked in the database, and not in the audit log');
  assert.match(readFileSync(join(dir, 'config.php'), 'utf8'), /'enc_key' => '[0-9a-f]{64}'/, 'the lock key was made and kept in config.php');
  const again = await call('outlook.save', { clientId: OL.clientId, tenantId: OL.tenantId, secret: '' }, tok.boss);
  assert.ok(again.ok && again.outlook.secretEnd === 'AB12', 'saving without typing the secret keeps the saved one');
  assert.equal((await call('outlook.check', {}, tok.boss)).error, 'Outlook is not connected. Press Connect Outlook first.');
});

test('outlook: Connect — the sign-in comes back only with the right state, once, within 10 minutes (PKCE, the secret goes to Microsoft only)', { skip }, async () => {
  await fakeMicrosoft();
  sql('UPDATE wt.settings SET v = UNIX_TIMESTAMP() + 86400 WHERE k = \'jobs_at\''); // only "Check now" in these checks (the 10-minute job waits)
  ms.token = (f) => (f.grant_type === 'authorization_code' && f.code === 'CODE-1' ? [200, { access_token: 'AT-0', refresh_token: 'RT-1' }] : [400, { error: 'invalid_grant' }]);
  assert.equal((await call('outlook.connect', {}, tok.suresh)).s, 403, 'staff cannot');
  const wrong = await callback({ code: 'CODE-1', state: 'wrong-state' });
  assert.equal(wrong.s, 400); assert.match(wrong.text, /not valid/);
  let c = await call('outlook.connect', {}, tok.boss);
  const u = new URL(c.url);
  assert.equal(`${u.origin}${u.pathname}`, `${MS}/acton.onmicrosoft.com/oauth2/v2.0/authorize`);
  const p = Object.fromEntries(u.searchParams);
  assert.deepEqual([p.client_id, p.response_type, p.scope, p.code_challenge_method, p.redirect_uri], [OL.clientId, 'code', 'offline_access User.Read Mail.ReadWrite', 'S256', `http://127.0.0.1:${WEB_PORT}/outlook.php`]);
  assert.ok(!c.url.includes(OL.secret), 'the secret never goes to the browser');
  sql("UPDATE wt.settings SET v = JSON_SET(v, '$.exp', 1) WHERE k = 'ol_oauth'");
  const late = await callback({ code: 'CODE-1', state: stateOf(c.url) });
  assert.equal(late.s, 400); assert.match(late.text, /more than 10 minutes/);
  assert.equal(ms.reqs.length, 0, 'Microsoft was not asked');
  c = await call('outlook.connect', {}, tok.boss);
  const challenge = new URL(c.url).searchParams.get('code_challenge');
  const ok = await callback({ code: 'CODE-1', state: stateOf(c.url) });
  assert.equal(ok.s, 200, ok.text); assert.match(ok.text, /Outlook connected ✓/);
  const tr = ms.reqs.find((x) => x.path.endsWith('/token'));
  assert.deepEqual([tr.form.grant_type, tr.form.code, tr.form.client_id, tr.form.client_secret, tr.form.redirect_uri], ['authorization_code', 'CODE-1', OL.clientId, OL.secret, `http://127.0.0.1:${WEB_PORT}/outlook.php`]);
  assert.equal(createHash('sha256').update(tr.form.code_verifier).digest('base64url'), challenge, 'PKCE: the verifier matches the challenge');
  assert.match((await callback({ code: 'CODE-1', state: stateOf(c.url) })).text, /not valid/, 'a state works once');
  const st = (await call('outlook.status', {}, tok.boss)).outlook;
  assert.deepEqual([st.connected, st.account, st.error], [true, 'venkat@acton.test', '']);
  assert.ok(!JSON.stringify(st).includes('RT-1'), 'the sign-in never goes to the browser');
  const stored = execFileSync('mysql', ['-u', 'root', `--socket=${SOCK}`, '-N', '-e', "SELECT GROUP_CONCAT(v) FROM wt.settings WHERE k LIKE 'ol\\_%'"], { encoding: 'utf8' });
  assert.ok(!stored.includes('RT-1'), 'kept locked');
});

test('outlook: each new email thread → one task "📧 subject" (mail + email thread, not work); later emails join that thread (no new task, no note, no Inbox item, state kept, at most 50); an older Inbox item / step / project thread joins as before; a deleted task → a new task; seen emails skipped; next pages followed; a new sign-in kept', { skip }, async () => {
  await fakeMicrosoft();
  const at = new Date(Date.now() - 3 * 86400e3).toISOString();
  let head = (await call('dp.head', {}, tok.boss)).head;
  assert.ok((await call('dp.commit', { parent: head, message: 'before', changes: [{ path: 'data.json', content: JSON.stringify({
    groups: [{ id: 'g1', name: 'Acton' }],
    inbox: [{ id: 'oi1', text: '📧 Old topic — from Kavi', createdAt: at, mail: { conversationId: 'C-OLD', count: 1 } }], // from before emails became tasks
    projects: [
      { id: 'olp1', name: 'Kiln quote', state: 'active', groupId: 'g1', createdAt: at, activeSince: istDay(3), steps: [{ id: 'ols1', text: 'Reply to Ravi', done: false, mail: { conversationId: 'C-STEP' } }], workNotes: [] },
      { id: 'olp2', name: 'Glaze trial', state: 'paused', groupId: 'g1', createdAt: at, stateChangedAt: at, steps: [], workNotes: [], mail: { conversationId: 'C-PROJ' } },
    ] }) }] }, tok.boss)).ok);
  ms.reqs = [];
  ms.token = (f) => (f.grant_type === 'refresh_token' && f.refresh_token === 'RT-1' ? [200, { access_token: 'AT-1', refresh_token: 'RT-2' }] : [400, { error: 'invalid_grant' }]);
  const long = 'Samples sent today. ' + 'More words about the glaze. '.repeat(20);
  ms.pages = [
    [mail('m1', 'C1', 'Kiln quote for November', 'Ravi', 50, 'Please find the price for the new kiln.'), mail('m2', 'C2', 'Glaze samples', 'Anil', 40, long),
     mail('m3', 'C1', 'RE: Kiln quote for November', 'Sandeep', 30, 'OK, go ahead with the order.')],
    [mail('m4', 'C-STEP', 'RE: Reply', 'Ravi', 20, 'Here is the answer you asked for.'), mail('m5', 'C-PROJ', 'RE: Glaze', 'Meena', 10, 'New glaze recipe attached.'),
     mail('m6', 'C-OLD', 'RE: Old topic', 'Kavi', 8, 'Any news?')],
  ];
  const r = await call('outlook.check', {}, tok.boss);
  assert.ok(r.ok, r.error);
  assert.deepEqual([r.outlook.error, r.outlook.addedToday], ['', 6]);
  const list = ms.reqs.find((x) => x.path === '/v1.0/me/mailFolders/inbox/messages');
  assert.match(decodeURIComponent(list.url), /\$select=id,subject,from,receivedDateTime,bodyPreview,webLink,conversationId/);
  assert.match(decodeURIComponent(list.url), /\$filter=receivedDateTime gt \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/);
  assert.equal(list.auth, 'Bearer AT-1');
  assert.ok(ms.reqs.some((x) => x.path === '/v1.0/next' && x.auth === 'Bearer AT-1'), 'the next page was read');
  let { data, history } = await dpNow();
  assert.deepEqual(data.inbox.map((x) => x.id), ['oi1'], 'no new Inbox item: new threads are tasks');
  assert.equal(data.inbox[0].mail.count, 2, 'an older Inbox item with an email still joins its thread');
  assert.match(data.inbox[0].note, /^💬 2 emails · latest from Kavi/);
  const tasks = data.projects.filter((p) => Array.isArray(p.thread));
  assert.deepEqual(tasks.map((p) => p.name).sort(), ['📧 Glaze samples', '📧 Kiln quote for November'], 'one task per thread, named "📧 subject"');
  const t1 = tasks.find((p) => p.mail.conversationId === 'C1');
  const t2 = tasks.find((p) => p.mail.conversationId === 'C2');
  assert.equal(data.projects[0].id, t2.id, 'new tasks go to the top');
  assert.deepEqual([t1.state, t1.groupId, t1.steps, t1.workNotes, t1.isMain, t1.parentIds], ['active', 'g1', [], [], undefined, undefined], 'a plain active task');
  // (r14: each email also carries addedAt = when the server brought it in; the owner asked for it, so a late Finish never hides it)
  const noAt = ({ at: when, addedAt, ...rest }) => { assert.match(when, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/); assert.match(addedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/, 'addedAt'); return rest; };
  assert.deepEqual(t1.thread.map(noAt), [
    { fromName: 'Ravi', fromMe: false, preview: 'Please find the price for the new kiln.', link: 'https://outlook.office365.com/owa/?ItemID=m1&exvsurl=1', messageId: 'm1' },
    { fromName: 'Sandeep', fromMe: false, preview: 'OK, go ahead with the order.', link: 'https://outlook.office365.com/owa/?ItemID=m3&exvsurl=1', messageId: 'm3' },
  ], 'the later email joined the thread (newest last)');
  assert.ok(t1.thread[0].at < t1.thread[1].at);
  assert.deepEqual(noAt(t1.mail), { conversationId: 'C1', messageId: 'm3', fromName: 'Sandeep', fromAddress: 'sandeep@x.test', subject: 'RE: Kiln quote for November' }, 'mail = the newest email (for a reply draft)');
  assert.equal(t2.thread[0].preview.length, 300, 'each email\'s first lines: at most 300 letters');
  const month = istDay(0).slice(0, 7);
  assert.deepEqual(history[month].filter((e) => e.kind === 'mail_task').map((e) => e.projectId).sort(), [t1.id, t2.id].sort(), 'a history line when a task is made');
  assert.ok(!history[month].some((e) => e.kind === 'mail_note' && (e.projectId === t1.id || e.projectId === t2.id)), 'no note for an email that joins a thread');
  // a step's / an older project's thread: a note there, as before
  const p1 = data.projects.find((p) => p.id === 'olp1'); const p2 = data.projects.find((p) => p.id === 'olp2');
  assert.match(p1.workNotes[0].text, /^📧 New reply from Ravi .* \(step: Reply to Ravi\): Here is the answer you asked for\.$/);
  assert.match(p2.workNotes[0].text, /^📧 New reply from Meena .*: New glaze recipe attached\.$/);
  assert.equal(p2.state, 'paused');
  const { dayScore, lastWorkDate, repliesOf, dotColour } = await import('../docs/rules.js');
  assert.equal(dayScore(data, history, istDay(0)).green, 0, 'emails are not your work');
  assert.equal(lastWorkDate(t1), null);
  assert.notEqual(dotColour(t1, istDay(0)), 'green');
  const waiting = repliesOf(data, istDay(0)).waiting;
  const w1 = waiting.find((m) => m.id === t1.id);
  assert.ok(w1 && waiting.some((m) => m.id === t2.id), 'the ✉ Replies page lists the tasks waiting for your reply');
  assert.deepEqual([w1.count, w1.preview, w1.from, w1.link.url], [2, 'OK, go ahead with the order.', 'Sandeep', 'https://outlook.office365.com/owa/?ItemID=m3&exvsurl=1']);
  // again: the same emails are not added twice, and Microsoft's new sign-in (RT-2) is the one used now
  head = (await dpNow()).head;
  ms.reqs = [];
  ms.token = (f) => (f.grant_type === 'refresh_token' && f.refresh_token === 'RT-2' ? [200, { access_token: 'AT-2' }] : [400, { error: 'invalid_grant' }]);
  const r2 = await call('outlook.check', {}, tok.boss);
  assert.deepEqual([r2.outlook.error, r2.outlook.addedToday], ['', 6]);
  assert.equal(ms.reqs[0].form.refresh_token, 'RT-2', 'the rotated sign-in was stored');
  assert.equal((await dpNow()).head, head, 'nothing new: no new version');
  // the owner deletes the Kiln task and pauses the Glaze one (with a full thread of 50 older emails)
  ({ data } = await dpNow());
  data.projects = data.projects.filter((p) => p.id !== t1.id);
  const g = data.projects.find((p) => p.id === t2.id);
  g.state = 'paused';
  g.thread = Array.from({ length: 50 }, (_, i) => ({ at: new Date(Date.now() - (2000 - i) * 60000).toISOString(), fromName: 'Anil', fromMe: false, preview: 'old ' + i, messageId: 'old' + i }));
  assert.ok((await call('dp.commit', { parent: head, changes: [{ path: 'data.json', content: JSON.stringify(data) }], message: 'sorted' }, tok.boss)).ok);
  ms.pages = [[...ms.pages[0], mail('m7', 'C1', 'RE: Kiln quote for November', 'Ravi', 5, 'One more thing.'), mail('m8', 'C2', 'RE: Glaze samples', 'Anil', 4, 'Did they arrive?')]];
  const r3 = await call('outlook.check', {}, tok.boss);
  assert.equal(r3.outlook.addedToday, 8);
  ({ data } = await dpNow());
  const kiln = data.projects.filter((p) => p.mail && p.mail.conversationId === 'C1');
  assert.deepEqual(kiln.map((p) => [p.name, p.thread.length, p.thread[0].messageId]), [['📧 RE: Kiln quote for November', 1, 'm7']], 'its task was deleted: a new email starts a new task');
  assert.notEqual(kiln[0].id, t1.id);
  const glaze = data.projects.find((p) => p.id === t2.id);
  assert.equal(glaze.state, 'paused', 'a new email does not change the task\'s state');
  assert.equal(glaze.thread.length, 50, 'at most 50 emails kept');
  assert.deepEqual([glaze.thread[0].messageId, glaze.thread[49].messageId, glaze.mail.messageId], ['old1', 'm8', 'm8'], 'the oldest one goes; the newest is last');
  assert.equal(data.projects.filter((p) => p.mail && p.mail.conversationId === 'C2').length, 1, 'no second task for the thread');
  assert.deepEqual(data.inbox.map((x) => x.id), ['oi1']);
  sql('UPDATE wt.settings SET v = 0 WHERE k = \'jobs_at\'');
});

test('outlook: an expired sign-in says so in plain words and stops; not connected = nothing is fetched; Disconnect forgets the sign-in', { skip }, async () => {
  await fakeMicrosoft();
  sql('UPDATE wt.settings SET v = UNIX_TIMESTAMP() + 86400 WHERE k = \'jobs_at\'');
  ms.token = () => [400, { error: 'invalid_grant', error_description: 'AADSTS70008: The refresh token has expired.' }];
  const before = (await dpNow()).head;
  const r = await call('outlook.check', {}, tok.boss);
  assert.deepEqual([r.outlook.error, r.outlook.connected], ['Sign-in expired — press Connect again', false]);
  assert.equal((await dpNow()).head, before, 'nothing written');
  // not connected: the 10-minute job asks Microsoft nothing
  ms.reqs = [];
  sql('UPDATE wt.settings SET v = 0 WHERE k = \'jobs_at\'');
  await call('me', {}, tok.boss); await call('me', {}, tok.boss);
  assert.equal(ms.reqs.length, 0, 'not connected: nothing fetched');
  // connected again, then Disconnect
  ms.token = (f) => (f.grant_type === 'authorization_code' ? [200, { access_token: 'AT-9', refresh_token: 'RT-9' }] : [200, { access_token: 'AT-9' }]);
  const c = await call('outlook.connect', {}, tok.boss);
  assert.equal((await callback({ code: 'CODE-9', state: stateOf(c.url) })).s, 200);
  assert.equal((await call('outlook.status', {}, tok.boss)).outlook.connected, true);
  const d = await call('outlook.disconnect', {}, tok.boss);
  assert.deepEqual([d.outlook.connected, d.outlook.account, d.outlook.secretEnd], [false, '', 'AB12'], 'the sign-in is gone; the setup stays');
  assert.equal(execFileSync('mysql', ['-u', 'root', `--socket=${SOCK}`, '-N', '-e', "SELECT COUNT(*) FROM wt.settings WHERE k = 'ol_refresh'"], { encoding: 'utf8' }).trim(), '0');
});

// ---------------------------------------------------------------- email replies: drafts in Outlook (never sent), "replied" from Sent Items
const isoAgo = (mins) => new Date(Date.now() - mins * 60000).toISOString().replace(/\.\d+Z$/, '.000Z');
const rMail = (id, minsAgo, extra = {}) => ({ conversationId: 'C-' + id, messageId: 'MSG-' + id, fromName: 'Ravi', fromAddress: 'ravi@x.test', subject: 'Price ' + id, at: isoAgo(minsAgo), ...extra });
async function replyProjects() {
  const head = (await call('dp.head', {}, tok.boss)).head;
  const at = new Date(Date.now() - 3 * 86400e3).toISOString();
  const data = {
    groups: [{ id: 'g1', name: 'Acton' }], people: [],
    inbox: [{ id: 'ri1', text: '📧 Price R4 — from Ravi', createdAt: at, mail: { ...rMail('R4', 120), count: 1 } }],
    projects: [
      { id: 'rp1', name: 'Kiln price', state: 'active', groupId: 'g1', createdAt: at, workNotes: [], links: [], files: [], notes: '',
        steps: [
          { id: 'rs1', text: 'Answer Ravi', done: false, mail: rMail('R1', 120), reply: { text: 'Dear Ravi,\nThe price is fine.\nRegards, Venkat', at: isoAgo(60), by: 'claude', forMessageId: 'MSG-R1', state: 'ready' } },
          { id: 'rs2', text: 'Answer Anil', done: false, mail: rMail('R2', 120) },
          { id: 'rs3', text: 'Answer Meena', done: false, mail: rMail('R3', 5) },
        ] },
    ],
  };
  const r = await call('dp.commit', { parent: head, changes: [{ path: 'data.json', content: JSON.stringify(data) }], message: 'reply test' }, tok.boss);
  assert.ok(r.ok, r.error);
}
async function connectOutlook() {
  ms.token = (f) => (f.grant_type === 'authorization_code' ? [200, { access_token: 'AT-R', refresh_token: 'RT-R' }] : [200, { access_token: 'AT-R' }]);
  const c = await call('outlook.connect', {}, tok.boss);
  assert.equal((await callback({ code: 'CODE-R', state: stateOf(c.url) })).s, 200);
}

test('replies: outlook.draft is owner-only, uses the SAVED reply text and messageId (never the browser\'s), calls createReply with the comment and returns the draft link; plain errors so the app falls back', { skip }, async () => {
  await fakeMicrosoft();
  sql('UPDATE wt.settings SET v = UNIX_TIMESTAMP() + 86400 WHERE k = \'jobs_at\'');
  await replyProjects();
  assert.match((await call('outlook.draft', { ref: 'rs1' }, tok.boss)).error, /Outlook is not connected/, 'not connected: a clear error (the app opens a new email instead)');
  await connectOutlook();
  assert.equal((await call('outlook.draft', { ref: 'rs1' }, tok.suresh)).s, 403, 'staff cannot');
  const m2 = (await call('login', { username: 'mgr2', password: 'mgr2-pass-456' })).token;
  assert.equal((await call('outlook.draft', { ref: 'rs1' }, m2)).s, 403, 'another manager cannot');
  ms.reqs = [];
  const r = await call('outlook.draft', { ref: 'rs1', text: 'EVIL TEXT', messageId: 'MSG-OTHER' }, tok.boss);
  assert.ok(r.ok, r.error);
  assert.equal(r.webLink, 'https://outlook.office365.com/owa/?ItemID=draft-MSG-R1&exvsurl=1');
  const cr = ms.reqs.find((x) => x.path.endsWith('/createReply'));
  assert.equal(cr.path, '/v1.0/me/messages/MSG-R1/createReply', 'a reply in the same thread, to the saved newest email');
  assert.equal(cr.method, 'POST');
  assert.deepEqual(JSON.parse(cr.body), { comment: 'Dear Ravi,\nThe price is fine.\nRegards, Venkat' }, 'the saved text, not the browser\'s');
  assert.ok(!ms.reqs.some((x) => /\/send(Mail)?$/.test(x.path)), 'nothing is ever sent');
  assert.match((await call('outlook.draft', { ref: 'rs2' }, tok.boss)).error, /no reply ready/, 'no draft saved: refused');
  assert.match((await call('outlook.draft', { ref: 'nope' }, tok.boss)).error, /not in your projects/);
  ms.draftCode = 404;
  assert.match((await call('outlook.draft', { ref: 'rs1' }, tok.boss)).error, /could not find that email/);
  ms.draftCode = 403;
  assert.match((await call('outlook.draft', { ref: 'rs1' }, tok.boss)).error, /needs admin approval/, 'outlook.php\'s plain-words errors');
  ms.draftCode = 201;
});

test('no-paste email: outlook.compose is owner-only, saves the finished email as a DRAFT (POST /me/messages: HTML body, To, Subject), never sends; bad address / too big refused; scripts stripped; not connected = a clear error', { skip }, async () => {
  await fakeMicrosoft();
  sql('UPDATE wt.settings SET v = UNIX_TIMESTAMP() + 86400 WHERE k = \'jobs_at\'');
  const good = { to: 'nila@acton.test', subject: 'Your work for Thu 22 Oct – please reply by evening', html: '<div><table><tr><td>Send kiln photos</td></tr></table></div>' };
  assert.equal((await call('outlook.disconnect', {}, tok.boss)).ok, true);
  assert.match((await call('outlook.compose', good, tok.boss)).error, /Outlook is not connected/, 'not connected: a clear error (the app copies the table instead)');
  await connectOutlook();
  assert.equal((await call('outlook.compose', good, tok.suresh)).s, 403, 'staff cannot');
  const m2 = (await call('login', { username: 'mgr2', password: 'mgr2-pass-456' })).token;
  assert.equal((await call('outlook.compose', good, m2)).s, 403, 'another manager cannot');
  ms.reqs = [];
  const evil = '<div onclick="alert(1)"><script>alert(2)</script><iframe src="https://x.test"></iframe><a href="javascript:alert(3)" onmouseover=\'x()\'>link</a><table><tr><td>Send kiln photos</td></tr></table></div>';
  const r = await call('outlook.compose', { ...good, html: evil }, tok.boss);
  assert.ok(r.ok, r.error);
  assert.equal(r.webLink, 'https://outlook.office365.com/owa/?ItemID=new-draft-1&exvsurl=1');
  const made = ms.reqs.filter((x) => x.path === '/v1.0/me/messages' && x.method === 'POST');
  assert.equal(made.length, 1, 'one draft');
  const b = JSON.parse(made[0].body);
  assert.equal(b.subject, good.subject);
  assert.deepEqual(b.toRecipients, [{ emailAddress: { address: 'nila@acton.test' } }]);
  assert.equal(b.body.contentType, 'HTML');
  assert.match(b.body.content, /<table><tr><td>Send kiln photos<\/td><\/tr><\/table>/, 'the table is inside');
  assert.doesNotMatch(b.body.content, /<script|alert\(2\)|<iframe|onclick|onmouseover|javascript:/i, 'scripts, frames and on...= handlers removed');
  assert.ok(!ms.reqs.some((x) => /\/send(Mail)?$/i.test(x.path)), 'nothing is ever sent');
  const log = execFileSync('mysql', ['-u', 'root', `--socket=${SOCK}`, '-N', '-e', "SELECT detail FROM wt.audit WHERE action = 'outlook_compose'"], { encoding: 'utf8' });
  assert.match(log, /draft to nila@acton\.test/, 'the audit line names who it was for');
  assert.doesNotMatch(log, /kiln photos/, 'never the body in the log');
  ms.reqs = [];
  for (const to of ['', 'not-an-email', 'a@b.test, c@d.test', 'a@b.test\nBcc: x@y.test']) assert.match((await call('outlook.compose', { ...good, to }, tok.boss)).error, /email address does not look right/, `refused: ${JSON.stringify(to)}`);
  assert.match((await call('outlook.compose', { ...good, html: '<p>' + 'x'.repeat(300 * 1024) + '</p>' }, tok.boss)).error, /too big/);
  assert.match((await call('outlook.compose', { ...good, subject: 'x'.repeat(256) }, tok.boss)).error, /subject is too long/);
  assert.match((await call('outlook.compose', { ...good, html: '  ' }, tok.boss)).error, /empty/);
  assert.equal(ms.reqs.filter((x) => x.path === '/v1.0/me/messages').length, 0, 'a refused email never reaches Microsoft');
  ms.composeCode = 403;
  assert.match((await call('outlook.compose', good, tok.boss)).error, /Mail\.ReadWrite not approved/, 'no consent: plain words');
  ms.composeCode = 401;
  assert.match((await call('outlook.compose', good, tok.boss)).error, /Sign-in expired/);
  ms.composeCode = 201;
});

test('replies: the Outlook check reads Sent Items and marks replied (not work): a ready draft, a waiting step; not a reply older than the newest email; not other threads', { skip }, async () => {
  await fakeMicrosoft();
  sql('UPDATE wt.settings SET v = UNIX_TIMESTAMP() + 86400 WHERE k = \'jobs_at\'');
  await replyProjects();
  ms.pages = [[]];
  ms.reqs = [];
  ms.sent = [
    { conversationId: 'C-R1', sentDateTime: isoAgo(30).replace('.000Z', 'Z') },
    { conversationId: 'C-R2', sentDateTime: isoAgo(20).replace('.000Z', 'Z') },
    { conversationId: 'C-R3', sentDateTime: isoAgo(10).replace('.000Z', 'Z') }, // before Meena's newest email (5 minutes ago)
    { conversationId: 'C-ELSE', sentDateTime: isoAgo(10).replace('.000Z', 'Z') },
  ];
  const r = await call('outlook.check', {}, tok.boss);
  assert.equal(r.outlook.error, '', r.outlook.error);
  const sr = ms.reqs.find((x) => x.path === '/v1.0/me/mailFolders/sentitems/messages');
  assert.ok(sr, 'Sent Items was read');
  assert.match(decodeURIComponent(sr.url), /\$select=id,conversationId,sentDateTime,bodyPreview,webLink/);
  assert.match(decodeURIComponent(sr.url), /\$filter=sentDateTime gt \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/);
  const { data, history } = await dpNow();
  const steps = Object.fromEntries(data.projects.find((p) => p.id === 'rp1').steps.map((s) => [s.id, s]));
  assert.deepEqual([steps.rs1.reply.state, steps.rs1.reply.text], ['sent', 'Dear Ravi,\nThe price is fine.\nRegards, Venkat'], 'the ready draft is marked sent');
  assert.match(steps.rs1.reply.sentAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
  assert.equal(steps.rs2.reply.state, 'sent', 'a step waiting for a reply is marked too');
  assert.equal(steps.rs3.reply, undefined, 'sent before the newest email: still waiting');
  assert.equal(data.inbox[0].reply, undefined, 'another thread is not touched');
  const month = istDay(0).slice(0, 7);
  assert.equal(history[month].filter((e) => e.kind === 'mail_replied' && e.projectId === 'rp1').length, 2);
  const { dayScore, lastWorkDate, repliesOf } = await import('../docs/rules.js');
  assert.equal(lastWorkDate(data.projects.find((p) => p.id === 'rp1')), null, 'not your work');
  assert.equal(dayScore(data, history, istDay(0)).green, 0);
  assert.deepEqual(repliesOf(data, istDay(0)).waiting.map((m) => m.id).sort(), ['ri1', 'rs3']);
  // again: nothing new to mark = no new version
  const head = (await dpNow()).head;
  await call('outlook.check', {}, tok.boss);
  assert.equal((await dpNow()).head, head);
  ms.sent = [];
});

test('replies: your reply in Outlook (Sent Items) joins the task\'s email thread as "↩ You" (once, not work); the task then waits for nobody; their next email makes it wait again', { skip }, async () => {
  await fakeMicrosoft();
  sql('UPDATE wt.settings SET v = UNIX_TIMESTAMP() + 86400 WHERE k = \'jobs_at\'');
  const head = (await call('dp.head', {}, tok.boss)).head;
  const at = new Date(Date.now() - 86400e3).toISOString();
  const tt = { id: 'tt1', name: '📧 Price list', state: 'active', groupId: 'g1', createdAt: at, steps: [], workNotes: [], links: [], files: [], notes: '',
    mail: { conversationId: 'C-T1', messageId: 'T1-1', fromName: 'Ravi', fromAddress: 'ravi@x.test', subject: 'Price list', at: isoAgo(60) },
    thread: [{ at: isoAgo(60), fromName: 'Ravi', fromMe: false, preview: 'Can you send the price?', messageId: 'T1-1' }] };
  assert.ok((await call('dp.commit', { parent: head, changes: [{ path: 'data.json', content: JSON.stringify({ groups: [{ id: 'g1', name: 'Acton' }], projects: [tt] }) }], message: 'thread task' }, tok.boss)).ok);
  const { repliesOf, lastWorkDate, dayScore } = await import('../docs/rules.js');
  assert.ok(repliesOf((await dpNow()).data, istDay(0)).waiting.some((m) => m.id === 'tt1'), 'before: waiting for your reply');
  ms.pages = [[]];
  ms.sent = [
    { id: 'S1', conversationId: 'C-T1', sentDateTime: isoAgo(30).replace('.000Z', 'Z'), bodyPreview: 'Dear Ravi, the price list is attached.', webLink: 'https://outlook.office365.com/owa/?ItemID=S1&exvsurl=1' },
    { id: 'S2', conversationId: 'C-ELSE', sentDateTime: isoAgo(20).replace('.000Z', 'Z'), bodyPreview: 'Another thread.' },
  ];
  const r = await call('outlook.check', {}, tok.boss);
  assert.equal(r.outlook.error, '', r.outlook.error);
  let { data, history } = await dpNow();
  let t = data.projects.find((p) => p.id === 'tt1');
  assert.equal(t.thread.length, 2);
  const { at: sentAt, addedAt: youAdded, ...you } = t.thread[1];
  assert.match(youAdded, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/, 'r14: addedAt on your reply too');
  assert.deepEqual(you, { fromName: 'You', fromMe: true, preview: 'Dear Ravi, the price list is attached.', link: 'https://outlook.office365.com/owa/?ItemID=S1&exvsurl=1', messageId: 'S1' }, '↩ You, newest last');
  assert.match(sentAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/, 'when it was sent');
  assert.ok(Math.abs(Date.parse(sentAt) - Date.parse(isoAgo(30))) < 120000);
  assert.deepEqual([t.mail.fromMe, t.mail.at, t.mail.messageId, t.mail.fromAddress], [true, sentAt, 'T1-1', 'ravi@x.test'], 'the newest is yours; their email is kept for a later reply');
  assert.equal(t.reply.state, 'sent', 'replied');
  assert.equal(data.projects.length, 1, 'no task for a thread you only wrote in');
  assert.ok(!repliesOf(data, istDay(0)).waiting.some((m) => m.id === 'tt1'), 'nothing waits now');
  assert.equal(lastWorkDate(t), null, 'not your work');
  assert.equal(dayScore(data, history, istDay(0)).green, 0);
  assert.ok(!(history[istDay(0).slice(0, 7)] || []).some((e) => e.kind === 'mail_note' && e.projectId === 'tt1'), 'no note');
  // again: the same sent email is not added twice
  const h2 = (await dpNow()).head;
  await call('outlook.check', {}, tok.boss);
  assert.equal((await dpNow()).head, h2, 'nothing new: no new version');
  // their answer: joins the thread and waits for your reply again
  ms.sent = [];
  ms.pages = [[mail('T1-2', 'C-T1', 'RE: Price list', 'Ravi', 2, 'Thanks. One more question.')]];
  await call('outlook.check', {}, tok.boss);
  ({ data } = await dpNow());
  t = data.projects.find((p) => p.id === 'tt1');
  assert.deepEqual(t.thread.map((e) => (e.fromMe ? '↩' : '📧') + e.messageId), ['📧T1-1', '↩S1', '📧T1-2']);
  assert.deepEqual([t.mail.fromMe, t.mail.messageId], [undefined, 'T1-2']);
  assert.ok(repliesOf(data, istDay(0)).waiting.some((m) => m.id === 'tt1'), 'waiting for your reply again');
});

test('replies: dp-cli mail-body, and Claude\'s tracker replies / set-reply / mail-body on the local server copy (ambiguous refused)', { skip }, async () => {
  await fakeMicrosoft();
  sql('UPDATE wt.settings SET v = UNIX_TIMESTAMP() + 86400 WHERE k = \'jobs_at\'');
  await replyProjects();
  ms.bodies['MSG-R2'] = { subject: 'Price R2', from: { emailAddress: { name: 'Anil', address: 'anil@x.test' } }, receivedDateTime: '2026-10-22T05:00:00Z', body: { contentType: 'text', content: 'Hello Venkat,\r\n' + 'x'.repeat(7000) } };
  ms.reqs = [];
  const run = promisify(execFile); // not execFileSync: the fake Microsoft runs in this same process and must answer
  const cliA = async (args) => (await run('php', [join(ROOT, 'team', 'app', 'dp-cli.php'), ...args], { env: env(), encoding: 'utf8' })).stdout;
  const b = JSON.parse(await cliA(['mail-body', 'rs2']));
  assert.deepEqual([b.subject, b.from, b.fromAddress, b.cut], ['Price R2', 'Anil', 'anil@x.test', true]);
  assert.equal(b.body.length, 6001, 'cut to 6000 letters (and …)');
  assert.ok(b.body.startsWith('Hello Venkat,\nxxx'));
  const g = ms.reqs.find((x) => x.path === '/v1.0/me/messages/MSG-R2');
  assert.equal(g.prefer, 'outlook.body-content-type="text"');
  assert.match(decodeURIComponent(g.url), /\$select=body,from,subject,receivedDateTime/);
  await assert.rejects(cliA(['mail-body', 'nope']), (e) => /No email with that id/.test(String(e.stderr)));
  const tr = async (...args) => (await run(process.execPath, [join(ROOT, 'tools', 'tracker.mjs'), ...args], { env: { ...env(), DP_SERVER_LOCAL: '1', DP_DATA_DIR: '' }, encoding: 'utf8' })).stdout;
  const list = await tr('replies');
  assert.match(list, /Replies: 3 waiting for a reply · 1 ready to send/);
  assert.match(list, /\[rs2\] Price R2\n {2}from: Ravi <ravi@x\.test> · waiting 0 day\(s\) · in: Kiln price → Answer Anil/);
  assert.match(list, /\[ri1\] Price R4/);
  assert.match(await tr('mail-body', 'rs2'), /Subject: Price R2\nFrom: Anil <anil@x\.test>[\s\S]*Hello Venkat,[\s\S]*\(cut: the email is longer\)/);
  await assert.rejects(tr('set-reply', 'Price', 'Hello'), (e) => /Several emails match "Price"/.test(String(e.stderr)), 'never a guess');
  assert.match(await tr('set-reply', 'Answer Anil', 'Dear Anil,\nNoted.\nRegards, Venkat'), /Saved to worktask\.in: Reply prepared/);
  const { data } = await dpNow();
  const r = data.projects.find((p) => p.id === 'rp1').steps.find((s) => s.id === 'rs2').reply;
  assert.deepEqual([r.text, r.by, r.state, r.forMessageId], ['Dear Anil,\nNoted.\nRegards, Venkat', 'claude', 'ready', 'MSG-R2']);
  assert.ok(!ms.reqs.some((x) => x.path.endsWith('/createReply') || /send/i.test(x.path)), 'set-reply sends nothing');
});

// ---------------------------------------------------------------- project reminders on the phone + cron.php
const cronAt = (iso) => execFileSync('php', [join(ROOT, 'team', 'app', 'cron.php')], {
  env: { ...env(), WT_TEST_NOW: String(Math.floor(Date.parse(iso) / 1000)) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const remindersSince = (n) => pushSince(n).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => /^prm/.test(x.msg.tag || ''));
const remindersAt = (iso) => { const n = pushLen(); cronAt(iso); return remindersSince(n); };

test('project reminders: "🔔 Remind me at" on the "📅 Only on" days — once a day, from the time for 3 hours, never snoozed / paused / finished, only to the owner (cron.php)', { skip }, async () => {
  const keys = { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'), auth: randomBytes(16).toString('base64url') };
  assert.ok((await call('push.subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/boss-phone', keys }, tok.boss)).ok);
  assert.ok((await call('push.subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/suresh-phone-2', keys }, tok.suresh)).ok);
  sql("USE wt; INSERT INTO wt.settings (k, v) VALUES ('fill_by', '23:59:59') ON DUPLICATE KEY UPDATE v = '23:59:59'"); // no evening summary in these runs
  const kiln = (more = {}) => ({ id: 'rm1', name: 'Kiln check', state: 'active', onlyDays: [1], remindAt: '09:30', steps: [{ id: 'k1', text: 'Check heaters', done: false }], ...more });
  await saveProjects([kiln()]);
  // October 2026: Mon 26, Tue 27; November: Mon 2, 9, 16, 23; Wed 25
  assert.deepEqual(remindersAt('2026-10-26T09:29:00+05:30'), [], 'not before the time');
  const m = remindersAt('2026-10-26T09:30:00+05:30');
  assert.deepEqual(m.map((x) => [x.user, x.msg.title, x.msg.body, x.msg.url, x.msg.tag]), [[id.boss, '📅 Kiln check', 'Today: Check heaters', '/projects/#open=rm1', 'prmrm1']], 'at the time, to the owner only');
  assert.deepEqual(remindersAt('2026-10-26T10:00:00+05:30'), [], 'never twice a day');
  assert.deepEqual(remindersAt('2026-10-27T09:45:00+05:30'), [], 'Tuesday is not a chosen day');
  assert.deepEqual(remindersAt('2026-11-02T12:31:00+05:30'), [], 'more than 3 hours late: skipped');
  assert.equal(remindersAt('2026-11-09T12:29:00+05:30').length, 1, 'within 3 hours: sent');
  await saveProjects([kiln({ snoozedUntil: '2026-11-20' })]);
  assert.deepEqual(remindersAt('2026-11-16T09:31:00+05:30'), [], 'not while snoozed');
  await saveProjects([kiln({ state: 'paused' })]);
  assert.deepEqual(remindersAt('2026-11-23T09:31:00+05:30'), [], 'not for a paused project');
  await saveProjects([kiln({ state: 'finished' })]);
  assert.deepEqual(remindersAt('2026-11-23T09:32:00+05:30'), [], 'not for a finished project');
  await saveProjects([kiln({ onlyDays: undefined, steps: [] })]);
  assert.deepEqual(remindersAt('2026-11-25T09:31:00+05:30').map((x) => [x.user, x.msg.body]), [[id.boss, 'No next step — add one']], 'no chosen days = every day');
  await saveProjects([]);
});

test('project reminders: "🔔 Remind me once" — sent once at or after its time (within 3 hours), never before or twice, not for finished projects, marked sent', { skip }, async () => {
  const once = (at, more = {}) => ({ id: 'rm2', name: 'Call Ravi', state: 'active', remindOnce: at, steps: [{ id: 'c1', text: 'Ask for the price', done: false }], ...more });
  await saveProjects([once('2026-12-01 16:00')]);
  assert.deepEqual(remindersAt('2026-12-01T15:59:00+05:30'), [], 'never before');
  assert.deepEqual(remindersAt('2026-12-01T16:05:00+05:30').map((x) => [x.user, x.msg.title, x.msg.body, x.msg.url]), [[id.boss, '📅 Call Ravi', 'Today: Ask for the price', '/projects/#open=rm2']]);
  assert.match(sql(`USE wt; SELECT v FROM wt.settings WHERE k = '${'pro:' + md5('rm2')}'`).toString(), /2026-12-01 16:00/, 'marked sent');
  assert.deepEqual(remindersAt('2026-12-01T16:30:00+05:30'), [], 'never twice');
  assert.deepEqual(remindersAt('2026-12-02T16:30:00+05:30'), [], 'not the next day either');
  await saveProjects([once('2026-12-03 08:00')]);
  assert.deepEqual(remindersAt('2026-12-03T11:30:00+05:30'), [], 'more than 3 hours late: skipped');
  await saveProjects([once('2026-12-04 08:00', { state: 'finished' })]);
  assert.deepEqual(remindersAt('2026-12-04T08:10:00+05:30'), [], 'not for a finished project');
  await saveProjects([]);
});

test('cron.php: runs the jobs from the command line, skips while another run holds the jobs lock, and refuses the web', { skip }, async () => {
  await saveProjects([{ id: 'rm3', name: 'Cron check', state: 'active', remindAt: '07:00', steps: [] }]);
  // another run holds the lock: cron skips (nothing sent)
  const holder = spawn('mysql', ['-u', 'root', `--socket=${SOCK}`, '-e', "SELECT GET_LOCK('wt_jobs', 0); SELECT SLEEP(4);"], { stdio: 'ignore' });
  await wait(800);
  let n = pushLen();
  assert.match(cronAt('2026-12-07T07:05:00+05:30'), /already running/);
  assert.deepEqual(remindersSince(n), [], 'never two runs at the same time');
  await new Promise((r) => holder.on('exit', r));
  n = pushLen();
  assert.match(cronAt('2026-12-07T07:06:00+05:30'), /Jobs done/);
  assert.equal(remindersSince(n).length, 1, 'the jobs ran (the reminder went)');
  // through a web server it does nothing
  const port = WEB_PORT + 1;
  const webApp = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', join(ROOT, 'team', 'app')], { env: env(), stdio: 'ignore' });
  try {
    await until(async () => { await fetch(`http://127.0.0.1:${port}/cron.php`); return true; }, 'PHP server for cron');
    const r = await fetch(`http://127.0.0.1:${port}/cron.php`);
    assert.equal(r.status, 404);
    assert.equal(await r.text(), '');
  } finally { webApp.kill(); }
  await saveProjects([]);
});

// ---------------------------------------------------------------- 🔌 Connections: outside apps send tasks and approvals (connect.php)
const CB_PORT = DB_PORT + 12000; // a tiny fake app that receives the decisions
const CB = `http://127.0.0.1:${CB_PORT}/hook`;
const cb = { reqs: [], code: 200, delay: 0, server: null };
async function fakeApp() {
  if (cb.server) return;
  cb.server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      cb.reqs.push({ method: req.method, path: req.url, headers: req.headers, body });
      if (cb.delay) return setTimeout(() => { res.writeHead(cb.code, { 'Content-Type': 'application/json' }); res.end('{}'); }, cb.delay);
      res.writeHead(cb.code, cb.code >= 300 && cb.code < 400 ? { Location: 'http://127.0.0.1:1/elsewhere' } : { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => cb.server.listen(CB_PORT, '127.0.0.1', r));
}
after(() => { try { cb.server?.close(); } catch { /* gone */ } });
const cn = {}; // the connections made below: { purchase: {id, key, secret}, poller: {…} }
async function appCall(a, body, key, method = 'POST') {
  const h = { 'Content-Type': 'application/json' };
  if (key !== undefined) h.Authorization = 'Bearer ' + key;
  const r = await fetch(B + a, method === 'GET' ? { headers: h } : { method, headers: h, body: JSON.stringify(body || {}) });
  let j = {};
  try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, ...j };
}
const hmac = (secret, text) => createHmac('sha256', secret).update(text).digest('hex');
const sqlOut = (q) => execFileSync('mysql', ['-u', 'root', `--socket=${SOCK}`, '-N', '-e', q], { encoding: 'utf8' });
const connList = async () => (await call('conn.list', {}, tok.boss)).connections;
const appItems = async () => (await call('conn.items', {}, tok.boss)).items;
// (not execFileSync: the fake app lives in this same process and must answer while cron runs)
const cronIn = (minutes) => promisify(execFile)('php', [join(ROOT, 'team', 'app', 'cron.php')], { env: { ...env(), WT_TEST_NOW: String(Math.floor(Date.now() / 1000) + minutes * 60) }, encoding: 'utf8' });

test('connections: only the owner manages them; create shows the key and secret once (never in the list, the database or the log); the decision address must be https', { skip }, async () => {
  await fakeApp();
  const m = (await call('login', { username: 'mgr2', password: 'mgr2-pass-456' })).token;
  assert.equal((await call('conn.list', {}, m)).s, 403, 'another manager cannot');
  assert.equal((await call('conn.create', { name: 'X' }, m)).s, 403);
  assert.equal((await call('conn.list', {}, tok.suresh)).s, 403, 'staff cannot');
  assert.match((await call('conn.create', { name: '  ' }, tok.boss)).error, /name is empty/);
  assert.match((await call('conn.create', { name: 'Purchase', callback_url: 'http://example.com/hook' }, tok.boss)).error, /https/, 'http is refused');
  assert.match((await call('conn.create', { name: 'Purchase', callback_url: 'https://user:pw@example.com/hook' }, tok.boss)).error, /user name or password/);
  assert.match((await call('conn.create', { name: 'Purchase', callback_url: 'ftp://example.com/x' }, tok.boss)).error, /https/);
  const r = await call('conn.create', { name: 'Purchase', callback_url: CB }, tok.boss);
  assert.ok(r.ok, r.error);
  assert.match(r.key, /^wtc_[0-9a-f]{48}$/, 'the key: wtc_ + 48 random letters');
  assert.match(r.secret, /^wts_[0-9a-f]{48}$/);
  assert.equal(r.connection.keyEnd, r.key.slice(-4));
  cn.purchase = { id: r.connection.id, key: r.key, secret: r.secret };
  const p = await call('conn.create', { name: 'Poller' }, tok.boss);
  cn.poller = { id: p.connection.id, key: p.key, secret: p.secret };
  assert.equal(p.connection.callbackUrl, '', 'no decision address: the app asks');
  const list = await call('conn.list', {}, tok.boss);
  assert.deepEqual(list.connections.map((c) => [c.name, c.active, c.pending, c.lastSeenAt]), [['Poller', true, 0, null], ['Purchase', true, 0, null]]);
  const shown = JSON.stringify(list);
  for (const x of [cn.purchase.key, cn.purchase.secret, cn.poller.key, cn.poller.secret]) assert.ok(!shown.includes(x), 'the list never shows a key or secret');
  const stored = sqlOut('SELECT key_hash, key_end, secret_enc FROM wt.connections; SELECT GROUP_CONCAT(detail) FROM wt.audit');
  assert.ok(stored.includes(createHash('sha256').update(cn.purchase.key).digest('hex')), 'only the key\'s fingerprint is kept');
  for (const x of [cn.purchase.key, cn.purchase.secret, cn.poller.secret]) assert.ok(!stored.includes(x), 'never kept as it is (database, audit)');
});

test('connect.push: a good key works, a bad / missing / switched-off key gets 401 with no detail; the same external_id updates (one item); plain errors; the owner gets a phone alert', { skip }, async () => {
  assert.deepEqual([(await appCall('connect.push', { external_id: 'x' })).s, (await appCall('connect.push', { external_id: 'x' })).error], [401, 'Not allowed.']);
  assert.equal((await appCall('connect.push', {}, 'wtc_' + 'a'.repeat(48))).s, 401, 'unknown key');
  assert.equal((await appCall('connect.push', {}, tok.boss)).s, 401, 'a person\'s sign-in is not an app key');
  const n = pushLen();
  const po = { external_id: 'PO-1001', kind: 'approval', title: 'Approve PO 1001', details: 'Clay for March', link: 'https://erp.example/po/1001', fields: { Amount: '12,500', Vendor: 'ABC Minerals' } };
  const a = await appCall('connect.push', po, cn.purchase.key);
  assert.ok(a.ok, a.error);
  assert.equal(a.status, 'pending');
  const alerts = pushSince(n).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => /^conn/.test(x.msg.tag || ''));
  assert.deepEqual(alerts.map((x) => [x.user, x.msg.title, x.msg.body, x.msg.url]), [[id.boss, '🔌 Purchase: Approve PO 1001', 'Clay for March', '/projects/#apps']], 'one alert to the owner');
  assert.ok((await connList()).find((c) => c.name === 'Purchase').lastSeenAt, 'last seen is kept');
  // plain errors
  assert.match((await appCall('connect.push', { ...po, kind: 'memo' }, cn.purchase.key)).error, /kind must be "task" or "approval"/);
  assert.match((await appCall('connect.push', { ...po, title: '' }, cn.purchase.key)).error, /title is empty/);
  assert.match((await appCall('connect.push', { ...po, external_id: '' }, cn.purchase.key)).error, /external_id is empty/);
  assert.match((await appCall('connect.push', { ...po, link: 'javascript:alert(1)' }, cn.purchase.key)).error, /http/);
  assert.match((await appCall('connect.push', { ...po, fields: Object.fromEntries(Array.from({ length: 21 }, (_, i) => ['f' + i, 'v'])) }, cn.purchase.key)).error, /20 at most/);
  assert.match((await appCall('connect.push', { ...po, kind: 'task' }, cn.purchase.key)).error, /cannot change/, 'one external_id stays one kind');
  // the same external_id again = an update of the same item (no second alert)
  const n2 = pushLen();
  const b = await appCall('connect.push', { ...po, title: 'Approve PO 1001 (new price)', fields: [{ key: 'Amount', value: '11,900' }] }, cn.purchase.key);
  assert.equal(b.id, a.id, 'the same item');
  assert.equal(pushSince(n2).includes('🔌'), false, 'an update sends no new alert');
  const items = (await appItems()).filter((i) => i.externalId === 'PO-1001');
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].title, items[0].fields, items[0].app, items[0].status, items[0].delivery], ['Approve PO 1001 (new price)', [['Amount', '11,900']], 'Purchase', 'pending', null]);
  // switched off: refused; on again: works
  assert.ok((await call('conn.update', { id: cn.purchase.id, active: false }, tok.boss)).ok);
  assert.equal((await appCall('connect.push', po, cn.purchase.key)).s, 401, 'switched off');
  assert.ok((await call('conn.update', { id: cn.purchase.id, active: true }, tok.boss)).ok);
  assert.ok((await appCall('connect.push', { ...po, title: 'Approve PO 1001 (new price)', fields: [{ key: 'Amount', value: '11,900' }] }, cn.purchase.key)).ok);
  assert.equal((await connList()).find((c) => c.name === 'Purchase').pending, 1, 'one waiting');
});

test('connect.push kind task: one Daily Projects task (name, description, link chip, a first note with the fields, "From <app>" — not your work); a later push adds a note with what changed, never a second task; withdraw', { skip }, async () => {
  const t = { external_id: 'T-1', kind: 'task', title: 'Check kiln 3', details: 'The top zone runs hot.', link: 'https://erp.example/t/1', fields: { Line: '3', Shift: 'B' } };
  const r = await appCall('connect.push', t, cn.purchase.key);
  assert.ok(r.ok, r.error);
  assert.equal(r.status, 'done', 'made at once');
  let dp = await dpNow();
  let made = dp.data.projects.filter((p) => p.fromApp === 'Purchase');
  assert.equal(made.length, 1);
  const task = made[0];
  assert.deepEqual([task.name, task.about, task.state, task.steps, task.deadline], ['Check kiln 3', 'The top zone runs hot.', 'active', [], null]);
  assert.deepEqual(task.links, [{ id: task.id + '-link', title: 'Open in Purchase', url: 'https://erp.example/t/1' }], 'the link chip');
  assert.deepEqual([task.workNotes.length, task.workNotes[0].text, task.workNotes[0].app], [1, 'Line: 3\nShift: B', true], 'the fields as the first note (not your work)');
  assert.ok(dp.history[istDay(0).slice(0, 7)].some((e) => e.kind === 'app_task' && e.projectId === task.id && e.detail === 'From Purchase: Check kiln 3'), 'a history line "From Purchase"');
  // the same external_id again: a note with what changed, on the same task
  const r2 = await appCall('connect.push', { ...t, title: 'Check kiln 3 today', fields: { Line: '3', Shift: 'C', Owner: 'Ravi' } }, cn.purchase.key);
  assert.equal(r2.id, r.id);
  dp = await dpNow();
  made = dp.data.projects.filter((p) => p.fromApp === 'Purchase');
  assert.equal(made.length, 1, 'never a second task');
  assert.equal(made[0].name, 'Check kiln 3', 'the name you see stays (you may have changed it)');
  assert.equal(made[0].workNotes.length, 2);
  assert.equal(made[0].workNotes[0].text, '🔌 Purchase updated this:\nTitle: Check kiln 3 → Check kiln 3 today\nShift: C (was B)\nOwner: Ravi');
  assert.ok(made[0].workNotes[0].app);
  assert.ok(dp.history[istDay(0).slice(0, 7)].some((e) => e.kind === 'app_note' && e.projectId === task.id));
  // nothing changed: no note
  await appCall('connect.push', { ...t, title: 'Check kiln 3 today', fields: { Line: '3', Shift: 'C', Owner: 'Ravi' } }, cn.purchase.key);
  assert.equal((await dpNow()).data.projects.find((p) => p.id === task.id).workNotes.length, 2, 'the same words again: no note');
  // long details: the description keeps 1000 letters, the note the whole text
  await appCall('connect.push', { external_id: 'T-2', kind: 'task', title: 'Long one', details: 'x'.repeat(1500) }, cn.purchase.key);
  const long = (await dpNow()).data.projects.find((p) => p.name === 'Long one');
  assert.deepEqual([long.about.length, long.workNotes[0].text.length, long.links], [1000, 1500, []]);
  // tasks are not approvals
  assert.ok(!(await appItems()).some((i) => i.externalId === 'T-1'), 'a task is not in From apps');
  // withdraw
  const w = await appCall('connect.withdraw', { external_id: 'T-1' }, cn.purchase.key);
  assert.deepEqual([w.id, w.status], [r.id, 'withdrawn']);
  assert.match((await dpNow()).data.projects.find((p) => p.id === task.id).workNotes[0].text, /Purchase took this back/);
  assert.equal((await appCall('connect.withdraw', { external_id: 'nope' }, cn.purchase.key)).s, 404);
});

test('approvals: conn.items lists them; ✓ Approve sends a signed decision (HMAC checked, also by the PHP connector); ✕ Reject with a reason; only a waiting one can be decided; owner only', { skip }, async () => {
  cb.code = 200; cb.reqs = [];
  const m = (await call('login', { username: 'mgr2', password: 'mgr2-pass-456' })).token;
  const it = (await appItems()).find((i) => i.externalId === 'PO-1001');
  assert.equal((await call('conn.decide', { id: it.id, decision: 'approved' }, m)).s, 403, 'another manager cannot decide');
  assert.match((await call('conn.decide', { id: it.id, decision: 'maybe' }, tok.boss)).error, /Approve or Reject/);
  const before = Math.floor(Date.now() / 1000);
  const d = await call('conn.decide', { id: it.id, decision: 'approved' }, tok.boss);
  assert.ok(d.ok, d.error);
  assert.deepEqual([d.item.status, d.item.delivery], ['approved', 'sent']);
  assert.equal(cb.reqs.length, 1, 'sent at once');
  const q = cb.reqs[0];
  const ts = q.headers['x-worktask-timestamp'];
  assert.ok(Math.abs(Number(ts) - before) < 60, 'the time it was sent');
  assert.equal(q.headers['x-worktask-signature'], 'sha256=' + hmac(cn.purchase.secret, ts + '.' + q.body), 'signed with the secret: HMAC-SHA256(secret, timestamp + "." + body)');
  const body = JSON.parse(q.body);
  assert.deepEqual([body.event, body.external_id, body.status, body.reason, body.item_id], ['decision', 'PO-1001', 'approved', '', it.id]);
  assert.match(body.decided_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+05:30$/);
  assert.equal((await call('conn.decide', { id: it.id, decision: 'rejected' }, tok.boss)).s, 409, 'decided once');
  assert.equal((await appCall('connect.push', { external_id: 'PO-1001', kind: 'approval', title: 'Again' }, cn.purchase.key)).status, 'approved', 'a decided item is not opened again');
  // the downloaded PHP connector checks the signature the same way
  const { buildConnector } = await import('../docs/ui/connections.js');
  const file = join(dir, 'worktask-connector.php');
  writeFileSync(file, buildConnector({ address: B.replace(/\?a=$/, ''), key: cn.purchase.key, secret: cn.purchase.secret }));
  const check = (b, t, s) => execFileSync('php', ['-r', 'require $argv[1]; echo wt_signature_ok($argv[2], $argv[3], $argv[4]) ? "yes" : "no";', file, b, t, s], { encoding: 'utf8' });
  assert.equal(check(q.body, ts, q.headers['x-worktask-signature']), 'yes');
  assert.equal(check(q.body.replace('approved', 'rejected'), ts, q.headers['x-worktask-signature']), 'no', 'a changed body fails');
  const old = String(Number(ts) - 600);
  assert.equal(check(q.body, old, 'sha256=' + hmac(cn.purchase.secret, old + '.' + q.body)), 'no', 'older than 5 minutes fails');
  // the connector can push too (wt_push against this server)
  const pushed = execFileSync('php', ['-r', 'require $argv[1]; $r = wt_push(["external_id" => "PO-1002", "kind" => "approval", "title" => "Approve PO 1002", "fields" => ["Amount" => "3,000"]]); echo $r["status"];', file], { encoding: 'utf8' });
  assert.equal(pushed, 'pending');
  // reject with a reason
  const it2 = (await appItems()).find((i) => i.externalId === 'PO-1002');
  const d2 = await call('conn.decide', { id: it2.id, decision: 'rejected', reason: 'Too costly' }, tok.boss);
  assert.deepEqual([d2.item.status, d2.item.reason], ['rejected', 'Too costly']);
  assert.deepEqual([JSON.parse(cb.reqs[1].body).status, JSON.parse(cb.reqs[1].body).reason], ['rejected', 'Too costly']);
  // taken back by the app: nothing to decide
  await appCall('connect.push', { external_id: 'PO-1003', kind: 'approval', title: 'Approve PO 1003' }, cn.purchase.key);
  assert.equal((await appCall('connect.withdraw', { external_id: 'PO-1003' }, cn.purchase.key)).status, 'withdrawn');
  const it3 = (await appItems()).find((i) => i.externalId === 'PO-1003');
  assert.equal(it3.status, 'withdrawn');
  assert.match((await call('conn.decide', { id: it3.id, decision: 'approved' }, tok.boss)).error, /took this back/);
});

test('approvals: a decision the app did not take (error / redirect) is tried again by the 5-minute job (cron) with backoff, then given up after 24 hours with the error in plain words; never follows a redirect', { skip }, async () => {
  cb.code = 500; cb.reqs = [];
  sql("USE wt; INSERT INTO wt.settings (k, v) VALUES ('fill_by', '23:59:59') ON DUPLICATE KEY UPDATE v = '23:59:59'");
  await appCall('connect.push', { external_id: 'PO-2001', kind: 'approval', title: 'Approve PO 2001' }, cn.purchase.key);
  const it = (await appItems()).find((i) => i.externalId === 'PO-2001');
  const d = await call('conn.decide', { id: it.id, decision: 'approved' }, tok.boss);
  assert.deepEqual([d.item.status, d.item.delivery, cb.reqs.length], ['approved', 'waiting', 1]);
  assert.match((await connList()).find((c) => c.name === 'Purchase').lastError, /said error 500\. Trying again by itself/);
  await cronIn(1);
  assert.equal(cb.reqs.length, 1, 'not again before 5 minutes');
  await cronIn(6);
  assert.equal(cb.reqs.length, 2, 'tried again after 5 minutes');
  await cronIn(8);
  assert.equal(cb.reqs.length, 2, 'then waits longer (10 minutes)');
  await cronIn(17);
  assert.equal(cb.reqs.length, 3);
  await cronIn(25 * 60);
  assert.equal(cb.reqs.length, 4, 'one last try');
  const gone = (await appItems()).find((i) => i.externalId === 'PO-2001');
  assert.equal(gone.delivery, 'failed');
  assert.match((await connList()).find((c) => c.name === 'Purchase').lastError, /for 24 hours.*Stopped trying — the app can still ask for its decisions/);
  await cronIn(27 * 60);
  assert.equal(cb.reqs.length, 4, 'given up: no more tries');
  // a redirect is not followed (counts as not taken); the next try that gets 200 clears the error
  cb.code = 302; cb.reqs = [];
  await appCall('connect.push', { external_id: 'PO-2002', kind: 'approval', title: 'Approve PO 2002' }, cn.purchase.key);
  const it2 = (await appItems()).find((i) => i.externalId === 'PO-2002');
  assert.equal((await call('conn.decide', { id: it2.id, decision: 'approved' }, tok.boss)).item.delivery, 'waiting');
  assert.deepEqual(cb.reqs.map((r) => r.path), ['/hook'], 'the redirect was not followed');
  assert.match((await connList()).find((c) => c.name === 'Purchase').lastError, /sent us somewhere else/);
  cb.code = 200;
  await cronIn(6);
  assert.equal((await appItems()).find((i) => i.externalId === 'PO-2002').delivery, 'sent');
  assert.equal((await connList()).find((c) => c.name === 'Purchase').lastError, '', 'the error is cleared');
});

test('connect.decisions: an app with no decision address asks for its decisions (POST or GET, since a time); only its own; asked = shown as sent', { skip }, async () => {
  await appCall('connect.push', { external_id: 'P-1', kind: 'approval', title: 'Leave for Ravi' }, cn.poller.key);
  const it = (await appItems()).find((i) => i.externalId === 'P-1' && i.app === 'Poller');
  const d = await call('conn.decide', { id: it.id, decision: 'rejected', reason: 'Busy week' }, tok.boss);
  assert.equal(d.item.delivery, 'ask', 'no address: the app picks it up');
  const all = await appCall('connect.decisions', {}, cn.poller.key);
  assert.ok(all.ok, all.error);
  assert.deepEqual(all.decisions.map((x) => [x.external_id, x.status, x.reason, x.item_id]), [['P-1', 'rejected', 'Busy week', it.id]], 'only this app\'s decisions');
  assert.match(all.decisions[0].decided_at, /\+05:30$/);
  assert.match(all.until, /\+05:30$/);
  assert.equal((await appItems()).find((i) => i.id === it.id).delivery, 'sent', 'asked for = the app knows');
  const later = await appCall('connect.decisions', { since: new Date(Date.now() + 3600e3).toISOString() }, cn.poller.key);
  assert.deepEqual(later.decisions, [], 'nothing after that time');
  assert.match((await appCall('connect.decisions', { since: 'yesterday-ish' }, cn.poller.key)).error, /since is not a time/);
  const g = await appCall(`connect.decisions&since=${encodeURIComponent(new Date(Date.now() - 3600e3).toISOString())}`, null, cn.poller.key, 'GET');
  assert.deepEqual(g.decisions.map((x) => x.external_id), ['P-1'], 'GET works too');
  assert.equal((await appCall('connect.decisions', {}, 'wtc_' + 'b'.repeat(48), 'GET')).s, 401);
  const purchase = await appCall('connect.decisions', {}, cn.purchase.key);
  assert.ok(purchase.decisions.every((x) => x.external_id.startsWith('PO-')), 'the other app sees only its own');
});

test('connect.*: more than 120 calls a minute from one app → 429 (other apps are not slowed)', { skip }, async () => {
  const burst = await call('conn.create', { name: 'Burst' }, tok.boss); // a fresh app: no calls yet this minute
  while (new Date().getSeconds() > 40) await wait(1000); // all calls inside one minute
  const results = [];
  for (let i = 0; i < 121; i++) results.push((await appCall('connect.decisions', {}, burst.key)).s);
  assert.deepEqual([results.slice(0, 120).every((s) => s === 200), results[120]], [true, 429]);
  assert.match((await appCall('connect.decisions', {}, burst.key)).error, /Too many calls/);
  assert.equal((await appCall('connect.decisions', {}, cn.purchase.key)).s, 200, 'another app is fine');
  assert.ok((await call('conn.delete', { id: burst.connection.id }, tok.boss)).ok);
});

test('connections: Rotate key — the old key stops at once, the new key and a new secret are shown once; Delete removes the app and its items; the log never holds a key or secret', { skip }, async () => {
  const r = await call('conn.rotate', { id: cn.purchase.id }, tok.boss);
  assert.ok(r.ok, r.error);
  assert.match(r.key, /^wtc_[0-9a-f]{48}$/);
  assert.notEqual(r.key, cn.purchase.key);
  assert.notEqual(r.secret, cn.purchase.secret);
  assert.equal((await appCall('connect.push', { external_id: 'PO-3001', kind: 'approval', title: 'x' }, cn.purchase.key)).s, 401, 'the old key is refused');
  assert.ok((await appCall('connect.push', { external_id: 'PO-3001', kind: 'approval', title: 'Approve PO 3001' }, r.key)).ok, 'the new key works');
  assert.ok(!JSON.stringify(await connList()).includes(r.key), 'not shown again');
  cb.code = 200; cb.reqs = [];
  const it = (await appItems()).find((i) => i.externalId === 'PO-3001');
  await call('conn.decide', { id: it.id, decision: 'approved' }, tok.boss);
  const q = cb.reqs[0];
  assert.equal(q.headers['x-worktask-signature'], 'sha256=' + hmac(r.secret, q.headers['x-worktask-timestamp'] + '.' + q.body), 'signed with the new secret');
  cn.purchase = { id: cn.purchase.id, key: r.key, secret: r.secret };
  // delete
  const m = (await call('login', { username: 'mgr2', password: 'mgr2-pass-456' })).token;
  assert.equal((await call('conn.delete', { id: cn.poller.id }, m)).s, 403);
  assert.ok((await call('conn.delete', { id: cn.poller.id }, tok.boss)).ok);
  assert.deepEqual((await connList()).map((c) => c.name), ['Purchase']);
  assert.ok(!(await appItems()).some((i) => i.app === 'Poller'), 'its items are deleted too');
  assert.equal((await appCall('connect.decisions', {}, cn.poller.key)).s, 401, 'its key is refused');
  const log = sqlOut("SELECT GROUP_CONCAT(action, ' ', detail SEPARATOR '\\n') FROM wt.audit WHERE action LIKE 'conn\\_%'");
  for (const a of ['conn_create #', 'conn_rotate #', 'conn_delete #', 'conn_update #', 'conn_decide #']) assert.ok(log.includes(a), a);
  assert.ok(!/wt[cs]_[0-9a-f]{20}/.test(log), 'no key or secret in the log');
  assert.equal(sqlOut("SELECT v FROM wt.settings WHERE k = 'schema'").trim(), '34', 'the tables steps ran (v34: conn_items.callback_since)');
});

// ---------------------------------------------------------------- review round 12 (connect.php / outlook.php)
// Server functions called directly (as the 5-minute job and a request would), to make the races happen on purpose.
const phpRun = (code) => promisify(execFile)('php', ['-r', ['bootstrap', 'auth', 'api', 'dp'].map((f) => `require '${join(ROOT, 'team', 'app', f + '.php')}';`).join(' ') + ' ' + code],
  { env: env(), encoding: 'utf8' }).then((r) => r.stdout);
const itemId = (conn, ext) => Number(sqlOut(`SELECT id FROM wt.conn_items WHERE conn_id = ${Number(conn)} AND external_id = '${ext}'`).trim());

test('review r12: a push and the 5-minute job making the same app task at once (both saw it not made) give ONE task', { skip }, async () => {
  sql(`INSERT INTO wt.conn_items (conn_id, external_id, kind, title, details, fields, status, created_at, updated_at) VALUES (${cn.purchase.id}, 'T-RACE', 'task', 'Race task', '', '[]', 'pending', NOW(), NOW())`);
  const iid = itemId(cn.purchase.id, 'T-RACE');
  // the same stale row (dp_task_id still empty) handed to two makers, one after the other and then two at once
  await phpRun(`$it = one('SELECT * FROM conn_items WHERE id = ${iid}'); var_export([conn_make_task($it, ['name' => 'Purchase']), conn_make_task($it, ['name' => 'Purchase'])]);`);
  await Promise.all([phpRun(`$it = one('SELECT * FROM conn_items WHERE id = ${iid}'); $it['dp_task_id'] = null; conn_make_task($it, ['name' => 'Purchase']);`),
    phpRun(`conn_jobs(); $it = one('SELECT * FROM conn_items WHERE id = ${iid}'); $it['dp_task_id'] = null; conn_make_task($it, ['name' => 'Purchase']);`)]);
  const made = (await dpNow()).data.projects.filter((p) => p.name === 'Race task');
  assert.equal(made.length, 1, 'one task, never two');
  assert.equal(sqlOut(`SELECT CONCAT(status, ' ', dp_task_id) FROM wt.conn_items WHERE id = ${iid}`).trim(), 'done ' + made[0].id, 'the item points at that task');
});

test('review r12: a task update whose note cannot be written is refused (503) and written when the app sends it again — never lost', { skip }, async () => {
  const t = { external_id: 'T-NOTE', kind: 'task', title: 'Clay order', fields: { Amount: '12,500' } };
  assert.equal((await appCall('connect.push', t, cn.purchase.key)).status, 'done');
  const owner = sqlOut("SELECT v FROM wt.settings WHERE k = 'dp_owner'").trim();
  sql("UPDATE wt.settings SET v = '0' WHERE k = 'dp_owner'"); // the projects cannot be saved just now
  let r;
  try { r = await appCall('connect.push', { ...t, fields: { Amount: '15,000' } }, cn.purchase.key); } finally { sql(`UPDATE wt.settings SET v = '${owner}' WHERE k = 'dp_owner'`); }
  assert.equal(r.s, 503, 'the app is told to send it again');
  assert.match(r.error, /Send the same again/);
  const r2 = await appCall('connect.push', { ...t, fields: { Amount: '15,000' } }, cn.purchase.key);
  assert.ok(r2.ok, r2.error);
  const task = (await dpNow()).data.projects.find((p) => p.name === 'Clay order');
  assert.equal(task.workNotes[0].text, '🔌 Purchase updated this:\nAmount: 15,000 (was 12,500)', 'the change reaches the task on the second send');
});

test('review r12: a withdraw racing the owner\'s ✓ Approve leaves it approved (and says so to the app)', { skip }, async () => {
  await appCall('connect.push', { external_id: 'PO-WR', kind: 'approval', title: 'Approve PO WR' }, cn.purchase.key);
  const iid = itemId(cn.purchase.id, 'PO-WR');
  // the withdraw read the item while it waited; the owner approved before its UPDATE ran
  const out = await phpRun(`$it = one('SELECT * FROM conn_items WHERE id = ${iid}'); $c = one('SELECT * FROM connections WHERE id = ${cn.purchase.id}');
    q("UPDATE conn_items SET status = 'approved', decided_at = NOW() WHERE id = ${iid}"); echo json_encode(conn_withdraw($c, $it));`);
  assert.deepEqual(JSON.parse(out), { id: iid, status: 'approved' }, 'the app hears the real status');
  assert.equal(sqlOut(`SELECT status FROM wt.conn_items WHERE id = ${iid}`).trim(), 'approved', 'the decision is kept');
  // a plain withdraw of a waiting one still works
  await appCall('connect.push', { external_id: 'PO-WR2', kind: 'approval', title: 'Approve PO WR2' }, cn.purchase.key);
  assert.equal((await appCall('connect.withdraw', { external_id: 'PO-WR2' }, cn.purchase.key)).status, 'withdrawn');
});

test('review r12: decisions made while an app had no decision address (or whose sending failed) are sent once an address is added', { skip }, async () => {
  await fakeApp();
  cb.code = 200; cb.reqs = []; cb.delay = 0;
  const late = await call('conn.create', { name: 'Late' }, tok.boss);
  for (const ext of ['L-1', 'L-2']) await appCall('connect.push', { external_id: ext, kind: 'approval', title: 'Approve ' + ext }, late.key);
  for (const ext of ['L-1', 'L-2']) {
    const it = (await appItems()).find((i) => i.externalId === ext && i.app === 'Late');
    assert.equal((await call('conn.decide', { id: it.id, decision: 'approved' }, tok.boss)).item.delivery, 'ask');
  }
  sql(`UPDATE wt.conn_items SET callback_failed = 1, callback_tries = 7 WHERE conn_id = ${late.connection.id} AND external_id = 'L-2'`); // gave up on a broken address
  assert.ok((await call('conn.update', { id: late.connection.id, callback_url: CB }, tok.boss)).ok);
  assert.deepEqual((await appItems()).filter((i) => i.app === 'Late').map((i) => i.delivery), ['waiting', 'waiting'], 'queued for the new address');
  await cronIn(1);
  assert.deepEqual(cb.reqs.map((q) => JSON.parse(q.body).external_id).sort(), ['L-1', 'L-2'], 'both sent by the 5-minute job');
  assert.deepEqual((await appItems()).filter((i) => i.app === 'Late').map((i) => i.delivery), ['sent', 'sent']);
  assert.ok((await call('conn.delete', { id: late.connection.id }, tok.boss)).ok);
});

test('review r12: connect.decisions with more than 500 decisions — "more" and until = the last one\'s time, so asking again from until gets the rest', { skip }, async () => {
  const many = await call('conn.create', { name: 'Many' }, tok.boss);
  const cid = many.connection.id;
  sql(`SET SESSION cte_max_recursion_depth = 2000; INSERT INTO wt.conn_items (conn_id, external_id, kind, title, status, decided_at, created_at, updated_at)
    WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 501)
    SELECT ${cid}, CONCAT('M-', i), 'approval', 'x', 'approved', NOW() - INTERVAL (600 - i) MINUTE, NOW(), NOW() FROM n`);
  const a = await appCall('connect.decisions', {}, many.key);
  assert.ok(a.ok, a.error);
  assert.deepEqual([a.decisions.length, a.more], [500, true]);
  assert.equal(a.until, a.decisions[499].decided_at, 'until = the last one given');
  const b = await appCall('connect.decisions', { since: a.until }, many.key);
  assert.equal(b.more, false);
  const got = new Set([...a.decisions, ...b.decisions].map((x) => x.external_id));
  assert.equal(got.size, 501, 'none skipped');
  assert.ok((await call('conn.delete', { id: cid }, tok.boss)).ok);
});

test('review r12: two senders at once (the owner\'s ✓ and the 5-minute job) tell the app ONCE', { skip }, async () => {
  await fakeApp();
  cb.code = 200; cb.reqs = []; cb.delay = 1500; // the app answers slowly: both senders are in the middle together
  try {
    await appCall('connect.push', { external_id: 'PO-TWICE', kind: 'approval', title: 'Approve PO TWICE' }, cn.purchase.key);
    const iid = itemId(cn.purchase.id, 'PO-TWICE');
    sql(`UPDATE wt.conn_items SET status = 'approved', decided_at = NOW(), callback_next_at = NOW() WHERE id = ${iid}`);
    await Promise.all([phpRun(`conn_send(${iid});`), phpRun(`conn_send(${iid});`)]);
    assert.equal(cb.reqs.filter((q) => JSON.parse(q.body).external_id === 'PO-TWICE').length, 1, 'one decision sent, not two');
    assert.equal((await appItems()).find((i) => i.id === iid).delivery, 'sent');
  } finally { cb.delay = 0; }
  // a second ✓ that lost the race does not send again either
  await appCall('connect.push', { external_id: 'PO-TWICE2', kind: 'approval', title: 'Approve PO TWICE2' }, cn.purchase.key);
  const it2 = (await appItems()).find((i) => i.externalId === 'PO-TWICE2');
  cb.reqs = [];
  const [d1, d2] = await Promise.all([call('conn.decide', { id: it2.id, decision: 'approved' }, tok.boss), call('conn.decide', { id: it2.id, decision: 'approved' }, tok.boss)]);
  assert.equal([d1, d2].filter((d) => d.ok).length, 1, 'one decision counts');
  assert.equal(cb.reqs.filter((q) => JSON.parse(q.body).external_id === 'PO-TWICE2').length, 1, 'sent once');
});

test('review r12: a new email from them in the thread of a FINISHED 📧 task (or finished project) opens it again, so it is seen on ✉ Replies; your own email does not', { skip }, async () => {
  await fakeMicrosoft();
  await connectOutlook();
  const at = new Date(Date.now() - 3 * 86400e3).toISOString();
  const fin = (id, conv, name, extra = {}) => ({ id, name, state: 'finished', stateChangedAt: at, groupId: 'g1', createdAt: at, steps: [], workNotes: [], links: [], files: [], notes: '',
    mail: { conversationId: conv, messageId: conv + '-1', fromName: 'Ravi', fromAddress: 'ravi@x.test', subject: name, at },
    thread: [{ at, fromName: 'Ravi', fromMe: false, preview: 'First', messageId: conv + '-1' }], ...extra });
  const finProj = { id: 'r12p', name: 'Kiln order', state: 'finished', stateChangedAt: at, groupId: 'g1', createdAt: at, steps: [], workNotes: [], mail: { conversationId: 'C-R12P' } };
  const head = (await call('dp.head', {}, tok.boss)).head;
  assert.ok((await call('dp.commit', { parent: head, message: 'finished threads', changes: [{ path: 'data.json', content: JSON.stringify({
    groups: [{ id: 'g1', name: 'Acton' }], projects: [fin('r12a', 'C-R12A', '📧 PO 4411'), fin('r12b', 'C-R12B', '📧 PO 4412'), finProj] }) }] }, tok.boss)).ok);
  const mine = { ...mail('r12-b2', 'C-R12B', 'RE: PO 4412', 'Venkat', 4, 'Thanks, closing this.'), from: { emailAddress: { name: 'Venkat', address: 'venkat@acton.test' } } };
  ms.sent = [];
  ms.pages = [[mail('r12-a2', 'C-R12A', 'RE: PO 4411', 'Ravi', 5, 'One more question on the price.'), mine, mail('r12-p2', 'C-R12P', 'RE: Kiln', 'Meena', 3, 'Delivery moved.')]];
  const r = await call('outlook.check', {}, tok.boss);
  assert.equal(r.outlook.error, '', r.outlook.error);
  const { data, history } = await dpNow();
  const a = data.projects.find((p) => p.id === 'r12a');
  assert.deepEqual([a.state, a.thread.length, a.activeSince], ['active', 2, istDay(0)], 'opened again, the email in its thread');
  assert.equal(data.projects.find((p) => p.id === 'r12b').state, 'finished', 'your own email does not open it');
  assert.equal(data.projects.find((p) => p.id === 'r12p').state, 'active', 'a finished project with that thread opens too');
  assert.ok(history[istDay(0).slice(0, 7)].some((e) => e.kind === 'reopened' && e.projectId === 'r12a'), 'a "Reopened" history line');
  const { repliesOf } = await import('../docs/rules.js');
  assert.ok(repliesOf(data, istDay(0)).waiting.some((m) => m.id === 'r12a'), 'listed on ✉ Replies');
  await saveProjects([]);
});

// ---------------------------------------------------------------- review round 13 (connect.php / jobs.php)
test('review r13: the app withdraws a task while the 5-minute job is making it — it stays withdrawn and the task gets the "took this back" note', { skip }, async () => {
  sql(`INSERT INTO wt.conn_items (conn_id, external_id, kind, title, details, fields, status, created_at, updated_at) VALUES (${cn.purchase.id}, 'T-WD1', 'task', 'Withdrawn while made', '', '[]', 'pending', NOW(), NOW())`);
  const iid = itemId(cn.purchase.id, 'T-WD1');
  // the withdraw holds the row and writes 'withdrawn' while the task is being made (after the maker read 'pending')
  const withdraw = promisify(execFile)('mysql', ['-u', 'root', `--socket=${SOCK}`, '-e',
    `BEGIN; SELECT id FROM wt.conn_items WHERE id = ${iid} FOR UPDATE; DO SLEEP(3); UPDATE wt.conn_items SET status = 'withdrawn' WHERE id = ${iid}; COMMIT;`]);
  await wait(500);
  await phpRun(`$it = one('SELECT * FROM conn_items WHERE id = ${iid}'); conn_make_task($it, ['name' => 'Purchase']);`);
  await withdraw;
  const task = (await dpNow()).data.projects.find((p) => p.name === 'Withdrawn while made');
  assert.ok(task, 'the task was made');
  assert.equal(sqlOut(`SELECT CONCAT(status, ' ', dp_task_id) FROM wt.conn_items WHERE id = ${iid}`).trim(), 'withdrawn ' + task.id, 'stays withdrawn (not done), and points at its task');
  assert.ok(task.workNotes.some((n) => n.text === '🔌 Purchase took this back (withdrawn).'), 'the task says the app took it back');
  // a withdrawn task is not made by the job afterwards
  await phpRun('conn_jobs();');
  assert.equal((await dpNow()).data.projects.filter((p) => p.name === 'Withdrawn while made').length, 1);
});

test('review r13: a withdraw that read the task as not made yet, while the job made it meanwhile, still writes the note on the task', { skip }, async () => {
  sql(`INSERT INTO wt.conn_items (conn_id, external_id, kind, title, details, fields, status, created_at, updated_at) VALUES (${cn.purchase.id}, 'T-WD2', 'task', 'Made before the withdraw', '', '[]', 'pending', NOW(), NOW())`);
  const iid = itemId(cn.purchase.id, 'T-WD2');
  const out = await phpRun(`$c = one('SELECT * FROM connections WHERE id = ${cn.purchase.id}'); $stale = one('SELECT * FROM conn_items WHERE id = ${iid}');
    conn_make_task($stale, $c); echo json_encode(conn_withdraw($c, $stale));`);
  assert.deepEqual(JSON.parse(out), { id: iid, status: 'withdrawn' });
  const task = (await dpNow()).data.projects.find((p) => p.name === 'Made before the withdraw');
  assert.equal(sqlOut(`SELECT CONCAT(status, ' ', dp_task_id) FROM wt.conn_items WHERE id = ${iid}`).trim(), 'withdrawn ' + task.id);
  assert.equal(task.workNotes.filter((n) => n.text === '🔌 Purchase took this back (withdrawn).').length, 1, 'one note on the task');
});

test('review r13: a task withdrawn before it was made, sent again, is made (and done)', { skip }, async () => {
  sql(`INSERT INTO wt.conn_items (conn_id, external_id, kind, title, details, fields, status, created_at, updated_at) VALUES (${cn.purchase.id}, 'T-WD3', 'task', 'Sent again', '', '[]', 'withdrawn', NOW(), NOW())`);
  const r = await appCall('connect.push', { external_id: 'T-WD3', kind: 'task', title: 'Sent again' }, cn.purchase.key);
  assert.equal(r.status, 'done', r.error);
  assert.equal((await dpNow()).data.projects.filter((p) => p.name === 'Sent again').length, 1);
});

test('review r13: after the owner fixes the decision address, an old decision gets a fresh 24 hours of tries (one failure does not give it up)', { skip }, async () => {
  await fakeApp();
  const old = await call('conn.create', { name: 'Old' }, tok.boss);
  sql(`INSERT INTO wt.conn_items (conn_id, external_id, kind, title, status, decided_at, callback_since, callback_failed, callback_tries, created_at, updated_at)
    VALUES (${old.connection.id}, 'O-1', 'approval', 'Approve O-1', 'approved', NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY, 1, 9, NOW() - INTERVAL 3 DAY, NOW())`);
  const iid = itemId(old.connection.id, 'O-1');
  cb.code = 503;
  try {
    assert.ok((await call('conn.update', { id: old.connection.id, callback_url: CB }, tok.boss)).ok);
    await phpRun(`conn_send(${iid});`);
  } finally { cb.code = 200; }
  const row = sqlOut(`SELECT CONCAT(callback_failed, ' ', callback_tries, ' ', callback_next_at IS NOT NULL) FROM wt.conn_items WHERE id = ${iid}`).trim();
  assert.equal(row, '0 1 1', 'one try failed: still queued to try again, not given up');
  assert.equal((await appItems()).find((i) => i.id === iid).delivery, 'waiting');
  assert.ok((await call('conn.delete', { id: old.connection.id }, tok.boss)).ok);
});

test('review r13: connect.decisions never skips a decision saved at the moment the app asked (its time is before that answer\'s until)', { skip }, async () => {
  const p = await call('conn.create', { name: 'Moment' }, tok.boss);
  const a = await appCall('connect.decisions', {}, p.key);
  assert.ok(a.ok, a.error);
  assert.deepEqual(a.decisions, []);
  // the owner's ✓ took its time a second before the app asked, but was written just after the answer
  await phpRun(`q("INSERT INTO conn_items (conn_id, external_id, kind, title, status, decided_at, created_at, updated_at) VALUES (${p.connection.id}, 'MO-1', 'approval', 'x', 'approved', ?, NOW(), NOW())",
    [date('Y-m-d H:i:s', time() - 1)]);`);
  const b = await appCall('connect.decisions', { since: a.until }, p.key);
  assert.deepEqual(b.decisions.map((d) => d.external_id), ['MO-1'], 'the next ask from until still gets it');
  const c = await appCall('connect.decisions', { since: b.until }, p.key);
  assert.ok(c.decisions.every((d) => d.external_id === 'MO-1'), 'at most the same one again (the app skips it by item_id)');
  assert.ok((await call('conn.delete', { id: p.connection.id }, tok.boss)).ok);
});

test('review r13: changing "🔔 Remind me at" to a later time the same day sends the new reminder once', { skip }, async () => {
  const p = (at) => ({ id: 'rm13', name: 'Glaze check', state: 'active', remindAt: at, steps: [] });
  await saveProjects([p('09:00')]);
  assert.equal(remindersAt('2026-12-14T09:05:00+05:30').length, 1, 'the 09:00 reminder');
  await saveProjects([p('14:00')]);
  assert.deepEqual(remindersAt('2026-12-14T13:59:00+05:30'), [], 'not before the new time');
  assert.equal(remindersAt('2026-12-14T14:01:00+05:30').length, 1, 'the new 14:00 reminder comes');
  assert.deepEqual(remindersAt('2026-12-14T14:30:00+05:30'), [], 'and never twice');
  await saveProjects([]);
});

// ---------------------------------------------------------------- review round 14 (server)
test('review r14: an approval sent again while the owner decides it (read as waiting, decided before the write) stays decided', { skip }, async () => {
  await appCall('connect.push', { external_id: 'PO-RP', kind: 'approval', title: 'Approve PO RP' }, cn.purchase.key);
  const iid = itemId(cn.purchase.id, 'PO-RP');
  // the re-push read the item while it waited; the owner pressed ✓ Approve before its UPDATE ran
  const out = await phpRun(`$old = one('SELECT * FROM conn_items WHERE id = ${iid}'); $c = one('SELECT * FROM connections WHERE id = ${cn.purchase.id}');
    q("UPDATE conn_items SET status = 'approved', decided_at = NOW() WHERE id = ${iid}");
    echo json_encode(conn_approval_again($c, $old, 'Approve PO RP (again)', '', '', '[]'));`);
  assert.deepEqual(JSON.parse(out), { id: iid, status: 'approved' }, 'the app hears the decision');
  assert.equal(sqlOut(`SELECT status FROM wt.conn_items WHERE id = ${iid}`).trim(), 'approved', 'never put back to pending');
  // a plain re-push of a waiting one still updates it
  await appCall('connect.push', { external_id: 'PO-RP2', kind: 'approval', title: 'Approve PO RP2' }, cn.purchase.key);
  const r = await appCall('connect.push', { external_id: 'PO-RP2', kind: 'approval', title: 'Approve PO RP2 (new words)' }, cn.purchase.key);
  assert.equal(r.status, 'pending');
  assert.equal(sqlOut(`SELECT title FROM wt.conn_items WHERE id = ${itemId(cn.purchase.id, 'PO-RP2')}`).trim(), 'Approve PO RP2 (new words)');
});

test('review r14: GET connect.decisions with since=…+05:30 not URL-encoded (the + arrives as a space) works', { skip }, async () => {
  const pl = await call('conn.create', { name: 'Plus' }, tok.boss);
  cn.plus = { id: pl.connection.id, key: pl.key };
  const ist = new Date(Date.now() + 5.5 * 3600e3 - 3600e3).toISOString().slice(0, 19) + '+05:30'; // an hour ago, India time
  const g = await appCall(`connect.decisions&since=${ist}`, null, cn.plus.key, 'GET');
  assert.equal(g.s, 200, g.error);
  assert.ok(g.ok && Array.isArray(g.decisions));
  const later = await appCall(`connect.decisions&since=${new Date(Date.now() + 5.5 * 3600e3 + 3600e3).toISOString().slice(0, 19)}+05:30`, null, cn.plus.key, 'GET');
  assert.deepEqual(later.decisions, [], 'read as +05:30 (an hour from now): nothing after it');
  assert.match((await appCall('connect.decisions&since=yesterday-ish', null, cn.plus.key, 'GET')).error, /since is not a time/, 'a wrong time is still refused');
  assert.ok((await call('conn.delete', { id: cn.plus.id }, tok.boss)).ok);
});

test('review r14: the PHP connector (team/connector) wt_decisions gives the whole answer (decisions, until, more); asking again from until while more gets them all', { skip }, async () => {
  const pg = await call('conn.create', { name: 'Paged' }, tok.boss);
  sql(`SET SESSION cte_max_recursion_depth = 2000; INSERT INTO wt.conn_items (conn_id, external_id, kind, title, status, decided_at, created_at, updated_at)
    WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 501)
    SELECT ${pg.connection.id}, CONCAT('G-', i), 'approval', 'x', 'approved', NOW() - INTERVAL (600 - i) MINUTE, NOW(), NOW() FROM n`);
  const file = join(dir, 'connector-r14.php');
  writeFileSync(file, readFileSync(join(ROOT, 'team', 'connector', 'worktask-connector.php'), 'utf8')
    .replace("'https://YOUR-WORK-TASK-ADDRESS/api/'", `'${B.replace(/\?a=$/, '')}'`).replace("'PASTE-YOUR-KEY-HERE'", `'${pg.key}'`));
  const out = execFileSync('php', ['-r', `require $argv[1]; $since = ''; $ids = []; $asks = 0;
    do { $a = wt_decisions($since); $asks++; foreach ($a['decisions'] as $d) $ids[$d['external_id']] = 1; $since = $a['until']; } while ($a['more'] && $asks < 5);
    echo json_encode(['n' => count($ids), 'asks' => $asks, 'keys' => array_keys($a), 'until' => $since]);`, file], { encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.deepEqual(r.keys, ['decisions', 'until', 'more']);
  assert.equal(r.n, 501, 'none missed');
  assert.equal(r.asks, 2, 'asked again once, because more was true');
  assert.match(r.until, /\+05:30$/);
  const tpl = readFileSync(join(ROOT, 'team', 'connector', 'worktask-connector.php'), 'utf8');
  assert.match(tpl, /while \(\$answer\['more'\]\)/, 'the comment says to repeat while more');
  assert.match(tpl, /\$lastTime = \$answer\['until'\]/, 'and to keep until');
  assert.ok((await call('conn.delete', { id: pg.connection.id }, tok.boss)).ok);
});

test('review r14: each email the Outlook check brings in carries addedAt (when it came in), on the thread entry and on the mail; an email seen again keeps it', { skip }, async () => {
  const out = await phpRun(`$data = (object)['projects' => [], 'groups' => [(object)['id' => 'g1']]]; $hist = [];
    $m = fn($id, $at) => ['id' => $id, 'subject' => 'Kiln quote', 'from' => ['emailAddress' => ['name' => 'Ravi', 'address' => 'ravi@example.com']],
      'receivedDateTime' => $at, 'bodyPreview' => 'hello', 'webLink' => 'https://outlook.office.com/x', 'conversationId' => 'conv-r14'];
    ol_apply($data, $hist, $m('m1', '2026-10-22T04:30:00Z'), false, '2026-10-22T04:40:00.000Z');
    $one = json_decode(json_encode($data->projects[0]), true);
    ol_apply($data, $hist, $m('m2', '2026-10-22T04:31:00Z'), true, '2026-10-22T04:50:00.000Z');
    ol_apply($data, $hist, $m('m2', '2026-10-22T04:31:00Z'), true, '2026-10-22T05:10:00.000Z');
    echo json_encode(['one' => $one, 'two' => $data->projects[0]]);`);
  const { one, two } = JSON.parse(out);
  assert.equal(one.thread[0].at, '2026-10-22T04:30:00.000Z', 'at = when it was received');
  assert.equal(one.thread[0].addedAt, '2026-10-22T04:40:00.000Z', 'addedAt = when the server brought it in');
  assert.equal(one.mail.addedAt, '2026-10-22T04:40:00.000Z', 'the new task\'s mail too');
  assert.deepEqual(two.thread.map((e) => [e.at, e.addedAt]), [['2026-10-22T04:30:00.000Z', '2026-10-22T04:40:00.000Z'], ['2026-10-22T04:31:00.000Z', '2026-10-22T04:50:00.000Z']]);
  assert.equal(two.mail.addedAt, '2026-10-22T04:50:00.000Z', 'the mail: when the newest email came in (not moved by seeing it again)');
});

test('review r14: the server sync never cancels the person\'s open task for a step made into its own task (movedTo), like keepMovedStep in the app', { skip }, async () => {
  const P = (steps) => ({ id: 'mv14', name: 'Moved step P', state: 'active', team: { userId: id.suresh, name: 'Suresh' }, steps });
  await saveProjects([P([{ id: 'mv14a', text: 'Line kiln', done: false }, { id: 'mv14b', text: 'Paint door', done: false }])]);
  const before = (await openOf('suresh', 'mv14')).find((t) => t.stepRef === 'mv14a');
  assert.ok(before, 'given');
  const doneAt = new Date().toISOString();
  await saveProjects([P([{ id: 'mv14a', text: 'Line kiln', done: true, doneAt, movedTo: 'np14' }, { id: 'mv14b', text: 'Paint door', done: false }]),
    { id: 'np14', name: 'Line kiln', state: 'active', steps: [] }]);
  await phpRun('server_sync_projects();');
  const after = await openOf('suresh', 'mv14');
  assert.ok(after.some((t) => t.id === before.id), 'the moved step\'s task stays open on Suresh\'s list');
  assert.equal(sqlOut(`SELECT status FROM wt.tasks WHERE id = ${before.id}`).trim(), 'open');
  // a done step without movedTo still closes as before
  await saveProjects([P([{ id: 'mv14a', text: 'Line kiln', done: true, doneAt, movedTo: 'np14' }, { id: 'mv14b', text: 'Paint door', done: true, doneAt }])]);
  assert.ok(!(await openOf('suresh', 'mv14')).some((t) => t.stepRef === 'mv14b'), 'a plain ticked step leaves the list');
  await saveProjects([]);
});
