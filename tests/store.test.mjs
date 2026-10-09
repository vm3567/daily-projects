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
