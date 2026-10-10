// Saving and syncing: one commit per save, two devices at once, offline, expired key, queue kept on the device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, MemRepo } from './helpers.mjs';
import { Store } from '../docs/store.js';
import { emptyData, makeOp } from '../docs/ops.js';

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
  s.dispatch('createProject', { projectId: 'p1', name: 'Kiln trial', groupId: 'g1' });
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
    id: 'p1', groupId: 'g1', name: 'Old', priority: 'medium', deadline: null, notes: '', links: [], state: 'active',
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
  tabA.dispatch('createProject', { projectId: 'p9', name: 'New one', groupId: 'g1' });
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
