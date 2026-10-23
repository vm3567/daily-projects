// Saving and syncing: one commit per save, two devices at once, offline, expired key, queue kept on the device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, MemRepo } from './helpers.mjs';
import { Store } from '../docs/store.js';
import { emptyData, makeOp } from '../docs/ops.js';
import { GitHubError } from '../docs/github.js';

installStorage();

async function device(state) {
  const store = new Store(new MemRepo(state));
  await store.init();
  return store;
}

function stop(store) { clearTimeout(store.saveTimer); }

async function freshRepoWithProject() {
  localStorage.clear();
  const repo = new MemRepo();
  const s = new Store(repo);
  await s.init();
  s.dispatch('createProject', { projectId: 'p1', name: 'Kiln trial' });
  s.dispatch('addStep', { projectId: 'p1', stepId: 's1', text: 'Order clay' });
  s.dispatch('addStep', { projectId: 'p1', stepId: 's2', text: 'Call supplier' });
  await s.flush();
  stop(s);
  return repo;
}

test('a save writes data.json and the month history in one commit', async () => {
  const repo = await freshRepoWithProject();
  const data = JSON.parse(repo.read('data.json'));
  assert.equal(data.projects[0].name, 'Kiln trial');
  assert.equal(data.projects[0].steps.length, 2);
  const months = Object.keys(repo.s.trees[repo.s.commits[repo.s.head].tree]).filter((p) => p.startsWith('history/'));
  assert.equal(months.length, 1);
});

test('two devices saving at the same time: both changes kept', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const mac = await device(repo.s);
  const phone = await device(repo.s);
  mac.pending = []; phone.pending = []; // separate devices = separate queues
  mac.dispatch('tickStep', { projectId: 'p1', stepId: 's1' });
  phone.dispatch('addStep', { projectId: 'p1', stepId: 's3', text: 'Fire samples' });
  await mac.flush();
  await phone.flush(); // clashes, reloads, replays
  stop(mac); stop(phone);
  const p = JSON.parse(repo.read('data.json')).projects[0];
  assert.ok(p.steps.find((s) => s.id === 's1').done, "mac's tick kept");
  assert.ok(p.steps.find((s) => s.id === 's3'), "phone's new step kept");
  assert.equal(phone.status, 'saved');
});

test('a step deleted on one device does not come back from the other', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const a = await device(repo.s);
  const b = await device(repo.s);
  a.pending = []; b.pending = [];
  a.dispatch('deleteStep', { projectId: 'p1', stepId: 's2' });
  b.dispatch('setStepField', { projectId: 'p1', stepId: 's2', field: 'text', value: 'Call supplier today' });
  await a.flush();
  await b.flush();
  stop(a); stop(b);
  const p = JSON.parse(repo.read('data.json')).projects[0];
  assert.ok(!p.steps.some((s) => s.id === 's2'));
});

test('no connection: the change waits on the device and is sent later', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const s = await device(repo.s);
  s.dispatch('addWorkNote', { projectId: 'p1', noteId: 'n1', text: 'Spoke to Ravi' });
  s.repo.fail = 'net';
  await s.save();
  stop(s);
  assert.equal(s.status, 'offline');
  assert.equal(JSON.parse(localStorage.getItem('dp.pending')).length, 1, 'kept on the device');
  // while offline, new edits are still accepted and wait on the device too
  assert.ok(s.dispatch('addWorkNote', { projectId: 'p1', noteId: 'n2', text: 'Second note' }));
  stop(s);
  assert.equal(JSON.parse(localStorage.getItem('dp.pending')).length, 2, 'both kept on the device');
  // the app is opened again later, online: the waiting change is sent
  const again = new Store(new MemRepo(repo.s));
  await again.init();
  await again.flush();
  stop(again);
  const p = JSON.parse(repo.read('data.json')).projects[0];
  assert.deepEqual(p.workNotes.map((n) => n.text).sort(), ['Second note', 'Spoke to Ravi']);
  assert.equal(JSON.parse(localStorage.getItem('dp.pending')).length, 0);
});

test('expired GitHub key: status "auth" and the change is kept', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const s = await device(repo.s);
  s.dispatch('tickStep', { projectId: 'p1', stepId: 's1' });
  s.repo.fail = 'auth';
  await s.save();
  stop(s);
  assert.equal(s.status, 'auth');
  assert.equal(s.pending.length, 1);
});

test('a change dated last month is saved into last month\'s history without losing it', async () => {
  localStorage.clear();
  const repo = new MemRepo();
  const data = emptyData();
  data.projects.push({
    id: 'p1', name: 'Old', priority: 'medium', deadline: null, notes: '', links: [], state: 'active',
    lastTickDate: null, activeSince: '2026-09-01', stateChangedAt: '2026-09-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z', steps: [{ id: 's1', text: 'A', done: false, doneAt: null, note: '', waiting: false, waitingOn: '' }], workNotes: [], files: [],
  });
  const oldEvent = { id: 'old1', projectId: 'p1', projectName: 'Old', kind: 'created', detail: 'Old', at: '2026-09-01T05:00:00Z' };
  repo.seed({ 'data.json': JSON.stringify(data), 'history/2026-09.json': JSON.stringify([oldEvent]) });
  const s = new Store(repo);
  s.pending = [makeOp('tickStep', { projectId: 'p1', stepId: 's1' }, '2026-09-30T12:00:00Z')];
  await s.init();
  await s.flush();
  stop(s);
  const sept = JSON.parse(repo.read('history/2026-09.json'));
  assert.equal(sept.length, 2, 'old event kept, new one added');
});

test('unticking a step ticked in a month not loaded takes its tick line out of that month', async () => {
  localStorage.clear();
  const repo = new MemRepo();
  const data = emptyData();
  data.projects.push({
    id: 'p1', name: 'Quote', priority: 'medium', deadline: null, notes: '', links: [], state: 'active',
    lastTickDate: '2025-09-28', activeSince: '2025-09-01', stateChangedAt: '2025-09-01T00:00:00Z', createdAt: '2025-09-01T00:00:00Z',
    updatedAt: '2025-09-28T06:00:00Z', steps: [{ id: 's1', text: 'Send quotation', done: true, doneAt: '2025-09-28T06:00:00Z', updatedAt: '2025-09-28T06:00:00Z', note: '', waiting: false, waitingOn: '' }], workNotes: [], files: [],
  });
  const tick = { id: 't1', projectId: 'p1', projectName: 'Quote', kind: 'step_ticked', detail: 'Send quotation', stepId: 's1', at: '2025-09-28T06:00:00Z' };
  repo.seed({ 'data.json': JSON.stringify(data), 'history/2025-09.json': JSON.stringify([tick]) });
  const s = new Store(repo);
  await s.init();
  assert.ok(!s.base.history['2025-09'], 'only this month is loaded');
  s.dispatch('untickStep', { projectId: 'p1', stepId: 's1' });
  await s.flush();
  stop(s);
  const sept = JSON.parse(repo.read('history/2025-09.json'));
  assert.ok(!sept.some((e) => e.kind === 'step_ticked'), 'the old tick line is gone');
  assert.ok(!JSON.parse(repo.read('data.json')).projects[0].steps[0].done);
});

test('a change the firewall refuses is set aside, and later changes still save', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const s = await device(repo.s);
  const commit = s.repo.commit.bind(s.repo);
  s.repo.commit = async (...args) => { // like the host's firewall: refuses any save holding '<script'
    if (JSON.stringify(args).includes('<script')) { const e = new GitHubError('The server refused this save (403).', 403); e.refused = true; throw e; }
    return commit(...args);
  };
  const refused = [];
  s.addEventListener('refused', (e) => refused.push(e.detail.op.type));
  s.dispatch('addWorkNote', { projectId: 'p1', noteId: 'n1', text: 'see <script src=x>' });
  s.dispatch('deleteWorkNote', { projectId: 'p1', noteId: 'n1' });
  s.dispatch('addStep', { projectId: 'p1', stepId: 's9', text: 'Fire samples' });
  for (let i = 0; i < 6 && s.pending.length; i++) { stop(s); await s.save(); }
  stop(s);
  assert.deepEqual(refused, ['addWorkNote']);
  assert.equal(s.pending.length, 0);
  assert.equal(s.status, 'saved');
  const p = JSON.parse(repo.read('data.json')).projects[0];
  assert.ok(p.steps.some((x) => x.id === 's9'), 'the harmless change is saved');
  assert.ok(!repo.read('data.json').includes('<script'));
  assert.ok(JSON.parse(localStorage.getItem('dp.refused')).some((o) => o.type === 'addWorkNote'), 'a copy is kept on the device');
  s.dispatch('addStep', { projectId: 'p1', stepId: 's10', text: 'Glaze' });
  await s.flush();
  stop(s);
  assert.ok(JSON.parse(repo.read('data.json')).projects[0].steps.some((x) => x.id === 's10'), 'saves go on as normal afterwards');
});

test('text already in the saved data that the firewall blocks (an email the server put in): changes are kept, not set aside', async () => {
  const repo = await freshRepoWithProject();
  const data = JSON.parse(repo.read('data.json'));
  data.projects[0].about = 'pasted <script src=x>'; // written on the server (Outlook job), never through the firewall
  repo.seed({ 'data.json': JSON.stringify(data) + '\n' });
  localStorage.clear();
  const s = await device(repo.s);
  const commit = s.repo.commit.bind(s.repo);
  s.repo.commit = async (...args) => { // the host's firewall: refuses any save holding '<script'
    if (JSON.stringify(args).includes('<script')) { const e = new GitHubError('The server refused this save (403).', 403); e.refused = true; throw e; }
    return commit(...args);
  };
  const refused = [];
  s.addEventListener('refused', (e) => refused.push(e.detail.op.type));
  const head = repo.s.head;
  s.dispatch('tickStep', { projectId: 'p1', stepId: 's1' });
  s.dispatch('addStep', { projectId: 'p1', stepId: 's9', text: 'Fire samples' });
  for (let i = 0; i < 6 && s.status !== 'error'; i++) { stop(s); await s.save(); }
  stop(s);
  assert.deepEqual(refused, [], 'nothing is set aside');
  assert.equal(s.pending.length, 2, 'both changes still wait to be saved');
  assert.equal(s.status, 'error');
  assert.match(s.message, /email/);
  assert.ok(s.view.data.projects[0].steps.find((x) => x.id === 's1').done, 'the tick is still shown');
  assert.equal(localStorage.getItem('dp.refused'), null);
  assert.equal(repo.s.head, head, 'the check saved nothing');
});

test('a refresh load that ends after a save it raced with does not put back the older data', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const s = await device(repo.s);
  const other = await device(repo.s);
  other.dispatch('addStep', { projectId: 'p1', stepId: 'o1', text: 'From the other phone' });
  await other.flush();
  stop(other);
  // the refresh's download of data.json hangs (slow link) until we let it go
  let release;
  const gate = new Promise((r) => { release = r; });
  const blobText = s.repo.blobText.bind(s.repo);
  let first = true;
  s.repo.blobText = async (sha) => { const text = await blobText(sha); if (first && text.includes('"projects"')) { first = false; await gate; } return text; };
  const refreshing = s.refresh();
  await new Promise((r) => setTimeout(r, 0));
  s.dispatch('addStep', { projectId: 'p1', stepId: 's9', text: 'Call vendor' });
  stop(s);
  await s.save(); // 409, loads again, saves
  assert.equal(s.pending.length, 0);
  release();
  await refreshing;
  stop(s);
  const steps = s.view.data.projects[0].steps.map((x) => x.id);
  assert.ok(steps.includes('s9'), 'the saved step is still shown');
  assert.ok(steps.includes('o1'), 'and the other phone\'s step');
  assert.equal(s.base.commit, repo.s.head);
  const snap = JSON.parse(localStorage.getItem('dp.snapshot'));
  assert.ok(snap.data.projects[0].steps.some((x) => x.id === 's9'), 'the device copy has it too');
});

test('a 403 from our own server (not allowed) does not set changes aside', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const s = await device(repo.s);
  s.repo.commit = async () => { throw new GitHubError('These projects belong to someone else.', 403); };
  s.dispatch('addStep', { projectId: 'p1', stepId: 's9', text: 'Fire samples' });
  await s.save();
  stop(s);
  assert.equal(s.status, 'error');
  assert.equal(s.pending.length, 1, 'the change is kept');
});

test('undo (restoreProject) after another device changed something', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const s = await device(repo.s);
  s.pending = [];
  const before = JSON.parse(JSON.stringify(s.view.data.projects[0]));
  const op = s.dispatch('tickStep', { projectId: 'p1', stepId: 's1' });
  await s.flush();
  s.dispatch('restoreProject', { project: before, index: 0, undoOpId: op.id });
  await s.flush();
  stop(s);
  const p = JSON.parse(repo.read('data.json')).projects[0];
  assert.equal(p.steps.find((x) => x.id === 's1').done, false);
});

test('a history month that did not change is not downloaded again', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const s = await device(repo.s);
  let reads = 0;
  const real = s.repo.blobText.bind(s.repo);
  s.repo.blobText = async (sha) => { reads++; return real(sha); };
  await s.load();
  const first = reads;
  await s.load();
  stop(s);
  assert.equal(reads - first, 1, 'second load fetched only data.json, history came from the cache');
});

test('opens without internet from the copy on the device, then syncs when back online', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const first = await device(repo.s); // online once: copy kept on the device
  stop(first);
  assert.ok(localStorage.getItem('dp.snapshot'));
  // next day, no internet
  const offlineRepo = new MemRepo(repo.s);
  offlineRepo.fail = 'net';
  const s = new Store(offlineRepo);
  await s.init();
  assert.equal(s.status, 'offline');
  assert.equal(s.view.data.projects[0].name, 'Kiln trial', 'projects shown from the copy');
  assert.ok(s.dispatch('tickStep', { projectId: 'p1', stepId: 's1' }), 'changes accepted offline');
  // meanwhile the phone (online) added a step
  localStorage.setItem('dp.pending.phone', '');
  const phone = new Store(new MemRepo(repo.s));
  const savedPending = localStorage.getItem('dp.pending');
  await phone.init();
  phone.pending = [];
  phone.dispatch('addStep', { projectId: 'p1', stepId: 's9', text: 'From phone' });
  await phone.flush();
  stop(phone);
  localStorage.setItem('dp.pending', savedPending);
  // internet back on the Mac: the waiting change is sent and merged with the phone's
  offlineRepo.fail = null;
  await s.refresh();
  await s.flush();
  stop(s);
  const p = JSON.parse(repo.read('data.json')).projects[0];
  assert.ok(p.steps.find((x) => x.id === 's1').done, "Mac's offline tick kept");
  assert.ok(p.steps.find((x) => x.id === 's9'), "phone's step kept");
  assert.equal(s.status, 'saved');
});

test('two tabs on one device: neither wipes the other\'s waiting changes', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const tabA = await device(repo.s);
  const tabB = await device(repo.s);
  stop(tabA); stop(tabB);
  tabA.dispatch('addStep', { projectId: 'p1', stepId: 'a1', text: 'From tab A' });
  tabB.dispatch('addStep', { projectId: 'p1', stepId: 'b1', text: 'From tab B' });
  stop(tabA); stop(tabB);
  const stored = JSON.parse(localStorage.getItem('dp.pending')).map((o) => o.args.stepId);
  assert.ok(stored.includes('a1') && stored.includes('b1'), stored.join());
});

test('the offline copy keeps a history month that was only saved from this device', async () => {
  localStorage.clear();
  const s = new Store(new MemRepo());
  await s.init();
  s.base.history['2020-01'] = [{ id: 'x', kind: 'note_added', at: '2020-01-05T00:00:00Z' }];
  s.base.entries.set('history/2020-01.json', 'local');
  s.saveSnapshot();
  const snap = JSON.parse(localStorage.getItem('dp.snapshot'));
  assert.equal(snap.history['2020-01'].length, 1);
  stop(s);
});

test('two tabs: when the other tab already sent my change, my screen keeps showing it', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const tabA = await device(repo.s);
  stop(tabA);
  tabA.dispatch('createProject', { projectId: 'p9', name: 'New one' });
  stop(tabA);
  // the other tab sent it and emptied the shared list; this tab hears about it
  localStorage.setItem('dp.pending', '[]');
  // simulate the 'storage' signal by calling the same merge the listener does
  const stored = JSON.parse(localStorage.getItem('dp.pending')).filter((o) => !tabA.sentIds.has(o.id));
  const ids = new Set(stored.map((o) => o.id));
  tabA.pending = [...stored, ...tabA.pending.filter((o) => !ids.has(o.id))];
  tabA.recompute();
  assert.ok(tabA.view.data.projects.some((p) => p.id === 'p9'), 'the new project does not vanish');
});

test('other computer: a refresh shows its change and says so; a stalled waiting change is sent by the next refresh', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const office = await device(repo.s);
  const home = await device(repo.s);
  office.pending = []; home.pending = [];
  let told = 0;
  home.addEventListener('remote', () => { told++; });
  office.dispatch('addStep', { projectId: 'p1', stepId: 's9', text: 'Glaze test' });
  stop(office); // the save timer never ran (laptop closed straight away)
  assert.equal(JSON.parse(repo.read('data.json')).projects[0].steps.length, 2, 'not sent yet');
  await office.refresh(); // next check sends it, even though no save had failed
  stop(office);
  assert.equal(office.pending.length, 0);
  await home.refresh();
  assert.ok(home.view.data.projects[0].steps.find((s) => s.id === 's9'), 'home computer shows it');
  assert.equal(told, 1);
  await home.refresh(); // nothing new: no message
  assert.equal(told, 1);
});

test('Finish / Delete on an email task works right after an email came in, even with the device clock behind the server', async () => {
  for (const kind of ['finish', 'deleteProject']) {
    localStorage.clear();
    const s = new Store(new MemRepo());
    await s.init();
    s.dispatch('createProject', { projectId: 'mt', name: '📧 Invoice' });
    stop(s);
    // the server brought the email in at its time, 3 minutes later than this device's clock says now
    const addedAt = new Date(Date.now() + 3 * 60000).toISOString();
    const p = s.view.data.projects.find((x) => x.id === 'mt');
    p.mail = { conversationId: 'c1', messageId: 'e1', fromName: 'Ravi', subject: 'Invoice', at: addedAt, addedAt };
    p.thread = [{ at: addedAt, addedAt, fromName: 'Ravi', fromMe: false, preview: 'Invoice', messageId: 'e1' }];
    const op = s.dispatch(kind, { projectId: 'mt' });
    stop(s);
    assert.ok(op, `${kind}: the button works`);
    assert.equal(op.args.seenMailAt, addedAt, `${kind}: keeps the newest email seen`);
  }
});

test('review r4-1 (whole code): two tabs — a change the other tab already saved is never sent again from here (it would put back an old value over a newer edit from another device); it stays on screen until the newest data comes', async () => {
  const repo = await freshRepoWithProject();
  localStorage.clear();
  const tabA = await device(repo.s);
  const tabB = await device(repo.s); // the same device: one shared queue
  tabA.dispatch('setProjectField', { projectId: 'p1', field: 'status', value: 'Waiting for clay' });
  stop(tabA);
  tabB.takeOtherTab(); // tab B hears about it
  assert.equal(tabB.view.data.projects[0].status, 'Waiting for clay');
  await tabA.flush(); stop(tabA); // tab A saves it
  // another device then changes the same field
  const other = await device(repo.s);
  other.pending = [];
  other.dispatch('setProjectField', { projectId: 'p1', field: 'status', value: 'Drawings came' });
  await other.flush(); stop(other);
  const before = repo.s.head;
  tabB.load = async () => {}; // (the newest data has not arrived in tab B yet)
  tabB.takeOtherTab();
  assert.equal(tabB.view.data.projects[0].status, 'Waiting for clay', 'still shown here meanwhile (never vanishes)');
  assert.equal(tabB.toSend().length, 0, 'nothing of it to send');
  await tabB.save(); stop(tabB);
  assert.equal(repo.s.head, before, 'not sent again');
  assert.equal(JSON.parse(repo.read('data.json')).projects[0].status, 'Drawings came', 'the newer edit stays');
  // tab B's own change afterwards: saved on the newest data, the old one not replayed with it
  delete tabB.load;
  tabB.dispatch('addStep', { projectId: 'p1', stepId: 's7', text: 'Glaze test' });
  await tabB.flush(); stop(tabB);
  const p = JSON.parse(repo.read('data.json')).projects[0];
  assert.equal(p.status, 'Drawings came', 'still the newer edit');
  assert.ok(p.steps.some((s) => s.id === 's7'), 'tab B\'s own change saved');
  assert.equal(tabB.pending.length, 0, 'and the other tab\'s copy is gone once the newest data came');
});
