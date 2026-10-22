// The Work Task PHP server, tested for real: each run starts its own throwaway MySQL and PHP server,
// runs the one-time setup, then checks sign-in, tasks, messages, photos, projects storage and the command tool.
// Needs php and mysqld on this computer; without them these tests are skipped (the rest still run).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
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

test('project description: project.sync stores about; the team sees it as projectAbout (overview, project pages, tasks); cut to 300', { skip }, async () => {
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
  await sync('y'.repeat(400));
  assert.equal((await openOf('suresh', 'ab1'))[0].projectAbout.length, 300, 'cut to 300');
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
