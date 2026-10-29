// Draws every screen once with sample data (using a tiny pretend browser page), so mistakes that only
// show up while drawing — like a name used before it exists — are caught before they go live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installStorage } from './helpers.mjs';
import { applyOps, emptyData, makeOp, newId } from '../docs/ops.js';

// ---- a very small pretend DOM: enough for h() to build elements ----
class Node {
  constructor(tag) {
    this.nodeName = tag.toUpperCase(); this.nodeType = 1; this.childNodes = []; this.attributes = [];
    this.dataset = {}; this.style = { cssText: '' }; this.className = ''; this.value = ''; this.checked = false;
  }
  appendChild(c) { this.childNodes.push(c); c.parentNode = this; return c; }
  replaceChildren(...cs) { this.childNodes = []; cs.forEach((c) => this.appendChild(typeof c === 'string' ? { nodeType: 3, nodeValue: c } : c)); }
  setAttribute(n, v) { this.attributes.push({ name: n, value: v }); }
  getAttribute(n) { const a = this.attributes.find((x) => x.name === n); return a ? a.value : null; }
  hasAttribute(n) { return !!this.attributes.find((x) => x.name === n); }
  set textContent(t) { this.childNodes = [{ nodeType: 3, nodeValue: String(t) }]; }
  get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(''); }
}
globalThis.document = {
  createElement: (t) => new Node(t),
  createTextNode: (t) => ({ nodeType: 3, nodeValue: t }),
  createElementNS: (ns, t) => new Node(t),
  querySelector: () => null,
  getElementById: () => null,
};
globalThis.Node = Node;
installStorage();

const { renderDetail } = await import('../docs/ui/detail.js');
const { renderDashboard } = await import('../docs/ui/dashboard.js');
const { renderPeopleList, renderPerson } = await import('../docs/ui/people.js');
const { renderTimeReport, rangeFor, startPreset } = await import('../docs/ui/timereport.js');

function sampleState() {
  const now = new Date();
  const at = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const s = { data: emptyData(), history: {} };
  applyOps(s, [
    makeOp('createProject', { projectId: 'p1', name: 'Kiln' }, at(300)),
    makeOp('addStep', { projectId: 'p1', stepId: 's1', text: 'Call @Ravi' }, at(299)),
    makeOp('addStep', { projectId: 'p1', stepId: 's2', text: 'Fire samples' }, at(298)),
    makeOp('addPerson', { personId: 'r', name: 'Ravi' }, at(297)),
    makeOp('setStepField', { projectId: 'p1', stepId: 's2', field: 'waiting', value: true }, at(296)),
    makeOp('setStepField', { projectId: 'p1', stepId: 's2', field: 'waitingOn', value: 'Ravi' }, at(295)),
    makeOp('addWorkNote', { projectId: 'p1', noteId: 'n1', text: 'Kiln at 1150', stepId: 's1' }, at(200)),
    makeOp('tickStep', { projectId: 'p1', stepId: 's1' }, at(199)),
    makeOp('addTime', { projectId: 'p1', minutes: 45 }, at(100)),
    makeOp('startTimer', { projectId: 'p1' }, at(20)),
    makeOp('addLink', { projectId: 'p1', linkId: newId(), title: 'Spec', url: 'https://example.com' }, at(10)),
    makeOp('addTag', { tagId: 'kiln', name: 'Kiln' }, at(9)),
    makeOp('setProjectField', { projectId: 'p1', field: 'tagId', value: 'kiln' }, at(8)),
  ]);
  return s;
}

function fakeCtx(state, ui = {}) {
  const store = {
    view: state, status: 'saved', pending: [], canEdit: () => true, isOffline: () => false,
    availableMonths: () => Object.keys(state.history), loadMonth: async () => {}, loadAllHistory: async () => {},
    dispatch: () => null,
  };
  const noop = () => {};
  return {
    store, ui, toast: noop, render: noop, act: noop, actMany: noop, hasAiKey: () => true, aiSteps: noop, goSettings: noop,
    draftFollowUp: noop, openSummary: noop, openProject: noop, openPerson: noop, selectPerson: noop, goBack: noop,
    canGoBack: () => true, neighbourProject: () => null, neighbourPerson: () => null, openInList: noop,
    toggleOk: noop, chase: noop, afterTick: noop, startTimer: noop, stopTimer: noop, clockText: () => '0:20',
  };
}

test('project page draws (steps, update box, people, time, links)', () => {
  const s = sampleState();
  const el = renderDetail(fakeCtx(s, { selected: 'p1', openParts: { history: true }, update: {}, showMore: true }));
  const text = el.textContent;
  for (const bit of ['Kiln', 'Fire samples', 'Save + tick “Fire samples”', 'Work notes', 'Status', 'Finish', 'Ravi', 'Today', 'Spec']) assert.ok(text.includes(bit), bit);
  assert.ok(text.includes('💤 Snooze'), 'Snooze is on the page next to Finish (the owner asked for it back, 22 Oct)');
  const menu = renderDetail(fakeCtx(s, { selected: 'p1', update: {}, projMenu: 'p1' })).textContent;
  for (const bit of ['Snooze', 'Pause', 'Delete task']) assert.ok(menu.includes(bit), 'menu: ' + bit);
});

test('empty project page draws', () => {
  assert.ok(renderDetail(fakeCtx(sampleState(), { selected: 'nope' })).textContent.includes('Pick a task'));
});

test('dashboard draws (tiles, calendar, time, people) on one screen', () => {
  const text = renderDashboard(fakeCtx(sampleState(), {})).textContent;
  for (const bit of ['Streak', 'Days on track', 'Time this week', 'People to contact', 'Needs attention']) assert.ok(text.includes(bit), bit); // (owner asked 24 Oct: "on track", was "Green days")
  for (const gone of ['Wins this week', 'This week vs last week']) assert.ok(!text.includes(gone), gone + ' removed');
});

test('people list and person page draw', () => {
  const s = sampleState();
  assert.ok(renderPeopleList(fakeCtx(s, {})).textContent.includes('Ravi'));
  const person = renderPerson(fakeCtx(s, { person: 'r' })).textContent;
  assert.ok(person.includes('Waiting on Ravi'));
  assert.ok(person.includes('Fire samples'));
});

test('time report draws (pie, legend in % and hours) and date ranges are right', () => {
  const s = sampleState();
  const ui = { timeReport: { preset: 'thisWeek', by: 'tag', mode: 'pct', custom: {} } };
  const text = renderTimeReport(fakeCtx(s, ui)).textContent;
  assert.ok(text.includes('Time by tag'), 'no group name in the title (groups are gone, owner 23 Oct)');
  assert.ok(!text.includes('Group '), 'no group picker');
  const empty = renderTimeReport(fakeCtx(s, { timeReport: { ...ui.timeReport, preset: 'custom', custom: { from: '2020-01-01', to: '2020-01-02' } } })).textContent;
  assert.ok(empty.includes('No time logged for this period.') && !empty.includes('Acton'), 'no group name when empty either');
  assert.ok(text.includes('Kiln'));
  assert.ok(text.includes('100%'));
  ui.timeReport.mode = 'hours';
  assert.ok(renderTimeReport(fakeCtx(s, ui)).textContent.includes('Download image'));
  const full = renderTimeReport(fakeCtx(s, ui)).textContent;
  assert.ok(full.includes('Work done (1 step)'), 'work done section');
  assert.ok(full.includes('✓ Call Ravi'), 'finished step listed');
  assert.ok(full.includes('Full report image'));
  assert.deepEqual(rangeFor('thisWeek', '2026-10-09'), ['2026-10-05', '2026-10-09']);
  assert.deepEqual(rangeFor('lastWeek', '2026-10-09'), ['2026-09-28', '2026-10-04']);
  assert.deepEqual(rangeFor('thisMonth', '2026-10-09'), ['2026-10-01', '2026-10-09']);
  assert.deepEqual(rangeFor('lastMonth', '2026-01-15'), ['2025-12-01', '2025-12-31']);
  assert.deepEqual(rangeFor('custom', '2026-10-09', { from: '2026-10-08', to: '2026-10-01' }), ['2026-10-01', '2026-10-08']);
});

test('time report opens on "Last month" in the first week of a month, else on what was used last', () => {
  assert.equal(startPreset('2026-11-03', 'thisWeek'), 'lastMonth');
  assert.equal(startPreset('2026-11-12', 'lastWeek'), 'lastWeek');
  assert.equal(startPreset('2026-11-12', 'custom'), 'thisWeek');
  assert.equal(startPreset('2026-11-12', undefined), 'thisWeek');
  const ui = {};
  renderTimeReport(fakeCtx(sampleState(), ui));
  assert.ok(['thisWeek', 'lastMonth'].includes(ui.timeReport.preset));
});

test('project page: "Save + done" button, and the next project offer when green', () => {
  const s = sampleState();
  applyOps(s, [
    makeOp('createProject', { projectId: 'p2', name: 'Glaze trial' }),
    makeOp('okForToday', { projectId: 'p1' }),
  ]);
  const ctx = fakeCtx(s, { selected: 'p1', update: {} });
  ctx.nextOpenProject = () => s.data.projects.find((p) => p.id === 'p2');
  ctx.openNextOpen = () => {};
  const text = renderDetail(ctx).textContent;
  assert.ok(text.includes('✓ Save + tick “Fire samples”'), 'save + done button, naming the step it ticks (owner asked 24 Oct)');
  assert.ok(text.includes('Next task: Glaze trial'), 'next task offered (at the bottom)');
  assert.ok(!text.includes('This step is done'), 'old tick box gone');
});

test('project page: one update box in the diary (about the next task), week strip, days; snoozed project shows when it comes back', () => {
  const s = sampleState();
  const el = renderDetail(fakeCtx(s, { selected: 'p1', update: {} }));
  const find = (node, f) => (f(node) ? node : (node.childNodes || []).map((c) => find(c, f)).find(Boolean));
  const diary = find(el, (n) => (n.className || '').includes('diary'));
  assert.ok(diary, 'the diary is on the page');
  const box = find(diary, (n) => (n.className || '').includes('update-form'));
  assert.ok(box, 'the one update box sits at the top of the diary');
  assert.ok(box.textContent.includes('📝 Writing about:') && box.textContent.includes('Save + tick “Fire samples”'), 'owner asked 24 Oct: "Writing about:" and the step on the button');
  assert.ok(find(box, (n) => (n.className || '').includes('chip on') && n.textContent === 'Fire samples'), 'about the next task');
  assert.ok(find(diary, (n) => (n.className || '').includes('week')), 'week strip');
  assert.ok(diary.textContent.includes('Today'), 'days listed');
  assert.ok(!find(el, (n) => (n.className || '').includes('has-update')), 'no box inside the steps any more');
  applyOps(s, [makeOp('snooze', { projectId: 'p1', days: 4 })]);
  const text = renderDetail(fakeCtx(s, { selected: 'p1', update: {} })).textContent;
  assert.ok(text.includes('Snoozed — comes back to Today'));
  assert.ok(text.includes('Wake up now'));
});

test('project page: notes, links, files and history wait under "More" until opened', () => {
  const s = sampleState();
  const text = renderDetail(fakeCtx(s, { selected: 'p1', update: {} })).textContent;
  assert.ok(text.includes('More'));
  assert.ok(text.includes('1 work note') && text.includes('1 link'), 'the fold says what is inside');
  assert.ok(text.includes('🔗 Spec'), 'the link shows as a chip near the top (owner asked, 22 Oct); adding and editing links waits under More');
});

test('project page: ⏰ remind me options, and the step shows its return day', () => {
  const s = sampleState();
  const ui = { selected: 'p1', update: {}, openStep: 's2' };
  let text = renderDetail(fakeCtx(s, ui)).textContent;
  assert.ok(text.includes('Remind me in') && text.includes('1 week'));
  const day = new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  applyOps(s, [makeOp('remindStep', { projectId: 'p1', stepId: 's2', date: day })]);
  text = renderDetail(fakeCtx(s, { selected: 'p1', update: {} })).textContent;
  assert.ok(text.includes('⏰'), 'reminder tag shown');
});

test('worktask.in: a step whose team task was cancelled or finished can be given again', () => {
  const s = sampleState();
  const ctx = fakeCtx(s, { selected: 'p1', update: {}, openStep: 's2' });
  ctx.onServer = true;
  ctx.teamInfo = () => ({ byStep: new Map(), fillBy: '18:00' });
  ctx.teamPeople = () => [];
  ctx.teamTask = (id) => (id === 's2' ? { id: 7, status: 'cancelled', assignee: { id: 2, name: 'Valar' }, stepRef: 's2' } : null);
  const el = renderDetail(ctx);
  const find = (node, f) => (f(node) ? node : (node.childNodes || []).map((c) => find(c, f)).find(Boolean));
  const btn = find(el, (n) => n.nodeName === 'A' && /Give to team|Team task/.test(n.textContent));
  assert.ok(btn, 'step team button shown');
  assert.equal(btn.textContent, '👥 Give to team');
  assert.ok(!el.textContent.includes('cancelled'), 'no old cancelled chip on an open step');
});

test('worktask.in: "Seen" and "Send" mark team messages read only up to the newest one shown', async () => {
  const s = sampleState();
  const ctx = fakeCtx(s, { selected: 'p1', update: {} });
  ctx.onServer = true;
  ctx.teamInfo = () => ({ byStep: new Map(), fillBy: '18:00' });
  ctx.teamPeople = () => [];
  ctx.teamTask = () => null;
  ctx.teamDaily = () => ({ data: { tasks: [], updates: [], comments: [
    { id: 41, taskId: 7, by: 'Valar', at: '2026-10-21 10:00:00', text: 'Done the firing', unread: true },
    { id: 39, taskId: 8, by: 'Valar', at: '2026-10-21 09:00:00', text: 'Started', unread: true },
    { id: 12, taskId: 7, by: 'Valar', at: '2026-10-20 09:00:00', text: 'old', unread: false },
  ] } });
  const calls = [];
  ctx.teamSeen = (p, ids, upTo) => { calls.push(['seen', ids, upTo]); return Promise.resolve(); };
  ctx.teamReply = (p, taskId, text, ids, cid, upTo) => { calls.push(['reply', ids, upTo]); return Promise.resolve(); };
  const el = renderDetail(ctx);
  const find = (node, f) => (f(node) ? node : (node.childNodes || []).map((c) => find(c, f)).find(Boolean));
  const seen = find(el, (n) => n.nodeName === 'BUTTON' && n.textContent === '✓ Seen');
  assert.ok(seen, 'Seen button shown');
  await seen.__on.click();
  const form = find(el, (n) => n.nodeName === 'FORM' && find(n, (x) => x.textContent === 'Send'));
  form.elements = { reply: { value: 'Thanks', disabled: false } };
  form.__on.submit({ preventDefault() {}, target: form });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls[0], ['seen', [8, 7], 41], 'Seen: up to the newest shown (41), not whatever came later');
  assert.deepEqual(calls[1], ['reply', [8, 7], 41], 'Send: the same');
});

test('project page: the short description shows in grey under the name, or a faint "+ Add a short description"', () => {
  const s = sampleState();
  const find = (node, f) => (f(node) ? node : (node.childNodes || []).map((c) => find(c, f)).find(Boolean));
  const box = (el) => find(el, (n) => (n.className || '').split(' ').includes('about-input'));
  const empty = box(renderDetail(fakeCtx(s, { selected: 'p1', update: {} })));
  assert.ok(empty, 'the description box is there');
  assert.equal(empty.getAttribute('placeholder'), '+ Add a short description');
  assert.ok(empty.className.includes('empty'));
  assert.equal(empty.value, '');
  applyOps(s, [makeOp('setProjectField', { projectId: 'p1', field: 'about', value: 'Glaze for the new basin line' })]);
  const el = renderDetail(fakeCtx(s, { selected: 'p1', update: {} }));
  const full = box(el);
  assert.equal(full.value, 'Glaze for the new basin line');
  assert.ok(!full.className.includes('empty'));
  assert.equal(full.getAttribute('maxlength'), '1000', 'owner asked for 1000 letters, 22 Oct');
  assert.equal(full.getAttribute('oneLine'), null, 'oneLine is not put on the page');
  // right under the title row
  const kids = el.childNodes.filter((c) => c.nodeType === 1);
  const top = kids.findIndex((c) => c.className === 'detail-top');
  assert.ok(top >= 0 && kids[top + 1] === full, 'just under the title row');
  // it saves by itself, like the name
  const sent = [];
  const ctx = fakeCtx(s, { selected: 'p1', update: {} });
  ctx.store.dispatch = (type, a) => { sent.push([type, a]); return true; };
  box(renderDetail(ctx)).__on.focusout(null, { value: 'Changed' });
  assert.deepEqual(sent, [['setProjectField', { projectId: 'p1', field: 'about', value: 'Changed' }]]);
});

test('project description goes to the team: both project.sync calls send about, and a change of it sends the project again', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const sends = APP.match(/teamApi\('project\.sync', \{ projectRef: p\.id, [^}]*\}/g) || [];
  assert.equal(sends.length, 2, 'giveProject and syncGivenNow');
  for (const s of sends) assert.match(s, /\babout\b/, s);
  assert.match(APP, /function syncSig\(userId, p, steps, needsPhoto\) \{\n\s*return JSON\.stringify\(\[[^\]]*p\.about \|\| '', !!\(p\.team && p\.team\.record\)\]\);/, 'the description is in the change signature (and 📒 record, owner asked 24 Oct)');
  assert.ok(!/JSON\.stringify\(\[(p\.team\.userId|person\.id), p\.name/.test(APP), 'no signature made without it');
});

test('a reply from an email thread shows on the project page with its "Open mail" link', () => {
  const s = sampleState();
  applyOps(s, [makeOp('addMailNote', { projectId: 'p1', noteId: 'ml1', text: '📧 New reply from Anil 22 Oct 14:05: price OK', link: { url: 'https://outlook.office365.com/owa/?ItemID=x', title: 'Kiln quote' } })]);
  const el = renderDetail(fakeCtx(s, { selected: 'p1', update: {}, showMore: true }));
  const links = [];
  const walk = (n) => { if (n.nodeName === 'A') links.push(n); (n.childNodes || []).forEach(walk); };
  walk(el);
  assert.ok(links.some((a) => a.getAttribute('href') === 'https://outlook.office365.com/owa/?ItemID=x' && a.textContent === '✉ Open mail'), 'the email opens from the note');
});

// ---------- One People page: Send pending list, sent mark, Work Task projects and account ----------

const findIn = (node, f) => (f(node) ? node : (node.childNodes || []).map((c) => findIn(c, f)).find(Boolean));
const allIn = (node, f, out = []) => { if (f(node)) out.push(node); (node.childNodes || []).forEach((c) => allIn(c, f, out)); return out; };
const hasClass = (c) => (n) => (n.className || '').split(' ').includes(c);

test('person page: "📋 Send again" and a green "✓ Sent today 9:05" once sent today; nothing before', () => {
  const s = sampleState();
  const before = renderPerson(fakeCtx(s, { person: 'r' })).textContent;
  assert.ok(before.includes('📋 Send pending list') && !before.includes('Sent today'));
  const ctx = fakeCtx(s, { person: 'r' });
  ctx.sentMark = () => ({ source: 'op', time: '9:05' });
  const el = renderPerson(ctx);
  assert.ok(el.textContent.includes('📋 Send again'));
  const tag = findIn(el, hasClass('sent-tag'));
  assert.equal(tag && tag.textContent, '✓ Sent today 9:05');
  // without ctx.sentMark the page reads the person's own mark (only today's)
  applyOps(s, [makeOp('markPersonSent', { personId: 'r', at: new Date().toISOString() })]);
  assert.ok(renderPerson(fakeCtx(s, { person: 'r' })).textContent.includes('📋 Send again'));
  const list = renderPeopleList(fakeCtx(s, {}));
  assert.match(findIn(list, hasClass('sent-mark')).textContent, /^✓ \d{1,2}:\d\d$/, 'the People list row shows ✓ and the time');
});

test('person page: projects given here show as "📁 Projects given to …" with the next step, and the list counts them', () => {
  const s = sampleState();
  applyOps(s, [makeOp('createProject', { projectId: 'p9', name: 'Basin mould' }),
    makeOp('addStep', { projectId: 'p9', stepId: 'g1', text: 'Cast 3 trial moulds' }),
    makeOp('setProjectTeam', { projectId: 'p9', userId: 7, name: 'ravi' })]);
  const ctx = fakeCtx(s, { person: 'r' });
  ctx.teamProgress = () => ({ stuck: true, lastUpdate: null });
  const text = renderPerson(ctx).textContent;
  assert.ok(text.includes('📁 Projects given to Ravi (1)'));
  assert.ok(text.includes('📁 Basin mould') && text.includes('Now: Cast 3 trial moulds') && text.includes('0 of 1 steps done') && text.includes('stuck'));
  assert.ok(text.indexOf('📁 Projects given to') < text.indexOf('To discuss with Ravi'), 'above the To discuss list');
  assert.ok(renderPeopleList(fakeCtx(s, {})).textContent.includes('1 project'), 'counted in the People list row');
});

test('person page for a Work Task person: the server list as a table, the Team account box, one email box, in order', () => {
  const s = sampleState();
  applyOps(s, [makeOp('addWorkNote', { projectId: 'p1', noteId: 'n7', text: 'About @Ravi: call back' })]);
  const user = { id: 7, name: 'Ravi', username: 'ravi', role: 'staff', active: true, email: 'ravi@acton.in', lastLogin: '2026-10-21 09:00:00' };
  const member = { id: 7, name: 'Ravi', sentAt: null, items: [
    { kind: 'task', title: 'Clean dryer', repeat: 'Every day', lastUpdate: null },
    { kind: 'project', title: 'Basin mould', now: 'Cast moulds', lateSince: '2026-10-18', projectRef: 'p1', lastUpdate: { day: '2026-10-21', note: 'Half done' } },
    { kind: 'task', title: 'Fix press', stuck: true, lastUpdate: null },
  ] };
  const opened = [];
  const ctx = fakeCtx(s, { person: 'r' });
  Object.assign(ctx, { onServer: true, teamLink: () => ({ user, member }), teamAccounts: () => [user, { id: 8, name: 'Valar', active: true }],
    openProject: (id) => opened.push(id), newPasswordFor: () => {}, toggleTeamUser: () => {}, setTeamEmail: () => {}, moveAllTasks: () => {} });
  const el = renderPerson(ctx);
  const text = el.textContent;
  assert.ok(text.includes('📁 Projects and tasks from the team (3)'));
  const rows = allIn(findIn(el, hasClass('wt-table')), (n) => n.nodeName === 'TR');
  assert.deepEqual(rows[0].childNodes.map((c) => c.textContent), ['#', 'Work', 'Last update']);
  assert.deepEqual(rows.slice(1).map((r) => r.childNodes[1].childNodes[0].textContent), ['📁 Basin mould', 'Fix press', 'Clean dryer'], 'late, stuck, then the rest');
  assert.ok(rows[1].textContent.includes('Late since 18 Oct') && rows[1].textContent.includes('Now: Cast moulds') && rows[1].textContent.includes('21 Oct: Half done'));
  assert.ok(rows[2].textContent.includes('Stuck') && rows[3].textContent.includes('Every day') && rows[3].textContent.includes('—'));
  rows[1].__on.click();
  assert.deepEqual(opened, ['p1'], 'tap a project row = open it');
  for (const bit of ['Team account', '@ravi', '🔑 New password', 'Switch off', '↔ Move all tasks to…']) assert.ok(text.includes(bit), bit);
  assert.equal(allIn(el, (n) => n.getAttribute && n.getAttribute('aria-label') === 'Email').length, 0, 'no second email box');
  assert.equal(findIn(el, (n) => n.getAttribute && n.getAttribute('aria-label') === 'Task List email').value, 'ravi@acton.in');
  const order = ['📋 Send pending list', 'Team account', '📁 Projects and tasks from the team', 'To discuss with Ravi', 'Notes about Ravi'].map((t) => text.indexOf(t));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), 'sections in order: ' + order);
  assert.ok(renderPeopleList(Object.assign(fakeCtx(s, {}), { teamLink: () => ({ user, member }) })).textContent.includes('1 project · 2 tasks'));
});

test('People: "+ Add a person" can also give a Work Task sign-in (checkbox, only on the server)', () => {
  const s = sampleState();
  assert.ok(!renderPeopleList(fakeCtx(s, {})).textContent.includes('Task List sign-in'), 'not off the server');
  const given = [];
  const ui = { addSignIn: true };
  const ctx = Object.assign(fakeCtx(s, ui), { onServer: true, giveSignIn: (person, email) => given.push([person.name, email]) });
  ctx.store.dispatch = (type, args) => applyOps(s, [makeOp(type, args)]).length > 0;
  const list = renderPeopleList(ctx);
  assert.ok(list.textContent.includes('Also give them a Task List sign-in'));
  const form = findIn(list, hasClass('people-add'));
  form.__on.submit({ preventDefault() {}, target: { elements: { name: { value: 'Mani' }, signin: { checked: true }, email: { value: ' mani@acton.in ' } } } });
  assert.ok(s.data.people.some((p) => p.name === 'Mani'));
  assert.deepEqual(given, [['Mani', 'mani@acton.in']]);
  ui.addSignIn = false;
  form.__on.submit({ preventDefault() {}, target: { elements: { name: { value: 'Kavi' }, signin: { checked: false } } } });
  assert.equal(given.length, 1, 'unticked: only added here');
});

test('send sheet wiring: Outlook/Copy copy the table (html + plain), Outlook opens mailto with the subject only; sent marks; Work Task account calls', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const sheet = APP.slice(APP.indexOf('function openSheet('), APP.indexOf('function closeSheet('));
  assert.match(sheet, /new ClipboardItem\(\{ 'text\/html': new Blob\(\[html\], \{ type: 'text\/html' \}\), 'text\/plain': new Blob\(\[area\.value\], \{ type: 'text\/plain' \}\) \}\)/);
  assert.match(sheet, /const outlook = async \(\) => \{[^]*?\n\s*if \(html\) \{ \/\/ the table cannot go in a link[^]*?const done = copyTable\(\);[^]*?location\.href = `mailto:\$\{[^`]*\}\?subject=\$\{encodeURIComponent\(subject\)\}`;/, 'copy first (inside the click), then mailto with To and Subject');
  assert.ok(!/mailto:[^`]*body=/.test(sheet), 'no body in the mailto');
  assert.match(sheet, /if \(html\) \{ say\(await copyTable\(\)\); return; \}/, 'Copy copies the table too');
  assert.match(sheet, /const say = \(how, why = ''\) => \{ const words = copyNotice\(how\);/, 'the honest notice (with why the paste way, for the no-paste email)');
  assert.match(sheet, /write\.then\(\(\) => 'html', \(\) => copyPlain\(\)\)/, 'only a real table copy says html');
  assert.match(sheet, /Changes in this box only go to WhatsApp/);
  assert.match(sheet, /const wa = \(\) => \{[^\n]*if \(onSent\) onSent\('whatsapp'\)/);
  assert.match(sheet, /if \(onSent\) onSent\('outlook'\);/);
  assert.ok(!/copy = async[^\n]*onSent/.test(sheet), 'Copy alone does not mark it sent');
  const open = APP.slice(APP.indexOf('function openPersonMessage('), APP.indexOf('function teamMorning('));
  assert.match(open, /personMessageHtml\(data, person, today, \{ items, owner \}\)/);
  assert.match(open, /if \(link && link\.member\) \{[^]*teamApi\('morning\.sent', \{ userId: member\.id \}\)[^]*\} else store\.dispatch\('markPersonSent', \{ personId: person\.id, at: new Date\(\)\.toISOString\(\) \}\)/, 'server mark for a Work Task person, the op for others');
  assert.match(APP, /teamApi\('people\.morning'\)/);
  assert.match(APP, /teamApi\('user\.save', \{ id: account\.id, name: account\.name, role: account\.role, email: /, 'email');
  assert.match(APP, /teamApi\('user\.reset', \{ id: account\.id, password \}\); sendSignIn\(/, 'new password, shown once');
  assert.match(APP, /teamApi\('user\.active', \{ id: account\.id, active: !account\.active \}\)/, 'switch off / on');
  assert.match(APP, /teamApi\('tasks\.moveAll', \{ fromId: account\.id, toId: to\.id \}\)/, 'move all tasks');
  assert.match(APP, /teamApi\('user\.save', \{ name: person\.name, username: name, password, role: 'staff', \.\.\.\(email \? \{ email: String\(email\)\.trim\(\) \} : \{\}\) \}\)/, 'new sign-in from + Add a person');
});

// ---------------------------------------------------------------- email replies
const { renderReplies, renderReplyRound, replyArea, readyCount } = await import('../docs/ui/replies.js');
const rFind = (node, f) => (f(node) ? node : (node.childNodes || []).map((c) => rFind(c, f)).find(Boolean));
const rAll = (node, f, out = []) => { if (f(node)) out.push(node); (node.childNodes || []).forEach((c) => rAll(c, f, out)); return out; };
const btn = (el, text) => rFind(el, (n) => n.nodeName === 'BUTTON' && n.textContent.includes(text));

function mailState() {
  const s = sampleState();
  const ago = (d) => new Date(Date.now() - d * 86400e3).toISOString();
  const mail = (id, d, from) => ({ conversationId: 'C' + id, count: 1, messageId: 'M' + id, fromName: from, fromAddress: from.toLowerCase() + '@x.test', subject: 'Subject ' + id, at: ago(d) });
  applyOps(s, [
    makeOp('addInbox', { itemId: 'i1', text: '📧 Price — from Ravi', note: 'Please send the price', link: { url: 'https://outlook.office365.com/owa/?ItemID=M1', title: 'x' }, mail: mail(1, 4, 'Ravi') }, ago(4)),
    makeOp('inboxToStep', { itemId: 'i1', projectId: 'p1', stepId: 'ms1' }, ago(4)),
    makeOp('addInbox', { itemId: 'i2', text: '📧 Glaze — from Anil', note: 'Samples sent', mail: mail(2, 1, 'Anil') }, ago(1)),
    makeOp('addInbox', { itemId: 'i3', text: '📧 Clay — from Meena', mail: mail(3, 0, 'Meena') }),
    makeOp('setReply', { itemId: 'i3', text: 'Dear Meena, thanks.', by: 'claude' }),
  ]);
  return s;
}
function replyCtx(s, ui = {}) {
  const ctx = fakeCtx(s, { update: {}, ...ui });
  ctx.calls = [];
  ctx.store.dispatch = (type, args) => { ctx.calls.push([type, args]); return { id: 'op' }; };
  ctx.openReplyDraft = (m) => ctx.calls.push(['draft', m.id]);
  ctx.openMail = (m) => ctx.calls.push(['open', m.id]);
  ctx.startReplyRound = () => ctx.calls.push(['round']);
  return ctx;
}

test('replies: the project page shows the email card; no reply = a hint and ✎ Write reply', () => {
  const s = mailState();
  const ctx = replyCtx(s, { selected: 'p1' });
  const el = renderDetail(ctx);
  const card = rFind(el, (n) => n.className === 'mail-card');
  assert.ok(card, 'email card on the project page');
  const t = card.textContent;
  for (const bit of ['From Ravi', 'step: 📧 Price — from Ravi', 'Please send the price', '💬 1 email', 'Open email ↗', 'No reply yet — ask Claude "prepare the reply for Kiln"']) assert.ok(t.includes(bit), bit);
  assert.ok(!t.includes('Reply ready'));
  btn(card, '✎ Write reply').__on.click();
  assert.equal(ctx.ui.replyOpen, 'step:p1:ms1', 'opens an empty box');
  const box = rFind(renderDetail(ctx), (n) => n.nodeName === 'TEXTAREA' && n.className === 'reply-text');
  assert.ok(box && box.value === '');
  assert.equal(box.getAttribute('placeholder'), 'Dear Mr. Ravi,\n\n…\n\nThank you.', 'hint in the owner\'s style, no sign-off (Outlook adds Thanks & Regards and the signature)');
  box.__on.focusout(null, { value: 'Dear Ravi, price attached.' });
  assert.deepEqual(ctx.calls.at(-1), ['setReply', { projectId: 'p1', stepId: 'ms1', text: 'Dear Ravi, price attached.', by: 'you' }], 'saves by itself, by you');
  assert.equal(renderDetail(replyCtx(sampleState(), { selected: 'p1' })).textContent.includes('💬'), false, 'no email: no card');
});

test('replies: the "✉ Reply ready" box — who prepared it, editable, and its four buttons wired', () => {
  const s = mailState();
  applyOps(s, [makeOp('setReply', { projectId: 'p1', stepId: 'ms1', text: 'Dear Ravi,\nPrice attached.', by: 'claude' })]);
  const ctx = replyCtx(s, { selected: 'p1' });
  const card = rFind(renderDetail(ctx), (n) => n.className === 'mail-card');
  const t = card.textContent;
  for (const bit of ['✉ Reply ready', 'prepared by Claude', 'you can edit', 'Open in Outlook (same thread)', '✓ Sent', '⏭ Later', '✕ Clear']) assert.ok(t.includes(bit), bit);
  assert.equal(rFind(card, (n) => n.nodeName === 'TEXTAREA').value, 'Dear Ravi,\nPrice attached.');
  btn(card, 'Open in Outlook').__on.click();
  btn(card, '✓ Sent').__on.click();
  btn(card, '⏭ Later').__on.click();
  btn(card, '✕ Clear').__on.click();
  assert.deepEqual(ctx.calls.map((c) => c[0]), ['draft', 'markReplySent', 'replyLater', 'clearReply']);
  assert.deepEqual(ctx.calls[1][1], { projectId: 'p1', stepId: 'ms1' });
});

test('replies: Undo after ✓ Sent takes it all back (undoReplySent with the draft, the date before and that ✓ Sent), not just the draft', () => {
  const s = mailState();
  applyOps(s, [makeOp('setReply', { projectId: 'p1', stepId: 'ms1', text: 'Dear Ravi', by: 'claude' })]);
  const ctx = replyCtx(s, { selected: 'p1' });
  let undo = null;
  ctx.toast = (t, ms, u) => { undo = u; };
  ctx.store.dispatch = (type, args) => { ctx.calls.push([type, args]); return { id: 'op9', at: '2026-10-22T10:30:00.000Z' }; };
  const wd = s.data.projects[0].workDate || null;
  btn(rFind(renderDetail(ctx), (n) => n.className === 'mail-card'), '✓ Sent').__on.click();
  assert.equal(typeof undo, 'function', 'Undo offered');
  undo();
  const [type, args] = ctx.calls.at(-1);
  assert.equal(type, 'undoReplySent');
  assert.deepEqual([args.projectId, args.stepId, args.reply.text, args.reply.state, args.workDate, args.sentAt, args.undoOpId], ['p1', 'ms1', 'Dear Ravi', 'ready', wd, '2026-10-22T10:30:00.000Z', 'op9']);
});

test('replies: a save timer from an earlier screen update does not bring back a reply marked ✓ Sent or ✕ Cleared', async (t) => {
  const { mailThreads } = await import('../docs/rules.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const button of ['✓ Sent', '✕ Clear']) {
    const s = mailState();
    const ctx = replyCtx(s);
    ctx.store.dispatch = (type, args) => { const op = makeOp(type, args); applyOps(s, [op]); ctx.calls.push([type, args]); return op; };
    const live = () => mailThreads(s.data).find((x) => x.key === 'inbox:i3');
    const prepared = () => (JSON.stringify(s.history).match(/"reply_prepared"/g) || []).length;
    const before = prepared();
    const el = { value: 'Dear Meena, thanks a lot.' }; // the same box on the page across updates
    rFind(replyArea(ctx, live()), (n) => n.nodeName === 'TEXTAREA').__on.input(null, el); // a letter typed
    const box = replyArea(ctx, live()); // the page updates (the store's save status) within the pause
    rFind(box, (n) => n.nodeName === 'TEXTAREA').__on.focusout(null, el); // leaving the box to click
    btn(box, button).__on.click();
    t.mock.timers.tick(1000); // the old pause runs out
    const types = ctx.calls.map((c) => c[0]);
    assert.deepEqual(types, ['setReply', button === '✓ Sent' ? 'markReplySent' : 'clearReply'], button + ': no late setReply after it');
    const r = live().reply;
    if (button === '✓ Sent') assert.equal(r && r.state, 'sent', 'still sent, not "Reply ready" again');
    else assert.ok(!r || r.state === 'sent', 'still cleared');
    assert.equal(prepared(), before, button + ': no stray "Reply prepared" line');
  }
});

test('replies: the ✉ Replies page — counts, ready and waiting lists with days, tap opens, round button', () => {
  const s = mailState();
  assert.equal(readyCount(s.data), 1, 'the menu number');
  const ctx = replyCtx(s);
  const el = renderReplies(ctx);
  const t = el.textContent;
  for (const bit of ['1 ready · 2 waiting', '▶ Check and send one by one', 'Ready to send (1)', 'Subject 3 — to Meena · waiting today', 'Waiting for your reply (2)', 'Subject 1 — from Ravi · waiting 4 days', 'Subject 2 — from Anil · waiting 1 day']) assert.ok(t.includes(bit), bit);
  const rows = rAll(el, (n) => n.nodeName === 'LI' && String(n.className).includes('waiting'));
  assert.deepEqual(rows.map((r) => r.className.trim()), ['reply-row waiting red', 'reply-row waiting orange'], 'red 3+ days, orange 1+');
  rFind(rows[0], (n) => n.nodeName === 'BUTTON').__on.click();
  btn(el, '▶ Check').__on.click();
  assert.deepEqual(ctx.calls, [['open', 'ms1'], ['round']]);
});

test('replies: the one-by-one round — Reply 1 of N, the email and draft, buttons, progress, end screen', () => {
  const s = mailState();
  applyOps(s, [makeOp('setReply', { itemId: 'i2', text: 'Dear Anil, received.', by: 'claude' })]);
  const ctx = replyCtx(s, { replyRound: { ids: ['inbox:i2', 'inbox:i3'], pos: 0 } });
  let el = renderReplyRound(ctx);
  const t = el.textContent;
  for (const bit of ['Reply 1 of 2', 'From Anil', 'Subject 2', 'Samples sent', 'Open in Outlook to send', '✎ Edit', '✓ Sent', '⏭ Later']) assert.ok(t.includes(bit), bit);
  assert.equal(rFind(el, (n) => n.nodeName === 'TEXTAREA').value, 'Dear Anil, received.');
  assert.ok(rFind(el, (n) => n.className === 'reply-progress'), 'thin progress bar');
  btn(el, 'Open in Outlook to send').__on.click();
  btn(el, '✓ Sent').__on.click();
  assert.deepEqual(ctx.calls.map((c) => c[0]), ['draft', 'markReplySent']);
  assert.equal(ctx.ui.replyRound.pos, 1, 'next reply');
  el = renderReplyRound(ctx);
  assert.ok(el.textContent.includes('Reply 2 of 2'));
  btn(el, '⏭ Later').__on.click();
  assert.ok(renderReplyRound(ctx).textContent.includes('All replies checked ✓'));
});

test('replies: an Inbox item from an email shows its reply box (app wiring: menu, key e, page, Outlook draft call)', async () => {
  const s = mailState();
  const m = (await import('../docs/rules.js')).mailThreads(s.data).find((x) => x.id === 'i3');
  assert.ok(replyArea(replyCtx(s), m).textContent.includes('✉ Reply ready'));
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(app, /item\('replies', '✉ Replies', readyCount\(data, today\)\)/, 'menu item with the ready count');
  assert.match(app, /k === 'e'\) go\('replies'\)/, 'key e');
  assert.match(app, /ui\.replyRound \? renderReplyRound\(ctx\) : renderReplies\(ctx\)/);
  assert.match(app, /teamApi\('outlook\.draft', \{ ref: fresh\.id \}\)/, 'only the ref goes to the server, never the text');
  assert.match(app, /replyMailto\(fresh\.mail, text\)/, 'falls back to a new email');
  assert.match(app, /item\.mail \? inboxReply\(item\) : null/);
});

// ---------------------------------------------------------------- People page: give @mentioned steps to the person's Work Task list
test('people: "→ Give to Ravi" on each open step (linked person), "→ Give all N", "👥 on Ravi\'s list" when already given; nothing when not linked', () => {
  const s = sampleState();
  applyOps(s, [
    makeOp('addStep', { projectId: 'p1', stepId: 's5', text: 'Check burner with @Ravi' }),
    makeOp('addStep', { projectId: 'p1', stepId: 's6', text: 'Order bricks @Ravi' }),
  ]);
  const user = { id: 7, name: 'Ravi', role: 'staff', active: true };
  const gave = [];
  const confirms = [];
  globalThis.confirm = (q) => { confirms.push(q); return true; };
  const ctx = fakeCtx(s, { person: 'r' });
  Object.assign(ctx, { onServer: true, teamLink: () => ({ user, member: { id: 7, name: 'Ravi', items: [] } }), teamAccounts: () => [user],
    newPasswordFor: () => {}, toggleTeamUser: () => {}, setTeamEmail: () => {}, moveAllTasks: () => {},
    teamTask: (id) => (id === 's6' ? { id: 99, status: 'open', assignee: { name: 'Ravi' } } : null),
    giveSteps: (items, u, person) => gave.push([items.map((x) => x.step.id), u.id, person.name]) });
  const el = renderPerson(ctx);
  const sec = (title) => rAll(el, (n) => n.nodeName === 'SECTION').find((x) => x.textContent.startsWith(title));
  const discuss = sec('To discuss with Ravi');
  assert.ok(discuss.textContent.includes('👥 on Ravi\'s list'), 'already a team task: a tag, no button');
  const rowBtns = rAll(discuss, (n) => n.nodeName === 'BUTTON' && n.textContent === '→ Give to Ravi');
  assert.equal(rowBtns.length, 1, 'only the step that is not given yet');
  rowBtns[0].__on.click();
  btn(discuss, '→ Give all 1').__on.click();
  btn(sec('Waiting on Ravi'), '→ Give to Ravi').__on.click();
  assert.deepEqual(gave, [[['s5'], 7, 'Ravi'], [['s5'], 7, 'Ravi'], [['s2'], 7, 'Ravi']]);
  assert.equal(confirms.length, 1, 'Give all asks once');
  // third choice in "Add a task with Ravi"
  assert.ok(btn(el, 'Ravi does it (their list)'), 'third choice beside I do it / Waiting on');
  // not linked to Work Task: no give buttons, no third choice
  const plain = renderPerson(fakeCtx(s, { person: 'r' })).textContent;
  assert.ok(!plain.includes('→ Give') && !plain.includes('does it (their list)'));
});

test('people: "Ravi does it" adds the step to the project AND gives it right away', () => {
  const s = sampleState();
  const user = { id: 7, name: 'Ravi', role: 'staff', active: true };
  const gave = [];
  const ui = { person: 'r' };
  const ctx = fakeCtx(s, ui);
  const { applyOp } = { applyOp: (st, o) => applyOps(st, [o]).length > 0 };
  ctx.store.dispatch = (type, args) => (applyOp(s, makeOp(type, args)) ? { id: 'x' } : null);
  Object.assign(ctx, { onServer: true, teamLink: () => ({ user, member: { id: 7, name: 'Ravi', items: [] } }), teamAccounts: () => [user],
    newPasswordFor: () => {}, toggleTeamUser: () => {}, setTeamEmail: () => {}, moveAllTasks: () => {},
    giveSteps: (items, u) => gave.push([items[0].step.text, u.id]) });
  let el = renderPerson(ctx);
  btn(el, 'Ravi does it (their list)').__on.click();
  assert.equal(ui.personTask.mode, 'give');
  const realQS = document.querySelector;
  document.querySelector = (q) => (q === '.person-task [name=task]' ? { value: 'Send burner quote', focus() {} } : null);
  try {
    el = renderPerson(ctx);
    rFind(el, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Kiln').__on.click();
  } finally { document.querySelector = realQS; }
  const step = s.data.projects[0].steps.find((x) => x.text.startsWith('Send burner quote'));
  assert.equal(step.text, 'Send burner quote @Ravi', 'linked to Ravi');
  assert.deepEqual(gave, [['Send burner quote @Ravi', 7]], 'given at once');
});

test('people give: the app sends task.save with the step\'s projectRef and stepRef (like 👥 Give to team) and one summary toast', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const fn = app.slice(app.indexOf('async function giveStepsTo('), app.indexOf('function refreshTeamPeople('));
  assert.match(fn, /teamApi\('task\.save', \{\s*assigneeId: user\.id, title: step\.text, details: '', project: project\.name, projectRef: project\.id, stepRef: step\.id,\s*repeat: 'once', dueDate: step\.dueDate \|\| null, skipSunday: true, clientId:/);
  assert.doesNotMatch(fn, /repeat: 'daily'/, 'a given step is a one-off: a daily task never closes on Finished, so the step was never ticked');
  assert.match(fn, /Given to \$\{first\} ✓/);
  assert.match(fn, /Given \$\{given\} to \$\{person\.name\} ✓\$\{failed\.length \? ` \(\$\{failed\.length\} failed: \$\{failed\[0\]\}\)` : ''\}/);
  assert.match(fn, /team\.byStep\.set\(step\.id, out\.task\)/, 'the step shows it is on their list at once');
  assert.match(app, /giveSteps: \(items, user, person\) => giveStepsTo\(items, user, person\)/);
});

test('page safety rules: no style="…" attributes in the projects app screens (the browser blocks them; widths go through .style)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const files = ['docs/app.js', ...readdirSync(new URL('../docs/ui/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => 'docs/ui/' + f)];
  for (const f of files) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(!/[{,]\s*style:\s*[`'"]/.test(src), `${f} sets a style attribute`);
  }
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.reply-round \.round-actions \.round-btn\.primary \{ grid-column: 1 \/ -1;/, 'the Outlook button takes the whole row in the replies round');
});

test('no-paste email (Send pending list → Outlook): connected + email → outlook.compose with the built html/subject, the tab opened inside the click, sent mark; else copy + mailto with why', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const sheet = APP.slice(APP.indexOf('function openSheet('), APP.indexOf('function closeSheet('));
  const out = sheet.slice(sheet.indexOf('const outlook = async'), sheet.indexOf('const first = '));
  assert.match(out, /if \(html && draft\) \{\n\s*const connected = outlookConnected\(\);\n\s*if \(emailPath\(\{ connected, email \}\) === 'draft'\) \{/, 'the rule picks the way');
  assert.match(out, /const tab = window\.open\('about:blank', '_blank'\);[^\n]*\n[^]*?await teamApi\('outlook\.compose', \{ to: email, subject, html \}\)/, 'the tab is opened before anything is awaited (inside the click), then the draft is made');
  assert.ok(out.indexOf("window.open('about:blank'") < out.indexOf('await '), 'no await before the tab opens');
  assert.match(out, /tab\.location\.href = out\.webLink;/, 'the draft opens in that tab');
  assert.match(out, /'Draft ready in Outlook — check it and press Send\.'/);
  assert.match(out, /tell\('Draft ready[^\n]*\n\s*if \(onSent\) onSent\('outlook'\);[^\n]*\n\s*return;/, 'marked sent as today');
  assert.match(out, /catch \(e\) \{\n\s*if \(tab\) tab\.close\(\);\n\s*why = pasteReason\(\{ connected, email, name: to && to\.name, error: e\.message \}\);/, 'a failed draft: the paste way, saying why');
  assert.match(out, /\} else why = pasteReason\(\{ connected, email, name: to && to\.name \}\)/, 'not connected / no email: the paste way, saying why');
  assert.match(out, /const done = copyTable\(\);[^]*say\(how, why\);[^]*location\.href = `mailto:/, 'the fallback still copies the table and opens a new mail');
  assert.ok(!/\/send|sendMail/.test(out), 'never sends');
  const open = APP.slice(APP.indexOf('function openPersonMessage('), APP.indexOf('function teamMorning('));
  assert.match(open, /outlookConnected\(\);[^\n]*\n\s*const data/, 'asked when the sheet opens, before the button is pressed');
  assert.match(open, /draft: true,/, 'the pending list uses the no-paste way');
  assert.match(APP, /let outlookOn = null;[^]*?function outlookConnected\(\) \{\n\s*if \(outlookOn === null\) \{\n\s*outlookOn = onServer \? teamApi\('outlook\.status'\)\.then\(\(o\) => \{ outlookOn = !!\(o\.outlook && o\.outlook\.connected\); \}, \(\) => \{ outlookOn = false; \}\) : false;/, 'outlook.status once per page load, kept in memory');
  assert.match(APP, /emailPath, pasteReason \} from '\.\/rules\.js'/);
  assert.match(sheet, /const say = \(how, why = ''\) => \{[^\n]*tell\(why \? `\$\{why\} — /, 'one short line: why, then what was copied');
});

test('make it a task: the step\'s ⋯ details have "↗ Make it a task" (one act, then the new task opens); a team-linked step asks first; the old step shows "→ moved to task" as a link', () => {
  const find = (node, f) => (f(node) ? node : (node.childNodes || []).map((c) => find(c, f)).find(Boolean));
  const btn = (el, words) => find(el, (n) => n.nodeName === 'BUTTON' && n.textContent.includes(words));
  const s = sampleState();
  const calls = [], opened = [];
  const ctx = fakeCtx(s, { selected: 'p1', update: {}, openStep: 's2' });
  ctx.act = (type, args, msg) => { calls.push({ type, args, msg }); return { op: {}, undo: () => {} }; };
  ctx.openProject = (id) => opened.push(id);
  const b = btn(renderDetail(ctx), '↗ Make it a task');
  assert.ok(b, 'the button is in the step details');
  b.__on.click();
  assert.equal(calls.length, 1, 'one change (so Undo is one step)');
  assert.equal(calls[0].type, 'stepToProject');
  assert.deepEqual([calls[0].args.projectId, calls[0].args.stepId], ['p1', 's2']);
  assert.ok(calls[0].args.newProjectId, 'a new id');
  assert.deepEqual(opened, [calls[0].args.newProjectId], 'the new project opens');
  assert.equal(ctx.ui.openStep, null);
  // a done step: no button
  assert.ok(!btn(renderDetail(fakeCtx(s, { selected: 'p1', update: {}, openStep: 's1', showDone: true })), '↗ Make it a task'), 'not on a done step');
  // given to the team: ask first; No = nothing changes
  const asked = [];
  const saved = globalThis.confirm;
  try {
    calls.length = 0;
    const tctx = fakeCtx(s, { selected: 'p1', update: {}, openStep: 's2' });
    tctx.onServer = true;
    tctx.teamInfo = () => ({ byStep: new Map(), fillBy: '18:00' });
    tctx.teamPeople = () => [];
    tctx.teamTask = (id) => (id === 's2' ? { id: 7, status: 'open', assignee: { id: 2, name: 'Valar' }, stepRef: 's2' } : null);
    tctx.act = ctx.act;
    tctx.openProject = ctx.openProject;
    globalThis.confirm = (q) => { asked.push(q); return false; };
    btn(renderDetail(tctx), '↗ Make it a task').__on.click();
    assert.deepEqual(asked, ["Valar's task stays with Kiln. Continue?"]);
    assert.equal(calls.length, 0, 'No: nothing changes');
    globalThis.confirm = (q) => { asked.push(q); return true; };
    btn(renderDetail(tctx), '↗ Make it a task').__on.click();
    assert.equal(calls.length, 1, 'Yes: made (the team task is not touched here)');
  } finally { globalThis.confirm = saved; }
  // after it: the old step is done with a link to the new project
  applyOps(s, [makeOp('stepToProject', { projectId: 'p1', stepId: 's2', newProjectId: 'pn' })]);
  opened.length = 0;
  const after = fakeCtx(s, { selected: 'p1', update: {}, showDone: true });
  after.openProject = (id) => opened.push(id);
  const link = btn(renderDetail(after), '→ moved to task: Fire samples');
  assert.ok(link, 'the old step links to the new project');
  link.__on.click();
  assert.deepEqual(opened, ['pn']);
});

test('make it a project wiring (app.js): Undo also takes the new project away; a given project keeps sending the moved step while its team task is open', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const act = APP.slice(APP.indexOf('function act(type, args, message'), APP.indexOf('/** Remember how far the list'));
  assert.match(act, /type === 'stepToProject' \? \{ removeProjectId: args\.newProjectId \} : \{\}/);
  assert.match(act, /store\.dispatch\('restoreProject', \{ project: before, index, undoOpId: op\.id, undoMonth: opMonth\(op\), \.\.\.made \}\)/);
  const steps = APP.slice(APP.indexOf('const projectSteps = (p) =>'), APP.indexOf('const wholeRef ='));
  // the rule itself (keep while the task is open, and while the team list is not loaded) is checked in core.test.mjs
  assert.match(steps, /const movedButGiven = \(x\) => keepMovedStep\(x, team\.byStep\.get\(x\.id\), !!team\.listAt\);/);
  assert.match(steps, /\(!x\.done \|\| movedButGiven\(x\)\)/, 'the person\'s task is not cancelled by the move');
  // a moved step is sent marked moved: the server keeps the task it has, but never makes a new one (or opens a cancelled one)
  assert.match(steps, /\.\.\.\(x\.done && x\.movedTo \? \{ moved: true \} : \{\}\)/);
  const DETAIL = readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8');
  assert.match(DETAIL, /setTimeout\(\(\) => \{ const f = document\.querySelector\('\.title-input'\); if \(f\) \{ f\.focus\(\); f\.select\(\); \} \}, 30\);/, 'the new project\'s name is ready to change');
});

test('project lists: "Red first" (red, yellow, green, grey) is the default order; "My order" is kept only when picked after that', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(app, /sort: saved\.sortV === 2 && saved\.sort === 'mine' \? 'mine' : 'red',/, 'red first unless My order was picked since the change');
  assert.match(app, /sort: ui\.sort, sortV: 2,/, 'the choice is remembered with the new version');
  assert.match(app, /const COLOUR_ORDER = \{ red: 0, yellow: 1, green: 2, grey: 3 \};/, 'grey (resting) goes last');
});

test('project page: a 💤 Snooze button sits next to Finish (not only in the ⋯ menu)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8');
  const top = src.slice(src.indexOf('function stateButtons('), src.indexOf("if (p.state === 'paused')", src.indexOf('function stateButtons(')));
  assert.match(top, /'💤 Snooze'\) : null,\s*p\.misc \? null : h\('button', \{ class: 'btn', onClick: \(\) => ctx\.act\('finish'/, 'Snooze right before Finish (none on 📂 Misc: it is never finished)');
  assert.match(top, /ui\.snoozeOpen = p\.id; ctx\.render\(\);/, 'it opens the snooze box');
});

const { readFileSync } = await import('node:fs');

test('📅 Only on: the ⋯ menu item opens the day chips (Mon … Sun, Every day, 🔔 Remind me at); the info chip; the resting bar on a rest day', async () => {
  const { todayIndia, addDays, weekdayOf, WEEKDAYS } = await import('../docs/rules.js');
  const { fmtDay } = await import('../docs/ui/dom.js');
  const s = sampleState();
  const menu = renderDetail(fakeCtx(s, { selected: 'p1', update: {}, projMenu: 'p1' })).textContent;
  assert.ok(menu.includes('📅 Only on…'), 'menu item');
  assert.ok(menu.includes('🔔 Remind me once…'), 'menu item for a one-time reminder');
  assert.ok(!renderDetail(fakeCtx(s, { selected: 'p1', update: {} })).textContent.includes('Every day'), 'chips closed until asked');
  const acts = [];
  const ctx = fakeCtx(s, { selected: 'p1', update: {}, onlyDaysOpen: 'p1' });
  ctx.act = (type, args) => { acts.push([type, args]); return true; };
  const el = renderDetail(ctx);
  const row = el.textContent;
  assert.ok(row.includes('Mon') && row.includes('Tue') && row.includes('Sun') && row.includes('Every day') && row.includes('🔔 Remind me at'), row);
  const find = (n, pred) => { if (pred(n)) return n; for (const c of n.childNodes || []) { const f = c.nodeType === 1 && find(c, pred); if (f) return f; } return null; };
  const thu = find(el, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Thu');
  assert.ok(thu, 'a Thu chip');
  // the day chips are buttons whose click sends setOnlyDays
  const DETAIL = readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8');
  assert.match(DETAIL, /ctx\.act\('setOnlyDays', \{ projectId: p\.id, days: next \}/);
  assert.match(DETAIL, /ctx\.act\('setRemindAt', \{ projectId: p\.id, time \}/);
  assert.match(DETAIL, /item\('📅 Only on…', \(\) => \{ ui\.onlyDaysOpen = p\.id; \}\)/);
  // rests today: chosen only tomorrow's weekday
  const today = todayIndia();
  const tomorrow = addDays(today, 1);
  const wd = weekdayOf(tomorrow);
  applyOps(s, [makeOp('setOnlyDays', { projectId: 'p1', days: [wd] }), makeOp('setRemindAt', { projectId: 'p1', time: '09:30' })]);
  const page = renderDetail(fakeCtx(s, { selected: 'p1', update: {} })).textContent;
  const long = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][wd];
  assert.ok(page.includes(`📅 ${long} · 🔔 9:30`), 'info chip');
  assert.ok(page.includes(`📅 Resting — comes back ${WEEKDAYS[wd]} ${fmtDay(tomorrow)} (${long} only)`), 'resting bar');
  // on a chosen day: no resting bar
  applyOps(s, [makeOp('setOnlyDays', { projectId: 'p1', days: [weekdayOf(today)] })]);
  assert.ok(!renderDetail(fakeCtx(s, { selected: 'p1', update: {} })).textContent.includes('Resting'), 'a chosen day is a normal day');
});

test('🔔 Remind me once: the bar (Today at, Tomorrow at, a date + time, Set, Clear) and the chip "🔔 Today 16:00"', async () => {
  const { indiaDateTime, addDays, todayIndia } = await import('../docs/rules.js');
  const s = sampleState();
  const bar = renderDetail(fakeCtx(s, { selected: 'p1', update: {}, remindOnceOpen: 'p1' })).textContent;
  for (const bit of ['🔔 Remind me once', 'Today at', 'Tomorrow at', 'Set', 'Cancel']) assert.ok(bar.includes(bit), bit);
  assert.ok(!bar.includes('Clear'), 'Clear only when one is set');
  const at = `${addDays(todayIndia(), 2)} 16:00`;
  applyOps(s, [makeOp('setRemindOnce', { projectId: 'p1', at })]);
  assert.ok(indiaDateTime() < at);
  const page = renderDetail(fakeCtx(s, { selected: 'p1', update: {}, remindOnceOpen: 'p1' })).textContent;
  assert.ok(page.includes('Clear'));
  assert.match(page, /🔔 \d+ \w{3} 16:00/, 'the chip');
  const DETAIL = readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8');
  assert.match(DETAIL, /ctx\.act\('setRemindOnce', \{ projectId: p\.id, at \}/);
});

test('🔔 Remind me once: "Today at" / "Tomorrow at" use the time typed (no redraw in between), not the time drawn', async () => {
  const { addDays, todayIndia } = await import('../docs/rules.js');
  const s = sampleState();
  const ctx = fakeCtx(s, { selected: 'p1', update: {}, remindOnceOpen: 'p1' });
  const calls = [];
  ctx.act = (type, args) => { calls.push([type, args]); return null; };
  const el = renderDetail(ctx);
  const box = (k) => rFind(el, (n) => n.nodeName === 'INPUT' && n.dataset.key === `ro-${k}-p1`);
  box('today').__on.input(null, { value: '23:59' });
  box('tomorrow').__on.input(null, { value: '18:30' });
  btn(el, 'Today at').__on.click();
  btn(el, 'Tomorrow at').__on.click();
  assert.deepEqual(calls.map((c) => c[1].at), [`${todayIndia()} 23:59`, `${addDays(todayIndia(), 1)} 18:30`]);
});

test('📅 a task\'s "Show older days" keeps its own setting: the main Diary\'s number (ui.diaryDays) is not turned into an object', () => {
  const s = sampleState();
  s.data.projects[0].createdAt = new Date(Date.now() - 60 * 86400e3).toISOString(); // older than 14 days: the button shows
  const ui = { selected: 'p1', update: {}, diaryDays: 14 };
  const el = renderDetail(fakeCtx(s, ui));
  const more = rFind(el, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Show older days');
  assert.ok(more, 'the task diary has the button');
  more.__on.click();
  assert.equal(ui.diaryDays, 14, 'the main Diary still shows its 14 days');
  assert.deepEqual(ui.projDiaryDays, { projectId: 'p1', n: 28 });
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(APP, /days\.slice\(0, Number\(ui\.diaryDays\) \|\| 14\)/, 'the Diary page never slices by a non-number');
  assert.match(APP, /ui\.diaryDays = \(Number\(ui\.diaryDays\) \|\| 14\) \+ 14/);
});

test('📅 Only on wiring (app.js): the list row hint says the days on a rest day; "#open=<id>" opens that project; the team sync never asks about rest days', () => {
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const row = APP.slice(APP.indexOf('function projectRow('), APP.indexOf('function projectRow(') + 4000);
  assert.match(row, /restReason\(p, today\) === 'onlyDays' \? h\('span', \{ class: 'tag snoozed'.*`📅 \$\{onlyDaysLabel\(p\.onlyDays\)\}`\)/);
  const open = APP.slice(APP.indexOf('function takeOpenFromHash('), APP.indexOf('let started = false;'));
  assert.match(open, /openIdFromHash\(location\.hash\)/);
  assert.match(open, /if \(store\) select\(id\);\s+else \{ ui\.selected = id; ui\.mobile = 'detail'; \}/);
  assert.match(APP, /takeOpenFromHash\(\); \/\/ "#open=<id>"/, 'on start');
  assert.match(APP, /if \(takeOpenFromHash\(\)\) render\(\);/, 'when the app is already open');
  const sync = APP.slice(APP.indexOf('const projectSteps = (p) =>'), APP.indexOf('const wholeRef ='));
  assert.doesNotMatch(sync, /onlyDays|isSnoozed|restUntil|restReason|remind/);
});

test('project page: the description has room above and below (never touching the title line or the chips) and lines up with the chips', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.about-input {'), css.indexOf('}', css.indexOf('.about-input {')));
  assert.match(rule, /margin: 10px 0 10px -7px;/, 'space above and below; the text starts where the chips start');
  assert.match(rule, /width: calc\(100% \+ 7px\);/);
});

// ---------------------------------------------------------------- 📂 projects and ✅ tasks
const mains = await import('../docs/ui/mains.js');
const { h: hh } = await import('../docs/ui/dom.js');
const { todayIndia: todayIndiaNow } = await import('../docs/rules.js');

function mainsState() {
  const s = sampleState(); // p1 'Kiln' (has steps)
  const now = Date.now();
  const at = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  applyOps(s, [
    makeOp('createMainProject', { projectId: 'm', name: 'Kilns', childId: 'p1' }, at(90)),
    makeOp('createProject', { projectId: 'c2', name: 'Kiln 2', parentId: 'm' }, at(80)),
    makeOp('createProject', { projectId: 'o', name: 'Office move' }, at(70)),
    makeOp('setProjectTeam', { projectId: 'c2', userId: 7, name: 'Ravi' }, at(60)),
  ]);
  return s;
}

/** A ctx whose dispatch / act really change the state, and remember what was asked. */
function liveCtx(s, ui = {}) {
  const ctx = fakeCtx(s, ui);
  ctx.calls = [];
  ctx.store.dispatch = (type, args) => { ctx.calls.push([type, args]); return applyOps(s, [makeOp(type, args)])[0] || null; };
  ctx.act = (type, args, message) => { ctx.calls.push(['act:' + type, args, message]); return applyOps(s, [makeOp(type, args)])[0] || null; };
  ctx.openProject = (id) => ctx.calls.push(['open', id]);
  ctx.rememberUi = () => ctx.calls.push(['remember']);
  return ctx;
}

test('✅ Tasks list: tasks only (📂 projects left out), a task in two projects listed once, with a small chip for each project under its row', async () => {
  const { activeTasks } = await import('../docs/rules.js');
  const s = mainsState();
  applyOps(s, [
    makeOp('createMainProject', { projectId: 'sa', name: 'Supplier approval' }),
    makeOp('addToProject', { projectId: 'p1', parentId: 'sa' }),
  ]);
  assert.deepEqual(activeTasks(s.data).map((p) => p.id).sort(), ['c2', 'o', 'p1'], 'the projects Kilns and Supplier approval are not tasks; Kiln is there once');
  const chips = (id) => {
    const el = mains.projectChips(s.data, s.data.projects.find((p) => p.id === id));
    return el ? rAll(el, (n) => n.className === 'tag main-tag').map((n) => n.textContent) : [];
  };
  assert.deepEqual(chips('p1'), ['📂 Kilns', '📂 Supplier approval'], 'both projects, under the row');
  assert.deepEqual(chips('c2'), ['📂 Kilns']);
  assert.deepEqual(chips('o'), [], 'in no project: no chips');
});

test('📂 smart box: ⋯ → "📂 Add to a project…"; projects only (typed any case), ↓ / Enter adds; it stays open to add more; ✓ on the ones it is in, tap again takes it out; a create line; Esc closes', () => {
  const s = mainsState();
  applyOps(s, [makeOp('createMainProject', { projectId: 'sa', name: 'Supplier approval' })]);
  const ui = { selected: 'o', update: {}, projMenu: 'o' };
  const ctx = liveCtx(s, ui);
  btn(renderDetail(ctx), '📂 Add to a project…').__on.click();
  assert.equal(ui.mainBox.mode, 'parent');
  assert.equal(ui.mainBox.id, 'o');
  const input = () => rFind(renderDetail(ctx), (n) => n.className === 'main-box-input');
  const items = (el) => rAll(el, (n) => n.nodeName === 'BUTTON' && /main-box-item/.test(n.className)).map((n) => n.textContent);
  const P = (id) => s.data.projects.find((p) => p.id === id);
  assert.deepEqual(items(renderDetail(ctx)).sort(), ['📂 Kilns', '📂 Supplier approval'], 'only projects (never a task)');
  input().__on.input(null, { value: 'KIL' });
  assert.deepEqual(items(renderDetail(ctx)), ['📂 Kilns', "+ Create 'KIL' as a new project"], 'any case, anywhere');
  const key = (k) => input().__on.keydown({ key: k, preventDefault() {}, stopPropagation() {} });
  key('ArrowDown');
  assert.equal(ui.mainBox.index, 1);
  key('ArrowUp');
  key('Enter');
  assert.deepEqual(ctx.calls.filter((c) => c[0].startsWith('act:')).pop().slice(0, 2), ['act:addToProject', { projectId: 'o', parentId: 'm' }]);
  assert.deepEqual(P('o').parentIds, ['m']);
  assert.ok(ui.mainBox && ui.mainBox.q === '', 'stays open (to add more), the typed name cleared');
  btn(renderDetail(ctx), '📂 Supplier approval').__on.click();
  assert.deepEqual(P('o').parentIds, ['m', 'sa'], 'a second project: in both');
  const page = renderDetail(ctx);
  assert.deepEqual(items(page).sort(), ['✓ 📂 Kilns', '✓ 📂 Supplier approval'], '✓ on the projects it is in');
  btn(page, '✓ 📂 Kilns').__on.click();
  assert.deepEqual(ctx.calls.filter((c) => c[0].startsWith('act:')).pop().slice(0, 2), ['act:removeFromProject', { projectId: 'o', parentId: 'm' }]);
  assert.deepEqual(P('o').parentIds, ['sa'], 'tap again: taken out of that one only');
  // a new name: the create line makes the project with this task in it (one act = one Undo), and keeps the others
  input().__on.input(null, { value: 'Furnaces' });
  assert.deepEqual(items(renderDetail(ctx)), ["+ Create 'Furnaces' as a new project"]);
  key('Enter');
  const made = ctx.calls.filter((c) => c[0] === 'act:createMainProject').pop();
  assert.deepEqual([made[1].childId, made[1].name], ['o', 'Furnaces']);
  assert.deepEqual(P('o').parentIds, ['sa', made[1].projectId]);
  key('Escape');
  assert.equal(ui.mainBox, null, 'Esc closes');
  // a project has no "Add to a project" (a project is never inside another)
  assert.ok(!btn(renderDetail(liveCtx(s, { selected: 'm', update: {}, projMenu: 'm' })), '📂 Add to a project…'));
});

test('📂 project page: TASKS (N) table (dot, name + 👥, Now / "No next step", last update), tap opens; "+ Add a task here" and "+ New task here"', () => {
  const s = mainsState();
  const ui = { selected: 'm', update: {} };
  const ctx = liveCtx(s, ui);
  const page = renderDetail(ctx);
  const text = page.textContent;
  assert.ok(text.includes('TASKS (2)'));
  assert.ok(!text.includes('SUB-PROJECTS'));
  for (const bit of ['Kiln 2', '👥 Ravi', 'No next step', 'Fire samples', 'Kiln at 1150', '+ Add tasks', '+ New task here']) assert.ok(text.includes(bit), bit);
  const rows = rAll(page, (n) => n.className === 'sub-row');
  assert.equal(rows.length, 2);
  rows[0].__on.click();
  assert.equal(ctx.calls.pop()[0], 'open');
  // "+ Add tasks" (owner asked, 22 Oct): a list with tick boxes, one or several tasks at once
  btn(page, '+ Add tasks').__on.click();
  const boxes = () => rAll(renderDetail(ctx), (n) => n.nodeName === 'INPUT' && n.getAttribute && n.getAttribute('type') === 'checkbox');
  const names = rAll(renderDetail(ctx), (n) => n.className === 'add-tasks-row').map((n) => n.textContent.trim());
  assert.deepEqual(names, ['Office move'], 'only tasks not already in it, never itself');
  boxes()[0].__on.change(null, { checked: true });
  assert.ok(renderDetail(ctx).textContent.includes('Add 1 task'), 'the button counts the ticks');
  btn(renderDetail(ctx), 'Add 1 task').__on.click();
  assert.deepEqual(s.data.projects.find((p) => p.id === 'o').parentIds, ['m']);
  // "+ New task here" opens a box on the page now (owner asked, 22 Oct: no browser question box)
  globalThis.prompt = () => { throw new Error('no prompt any more'); };
  try { btn(renderDetail(ctx), '+ New task here').__on.click(); } finally { delete globalThis.prompt; }
  const name = rFind(renderDetail(ctx), (n) => n.nodeName === 'INPUT' && n.dataset.key === 'newhere-m-name');
  name.__on.input(null, { value: 'Kiln 3' });
  name.__on.keydown({ key: 'Enter', preventDefault() {} }, { value: 'Kiln 3' });
  const made = s.data.projects.find((p) => p.name === 'Kiln 3');
  assert.deepEqual(made.parentIds, ['m'], 'made already in it');
  assert.ok(renderDetail(ctx).textContent.includes('TASKS (4)'));
});

test('📂 a task shows a chip "📂 Kilns ›" for each project it is in (opens it); others do not', () => {
  const s = mainsState();
  applyOps(s, [makeOp('createMainProject', { projectId: 'sa', name: 'Supplier approval', childId: 'p1' })]);
  const ctx = liveCtx(s, { selected: 'p1', update: {} });
  const page = renderDetail(ctx);
  assert.ok(btn(page, '📂 Supplier approval ›'), 'a chip for each project');
  const chip = btn(page, '📂 Kilns ›');
  assert.ok(chip);
  chip.__on.click();
  assert.deepEqual(ctx.calls.pop(), ['open', 'm']);
  assert.ok(!renderDetail(liveCtx(s, { selected: 'o', update: {} })).textContent.includes('📂 Kilns ›'));
  assert.ok(!renderDetail(liveCtx(s, { selected: 'p1', update: {} })).textContent.includes('TASKS ('), 'no table on a task');
});

test('📂 Projects page head: the line (each task counted once) and "+ New project"; the page is a plain list of projects like ✅ Tasks (owner asked, 22 Oct)', async () => {
  const s = mainsState();
  const ctx = liveCtx(s, {});
  globalThis.prompt = () => 'Furnaces';
  let head;
  try {
    head = mains.renderProjectsHead(ctx);
    assert.ok(head.textContent.includes('1 project · 2 tasks in them'), head.textContent); // (then "· N in no project", owner asked 24 Oct)
    btn(head, '+ New project').__on.click();
  } finally { delete globalThis.prompt; }
  const fur = s.data.projects.find((p) => p.name === 'Furnaces');
  assert.ok(fur && fur.isMain, 'made as a project (shows while empty)');
  applyOps(s, [makeOp('addToProject', { projectId: 'p1', parentId: fur.id })]);
  head = mains.renderProjectsHead(ctx);
  assert.ok(head.textContent.includes('2 projects · 2 tasks in them'), 'Kiln is in both, counted once');
  assert.ok(!head.textContent.includes('Kiln 2'), 'no task lists on the Projects page: only projects');
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(ui\.view === 'mains'\) return mainProjects\(store\.view\.data\)\.filter\(\(p\) => p\.state !== 'finished'\);/, 'the list shows projects only');
  assert.match(app, /const asProject = ui\.view === 'mains' && !ui\.search;/, 'a project row shows "N tasks · …" instead of the next step');
  assert.match(app, /asProject \? h\('span', \{ class: 'prow-next' \}, projectLine\(store\.view\.data, p, today\)\)/, 'its line counts the projects inside it and their tasks (owner asked 23 Oct)');
  assert.ok(!/'replies', 'mains'\]\.includes\(ui\.view\)/.test(app), '↓ ↑ move through projects like tasks');
  assert.ok(!/renderMainProjects/.test(app), 'the old cards are gone');
});

test('📂 app wiring (app.js): ✅ Tasks and 📂 Projects menu items (keys; listed under ?; Ctrl-K), flat lists with project chips, Today without empty projects, Undo of a new / deleted project; the team sync never sends parentIds', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(APP, /item\('all', '✅ Tasks', activeTasks\(data\)\.length\)/);
  assert.doesNotMatch(APP, /'All projects'|Main projects/, 'the old words are gone');
  assert.match(APP, /item\('mains', '📂 Projects', mainProjects\(data\)\.filter\(\(m\) => m\.state !== 'finished' && !m\.misc\)\.length\)/ /* (owner asked 24 Oct: the same count as the page, without "In no project") */);
  assert.match(APP, /mains: 'M'/);
  assert.match(APP, /else if \(k === 'm'\) go\('mains'\)/);
  assert.match(APP, /\['m', 'Go to 📂 Projects'\]/);
  assert.match(APP, /\['✅ Tasks', \(\) => go\('all'\)\]/, 'Ctrl-K');
  assert.match(APP, /all: '✅ Tasks',/, 'page title');
  assert.match(APP, /mains: '📂 Projects' \}\[ui\.view\]/, 'page title');
  assert.match(APP, /if \(ui\.view === 'all'\) return activeTasks\(store\.view\.data\)/);
  assert.match(APP, /const rows = open\.map\(\(p\) => projectRow\(p, today\)\);/, 'flat: each task once');
  assert.match(APP, /projectChips\(store\.view\.data, p\)/, 'project chips under the row');
  assert.match(APP, /item\('📂', task \? 'Add to a project…' : 'Put inside a project…'/, 'a task: Add to a project; a 📂 project: Put inside a project (owner asked 23 Oct)');
  assert.match(APP, /'\+ New task', keyHint\('N'\)/);
  assert.match(APP, /todayWithoutEmptyMains\(awakeProjects/);
  assert.match(APP, /type === 'createMainProject' \? \{ removeProjectId: args\.projectId \} : parentIds \? \{ parentIds \}/);
  assert.match(APP, /parentIdsOf\(x\)\.includes\(args\.projectId\)/, 'Undo of a deleted project puts its tasks back');
  for (const line of APP.split('\n').filter((l) => l.includes("'project.sync'"))) assert.ok(!line.includes('parent'), 'project.sync never sends parentIds');
});

test('📧 a task made from an email: EMAIL THREAD under the steps (📧 them / ↩ you, date, first lines, Open ↗), the Reply ready box, and the ✉ Replies page lists it', () => {
  const s = sampleState();
  applyOps(s, [makeOp('createProject', { projectId: 'et', name: '📧 Price list' })]);
  const t = s.data.projects.find((p) => p.id === 'et');
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  t.mail = { conversationId: 'C1', messageId: 'M2', fromName: 'Ravi', fromAddress: 'ravi@x.test', subject: 'Price list', at: ago(10) };
  t.thread = [
    { at: ago(60), fromName: 'Ravi', fromMe: false, preview: 'Can you send the price?', link: 'https://outlook.office365.com/owa/?ItemID=M1', messageId: 'M1' },
    { at: ago(30), fromName: 'You', fromMe: true, preview: 'Sending it today.', link: 'https://outlook.office365.com/owa/?ItemID=S1', messageId: 'S1' },
    { at: ago(10), fromName: 'Ravi', fromMe: false, preview: 'Any news?', link: 'javascript:alert(1)', messageId: 'M2' },
  ];
  const ctx = fakeCtx(s, { selected: 'et', update: {} });
  const page = renderDetail(ctx);
  const block = rFind(page, (n) => /email-thread/.test(String(n.className)));
  assert.ok(block, 'the EMAIL THREAD section');
  const text = block.textContent;
  for (const bit of ['EMAIL THREAD (3)', '📧 Ravi', '↩ You', 'Can you send the price?', 'Sending it today.', 'Any news?']) assert.ok(text.includes(bit), bit);
  const rows = rAll(block, (n) => /thread-row/.test(String(n.className)));
  assert.deepEqual(rows.map((r) => r.className), ['thread-row', 'thread-row me', 'thread-row'], 'yours look different');
  const links = rAll(block, (n) => n.nodeName === 'A').map((a) => a.getAttribute('href'));
  assert.deepEqual(links, ['https://outlook.office365.com/owa/?ItemID=M1', 'https://outlook.office365.com/owa/?ItemID=S1'], 'Open ↗ only for real web links');
  const all = page.textContent;
  const order = rAll(page, () => true);
  const steps = rFind(page, (n) => /sortable-steps/.test(String(n.className)));
  assert.ok(steps && order.indexOf(block) > order.indexOf(steps), 'under the steps');
  assert.ok(all.includes('No reply yet') || all.includes('✎ Write reply'), 'the reply box is there');
  assert.ok(!renderDetail(fakeCtx(s, { selected: 'p1', update: {} })).textContent.includes('EMAIL THREAD'), 'not on a task without emails');
  const replies = renderReplies(fakeCtx(s, {})).textContent;
  assert.ok(replies.includes('Price list — from Ravi'), 'on the ✉ Replies page (waiting for your reply)');
});

test('📂 a project name opens the project on the 📂 Projects page (its own page with its tasks), never the task list', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const open = app.slice(app.indexOf('  openProject: (id) => {'), app.indexOf('  openProject: (id) => {') + 600);
  assert.match(open, /ui\.view = p\.state !== 'active' \? p\.state : isMainProject\(store\.view\.data, p\) \? 'mains' : 'all';/);
});

test('📂 Projects page: a click on a project row selects it and stays on the page (like ✅ Tasks); a task in a project\'s TASKS table opens on the right without leaving', async () => {
  const { readFileSync } = await import('node:fs');
  const mainsSrc = readFileSync(new URL('../docs/ui/mains.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(app, /h\('button', \{ class: 'prow-btn', onClick: \(\) => select\(p\.id\) \}/, 'rows only select (no jump)');
  assert.match(mainsSrc, /ctx\.ui\.view === 'mains' && ctx\.showHere \? ctx\.showHere\(c\.id\)/, 'a task in the TASKS table while on the Projects page');
  const here = app.slice(app.indexOf('  showHere: (id) => {'), app.indexOf('  openProject: (id) => {'));
  assert.match(here, /select\(id\);/);
  assert.match(readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8'), /const CACHE = 'daily-projects-app-54'/, 'phones get the new copy');
});

test('📂 project page: "✕ Remove" on a task row takes it out of this project only — the task is kept (and stays in its other projects)', () => {
  const s = mainsState();
  const ui = { selected: 'm', update: {} };
  const ctx = liveCtx(s, ui);
  const page = renderDetail(ctx);
  const rows = rAll(page, (n) => n.className === 'sub-row');
  assert.ok(rows.length >= 2);
  const before = s.data.projects.length;
  const removeBtn = rAll(rows[0], (n) => n.nodeName === 'BUTTON' && /sub-remove/.test(n.className))[0];
  assert.ok(removeBtn, 'each row has a Remove button');
  const name = rows[0].textContent;
  removeBtn.__on.click({ stopPropagation() {} });
  const call = ctx.calls.find((c) => c[0] === 'act:removeFromProject');
  assert.ok(call && call[1].parentId === 'm', 'removeFromProject for this project');
  assert.equal(s.data.projects.length, before, 'nothing deleted');
  const task = s.data.projects.find((p) => p.id === call[1].projectId);
  assert.ok(task && !(task.parentIds || []).includes('m'), 'out of this project');
  assert.ok(name.includes(task.name));
  assert.ok(!ctx.calls.some((c) => c[0] === 'open'), 'the click does not open the task');
  assert.ok(renderDetail(ctx).textContent.includes(`TASKS (${rows.length - 1})`));
});

test('📋 Copy list buttons: on a project page (its tasks) and on the task lists (what is on screen)', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const mainsSrc = readFileSync(new URL('../docs/ui/mains.js', import.meta.url), 'utf8');
  assert.match(mainsSrc, /const all = orderedTasks\(data, p, today\)\.filter\(\(c\) => !isMainProject\(data, c\)\);/, 'the table\'s list: the project\'s own order, tasks only');
  assert.match(mainsSrc, /ctx\.copyList\(all\.filter\(\(c\) => c\.state !== 'finished'\), \{ title: `📂 \$\{p\.name\}`, about: p\.about \|\| '' \}\) \}, '📋 Copy list'\)/, 'in the project\'s own order');
  assert.match(app, /onClick: \(\) => copyList\(currentList\(\), \{ title: viewTitle\(\) \}\) \}, '📋 Copy list'\)/);
  assert.match(app, /!ui\.search && list\.length && ui\.view !== 'mains' \? h\('button', \{ class: 'btn small copy-list'/, 'not on the 📂 Projects list (each project page has its own)');
  assert.match(app, /new ClipboardItem\(\{ 'text\/html': new Blob\(\[html\]/, 'rich copy for email, plain for AI');
});

test('✅ Tasks: "All tasks N" | "No project N" switch (both red first, remembered); no "My order" there', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(app, /opt\('all', `All tasks \$\{all\.length\}`\), opt\('loose', `No project \$\{loose\}`\)/);
  assert.match(app, /if \(ui\.view === 'all'\) return activeTasks\(store\.view\.data\)\.filter\(\(p\) => ui\.taskFilter !== 'loose' \|\| !parentIdsOf\(p\)\.length\);/, '"No project" = tasks in no project');
  assert.match(app, /taskListView\(\) && !ui\.search && !ui\.adding \? taskFilterSwitch\(\) : showSort/, 'the switch replaces My order / Red first on Tasks and in groups (owner asked, 22 Oct)');
  // (groups are gone, owner 23 Oct: ✅ Tasks only)
  assert.match(app, /function taskListView\(\) \{\n  return ui\.view === 'all';/);
  assert.match(app, /if \(\(ui\.sort !== 'red' && !taskListView\(\)\) \|\| ui\.search\) return list;/, 'Tasks and groups are always red first');
  assert.match(app, /taskFilter: ui\.taskFilter,/, 'remembered');
});

test('📂 project page: no STEPS section and no step box (steps live in its tasks); old steps show under "Steps from before" and "↗ Make it a task" makes a task in this project', () => {
  const s = mainsState();
  applyOps(s, [makeOp('addStep', { projectId: 'm', stepId: 'os1', text: 'Order spare coil' })]);
  const ui = { selected: 'm', update: {} };
  const ctx = liveCtx(s, ui);
  const page = renderDetail(ctx);
  const text = page.textContent;
  assert.ok(!rAll(page, (n) => n.nodeName === 'FORM' && /add-step/.test(n.className || '')).length, 'no add-step box on a project');
  assert.ok(!/steps done/.test(text), 'no "x of y steps done" chip');
  assert.ok(text.includes('Steps from before (1)') && text.includes('Order spare coil'));
  const before = s.data.projects.length;
  btn(page, '↗ Make it a task').__on.click();
  assert.equal(s.data.projects.length, before + 1, 'a new task');
  const made = s.data.projects.find((p) => p.name === 'Order spare coil');
  assert.ok(made && (made.parentIds || []).includes('m'), 'the new task is in this project');
  assert.ok(!renderDetail(ctx).textContent.includes('Steps from before'), 'the old step is gone from the project page');
  // a task still has its steps section
  ui.selected = 'p1';
  assert.ok(rAll(renderDetail(ctx), (n) => n.nodeName === 'FORM' && /add-step/.test(n.className || '')).length === 1, 'tasks keep their steps');
});

test('task lists: a task with no next step shows no red "No next step — add one" line (the + on the left adds one)', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const row = app.slice(app.indexOf('function projectRow('), app.indexOf('function rowAction('));
  assert.ok(!row.includes('No next step — add one'), 'the red line is gone from list rows (owner asked, 22 Oct)');
  assert.match(row, /class: 'quick-add', title: 'Add the first step'/, 'the + to add a step stays');
});

test('groups are gone (owner, 23 Oct): no Groups in the menu, no group pages, no group on a task or + New task, one tag list and one timer switch in Settings, no group in the Time report or the Dashboard', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8');
  const dash = readFileSync(new URL('../docs/ui/dashboard.js', import.meta.url), 'utf8');
  for (const gone of ["'groups-head'", 'function addGroup(', 'function editGroup(', "go('group:'", "'Group: '", "name: 'group'", '+ New task in ', 'groupHasTimer', 'mergeGroups', '.groups']) assert.ok(!app.includes(gone), 'gone: ' + gone);
  for (const f of ['detail.js', 'timereport.js', 'dashboard.js', 'mains.js', 'people.js', 'richedit.js']) {
    const src = readFileSync(new URL('../docs/ui/' + f, import.meta.url), 'utf8');
    assert.ok(!/groupId|\.groups\b|groupHasTimer/.test(src), f + ': no groups');
  }
  assert.equal((app.match(/group:/g) || []).length, 1, 'only the old saved group page, which opens ✅ Tasks');
  assert.match(app, /view: saved\.view && !String\(saved\.view\)\.startsWith\('group:'\) \? saved\.view : saved\.view \? 'all' : 'today'/);
  assert.ok(!/'Group ',/.test(detail), 'no group box on a task');
  assert.ok(!/time-groups/.test(dash), 'no time by group on the Dashboard');
  assert.match(app, /h\('h3', null, 'Tags and timer'\)/);
  assert.match(app, /checked: timerOn\(data\), onChange: \(e, el\) => store\.dispatch\('setTimer', \{ on: el\.checked \}\)/, 'one timer switch');
  assert.match(app, /\(data\.tags \|\| \[\]\)\.map\(\(t\) => h\('span', \{ class: 'tag tag-chip'/, 'one tag list');
  // drawn: the task page shows its tag, no group chip
  const s = sampleState();
  applyOps(s, [makeOp('setProjectField', { projectId: 'p1', field: 'tagId', value: 'kiln' })]);
  const text = renderDetail(fakeCtx(s, { selected: 'p1', update: {} })).textContent;
  assert.ok(text.includes('🏷 Kiln'), 'the tag shows');
  assert.ok(!/Acton|No group/.test(text), 'no group');
});



test('menu order (owner, 22 Oct): Today, Tasks, Projects, Replies, Inbox, Groups, Paused, Finished, People, Settings, More ▸ (Diary, Dashboard, Time report); no people listed under People', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const menu = app.slice(app.indexOf("h('ul', { class: 'menu-list' },"), app.indexOf('// ---------------------------------------------------------------- Today box'));
  // (groups are gone, owner 23 Oct: no Groups between Inbox and Paused)
  const order = ["item('today'", "item('all'", "item('mains'", "item('replies'", "item('inbox'", "item('paused'", "item('finished'", "item('people'", "item('settings'", "'more-menu'", "item('diary'", "item('dashboard'", "item('time'"];
  let at = -1;
  for (const bit of order) { const i = menu.indexOf(bit); assert.ok(i > at, `${bit} in its place`); at = i; }
  assert.ok(!menu.includes('menu-person'), 'People shows just its count');
  assert.match(menu, /moreOpen \? 'More ▾' : 'More ▸'/);
  assert.match(app, /const moreOpen = !!ui\.moreMenu \|\| \['diary', 'dashboard', 'time'\]\.includes\(ui\.view\);/, 'open while one of them is on screen');
});

test('✅ Tasks and groups: a select box on each row (instead of +), a bar "N selected · 📂 Add to project… · Select all · Clear" that puts all selected tasks into one project (or a new one); Today keeps its tick box', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(app, /function canPickRows\(\) \{\n  return !ui\.search && ui\.view === 'all';/, 'Tasks only (not Today; groups are gone, owner 23 Oct)');
  assert.match(app, /picking\n      \? h\('input', \{\n        type: 'checkbox', class: 'row-pick'/, 'the select box takes the place of + and the tick');
  assert.match(app, /for \(const id of picked\) if \(store\.dispatch\('addToProject', \{ projectId: id, parentId: main\.id \}\)\) n\+\+;/, 'all selected go into the chosen project');
  assert.match(app, /store\.dispatch\('createMainProject', \{ projectId, name, childId: ids\[0\] \}\)/, 'or a new project made with them');
  assert.match(app, /`\$\{picked\.size\} selected`/);
  assert.match(app, /pickBar\(list\),\n    \.\.\.listParts\(list, today\),/);
});

test('a task or project page shows its links and files as chips near the top (🔗 title / 📎 name), one click to open', () => {
  const s = mainsState();
  applyOps(s, [makeOp('addLink', { projectId: 'm', linkId: 'l1', title: 'PPT', url: 'https://example.com/ppt' })]);
  const ui = { selected: 'm', update: {} };
  const ctx = liveCtx(s, ui);
  const page = renderDetail(ctx);
  const chips = rAll(page, (n) => n.className === 'tag quick-link' && n.textContent === '🔗 PPT');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].getAttribute('href'), 'https://example.com/ppt');
  const quick = rAll(page, (n) => n.className === 'quick-links')[0];
  const tasksAt = page.textContent.indexOf('TASKS');
  assert.ok(page.textContent.indexOf('🔗 PPT') < tasksAt, 'above the tasks, near the top');
  ui.selected = 'o';
  assert.ok(!rAll(renderDetail(ctx), (n) => n.className === 'quick-links').length, 'nothing when there are no links or files');
  assert.ok(quick);
});

// Drag-to-move (owner asked, 23 Oct): a ⋮⋮ grip on each task row replaces the ▲ ▼ buttons.
function threeTasks() {
  const s = mainsState();
  applyOps(s, [makeOp('createProject', { projectId: 'c3', name: 'Kiln 3', parentId: 'm' })]);
  return s;
}
const isSubRow = (n) => /(^| )sub-row( |$)/.test(n.className || '');
const rowIds = (page) => rAll(page, isSubRow).map((r) => r.dataset.key.replace(/^sub-/, ''));
/** Gives the pretend rows a place on screen (40px each) and the grips what Pointer Events need. */
function dragKit(page) {
  const rows = rAll(page, isSubRow);
  rows.forEach((r, i) => { r.getBoundingClientRect = () => ({ top: i * 40, height: 40 }); });
  const grip = (i) => {
    const g = rFind(rows[i], (n) => n.dataset && /^grip-/.test(n.dataset.key || ''));
    g.__l = {}; g.captured = false;
    g.addEventListener = (t, f) => { g.__l[t] = f; };
    g.removeEventListener = (t) => { delete g.__l[t]; };
    g.setPointerCapture = () => { g.captured = true; };
    g.releasePointerCapture = () => { g.captured = false; };
    return g;
  };
  return { rows, grip };
}
function withDocListeners(fn) {
  const docL = {};
  document.addEventListener = (t, f) => { docL[t] = f; };
  document.removeEventListener = (t) => { delete docL[t]; };
  try { return fn(docL); } finally { delete document.addEventListener; delete document.removeEventListener; }
}
const down = (y) => ({ button: 0, pointerId: 1, clientY: y, preventDefault() {} });

test('📂 project page: each task row has a ⋮⋮ grip (aria-label "Drag to move <name>") and no ▲ ▼ buttons; ✕ Remove stays', () => {
  const s = threeTasks();
  const page = renderDetail(liveCtx(s, { selected: 'm', update: {} }));
  const rows = rAll(page, isSubRow);
  assert.equal(rows.length, 3);
  for (const r of rows) {
    const id = r.dataset.key.replace(/^sub-/, '');
    const name = s.data.projects.find((x) => x.id === id).name;
    const g = rFind(r, (n) => n.dataset && n.dataset.key === 'grip-' + id);
    assert.ok(g, 'a grip on ' + name);
    assert.equal(g.nodeName, 'BUTTON', 'a button, so the keyboard can reach it');
    assert.equal(g.getAttribute('aria-label'), `Drag to move ${name}`);
    assert.equal(g.textContent, '⋮⋮');
    assert.ok(g.__on.pointerdown && g.__on.keydown, 'drag and keys wired');
    assert.equal(r.childNodes[0].childNodes[0], g, 'the grip is on the left (first cell)');
    assert.ok(!rAll(r, (n) => n.nodeName === 'BUTTON' && (n.textContent === '▲' || n.textContent === '▼')).length, 'no ▲ ▼');
    assert.ok(rAll(r, (n) => n.nodeName === 'BUTTON' && /sub-remove/.test(n.className || '')).length, '✕ (take out of project) stays'); // (owner asked 24 Oct: a quiet ✕, was "✕ Remove")
  }
  assert.ok(!rAll(page, (n) => n.dataset && /^mv-(up|down)-/.test(n.dataset.key || '')).length, 'no old ▲ ▼ keys anywhere');
});

test('📂 project page: dragging a task by its grip moves it (one setTaskOrder with the full new order, saved); a blue line shows where it lands; Copy list follows that order', async () => {
  const s = threeTasks();
  const ctx = liveCtx(s, { selected: 'm', update: {} });
  let page = renderDetail(ctx);
  let renders = 0;
  ctx.render = () => { renders++; page = renderDetail(ctx); };
  const before = rowIds(page);
  withDocListeners((docL) => {
    const { rows, grip } = dragKit(page);
    const g = grip(0);
    g.__on.pointerdown(down(20), g);
    assert.ok(g.captured, 'the pointer is captured, so the drag keeps going outside the grip');
    assert.ok(docL.keydown, 'Escape is listened for while dragging');
    g.__l.pointermove({ clientY: 70 });
    assert.ok(/dragging/.test(rows[0].className), 'the dragged row looks lifted');
    assert.equal(rows[0].style.transform, 'translateY(50px)', 'and follows the pointer');
    assert.ok(/drop-line-above/.test(rows[2].className), 'the blue line: between the 2nd and 3rd rows');
    g.__l.pointermove({ clientY: 110 });
    assert.ok(!/drop-line/.test(rows[2].className.replace('drop-line-below', '')) && /drop-line-below/.test(rows[2].className), 'now below the last row');
    assert.equal(renders, 0, 'nothing is redrawn during the drag');
    assert.equal(ctx.calls.length, 0, 'nothing saved during the drag');
    g.__l.pointerup({ clientY: 110 });
    assert.ok(!/dragging|drop-line/.test(rows.map((r) => r.className).join(' ')), 'lift and line cleaned up');
    assert.equal(rows[0].style.transform, '');
    assert.ok(!g.__l.pointermove && !docL.keydown, 'listeners removed after the drop');
  });
  assert.deepEqual(ctx.calls, [['setTaskOrder', { projectId: 'm', order: [before[1], before[2], before[0]] }]], 'one save with the full new order');
  assert.equal(renders, 1, 'drawn once, on the drop');
  assert.deepEqual(rowIds(page), [before[1], before[2], before[0]], 'the first task is now last');
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../docs/ui/mains.js', import.meta.url), 'utf8'), /ctx\.copyList\(all\.filter\(/, 'Copy list uses the same order (the table\'s list: orderedTasks, tasks only)');
});

test('📂 project page: a drag dropped in the same place, a tiny wobble, Escape, or a cancelled touch saves nothing', () => {
  const s = threeTasks();
  const ctx = liveCtx(s, { selected: 'm', update: {} });
  let renders = 0;
  ctx.render = () => { renders++; };
  const page = renderDetail(ctx);
  withDocListeners((docL) => {
    const { rows, grip } = dragKit(page);
    let g = grip(1); // row 2 (middle 60): drop at 70 → still between rows 1 and 3
    g.__on.pointerdown(down(60), g); g.__l.pointermove({ clientY: 70 });
    assert.ok(!/drop-line/.test(rows.map((r) => r.className).join(' ')), 'no line where it already is');
    g.__l.pointerup({ clientY: 70 });
    g = grip(0); g.__on.pointerdown(down(20), g); g.__l.pointerup({ clientY: 22 }); // a tap / wobble
    g = grip(0); g.__on.pointerdown(down(20), g); g.__l.pointermove({ clientY: 110 });
    docL.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.ok(!/dragging|drop-line/.test(rows.map((r) => r.className).join(' ')), 'Escape puts the row back');
    assert.ok(!g.__l.pointerup, 'and ends the drag');
    g = grip(0); g.__on.pointerdown(down(20), g); g.__l.pointermove({ clientY: 110 }); g.__l.pointercancel({ clientY: 110 });
    g = grip(0); g.__on.pointerdown({ ...down(20), button: 2 }, g);
    assert.ok(!g.__l.pointermove, 'a right-click does not start a drag');
  });
  assert.equal(ctx.calls.length, 0, 'nothing dispatched');
  assert.equal(renders, 0);
});

test('📂 project page: on the grip, Alt+↓ / Alt+↑ (or plain ↓ ↑) move the task one place and the focus comes back to that task\'s grip', () => {
  const s = threeTasks();
  const ctx = liveCtx(s, { selected: 'm', update: {} });
  let page = renderDetail(ctx);
  ctx.render = () => { page = renderDetail(ctx); };
  const focused = [];
  const saved = document.querySelector;
  document.querySelector = (sel) => {
    const m = /data-key="([^"]+)"/.exec(sel);
    const el = m && rFind(page, (n) => n.dataset && n.dataset.key === m[1]);
    if (el) el.focus = () => focused.push(m[1]);
    return el || null;
  };
  const key = (id, k, alt) => {
    let stopped = false; let prevented = false;
    rFind(page, (n) => n.dataset && n.dataset.key === 'grip-' + id).__on.keydown({ key: k, altKey: !!alt, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    return { stopped, prevented };
  };
  try {
    const [a, b, c] = rowIds(page);
    const k = key(a, 'ArrowDown', true);
    assert.deepEqual(rowIds(page), [b, a, c], 'Alt+↓ moved it one place down');
    assert.deepEqual(focused, ['grip-' + a], 'focus back on the same task\'s grip');
    assert.ok(k.prevented && k.stopped, 'the page does not scroll and the list\'s own ↑ ↓ does not also run');
    key(a, 'ArrowDown');
    assert.deepEqual(rowIds(page), [b, c, a], 'plain ↓ too');
    key(a, 'ArrowUp', true);
    assert.deepEqual(rowIds(page), [b, a, c], 'Alt+↑ back up');
    assert.equal(focused.at(-1), 'grip-' + a);
    const n = ctx.calls.length;
    key(b, 'ArrowUp');
    assert.equal(ctx.calls.length, n, 'the first cannot go up: nothing saved');
    key(b, 'Enter');
    assert.equal(ctx.calls.length, n, 'other keys do nothing');
    assert.ok(ctx.calls.every(([t]) => t === 'setTaskOrder'));
  } finally { document.querySelector = saved; }
});

test('📂 project page: the grip is always visible, does not scroll the phone while dragging (touch-action: none), and the blue line / lifted row are CSS classes', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.sub-grip \{[^}]*touch-action: none;/);
  assert.match(css, /\.sub-row\.drop-line-above > td \{[^}]*#1976d2/);
  assert.match(css, /\.sub-row\.drop-line-below > td \{[^}]*#1976d2/);
  assert.match(css, /\.sub-row\.dragging \{[^}]*box-shadow/);
  assert.ok(!/\.sub-move/.test(css), 'old ▲ ▼ styles gone');
  assert.match(css, /\.sub-table th:nth-child\(5\), \.sub-table td:nth-child\(5\) \{ display: none; \}/, 'on a phone the Last update column (now 5th, after the grip) is hidden');
  const dom = readFileSync(new URL('../docs/ui/dom.js', import.meta.url), 'utf8');
  assert.match(dom, /const EVENTS = \[[^\]]*'pointerdown'/, 'pointerdown reaches the grip in the real page');
});

test('📂 project page: a finished task shows green (green dot, green name, "✓ finished"), its Now cell calm grey', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../docs/ui/mains.js', import.meta.url), 'utf8');
  assert.match(src, /class: 'sub-row' \+ \(done \? ' sub-done' : ''\)/);
  assert.match(src, /dot \$\{done \? 'green' : dotColour\(c, today\)\}/);
  assert.match(src, /done \? '✓ finished' : c\.state/);
  assert.match(src, /class: c\.state !== 'active' \? 'muted' : ns \? '' : 'warn'/);
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.sub-done \.sub-name \{ color: #2e7d32; \}/);
});

// ---------- Rich "What happened today?" box (owner asked, 22 Oct) ----------
const { TABLE_HTML } = await import('../docs/rich.js');
const richedit = await import('../docs/ui/richedit.js');
const { diaryEntries, summaryText, projectMatches } = await import('../docs/reports.js');

/** A pretend rich box: its HTML is what the test says; it records what is added to it. */
function fakeEditor(html = '') {
  const el = new Node('div');
  el.innerHTML = html;
  el.focus = () => {};
  return el;
}
/** Run `fn` with the page's rich box (data-key) found, and browser editing commands recorded. */
async function withEditor(editors, fn, { focused = null } = {}) {
  const cmds = [];
  const saved = { qs: document.querySelector, ex: document.execCommand, ae: document.activeElement };
  document.querySelector = (sel) => { const m = /data-key="([^"]+)"/.exec(sel); return m ? editors[m[1]] || null : null; };
  document.execCommand = (cmd, ui, value) => { cmds.push([cmd, value]); return true; };
  document.activeElement = focused;
  try { await fn(cmds); } finally { document.querySelector = saved.qs; document.execCommand = saved.ex; document.activeElement = saved.ae; }
}
const keyOf = (n) => n.dataset && n.dataset.key;
const ev = (x = {}) => { const e = { preventDefault() { e.prevented = true; }, prevented: false, ...x }; return e; };
const clip = ({ html = '', text = '', files = [] }) => ({ files, getData: (t) => (t === 'text/html' ? html : t === 'text/plain' ? text : '') });

test('rich box: pasting an update copied from another task brings its photo along (same picture, new id here); a photo found nowhere is left out with a note', async () => {
  const s = sampleState();
  applyOps(s, [
    makeOp('createProject', { projectId: 'pB', name: 'Glaze' }),
    makeOp('addFile', { projectId: 'p1', fileId: 'fA', name: 'kiln.jpg', sha: 'shaA', size: 9, type: 'image/jpeg' }),
    makeOp('addFile', { projectId: 'pB', fileId: 'fB', name: 'own.jpg', sha: 'shaB', size: 9, type: 'image/jpeg' }),
  ]);
  const toasts = [];
  const ctx = { ...fakeCtx(s), toast: (t) => toasts.push(t) };
  const d = {};
  const ed = fakeEditor('');
  const e = ev({ clipboardData: clip({ html: '<p>Fired<img data-file="fA"><img data-file="fB"><img data-file="lost"></p>', text: 'Fired' }) });
  await withEditor({}, () => { richedit.pasteRich(ctx, d, e, ed, 'wn-pB', null, null, s.data.projects.find((p) => p.id === 'pB').files); });
  assert.equal(d.photos.length, 1, 'one photo brought along');
  const ph = d.photos[0];
  assert.notEqual(ph.fileId, 'fA', 'its own id in this task');
  assert.deepEqual([ph.sha, ph.name, ph.inline], ['shaA', 'kiln.jpg', true], 'the same saved picture');
  const ids = rAll(ed, (n) => n.nodeName === 'IMG').map((n) => n.getAttribute('data-file'));
  assert.deepEqual(ids, [ph.fileId, 'fB'], 'the box points at the copy and keeps this task\'s own photo; the lost one is gone');
  assert.ok(toasts.some((t) => t.includes('1 copied photo could not come along')), toasts.join());
  const r = richedit.readDraft(d, { innerHTML: `<p>Fired<img data-file="${ph.fileId}"><img data-file="fB"></p>` });
  assert.deepEqual(r.photos.map((x) => x.fileId), [ph.fileId], 'saved as a photo of this task (addFile)');
  assert.deepEqual(Object.keys(richedit.photoArgs(ph)).sort(), ['fileId', 'name', 'sha', 'size', 'type']);
});

test('rich update box: toolbar B · I · • List · 1. List · ⊞ Table · 📷 Photo · 🔗 Link over a contenteditable box (kept on redraw)', async () => {
  const s = sampleState();
  const ctx = fakeCtx(s, { selected: 'p1', update: {} });
  const el = renderDetail(ctx);
  const tools = rFind(el, (n) => n.className === 'rich-tools');
  assert.ok(tools, 'toolbar');
  for (const label of ['B', 'I', '• List', '1. List', '⊞ Table', '📷 Photo', '🔗 Link']) assert.ok(rFind(tools, (n) => (n.nodeName === 'BUTTON' || n.nodeName === 'LABEL') && n.textContent.startsWith(label)), label);
  const box = rFind(el, (n) => keyOf(n) === 'wn-p1');
  assert.equal(box.getAttribute('contenteditable'), 'true');
  assert.equal(box.className, 'rich-edit');
  assert.ok(!rFind(el, (n) => n.nodeName === 'INPUT' && n.getAttribute('name') === 'note'), 'the old one-line box is gone');
  const ed = fakeEditor();
  await withEditor({ 'wn-p1': ed }, (cmds) => {
    rFind(tools, (n) => n.nodeName === 'BUTTON' && n.textContent === '⊞ Table').__on.click();
    rFind(tools, (n) => n.nodeName === 'BUTTON' && n.textContent === 'B').__on.click();
    rFind(tools, (n) => n.nodeName === 'BUTTON' && n.textContent === '• List').__on.click();
    assert.deepEqual(cmds, [['insertHTML', TABLE_HTML], ['bold', null], ['insertUnorderedList', null]]);
    assert.ok(TABLE_HTML.match(/<td>/g).length === 9, 'a 3 × 3 table');
  });
  // the page is drawn again while typing: the box keeps what is in it (morph leaves a contenteditable alone)
  const { morph } = await import('../docs/ui/dom.js');
  const live = renderDetail(ctx);
  const liveBox = rFind(live, (n) => keyOf(n) === 'wn-p1');
  liveBox.childNodes.push({ nodeType: 3, nodeValue: 'typed' });
  const domSrc = readFileSync(new URL('../docs/ui/dom.js', import.meta.url), 'utf8');
  assert.match(domSrc, /getAttribute\('contenteditable'\) === 'true'\) return;/, 'morph does not touch what is typed in a rich box');
  assert.ok(typeof morph === 'function');
});

test('rich update box: pasting HTML (Excel/Outlook/web) keeps the table, cleaned; plain text stays plain', async () => {
  const s = sampleState();
  const ctx = fakeCtx(s, { selected: 'p1', update: {} });
  const box = rFind(renderDetail(ctx), (n) => keyOf(n) === 'wn-p1');
  const ed = fakeEditor();
  await withEditor({ 'wn-p1': ed }, (cmds) => {
    const e = ev({ clipboardData: clip({ html: '<style>td{x}</style><table style="a"><tr><td class=x onclick=y><b>Clay</b></td><td>20</td></tr></table><script>z</script>', text: 'Clay\t20', files: [new File(['x'], 'image.png', { type: 'image/png' })] }) });
    box.__on.paste(e, ed);
    assert.ok(e.prevented);
    assert.deepEqual(cmds, [['insertHTML', '<table><tr><td><b>Clay</b></td><td>20</td></tr></table>']], 'the cells win over Excel\'s picture of them');
    cmds.length = 0;
    box.__on.paste(ev({ clipboardData: clip({ text: 'just <b>words</b>' }) }), ed);
    assert.deepEqual(cmds, [['insertText', 'just <b>words</b>']], 'plain words are pasted as words');
  }, { focused: ed });
});

test('rich update box: a pasted screenshot is uploaded as a photo, shown inside the box, and saved as <img data-file> + addFile', async () => {
  const s = sampleState();
  const ui = { selected: 'p1', update: {} };
  const ctx = fakeCtx(s, ui);
  const steps = [];
  ctx.actMany = (pid, st) => { steps.push(...st); return { undo: null }; };
  ctx.store.repo = { createBlobBase64: async () => 'sha-shot' };
  const box = rFind(renderDetail(ctx), (n) => keyOf(n) === 'wn-p1');
  const ed = fakeEditor('<p>Kiln hot</p>');
  await withEditor({ 'wn-p1': ed }, async () => {
    const e = ev({ clipboardData: clip({ files: [new File(['png-bytes'], 'image.png', { type: 'image/png' })] }) });
    box.__on.paste(e, ed);
    assert.ok(e.prevented);
    await new Promise((r) => setTimeout(r, 30));
    const ph = ui.update.p1.photos[0];
    assert.ok(ph && ph.sha === 'sha-shot' && ph.inline, 'uploaded');
    assert.match(ph.name, /^pasted-.*\.png$/, 'a clear name, not image.png');
    const img = rFind(ed, (n) => n.nodeName === 'IMG');
    assert.equal(img.getAttribute('data-file'), ph.fileId, 'shown inside the box');
    assert.ok(!rFind(renderDetail(ctx), (n) => n.className === 'tag photo' && n.textContent.includes('pasted-')), 'no extra chip for a photo shown inside');
    ed.innerHTML = `<p>Kiln hot</p><img data-file="${ph.fileId}" class="rich-photo" src="blob:http://x/1">`;
    const form = rFind(renderDetail(ctx), (n) => n.nodeName === 'FORM' && n.className.includes('update-form'));
    form.__on.submit(ev());
    const add = steps.find((x) => x[0] === 'addWorkNote')[1];
    assert.equal(add.text, 'Kiln hot');
    assert.equal(add.html, `<p>Kiln hot</p><img data-file="${ph.fileId}">`, 'only a reference to the photo; no picture data in the note');
    const file = steps.find((x) => x[0] === 'addFile')[1];
    assert.equal(file.fileId, ph.fileId);
    assert.equal(file.noteId, add.noteId);
    assert.ok(!('preview' in file) && !('inline' in file));
    assert.equal(ui.update.p1.photos.length, 0, 'the box is empty again');
  });
});

test('rich update box: Enter saves a quick note; Shift+Enter / in a table / rich content = new line; Ctrl/⌘+Enter saves', async () => {
  const s = sampleState();
  const ctx = fakeCtx(s, { selected: 'p1', update: {} });
  const saves = [];
  ctx.actMany = (pid, st) => { saves.push(st); return { undo: null }; };
  const box = () => rFind(renderDetail(ctx), (n) => keyOf(n) === 'wn-p1');
  const press = (x, ed) => { const e = ev({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, ...x }); box().__on.keydown(e, ed); return e; };
  await withEditor({}, () => {
    let ed = fakeEditor('Kiln checked');
    assert.ok(press({}, ed).prevented);
    assert.equal(saves.pop()[0][1].text, 'Kiln checked', 'Enter = Save');
    assert.ok(!press({ shiftKey: true }, fakeEditor('a')).prevented, 'Shift+Enter = new line');
    assert.equal(saves.length, 0);
    ed = fakeEditor('<table><tr><td>a</td></tr></table>');
    assert.ok(!press({}, ed).prevented, 'rich content: Enter = new line');
    globalThis.getSelection = () => ({ anchorNode: { nodeName: 'TD', parentNode: ed } });
    try { assert.ok(!press({}, fakeEditor('x')).prevented, 'in a table cell: Enter = new line'); } finally { delete globalThis.getSelection; }
    assert.equal(saves.length, 0);
    assert.ok(press({ ctrlKey: true }, ed).prevented);
    const st = saves.pop();
    assert.equal(st[0][1].html, '<table><tr><td>a</td></tr></table>', 'Ctrl+Enter saves the table');
    assert.ok(!st.some((x) => x[0] === 'tickStep'), 'rich: Ctrl+Enter is Save, not Save + done');
    press({ metaKey: true }, fakeEditor('done it'));
    assert.ok(saves.pop().some((x) => x[0] === 'tickStep'), 'a quick note: ⌘+Enter = Save + done, as before');
  });
});

test('a saved rich update shows its table and photo thumbnail in What\'s happening, Work notes and the Diary; emails, search and summaries use the plain words', async () => {
  const s = sampleState();
  applyOps(s, [
    makeOp('addWorkNote', { projectId: 'p1', noteId: 'rn', text: 'x', html: '<p>Trial <b>2</b></p><table><tr><td>Clay</td><td>Kaolin</td></tr></table><img data-file="f1">' }),
    makeOp('addFile', { projectId: 'p1', fileId: 'f1', name: 'shot.png', sha: 'sha1', size: 9, type: 'image/png', noteId: 'rn' }),
    makeOp('addFile', { projectId: 'p1', fileId: 'f2', name: 'extra.png', sha: 'sha2', size: 9, type: 'image/png', noteId: 'rn' }),
  ]);
  const el = renderDetail(fakeCtx(s, { selected: 'p1', update: {}, showMore: true, openParts: {} }));
  const diary = rFind(el, (n) => (n.className || '').includes('block diary'));
  const note = rFind(diary, (n) => n.className === 'rich-note');
  assert.ok(note, 'drawn as a rich note');
  assert.ok(rFind(note, (n) => n.nodeName === 'TABLE') && rFind(note, (n) => n.nodeName === 'B'), 'table and bold');
  const thumb = rFind(note, (n) => n.getAttribute && n.getAttribute('data-file') === 'f1');
  assert.ok(thumb && thumb.textContent.includes('shot.png') && thumb.__on.click, 'the photo inside it opens the viewer');
  assert.ok(diary.textContent.includes('📷 extra.png') && !diary.textContent.includes(' 📷 shot.png'), 'a photo not inside is listed once; the inside one not twice');
  const log = rAll(el, (n) => n.className === 'note-rich');
  assert.equal(log.length, 1, 'Work notes list shows it rich too');
  assert.ok(rFind(log[0], (n) => n.nodeName === 'TABLE'));
  assert.ok(!rAll(el, (n) => n.nodeName === 'SCRIPT' || (n.attributes || []).some((a) => a.name === 'style' || a.name.startsWith('on'))).length, 'nothing that could run, no style attributes');
  const d = diaryEntries(s.data, s.history);
  const entry = [...d.values()].flat().find((x) => x.html);
  assert.ok(entry.text.includes('Clay | Kaolin'), 'Diary keeps the words too');
  assert.ok(projectMatches(s.data.projects[0], 'kaolin'), 'search finds words inside a table');
  assert.ok(summaryText(s.data, s.history, todayIndiaNow(), 'today').includes('Clay | Kaolin'), 'summaries use plain words');
  assert.ok(!summaryText(s.data, s.history, todayIndiaNow(), 'today').includes('<table'));
});

test('✎ on a rich update opens it in the write box; Save changes it (editWorkNote with html)', async () => {
  const s = sampleState();
  applyOps(s, [makeOp('addWorkNote', { projectId: 'p1', noteId: 'rn', text: 'x', html: '<ul><li>one</li></ul>' })]);
  const ui = { selected: 'p1', update: {} };
  const ctx = fakeCtx(s, ui);
  const steps = [];
  ctx.actMany = (pid, st) => { steps.push(...st); return { undo: null }; };
  const ed = fakeEditor();
  await withEditor({ 'wn-p1': ed }, async () => {
    const diary = rFind(renderDetail(ctx), (n) => (n.className || '').includes('block diary'));
    rFind(diary, (n) => n.nodeName === 'BUTTON' && n.textContent === ' ✎' && n.parentNode && rFind(n.parentNode, (x) => x.className === 'rich-note')).__on.click();
    assert.equal(ui.update.p1.editing, 'rn');
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(rFind(ed, (n) => n.nodeName === 'LI' && n.textContent === 'one'), 'the box is filled with the saved update');
    const page = renderDetail(ctx);
    assert.ok(page.textContent.includes('✎ Changing your update'), 'says it is changing an update');
    assert.ok(!page.textContent.includes('Save + done'));
    ed.innerHTML = '<ul><li>one</li><li>two</li></ul>';
    rFind(page, (n) => n.nodeName === 'FORM' && n.className.includes('update-form')).__on.submit(ev());
    assert.deepEqual(steps[0], ['editWorkNote', { projectId: 'p1', noteId: 'rn', text: '• one\n• two', html: '<ul><li>one</li><li>two</li></ul>' }]);
    assert.equal(ui.update.p1.editing, null);
  });
});

test('"+ New task here" (📂 project) and "+ New task": a box with a name and the rich area (no prompt); a pasted screenshot lands in the new task\'s first update', async () => {
  const s = mainsState();
  const ui = { selected: 'm', update: {} };
  const ctx = liveCtx(s, ui);
  ctx.store.repo = { createBlobBase64: async () => 'sha-new' };
  globalThis.prompt = () => { throw new Error('no prompt'); };
  try { btn(renderDetail(ctx), '+ New task here').__on.click(); } finally { delete globalThis.prompt; }
  let page = renderDetail(ctx);
  const boxForm = rFind(page, (n) => n.className === 'new-task-box');
  assert.ok(boxForm && boxForm.textContent.includes('New task in 📂 Kilns'));
  assert.ok(rFind(boxForm, (n) => n.className === 'rich-tools' && n.textContent.includes('📷 Photo')), 'the same toolbar and 📷 Photo');
  const area = rFind(boxForm, (n) => keyOf(n) === 'newhere-m-rich');
  assert.equal(area.getAttribute('contenteditable'), 'true');
  // Esc closes
  rFind(boxForm, (n) => n.nodeName === 'INPUT' && keyOf(n) === 'newhere-m-name').__on.keydown(ev({ key: 'Escape' }), { value: '' });
  assert.equal(ui.newHere, null);
  btn(renderDetail(ctx), '+ New task here').__on.click();
  page = renderDetail(ctx);
  const ed = fakeEditor('<table><tr><td>Size</td><td>600x600</td></tr></table>');
  await withEditor({ 'newhere-m-rich': ed }, async () => {
    rFind(page, (n) => keyOf(n) === 'newhere-m-rich').__on.paste(ev({ clipboardData: clip({ files: [new File(['b'], 'image.png', { type: 'image/png' })] }) }), ed);
    await new Promise((r) => setTimeout(r, 30));
    const d = ui.newTaskDraft['here-m'];
    const id = d.photos[0].fileId;
    ed.innerHTML += `<img data-file="${id}" src="blob:x">`;
    const name = rFind(renderDetail(ctx), (n) => n.nodeName === 'INPUT' && keyOf(n) === 'newhere-m-name');
    name.__on.input(null, { value: 'Tile trial' });
    name.__on.keydown(ev({ key: 'Enter' }), { value: 'Tile trial' });
    assert.ok(!s.data.projects.some((p) => p.name === 'Tile trial'), 'Enter in the name does not create while the notes have something (Create does)');
    rFind(renderDetail(ctx), (n) => n.className === 'new-task-box').__on.submit(ev());
    const made = s.data.projects.find((p) => p.name === 'Tile trial');
    assert.deepEqual(made.parentIds, ['m'], 'made inside the project');
    const note = made.workNotes[0];
    assert.equal(note.text, 'Size | 600x600');
    assert.equal(note.html, `<table><tr><td>Size</td><td>600x600</td></tr></table><img data-file="${id}">`);
    assert.deepEqual(made.files.map((f) => [f.id, f.sha, f.noteId]), [[id, 'sha-new', note.id]], 'the screenshot is the first update\'s photo');
    assert.equal(ui.newHere, null, 'closed');
  });
  // the normal "+ New task" form uses the same box (no prompt)
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const form = app.slice(app.indexOf('function newProjectForm()'), app.indexOf('function statusText()'));
  assert.match(form, /newTaskBox\(ctx, d, \{/);
  assert.match(form, /createTaskWithNote\(ctx, \{ name, d, editor \}\)/); // (groups are gone: no group box)
  assert.ok(!/name: 'group'/.test(form), 'no group box on + New task');
  assert.ok(!/prompt\(/.test(form));
  const mainsSrc = readFileSync(new URL('../docs/ui/mains.js', import.meta.url), 'utf8');
  assert.ok(!/prompt\(`New task in/.test(mainsSrc), 'no question box for a new task here');
});

test('new task box: Enter in the name creates the task when the notes are empty (no first update then)', async () => {
  const s = mainsState();
  const ctx = liveCtx(s, { selected: 'm', update: {} });
  const d = {};
  let made = null;
  const box = richedit.newTaskBox(ctx, d, { key: 'new', onCancel: () => {}, onCreate: (name, editor) => { made = richedit.createTaskWithNote(ctx, { name, d, editor }); } });
  await withEditor({ 'new-rich': fakeEditor('') }, () => {
    const name = rFind(box, (n) => n.nodeName === 'INPUT' && keyOf(n) === 'new-name');
    name.__on.input(null, { value: 'Glaze check' });
    name.__on.keydown(ev({ key: 'Enter' }), { value: 'Glaze check' });
  });
  const p = s.data.projects.find((x) => x.id === made);
  assert.equal(p.name, 'Glaze check');
  assert.equal(p.workNotes.length, 0, 'nothing written: no note');
  assert.deepEqual(p.parentIds || [], []);
});

// ---------------------------------------------------------------- 🔌 Connections (Settings) and 🔌 From apps
const cnx = await import('../docs/ui/connections.js');
const walk = (node, f, out = []) => { if (f(node)) out.push(node); for (const c of node.childNodes || []) walk(c, f, out); return out; };
const byText = (node, text, tag) => walk(node, (n) => n.nodeType === 1 && (!tag || n.nodeName === tag.toUpperCase()) && n.textContent.trim() === text)[0];
const flush = () => new Promise((r) => setTimeout(r, 0));
const KEY = 'wtc_' + '1a2b'.repeat(12);
const SECRET = 'wts_' + '9f8e'.repeat(12);
function appsCtx(answers) {
  const calls = []; const copied = []; const downloads = []; const toasts = []; const asked = [];
  return {
    calls, copied, downloads, toasts, asked,
    api: async (a, body) => { calls.push([a, body]); const r = answers[a]; if (r instanceof Error) throw r; return typeof r === 'function' ? r(body) : r; },
    toast: (m) => toasts.push(m), render: () => {}, base: 'https://worktask.in/api/',
    copy: (text, what) => copied.push([what, text]), download: (name, text) => downloads.push([name, text]), confirm: (q) => { asked.push(q); return true; },
  };
}
const conn = (more = {}) => ({ id: 1, name: 'Purchase', keyEnd: 'ab12', active: true, callbackUrl: 'https://erp.example/hook', createdAt: '2026-10-20 09:00:00', lastSeenAt: null, lastError: '', pending: 2, ...more });

test('🔌 Settings → Connections: the list (name, On, last seen, waiting, the error in plain words, Rotate key / Delete) and + New connection', async () => {
  cnx.resetConnections();
  const seen = new Date(Date.now() - 5 * 60000);
  const c = appsCtx({ 'conn.list': { connections: [conn({ lastSeenAt: seen.toISOString(), lastError: 'Could not tell the app about “PO 1”: its decision address said error 500. Trying again by itself.' }), conn({ id: 2, name: 'Forms', active: false, callbackUrl: '', pending: 0 })] } });
  assert.match(cnx.renderConnectionsSettings(c).textContent, /🔌 Connections[^]*Loading…/);
  await flush();
  const el = cnx.renderConnectionsSettings(c);
  const text = el.textContent;
  assert.deepEqual(c.calls.map((x) => x[0]), ['conn.list'], 'asked once');
  for (const bit of ['Purchase', ' · key …ab12', ' On', `last seen ${cnx.whenText(seen.toISOString())}`, '2 waiting for you', 'decisions go to https://erp.example/hook',
    '⚠ Could not tell the app about “PO 1”: its decision address said error 500. Trying again by itself.', 'Forms', 'Off (the app is refused)', 'nothing waiting',
    'no decision address (the app asks for decisions)', 'Rotate key', 'Delete', '+ New connection']) assert.ok(text.includes(bit), bit);
  assert.match(cnx.whenText('2026-10-21 10:42:00', '2026-10-22'), /^21 Oct 10:42/i, 'another day: the date and time (India time)');
  // the On box switches the app off
  const box = walk(el, (n) => n.nodeName === 'INPUT' && n.getAttribute('aria-label') === 'Purchase on')[0];
  c.api = async (a, body) => { c.calls.push([a, body]); return { connection: conn({ active: body.active }) }; };
  await box.__on.change(null, { checked: false });
  assert.deepEqual(c.calls.at(-1), ['conn.update', { id: 1, active: false }]);
  // Delete asks first
  const row = walk(cnx.renderConnectionsSettings(c), (n) => n.nodeName === 'LI' && n.textContent.startsWith('Purchase'))[0];
  await byText(row, 'Delete', 'button').__on.click();
  assert.match(c.asked[0], /Delete the connection "Purchase"\?[^]*approvals here are deleted too/);
  assert.deepEqual(c.calls.at(-1), ['conn.delete', { id: 1 }]);
  assert.ok(!cnx.renderConnectionsSettings(c).textContent.includes('Purchase'), 'gone from the list');
});

test('🔌 New connection → the one-time box "Give these to … — shown only now": Address / Key / Signing secret each with 📋 Copy, ⬇ Download PHP connector (filled in), the guide, the warning; closing it forgets the key', async () => {
  cnx.resetConnections();
  installStorage();
  const c = appsCtx({ 'conn.list': { connections: [] }, 'conn.create': (b) => ({ connection: conn({ id: 7, name: b.name, callbackUrl: b.callback_url, pending: 0 }), key: KEY, secret: SECRET }) });
  cnx.renderConnectionsSettings(c);
  await flush();
  let el = cnx.renderConnectionsSettings(c);
  assert.ok(el.textContent.includes('No connections yet.'));
  byText(el, '+ New connection', 'button').__on.click();
  el = cnx.renderConnectionsSettings(c);
  assert.ok(el.textContent.includes('Decision address (callback URL) — optional'));
  const [name, url] = walk(el, (n) => n.nodeName === 'INPUT');
  name.__on.input(null, { value: 'Purchase app' });
  url.__on.input(null, { value: ' https://erp.example/hook ' });
  await walk(el, (n) => n.nodeName === 'FORM')[0].__on.submit({ preventDefault() {} });
  assert.deepEqual(c.calls.at(-1), ['conn.create', { name: 'Purchase app', callback_url: 'https://erp.example/hook' }]);
  el = cnx.renderConnectionsSettings(c);
  const text = el.textContent;
  assert.ok(text.includes('Give these to Purchase app — shown only now'));
  for (const v of ['https://worktask.in/api/?a=connect.push', KEY, SECRET, 'Keep the key secret. Rotate it if it leaks.', '⬇ Download PHP connector', 'How to connect']) assert.ok(text.includes(v), v);
  const copies = walk(el, (n) => n.nodeName === 'BUTTON' && n.textContent === '📋 Copy');
  assert.equal(copies.length, 3, 'a Copy button for each value');
  copies.forEach((b) => b.__on.click());
  assert.deepEqual(c.copied, [['Address', 'https://worktask.in/api/?a=connect.push'], ['Key', KEY], ['Signing secret', SECRET]]);
  byText(el, '📋 Copy guide', 'button').__on.click();
  const guide = c.copied.at(-1)[1];
  for (const v of ['"external_id"', '"kind"', 'Authorization: Bearer ' + KEY, "curl -X POST 'https://worktask.in/api/?a=connect.push'", 'X-WorkTask-Signature: sha256=', 'HMAC-SHA256(signing secret, timestamp + "." + body)', 'within 5 minutes', '?a=connect.decisions', '?a=connect.withdraw']) assert.ok(guide.includes(v), v);
  assert.ok(!guide.includes(SECRET), 'the guide never holds the secret');
  byText(el, '⬇ Download PHP connector', 'button').__on.click();
  const [[file, php]] = c.downloads;
  assert.equal(file, 'worktask-connector.php');
  assert.ok(php.includes("const WT_ADDRESS = 'https://worktask.in/api/';") && php.includes(`const WT_KEY = '${KEY}';`) && php.includes(`const WT_SECRET = '${SECRET}';`), 'the address, key and secret filled in');
  assert.ok(!php.includes('PASTE-YOUR-KEY-HERE'));
  // closed: the key and secret are gone (page, memory, this device's storage)
  byText(el, 'Done — I gave them to the app', 'button').__on.click();
  el = cnx.renderConnectionsSettings(c);
  assert.ok(!el.textContent.includes(KEY) && !el.textContent.includes(SECRET), 'not on the page');
  assert.equal(cnx.cx.once, null);
  assert.ok(!JSON.stringify({ ...cnx.cx, open: [], busy: [] }).includes(KEY), 'not kept in memory');
  assert.ok(!Object.values(localStorage).some((v) => String(v).includes(KEY) || String(v).includes(SECRET)), 'never saved on this device');
  assert.ok(el.textContent.includes('Purchase app'), 'the new connection is listed');
});

test('🔌 Rotate key asks first, then shows the new key once; a failed call says why', async () => {
  cnx.resetConnections();
  const c = appsCtx({ 'conn.list': { connections: [conn()] }, 'conn.rotate': { connection: conn({ keyEnd: 'cd34' }), key: KEY, secret: SECRET } });
  cnx.renderConnectionsSettings(c);
  await flush();
  await byText(cnx.renderConnectionsSettings(c), 'Rotate key', 'button').__on.click();
  assert.match(c.asked[0], /Make a new key for "Purchase"\?[^]*old key stops working at once/);
  assert.deepEqual(c.calls.at(-1), ['conn.rotate', { id: 1 }]);
  assert.ok(cnx.renderConnectionsSettings(c).textContent.includes('Give these to Purchase — shown only now'));
  cnx.forgetOnce();
  const bad = appsCtx({ 'conn.list': { connections: [] }, 'conn.create': new Error('The decision address must start with https:// (a safe address).') });
  cnx.resetConnections();
  cnx.renderConnectionsSettings(bad);
  await flush();
  cnx.cx.form = { name: 'X', url: 'http://x' };
  await walk(cnx.renderConnectionsSettings(bad), (n) => n.nodeName === 'FORM')[0].__on.submit({ preventDefault() {} });
  await flush();
  assert.deepEqual(bad.toasts, ['The decision address must start with https:// (a safe address).']);
  assert.equal(cnx.cx.once, null);
});

const appItem = (more = {}) => ({ id: 1, connId: 1, app: 'Purchase', externalId: 'PO-1', kind: 'approval', title: 'Approve PO 1', details: '', link: '', fields: [], status: 'pending', reason: '', decidedAt: null, createdAt: '2026-10-22 10:00:00', updatedAt: '2026-10-22 10:00:00', delivery: null, ...more });

test('🔌 From apps: waiting approvals grouped by app (newest first) with the fields table, short details (More ▾), Open ↗, ✓ Approve / ✕ Reject (an in-page reason box, never prompt()); Decided (N) folded with the status and whether the app was told', async () => {
  cnx.resetConnections();
  const items = [
    appItem({ id: 5, app: 'Forms', title: 'Leave for Ravi', createdAt: '2026-10-22 11:00:00', updatedAt: '2026-10-22 11:00:00' }),
    appItem({ id: 4, title: 'Approve PO 1002', fields: [['Amount', '12,500'], ['Vendor', 'ABC Minerals']], details: 'x'.repeat(250), link: 'https://erp.example/po/1002' }),
    appItem({ id: 3, title: 'Approve PO 1001' }),
    appItem({ id: 2, title: 'Approve PO 900', status: 'approved', decidedAt: '2026-10-21 09:00:00', delivery: 'sent' }),
    appItem({ id: 1, title: 'Approve PO 800', status: 'rejected', reason: 'Too costly', decidedAt: '2026-10-21 08:00:00', delivery: 'waiting' }),
    appItem({ id: 9, title: 'Approve PO 700', status: 'withdrawn' }),
  ];
  const c = appsCtx({ 'conn.items': { items }, 'conn.decide': (b) => ({ item: { ...items.find((i) => i.id === b.id), status: b.decision, reason: b.reason, delivery: 'sent' } }) });
  assert.match(cnx.renderFromApps(c).textContent, /Loading…/);
  await flush();
  assert.equal(cnx.appsPending(), 3, 'the menu count: waiting ones');
  let el = cnx.renderFromApps(c);
  const groups = walk(el, (n) => n.nodeName === 'SECTION');
  assert.deepEqual(groups.map((g) => g.childNodes[0].textContent), ['Forms (1)', 'Purchase (2)'], 'grouped by app, the newest first');
  assert.deepEqual(walk(groups[1], (n) => n.nodeName === 'STRONG').map((s) => s.textContent), ['Approve PO 1002', 'Approve PO 1001'], 'newest first in a group');
  const card = walk(el, (n) => n.nodeName === 'ARTICLE' && n.textContent.includes('PO 1002'))[0];
  assert.deepEqual(walk(card, (n) => n.nodeName === 'TR').map((r) => [r.childNodes[0].textContent, r.childNodes[1].textContent]), [['Amount', '12,500'], ['Vendor', 'ABC Minerals']], 'the fields as a small table');
  assert.ok(card.textContent.includes('x'.repeat(200) + '…') && !card.textContent.includes('x'.repeat(201)), 'details cut short');
  byText(card, 'More ▾', 'button').__on.click();
  assert.ok(cnx.renderFromApps(c).textContent.includes('x'.repeat(250)), 'More ▾ shows all');
  const open = walk(card, (n) => n.nodeName === 'A')[0];
  assert.deepEqual([open.textContent, open.getAttribute('href'), open.getAttribute('target'), open.getAttribute('rel')], ['Open ↗', 'https://erp.example/po/1002', '_blank', 'noopener noreferrer']);
  // ✓ Approve
  await byText(walk(cnx.renderFromApps(c), (n) => n.nodeName === 'ARTICLE' && n.textContent.includes('PO 1001'))[0], '✓ Approve', 'button').__on.click();
  assert.deepEqual(c.calls.at(-1), ['conn.decide', { id: 3, decision: 'approved', reason: '' }]);
  assert.match(c.toasts.at(-1), /✓ Approved: Approve PO 1001 — the app was told ✓/);
  assert.equal(cnx.appsPending(), 2);
  // ✕ Reject: a reason box on the page
  el = cnx.renderFromApps(c);
  byText(walk(el, (n) => n.nodeName === 'ARTICLE' && n.textContent.includes('PO 1002'))[0], '✕ Reject', 'button').__on.click();
  el = cnx.renderFromApps(c);
  const rej = walk(el, (n) => n.nodeName === 'DIV' && n.className === 'reject-box')[0];
  assert.ok(rej.textContent.includes('Why? (optional — the app is told)'));
  walk(rej, (n) => n.nodeName === 'TEXTAREA')[0].__on.input(null, { value: 'Price too high' });
  await byText(rej, '✕ Reject', 'button').__on.click();
  assert.deepEqual(c.calls.at(-1), ['conn.decide', { id: 4, decision: 'rejected', reason: 'Price too high' }]);
  assert.equal(cnx.cx.rejecting, null, 'the box closes');
  // Decided (N), folded
  el = cnx.renderFromApps(c);
  const fold = walk(el, (n) => n.nodeName === 'BUTTON' && /Decided \(\d+\)/.test(n.textContent))[0];
  assert.equal(fold.textContent, '▸ Decided (5)');
  assert.ok(!el.textContent.includes('Approve PO 800'), 'folded away');
  fold.__on.click();
  const dtext = cnx.renderFromApps(c).textContent;
  for (const bit of ['✓ Approved', 'Approve PO 900', '✓ sent to app', '✕ Rejected', 'Approve PO 800', 'waiting to send', '“Too costly”', 'Withdrawn by the app']) assert.ok(dtext.includes(bit), bit);
  const src = (await import('node:fs')).readFileSync(new URL('../docs/ui/connections.js', import.meta.url), 'utf8');
  assert.ok(!/\bprompt\(/.test(src), 'no prompt() boxes');
  cnx.resetConnections();
  const empty = appsCtx({ 'conn.items': { items: [] } });
  cnx.renderFromApps(empty);
  await flush();
  assert.ok(cnx.renderFromApps(empty).textContent.includes('Nothing waiting for you ✓'));
});

test('🔌 From apps: ✓ Approve sends the version of the words on the screen; refused (the app changed them) → the list is loaded again to show the new words', async () => {
  cnx.resetConnections();
  let items = [appItem({ id: 7, title: 'Approve PO 1001', fields: [['Amount', '12,500']], version: 'v-old' })];
  const changed = new Error('The app changed this since you opened it. Look at it again, then decide.');
  const c = appsCtx({ 'conn.items': () => ({ items }), 'conn.decide': changed });
  cnx.renderFromApps(c);
  await flush();
  items = [appItem({ id: 7, title: 'Approve PO 1001', fields: [['Amount', '125,000']], version: 'v-new' })];
  await byText(walk(cnx.renderFromApps(c), (n) => n.nodeName === 'ARTICLE')[0], '✓ Approve', 'button').__on.click();
  assert.deepEqual(c.calls.find((x) => x[0] === 'conn.decide'), ['conn.decide', { id: 7, decision: 'approved', reason: '', version: 'v-old' }]);
  assert.match(c.toasts.at(-1), /changed this since you opened it/);
  await flush();
  assert.equal(c.calls.filter((x) => x[0] === 'conn.items').length, 2, 'loaded again');
  assert.ok(cnx.renderFromApps(c).textContent.includes('125,000'), 'the new amount is shown');
  assert.equal(cnx.appsPending(), 1, 'still waiting');
});

test('🔌 app wiring (app.js): "🔌 From apps" after ✉ Replies with the waiting count (worktask.in only), its page, the Settings section, #apps from a phone alert, the key forgotten when leaving Settings; offline copy daily-projects-app-27', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(app, /item\('replies', '✉ Replies', readyCount\(data, today\)\),[^\n]*\n\s*onServer \? item\('apps', '🔌 From apps', appsPending\(\)\) : null,/, 'right after ✉ Replies, with the count');
  assert.match(app, /if \(ui\.view === 'apps' && !ui\.search\) return h\('div', \{ class: 'col-inner' \}, head, timerStrip\(\), onServer \? renderFromApps\(appsCtx\)/);
  assert.match(app, /onServer \? renderConnectionsSettings\(appsCtx\) : null,/);
  assert.match(app, /base: \(\) => new URL\('\.\.\/api\/', location\.href\)\.href/, 'the address apps use: this host\'s /api/');
  assert.match(app, /api: \(a, body\) => teamApi\(a, body\)/);
  assert.match(app, /if \(location\.hash === '#apps' && onServer\) \{ ui\.view = 'apps';/);
  assert.match(app, /function go\(view\) \{\n\s*if \(view !== 'settings'\) forgetOnce\(\);/);
  assert.match(app, /if \(onServer\) loadApps\(appsCtx, force \|\| ui\.view === 'apps'\);/);
  assert.match(app, /replies: '✉ Replies', apps: '🔌 From apps', mains: '📂 Projects' \}\[ui\.view\]/, 'its page title');
  assert.match(readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8'), /const CACHE = 'daily-projects-app-54'/, 'phones get the new copy');
});

test('🔌 the PHP connector (team/connector/worktask-connector.php): the same text the app downloads, placeholders only (no real key), valid PHP 7.4+ (php -l), with wt_push / wt_withdraw / wt_decisions / wt_receive_decision', async () => {
  const { readFileSync, writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const path = new URL('../team/connector/worktask-connector.php', import.meta.url);
  const tpl = readFileSync(path, 'utf8');
  assert.equal(cnx.CONNECTOR_TEMPLATE, tpl, 'docs/ui/connections.js carries the same text');
  assert.ok(!/wt[cs]_[0-9a-f]{20,}/.test(tpl), 'no real key or secret in the template');
  for (const p of ["const WT_ADDRESS = 'https://YOUR-WORK-TASK-ADDRESS/api/';", "const WT_KEY = 'PASTE-YOUR-KEY-HERE';", "const WT_SECRET = 'PASTE-YOUR-SIGNING-SECRET-HERE';"]) assert.ok(tpl.includes(p), p);
  for (const f of ['function wt_push(array $item)', 'function wt_withdraw(string $externalId)', 'function wt_decisions(string $since', 'function wt_receive_decision(callable $onDecision)', 'hash_equals(', 'CURLOPT_FOLLOWLOCATION => false']) assert.ok(tpl.includes(f), f);
  assert.match(tpl, /How to use it - 3 steps/);
  assert.ok(!/str_starts_with|str_contains|\bmatch\s*\(/.test(tpl), 'PHP 7.4: no PHP 8 functions');
  const built = cnx.buildConnector({ address: "https://worktask.in/api/", key: KEY, secret: "it's$1\\" });
  assert.ok(built.includes("const WT_SECRET = 'it\\'s$1\\\\';"), 'quotes, $ and \\ are kept safe');
  let php = false;
  try { execFileSync('which', ['php'], { stdio: 'ignore' }); php = true; } catch { /* no php here */ }
  if (!php) return;
  const tmp = mkdtempSync(join(tmpdir(), 'wt-conn-'));
  try {
    assert.match(execFileSync('php', ['-l', fileURLToPath(path)], { encoding: 'utf8' }), /No syntax errors/);
    writeFileSync(join(tmp, 'c.php'), built);
    assert.match(execFileSync('php', ['-l', join(tmp, 'c.php')], { encoding: 'utf8' }), /No syntax errors/);
    assert.equal(execFileSync('php', ['-r', 'require $argv[1]; echo WT_SECRET;', join(tmp, 'c.php')], { encoding: 'utf8' }), "it's$1\\");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('🔌 a task an app sent shows like any task: the "🔗 Open in <app>" chip, the description, and its note marked with the app\'s name (not "You")', () => {
  const s = sampleState();
  const at = new Date().toISOString();
  s.data.projects.unshift({
    id: 'ct1', name: 'Check kiln 3', priority: 'medium', deadline: null, notes: '', about: 'The top zone runs hot.',
    links: [{ id: 'ct1-link', title: 'Open in Purchase', url: 'https://erp.example/t/1' }], state: 'active', lastTickDate: null,
    lastActivityDate: at.slice(0, 10), activeSince: at.slice(0, 10), stateChangedAt: at, createdAt: at, updatedAt: at, steps: [], files: [], fromApp: 'Purchase',
    workNotes: [{ id: 'an1', text: 'Line: 3\nShift: B', stepId: null, createdAt: at, updatedAt: at, app: true }],
  });
  const el = renderDetail(fakeCtx(s, { selected: 'ct1', update: {} }));
  const text = el.textContent;
  assert.ok(text.includes('Open in Purchase'), 'the link chip');
  assert.equal(walk(el, (n) => String(n.className || '').includes('about-input'))[0].value, 'The top zone runs hot.', 'the description');
  assert.ok(text.includes('Purchase Line: 3'), 'the note says who wrote it: the app');
  assert.ok(!text.includes('You Line: 3'));
});

test('🔌 From apps: opening the page always loads the waiting approvals fresh (a new job never waits for the 1-minute refresh)', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const go = app.slice(app.indexOf('function go(view) {'), app.indexOf('function go(view) {') + 400);
  assert.match(go, /if \(view === 'apps' && onServer\) loadApps\(appsCtx, true\);/);
});

test('🔌 From apps: ✕ Reject puts the cursor straight into the reason box', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../docs/ui/connections.js', import.meta.url), 'utf8');
  assert.match(src, /cx\.rejecting = it\.id; cx\.reason = ''; ctx\.render\(\); focusReason\(it\.id\);/);
  assert.match(src, /key: 'rej-reason-' \+ it\.id/);
});

// ---------------------------------------------------------------- review round 12 (Daily Projects screens)
test('dashboard and the top bar\'s score leave out an empty 📂 project (as colourCounts), so one green task is an all-green day', () => {
  const s = { data: emptyData(), history: {} };
  applyOps(s, [
    makeOp('createMainProject', { projectId: 'e', name: 'Holder' }),
    makeOp('createProject', { projectId: 't', name: 'Task', parentId: 'e' }),
    makeOp('addStep', { projectId: 't', stepId: 'ts', text: 'Do it' }),
    makeOp('addWorkNote', { projectId: 't', noteId: 'n1', text: 'Did some' }),
  ]);
  const text = renderDashboard(fakeCtx(s, {})).textContent;
  assert.ok(text.includes('🔥 1'), 'today counts as all green');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const fn = APP.slice(APP.indexOf('function todayScore()'), APP.indexOf('function saveTypedText()'));
  assert.match(fn, /todayWithoutEmptyMains\(awakeProjects\(store\.view\.data, today\), today\)/, 'the top bar uses the same list');
});

test('📂 the list\'s "Add to project" box: Enter uses pickEnterTarget (the exact name, nothing when empty), never mains[0]', () => {
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const bar = APP.slice(APP.indexOf('function pickBar(list)'), APP.indexOf('function rowAction('));
  assert.match(bar, /const t = pickEnterTarget\(mains, q\); if \(t && t\.add\) add\(t\.add\); else if \(t\) create\(t\.create\);/);
  assert.ok(!/add\(mains\[0\]\)/.test(bar), 'not the first match');
});

test('Work notes: a note of several lines is shown (not a one-line box that glues its lines); a box saves only a real change', () => {
  const s = sampleState();
  s.data.projects[0].workNotes.unshift({ id: 'an1', text: 'Amount: 12,500\nVendor: ABC Minerals', stepId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), app: true });
  const ctx = fakeCtx(s, { selected: 'p1', update: {}, showMore: true });
  const sent = [];
  ctx.store.dispatch = (type, a) => { sent.push([type, a]); return true; };
  const el = renderDetail(ctx);
  assert.ok(!rFind(el, (n) => n.nodeName === 'INPUT' && keyOf(n) === 'nt-an1'), 'no one-line box for it');
  const shown = rFind(el, (n) => keyOf(n) === 'nt-an1');
  assert.ok(shown && shown.className.includes('note-lines') && shown.textContent === 'Amount: 12,500\nVendor: ABC Minerals', 'shown with its lines');
  // a one-line note: leaving the box with no change sends nothing; a change is saved
  const box = rFind(el, (n) => n.nodeName === 'INPUT' && keyOf(n) === 'nt-n1');
  box.__on.focusout(null, { value: 'Kiln at 1150' });
  assert.deepEqual(sent, [], 'no change: nothing saved');
  box.__on.focusout(null, { value: 'Kiln at 1160' });
  assert.deepEqual(sent, [['editWorkNote', { projectId: 'p1', noteId: 'n1', text: 'Kiln at 1160' }]]);
});

test('✎ on a paused task\'s rich update does not flatten it through the question box; an unchanged answer saves nothing', () => {
  const s = sampleState();
  applyOps(s, [
    makeOp('addWorkNote', { projectId: 'p1', noteId: 'rn', text: 'x', html: '<table><tr><td>Clay</td><td>20</td></tr></table>' }),
    makeOp('pause', { projectId: 'p1' }),
  ]);
  const n = s.data.projects[0].workNotes.find((x) => x.id === 'rn');
  assert.ok(n && n.html, 'a rich note');
  const ctx = fakeCtx(s, { selected: 'p1', update: {} });
  const sent = []; const toasts = []; const asked = [];
  ctx.store.dispatch = (type, a) => { sent.push([type, a]); return true; };
  ctx.toast = (m) => toasts.push(m);
  globalThis.prompt = (q, v) => { asked.push(v); return String(v).replace(/\n/g, ' '); };
  try {
    const pens = rAll(renderDetail(ctx), (x) => x.nodeName === 'BUTTON' && x.textContent === ' ✎' && x.getAttribute('title') === 'Change this update');
    for (const b of pens) b.__on.click();
    assert.ok(pens.length >= 2, 'a ✎ for each update');
    assert.ok(!sent.some(([t, a]) => t === 'editWorkNote' && a.noteId === 'rn'), 'the rich note is not sent flat');
    assert.ok(toasts.some((m) => /Unpause or reopen/.test(m)), 'says why');
    assert.ok(!sent.some(([t]) => t === 'editWorkNote'), 'a plain note answered unchanged: nothing saved');
    assert.ok(asked.includes('Kiln at 1150'), 'a plain one-line note is still asked');
  } finally { delete globalThis.prompt; }
});

test('rich box: a paste whose HTML is too big (or cleans to nothing) pastes the plain words; a box past 2 MB is "too big", never empty', async () => {
  const { RAW_MAX } = await import('../docs/rich.js');
  const s = sampleState();
  const ctx = fakeCtx(s, { selected: 'p1', update: {} });
  const toasts = [];
  ctx.toast = (m) => toasts.push(m);
  const box = rFind(renderDetail(ctx), (n) => keyOf(n) === 'wn-p1');
  const ed = fakeEditor();
  await withEditor({ 'wn-p1': ed }, (cmds) => {
    const big = '<table>' + '<tr><td style="mso-x:1">Clay</td></tr>'.repeat(Math.ceil(RAW_MAX / 30) + 10) + '</table>';
    const e = ev({ clipboardData: clip({ html: big, text: 'Clay\nClay' }) });
    box.__on.paste(e, ed);
    assert.ok(e.prevented);
    assert.deepEqual(cmds, [['insertText', 'Clay\nClay']], 'the plain words are pasted');
    assert.ok(toasts.some((m) => /Too big to paste as a table/.test(m)));
    cmds.length = 0;
    box.__on.paste(ev({ clipboardData: clip({ html: '<svg><text>Kiln</text></svg>', text: 'Kiln' }) }), ed);
    assert.deepEqual(cmds, [['insertText', 'Kiln']], 'HTML that cleans to nothing: the words');
  }, { focused: ed });
  const huge = fakeEditor('<p>' + 'a'.repeat(RAW_MAX + 10) + '</p>');
  assert.equal(richedit.readDraft({}, huge).tooBig, true, 'Save + done stops with a message instead of ticking an "empty" update');
});

test('🔗 Link keeps an address with &reg= / &times= / &copy= as typed (no ® or ×)', async () => {
  const ed = fakeEditor();
  const url = 'https://erp.example/r?id=5&reg=south&times=3&copy=1';
  await withEditor({}, (cmds) => {
    richedit.insertLink(ed, () => url);
    assert.equal(cmds.length, 1);
    const [cmd, html] = cmds[0];
    assert.equal(cmd, 'insertHTML');
    const href = /href="([^"]*)"/.exec(html)[1].replace(/&amp;/g, '&');
    assert.equal(href, url);
  });
});

test('a screenshot pasted while naming a new task goes into that box, never into the task open on the right', async () => {
  const { pasteInForm } = await import('../docs/rules.js');
  const s = mainsState();
  const ui = { selected: 'p1', update: {} };
  const ctx = liveCtx(s, ui);
  ctx.store.repo = { createBlobBase64: async () => 'sha-new' };
  const d = {};
  const box = richedit.newTaskBox(ctx, d, { key: 'new', onCancel: () => {}, onCreate: () => {} });
  const name = rFind(box, (n) => n.nodeName === 'INPUT' && keyOf(n) === 'new-name');
  assert.ok(name.__on && name.__on.paste, 'the name box has its own paste');
  await withEditor({ 'new-rich': fakeEditor('') }, async () => {
    const e = ev({ clipboardData: clip({ files: [new File(['b'], 'image.png', { type: 'image/png' })] }) });
    name.__on.paste(e, name);
    assert.ok(e.prevented, 'taken by the new task box');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(d.photos.length, 1, 'the photo is in the new task\'s notes');
    const t = ev({ clipboardData: clip({ text: 'Glaze', files: [] }) });
    name.__on.paste(t, name);
    assert.ok(!t.prevented, 'typed words paste as usual');
  });
  assert.ok(!(ui.update.p1 && (ui.update.p1.photos || []).length), 'task p1 got nothing');
  // the page-wide paste handler leaves a paste inside the box alone
  const inBox = { closest: (sel) => (sel === '.new-task-box' ? {} : null) };
  assert.equal(pasteInForm(inBox), true);
  assert.equal(pasteInForm({ closest: () => null }), false);
  assert.equal(pasteInForm({ nodeType: 3, parentNode: inBox }), true, 'a text node inside it');
  assert.equal(pasteInForm(null), false);
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const h = APP.slice(APP.indexOf("document.addEventListener('paste'"));
  assert.ok(h.indexOf('if (pasteInForm(e.target)) return;') >= 0 && h.indexOf('if (pasteInForm(e.target)) return;') < h.indexOf('pasteIntoProject(ctx, p, files)'));
});

// ---------- Review round 14 ----------
test('a photo dropped on a paused or finished task goes to its Files (no hidden update box); on an active task it goes in the update box', async () => {
  const findCls = (el, cls) => (String(el.className || '').split(' ').includes(cls) ? el : (el.childNodes || []).map((c) => findCls(c, cls)).find(Boolean));
  const photo = { name: 'kiln.jpg', type: 'image/jpeg', size: 10 };
  for (const [state, where] of [['paused', 'file'], ['finished', 'file'], ['active', 'photo']]) {
    const s = sampleState();
    const p = s.data.projects.find((x) => x.id === 'p1');
    p.state = state;
    const toasts = [];
    const ctx = fakeCtx(s, { selected: 'p1', update: {} });
    ctx.store.isOffline = () => true; // stops before any real upload; the toast tells which way it went
    ctx.toast = (m) => toasts.push(m);
    const root = findCls(renderDetail(ctx), 'detail-inner');
    await root.__on.drop({ preventDefault() {}, dataTransfer: { types: ['Files'], files: [photo] } });
    if (where === 'file') {
      assert.ok(toasts.includes('No connection — file not added'), `${state}: to Files`);
      assert.ok(!toasts.includes('No connection — photo not added'), `${state}: not into the hidden update box`);
      assert.ok(!(ctx.ui.update.p1 && ctx.ui.update.p1.uploading), `${state}: no draft upload`);
    } else assert.ok(toasts.includes('No connection — photo not added'), 'active: into the update box');
  }
});

test('Inbox Undo (app.js) sends only the step to take back (projectId + stepId), never an old copy of the task', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const part = app.slice(app.indexOf('function inboxAct('), app.indexOf('function inboxReply('));
  assert.match(part, /type === 'inboxToStep' \? \{ projectId: args\.projectId, stepId: args\.stepId \}/);
  assert.ok(!/project: snapshot/.test(part), 'no copy of the whole task');
});

test('🔌 the downloadable PHP connector: wt_decisions gives decisions, until and more; the how-to keeps until and asks again while more', () => {
  const tpl = cnx.CONNECTOR_TEMPLATE;
  assert.match(tpl, /'until' => isset\(\$answer\['until'\]\)/);
  assert.match(tpl, /'more' => !empty\(\$answer\['more'\]\)/);
  assert.match(tpl, /\$lastTime = \$answer\['until'\];/);
  assert.match(tpl, /\} while \(\$answer\['more'\]\);/);
  assert.ok(!/keep the answer's newest decided_at/.test(tpl), 'not the newest decided_at');
});

test('review r15 wiring (app.js): Undo of Pause / Finish passes the stopped timer; Start / Stop name the timer they were pressed for', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const act = app.slice(app.indexOf('function act(type, args, message'), app.indexOf('/** Remember how far the list'));
  assert.match(act, /const timerBefore = store\.view\.data\.timer && store\.view\.data\.timer\.projectId === snapId \? clone\(store\.view\.data\.timer\) : null;\s*const op = store\.dispatch\(type, args\);/, 'the timer is read before the change');
  assert.match(act, /if \(timerStopped\) made\.timer = timerStopped;/);
  assert.match(app, /store\.dispatch\('startTimer', \{ projectId: p\.id, running: running \? running\.id : null \}\)/);
  assert.match(app, /store\.dispatch\('stopTimer', \{ timerId: t\.id \}\)/);
});

test('review r15: a box left focused (not typed in) takes another device\'s newer text, so leaving it never saves the old text back; typed text is never touched', async () => {
  const { h, morph } = await import('../docs/ui/dom.js');
  const box = h('textarea', { value: 'old notes' });
  const was = document.activeElement;
  document.activeElement = box;
  try {
    morph(box, h('textarea', { value: 'newer notes from the phone' }));
    assert.equal(box.value, 'newer notes from the phone', 'untouched focused box is brought up to date');
    box.value = 'newer notes from the phone + typing'; // the user types
    morph(box, h('textarea', { value: 'yet another change' }));
    assert.equal(box.value, 'newer notes from the phone + typing', 'what is being typed stays');
    const input = h('input', { value: 'Kiln' });
    document.activeElement = input;
    morph(input, h('input', { value: 'Kiln trial' }));
    assert.equal(input.value, 'Kiln trial');
  } finally { document.activeElement = was; }
});

test('+ Add time: "2 hours" adds 120 minutes; an answer it cannot read saves nothing and says how to type it', () => {
  const s = sampleState();
  const ui = { selected: 'p1', update: {}, showTime: 'p1' };
  const acts = [];
  const toasts = [];
  const ctx = Object.assign(fakeCtx(s, ui), { act: (type, args) => acts.push([type, args]), toast: (m) => toasts.push(m) });
  const realPrompt = globalThis.prompt;
  try {
    for (const answer of ['2 hours', '1h 30m', '2 apples']) {
      globalThis.prompt = () => answer;
      btn(renderDetail(ctx), '+ Add time').__on.click();
    }
  } finally { globalThis.prompt = realPrompt; }
  assert.deepEqual(acts, [['addTime', { projectId: 'p1', minutes: 120 }], ['addTime', { projectId: 'p1', minutes: 90 }]]);
  assert.match(toasts.at(-1), /Type a number of minutes/);
});

test('photo shrink: a wide PNG (a Mac window screenshot with a clear shadow) gets a white background before it is drawn into the JPEG, not black', async () => {
  const { uploadBlob } = await import('../docs/ui/files.js');
  const calls = [];
  const c2d = {
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    drawImage: (img, ...a) => calls.push(['drawImage', ...a]),
  };
  const canvas = { getContext: () => c2d, toBlob: (r, type) => r(new Blob(['jpg'], { type })) };
  const realCreate = document.createElement;
  const realBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 3000, height: 1500, close() {} });
  document.createElement = (t) => (t === 'canvas' ? canvas : realCreate(t));
  try {
    const store = { isOffline: () => false, canEdit: () => true, repo: { createBlobBase64: async () => 'sha1' } };
    const out = await uploadBlob({ store, toast: () => {} }, new File(['png'], 'Screenshot.png', { type: 'image/png' }));
    assert.equal(out.name, 'Screenshot.jpg');
    const draw = calls.findIndex((c) => c[0] === 'drawImage');
    const fill = calls.findIndex((c) => c[0] === 'fillRect');
    assert.ok(fill >= 0 && fill < draw, 'the canvas is filled before the picture is drawn');
    assert.deepEqual(calls[fill], ['fillRect', 0, 0, 2000, 1000]);
    assert.deepEqual(calls.filter((c) => c[0] === 'fillStyle' && calls.indexOf(c) < fill).at(-1), ['fillStyle', '#fff'], 'with white');
  } finally { document.createElement = realCreate; globalThis.createImageBitmap = realBitmap; }
});

// Runs one function from app.js with stand-ins for what it uses (app.js itself needs a real browser).
async function appFunctions(from, to, deps) {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const src = app.slice(app.indexOf(from), app.indexOf(to));
  const names = Object.keys(deps);
  const fns = [...src.matchAll(/^(?:async )?function (\w+)\(/gm)].map((m) => m[1]);
  return new Function(...names, `${src}\nreturn { ${fns.join(', ')} };`)(...names.map((n) => deps[n]));
}

test('people give: a retry after a lost reply sends the same clientId (one task on their list); after it is given, a new give gets a new id', async () => {
  const sent = [];
  let lose = true;
  const team = { byStep: new Map() };
  const deps = {
    team, newId, toast: () => {}, render: () => {}, teamMorning: () => {}, loadTeam: () => {},
    teamApi: async (action, args) => { sent.push(args.clientId); if (lose) { lose = false; throw new Error('No connection'); } return { task: { id: 1 } }; },
  };
  const { giveStepsTo } = await appFunctions('async function giveStepsTo(', 'function refreshTeamPeople(', deps);
  const items = [{ project: { id: 'p1', name: 'Kiln' }, step: { id: 's1', text: 'Send quote' } }];
  const ravi = { id: 7 };
  await giveStepsTo(items, ravi, { name: 'Ravi' }); // the server made it, the reply was lost
  await giveStepsTo(items, ravi, { name: 'Ravi' }); // tapped again
  assert.equal(sent.length, 2);
  assert.equal(sent[1], sent[0], 'the same id: the server gives back the task it already made');
  assert.match(sent[0], /^[A-Za-z0-9-]{8,60}$/, 'an id the server accepts');
  await giveStepsTo(items, { id: 8 }, { name: 'Anil' });
  assert.notEqual(sent[2], sent[0], 'another person: another give');
  await giveStepsTo(items, ravi, { name: 'Ravi' });
  assert.notEqual(sent[3], sent[0], 'given already (then cancelled): a new give is a new task');
});

test('Give a Work Task sign-in: a retry after a lost reply does not make a second account (ravi1); it offers a new password for the one made', async () => {
  const { teamMemberFor } = await import('../docs/rules.js');
  const accounts = [{ id: 1, owner: true, name: 'Owner', username: 'owner' }];
  const made = [];
  const reset = [];
  const toasts = [];
  let refreshed = 0;
  let lose = true;
  const team = {};
  const deps = {
    team, teamMemberFor, toast: (m) => toasts.push(m), render: () => {}, refreshTeamPeople: () => { refreshed++; },
    sendSignIn: () => {}, firstPassword: () => 'kiln-clay-427', openSheet: () => {}, confirm: () => true,
    teamApi: async (action, args) => {
      if (action === 'users.list') return { users: accounts };
      if (action === 'user.reset') { reset.push(args.id); return {}; }
      if (accounts.some((u) => u.username === args.username)) throw new Error('This username is taken.');
      accounts.push({ id: accounts.length + 1, name: args.name, username: args.username });
      made.push(args.username);
      if (lose) { lose = false; throw new Error('No connection'); }
      return { user: accounts.at(-1) };
    },
  };
  const { giveSignIn } = await appFunctions('async function giveSignIn(', 'function personMenu(', deps);
  const ravi = { name: 'Ravi' };
  await giveSignIn(ravi); // made on the server, the reply was lost
  assert.equal(refreshed, 1, 'the sign-ins are loaded again (the menu then shows the account)');
  await giveSignIn(ravi); // tapped again before that came back
  assert.deepEqual(made, ['ravi'], 'only one account');
  assert.deepEqual(reset, [2], 'a new first password for the account that was made');
  assert.match(toasts.at(-1), /already has a Task List sign-in: @ravi/);
  accounts.push({ id: 9, name: 'Meena Rao', username: 'meena' });
  await giveSignIn({ name: 'Meena Das' }); // a different Meena: 'meena' is someone else's, so the next number
  assert.deepEqual(made, ['ravi', 'meena1']);
});

test('people: "Add a task with Ravi" offers tasks only — a 📂 project (even one with an old @Ravi step) is never a chip or the Enter target', () => {
  const s = sampleState();
  applyOps(s, [
    makeOp('createMainProject', { projectId: 'm1', name: 'Kilns' }),
    makeOp('addStep', { projectId: 'm1', stepId: 'ms', text: 'Old step with @Ravi' }),
  ]);
  const el = renderPerson(fakeCtx(s, { person: 'r' }));
  const box = rFind(el, (n) => n.className === 'person-task block');
  assert.ok(box, 'the task box is drawn');
  assert.ok(rFind(box, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Kiln'), 'the task Kiln is offered');
  assert.ok(!rFind(box, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Kilns'), 'the 📂 project Kilns is not offered');
  assert.equal(rFind(box, (n) => n.className === 'chip first').textContent, 'Kiln', 'Enter adds to a task');
});

test('📂 app wiring (app.js): Inbox, Chrome clip and their suggestions offer tasks only (stepTargets); progress line, Daily round and evening check count what Today shows (todayList); Inbox Undo keeps the whole item', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const body = (name) => { const i = APP.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return APP.slice(i, APP.indexOf('\n}\n', i)); };
  for (const f of ['clipBox', 'renderInbox']) {
    assert.match(body(f), /stepTargets\((store\.view\.)?data, todayIndia\(\)\)/, f + ': tasks only');
    assert.doesNotMatch(body(f), /awakeProjects\(/, f + ': never every awake project (that has 📂 projects)');
  }
  // the suggestions: the rule in rules.js (inboxMatches, owner 24 Oct: two words in common), over the same tasks only
  assert.match(body('inboxSuggestions'), /inboxMatches\(store\.view\.data, text, todayIndia\(\)\)/);
  const RULES = readFileSync(new URL('../docs/rules.js', import.meta.url), 'utf8');
  const im = RULES.slice(RULES.indexOf('export function inboxMatches('), RULES.indexOf('\n}\n', RULES.indexOf('export function inboxMatches(')));
  assert.match(im, /stepTargets\(data, today\)/, 'inboxMatches: tasks only');
  assert.doesNotMatch(im, /awakeProjects\(/);
  for (const f of ['progressLine', 'eveningCheck', 'startRound', 'renderRound']) {
    assert.match(body(f), /todayList\(store\.view\.data, (today|todayIndia\(\))\)/, f + ': same list as Today');
    assert.doesNotMatch(body(f), /awakeProjects\(/, f + ': an empty 📂 project is not counted');
  }
  const act = body('inboxAct');
  assert.match(act, /const saved = clone\(item\)/, 'Undo keeps the whole item (mail, note, reply)');
  assert.match(act, /store\.dispatch\('inboxUndo', \{\n\s+item: saved, index,/, 'that saved item is what Undo sends');
});

// ---------------------------------------------------------------- one app: the staff view (ui/staff.js)
const staffMod = await import('../docs/ui/staff.js');
const teamRules = await import('../team/public_html/logic.js');
const STAFF_DAY = '2026-10-22';
function staffData() {
  return {
    today: STAFF_DAY, fillBy: '18:00',
    tasks: [
      { id: 11, title: 'Check kiln temperature', project: '', status: 'open', repeat: 'daily', skipSunday: true, today: null, unread: 1, needsPhoto: false },
      { id: 12, title: 'Pack the samples', project: '', status: 'open', repeat: 'once', dueDate: '2026-10-20', today: null },
      { id: 13, title: 'Order clay', project: 'Kiln trial', projectRef: 'p1', stepRef: 's1', seq: 1, status: 'open', today: { id: 90, note: 'Called Ravi', state: 'progress', at: '2026-10-22 10:30:00', photos: [] } },
    ],
    other: [{ id: 14, title: 'Fire the second batch', project: 'Kiln trial', projectRef: 'p1', stepRef: 's2', seq: 2, queued: true, status: 'open' }],
    suggestions: [{ id: 15, title: 'Clean dryer filters', status: 'suggested' }],
  };
}
function fakeStaff(answers = {}) {
  const calls = [];
  const api = async (a, body) => {
    calls.push({ a, body });
    if (!staffMod.STAFF_CALLS.includes(a)) throw new Error('not a staff call: ' + a);
    if (answers[a]) return answers[a](body);
    if (a === 'my.today') return staffData();
    return { ok: true };
  };
  const toasts = [];
  const s = staffMod.createStaff({ root: null, api, rules: teamRules, user: { id: 7, name: 'Valar', role: 'staff' }, toast: (t) => toasts.push(t) });
  return { s, calls, toasts };
}

test('one app — staff view: the same layout as Daily Projects (menu, list, page), only their own work; none of the owner\'s screens', async () => {
  const { s, calls } = fakeStaff();
  await s.load();
  const tree = s.view();
  assert.match(tree.className, /\blayout\b/, 'the same layout classes as the owner\'s app');
  const text = tree.textContent;
  for (const bit of ['Today', '✅ Tasks', '📂 Projects', 'Coming next', 'My suggestions', '💡 Suggest a task', '👤 Valar', 'Sign out', 'Check kiln temperature', 'Pack the samples', '1 of 3 sent', 'by 18:00', '✓ Sent 10:30 am']) assert.ok(text.includes(bit), bit);
  for (const gone of ['📥 Inbox', '✉ Replies', 'Settings', 'People', 'Groups', '🔌 From apps', 'Dashboard', 'Time report', '+ Give a task']) assert.ok(!text.includes(gone), 'no owner screen: ' + gone);
  // dots as on the owner's Today: green = sent today, red = not yet
  const kilnRow = rFind(tree, (n) => n.nodeName === 'LI' && n.textContent.includes('Check kiln temperature'));
  assert.ok(rFind(kilnRow, (n) => /\bdot (red|yellow)\b/.test(n.className || '')), 'not sent yet: yellow until updates are due, then red (owner asked 24 Oct, was always red)');
  assert.ok(kilnRow.textContent.includes('💬 New'), 'a new message shows on the row');
  assert.ok(calls.every((c) => staffMod.STAFF_CALLS.includes(c.a)));
  // (owner, 23 Oct: projects are on 📂 Projects, as on the owner's pages — not listed in the menu or on Today any more)
  assert.ok(!text.includes('📂 Kiln trial'), 'projects are on the 📂 Projects page');
  s.act.show('projects');
  assert.ok(s.view().textContent.includes('📂 Kiln trial'), 'there they are');
});

test('one app — staff view: the staff server calls never include the owner\'s projects (dp.*), Outlook or connections; staffApi refuses them before asking', async () => {
  for (const a of staffMod.STAFF_CALLS) assert.ok(!/^(dp\.|outlook\.|conn\.|connect\.|users?\.|team\.|task\.save|task\.status|task\.move|tasks\.moveAll|project\.sync|followup|morning|people)/.test(a), 'a staff call only: ' + a);
  const was = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async () => { asked++; return new Response('{"ok":true}'); };
  try {
    const api = staffMod.staffApi('tok');
    for (const a of ['dp.load', 'dp.head', 'outlook.draft', 'users.list', 'task.save', 'project.sync']) await assert.rejects(api(a, {}), /Not allowed here/);
    assert.equal(asked, 0, 'never even sent');
    assert.ok((await api('my.today')).ok);
    assert.equal(asked, 1);
  } finally { globalThis.fetch = was; }
});

test('one app — staff view: Send writes today\'s update with Work Task\'s rule (clientId), words typed while sending stay; an empty box says so', async () => {
  let release;
  const { s, calls, toasts } = fakeStaff({ 'update.save': (body) => new Promise((r) => { release = () => r({ ok: true, update: { id: 99, note: body.note } }); }) });
  await s.load();
  const t = s.state.data.tasks[0];
  assert.equal(await s.act.sendUpdate(t), 'Write what you did first.');
  s.state.drafts[t.id] = { note: 'Kiln at 1150', state: 'stuck' };
  const going = s.act.sendUpdate(t);
  await new Promise((r) => setTimeout(r, 0));
  s.state.drafts[t.id].note = 'Kiln at 1150\nand the fan is noisy'; // typed while it was sending
  release();
  assert.equal(await going, '');
  const save = calls.find((c) => c.a === 'update.save');
  assert.deepEqual({ taskId: save.body.taskId, note: save.body.note, state: save.body.state }, { taskId: 11, note: 'Kiln at 1150', state: 'stuck' });
  assert.ok(save.body.clientId, 'a clientId, as Work Task sends (a retry is kept once)');
  // Work Task's rule (updateBoxLeft): more typed than what went = the whole text stays, open as a change of today's update
  assert.equal(s.state.drafts[t.id].note, 'Kiln at 1150\nand the fan is noisy', 'what was typed meanwhile stays in the box');
  assert.equal(s.state.editing[t.id], true);
  assert.ok(toasts.includes('Sent ✓'));
});

test('one app — staff view: a needed photo is asked for before Finished; messages and steps send with a clientId and keep later words; suggest goes for a yes', async () => {
  const { s, calls } = fakeStaff({ 'comment.add': () => ({ ok: true, comments: [{ id: 1, text: 'Is the fan ok?', mine: true, at: '2026-10-22 11:30:00' }] }) });
  await s.load();
  const t = { ...s.state.data.tasks[0], needsPhoto: true };
  s.state.drafts[t.id] = { note: 'Done', state: 'finished' };
  assert.match(await s.act.sendUpdate(t), /Add a photo to finish/);
  assert.ok(!calls.some((c) => c.a === 'update.save'), 'nothing sent without the photo');
  s.state.msgDrafts[11] = 'Is the fan ok?';
  assert.equal(await s.act.sendMessage(11), '');
  const m = calls.find((c) => c.a === 'comment.add');
  assert.equal(m.body.text, 'Is the fan ok?'); assert.ok(m.body.clientId);
  assert.equal(s.state.msgDrafts[11], undefined, 'the box is empty after Send');
  s.state.stepDrafts.p1 = 'Order the spare servo motor';
  assert.equal(await s.act.addStep('p1'), '');
  assert.deepEqual(calls.filter((c) => c.a === 'project.addStep').map((c) => [c.body.projectRef, c.body.title, !!c.body.clientId]), [['p1', 'Order the spare servo motor', true]]);
  assert.equal(await s.act.suggest({ title: '  ', details: '', repeat: 'once' }), 'Write the task first.');
  assert.equal(await s.act.suggest({ title: 'Clean dryer filters', details: '', repeat: 'weekly', clientId: 'x1' }), '');
  assert.equal(s.state.section, 'sugg', 'then My suggestions is shown');
});

test('one app — staff view: a task page shows chips, today\'s update box, messages and earlier days (Work Task\'s diary rule); a project page its steps in order', async () => {
  const { s } = fakeStaff({
    'task.get': () => ({ ok: true, task: staffData().tasks[1], updates: [], comments: [{ id: 3, by: 'Boss', text: 'Please send a photo', mine: false, at: '2026-10-21 11:30:00' }] }),
    'project.mine': () => ({ ok: true, tasks: [{ id: 10, title: 'Buy clay', status: 'done', projectRef: 'p1', stepRef: 's0', seq: 0, doneAt: '2026-10-20 17:00:00' }] }),
  });
  await s.load();
  s.open('task:12');
  await new Promise((r) => setTimeout(r, 0));
  const page = s.view().textContent;
  for (const bit of ['Pack the samples', '⏰ Late — was by', 'Working on it', 'Stuck', 'Finished', 'Send', '💬 Messages', 'Please send a photo', "📅 What's happening"]) assert.ok(page.includes(bit), bit);
  assert.ok(page.indexOf("📅 What's happening") < page.indexOf('Working on it'), 'today\'s update box is under "What\'s happening", as on the owner\'s page (owner, 23 Oct: every page the same)');
  s.open('project:p1');
  await new Promise((r) => setTimeout(r, 0));
  const proj = s.view().textContent;
  for (const bit of ['📂 Kiln trial', '✓ 1 done', 'Buy clay', 'Step 2 · current', 'Order clay', 'Step 3 · next', 'Fire the second batch']) assert.ok(proj.includes(bit), bit);
  assert.ok(rFind(s.view(), (n) => n.nodeName === 'INPUT' && n.getAttribute('placeholder') === '+ Add the next step…'), 'the owner\'s add-step box');
});

test('one app wiring (app.js): who signed in picks the screens — staff get the staff view, another manager Work Task, the owner this app (never held up once known; no answer = the owner\'s app)', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const st = app.slice(app.indexOf('function start() {'), app.indexOf('/** The owner\'s Daily Projects. */'));
  // (step 4: a task link from a notification goes along to the staff view and the team pages: teamTask)
  assert.match(st, /if \(known === 'staff'\) \{ startStaff\(undefined, teamTask\); return; \}/);
  // (step 4: a manager who is not the owner gets the team pages of this app, no longer Work Task)
  assert.match(st, /if \(known === 'manager'\) \{ startManager\(undefined, teamTask\); return; \}/);
  assert.match(st, /askWho\(\)\.then\(\(r\) => routeWho\(r, teamTask\)\);/);
  // (code-review 23 Oct: no answer in time no longer means the owner's app for anyone — a team member on a slow first
  // start got the owner's app. Only this phone's own owner copy opens it; else "Try again")
  const route = app.slice(app.indexOf('function routeWho('), app.indexOf('/** Signed in: their first password'));
  assert.match(route, /if \(user && user\.mustChange\) openFor\(user, teamTask\);[^\n]*\n\s*else if \(who === 'staff'\) startStaff\(user, teamTask\);\s*else if \(who === 'manager'\) startManager\(user, teamTask\);\s*else if \(who === 'owner' \|\| ownerCopyHere\(\)\) startOwner\(\);[^\n]*\n\s*else if \(answered\) signInAgain\(\);[^\n]*\n\s*else noAnswerYet\(teamTask\);/, 'their first password first; not known: the owner\'s own phone opens as before, a dead sign-in signs in again, else try again');
  assert.match(route, /const ownerCopyHere = \(\) => \{ try \{ return !!localStorage\.getItem\('dp\.snapshot'\); \}/);
  assert.match(route, /'Cannot reach worktask\.in right now\. Check the internet\.'\), h\('button', \{ class: 'btn primary', onClick: again \}, 'Try again'\)/);
  assert.match(app, /if \(!user\.owner\) localStorage\.removeItem\('dp\.snapshot'\);/, 'someone else signing in on this phone: the owner\'s copy goes (so it never opens the owner\'s app for them)');
  // (step 4: signing in is inside this app now — the owner asked for one app)
  assert.ok(st.indexOf("if (onServer && !isMock && !serverToken()) { root.replaceChildren(); showSignIn((user) => openFor(user, teamTask)); return; }") >= 0, 'signed out: this app\'s sign-in');
  assert.ok(st.indexOf('showSignIn(') < st.indexOf('rememberedWho()'), 'signed out: to sign-in first');
  assert.match(app, /const timer = setTimeout\(\(\) => stop\.abort\(\), 4000\);/, 'a slow answer never holds the owner up for long');
  // the staff code and Work Task's rules load only for staff: the owner's start (offline too) never needs them
  assert.ok(!/^import .*ui\/staff\.js/m.test(app) && !/^import .*\.\.\/logic\.js/m.test(app));
  assert.match(app, /await Promise\.all\(\[import\('\.\/ui\/staff\.js'\), import\('\.\/ui\/staffbox\.js'\), import\('\.\.\/logic\.js'\)\]\)/);
  assert.ok(!/^import .*ui\/staffbox\.js/m.test(app), 'the offline sender loads only for staff too');
  // (the owner asked: staff see the owner's own design — Work Task's styles are never loaded on top)
  assert.ok(!/\.\.\/styles\.css/.test(app), 'never Work Task\'s styles');
  assert.match(readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8'), /'ui\/staff\.js'/, 'kept for offline');
});

// ---------------------------------------------------------------- one app, step 2: offline, files, messages, notifications
const staffBox = await import('../docs/ui/staffbox.js');
const tick = () => new Promise((r) => setTimeout(r, 0));
function fakeStaff2(answers = {}, more = {}) {
  const calls = [];
  const box = staffBox.memOutbox();
  const api = async (a, body, form) => {
    calls.push({ a, body, form });
    if (!staffMod.STAFF_CALLS.includes(a)) throw new Error('not a staff call: ' + a);
    if (answers[a]) return answers[a](body);
    if (a === 'my.today') return staffData();
    return { ok: true };
  };
  const toasts = [], shown = [];
  const s = staffMod.createStaff({ root: null, api, rules: teamRules, user: { id: 7, name: 'Valar', role: 'staff' }, box, lock: null,
    toast: (t) => toasts.push(t), viewer: (url, name, image) => shown.push({ url, name, image }), shrink: async (f) => f, ...more });
  return { s, calls, box, toasts, shown };
}
const offlineErr = () => Object.assign(new Error('You are offline.'), { offline: true });

test('one app — offline sender (staffbox): Work Task\'s outbox and item shape; each kind sent as Work Task sends it (day it was written, clientIds, photos one by one, then Finished)', async () => {
  const box = staffBox.memOutbox();
  const calls = [];
  const api = async (a, body, form) => {
    calls.push({ a, body: form ? Object.fromEntries([...body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : 'file'])) : body });
    if (a === 'update.save') return { ok: true, update: { id: 55, day: '2026-10-21', note: body.note } };
    return { ok: true };
  };
  const at = new Date('2026-10-22T06:00:00Z');
  const ob = staffBox.createOutbox({ box, api, rules: teamRules, userId: () => 7, signedIn: () => true, lock: null, now: () => at });
  await ob.queue({ kind: 'update', taskId: 11, note: 'Packed 6 boxes', state: 'finished', needsPhoto: true, hadPhoto: false, files: [new Blob(['a']), new Blob(['b'])] });
  await ob.queue({ kind: 'comment', taskId: 11, text: 'Boxes are short' });
  await ob.queue({ kind: 'step', projectRef: 'p1', title: 'Order servo' });
  await ob.queue({ kind: 'suggest', title: 'Clean filters', details: '', repeat: 'weekly' });
  await box.add({ kind: 'comment', taskId: 99, text: 'someone else', userId: 8, at: at.toISOString(), clientId: 'x' });
  const items = await ob.list();
  assert.equal(items.length, 4, 'only this person\'s items');
  assert.ok(items.every((x) => x.userId === 7 && x.clientId && x.at), 'the same shape as Work Task\'s items (userId, clientId, at)');
  const r = await ob.flush();
  assert.deepEqual(r, { sent: 4, gave: 0 });
  const first = calls[0];
  assert.equal(first.a, 'update.save');
  assert.equal(first.body.state, 'progress', 'a photo is needed to finish: saved as working first');
  assert.equal(first.body.day, '2026-10-22'); assert.equal(first.body.writtenAt, at.toISOString()); assert.ok(first.body.sentAt, 'the server puts a wrong phone clock right');
  assert.deepEqual(calls.slice(1, 3).map((c) => [c.a, c.body.updateId, c.body.clientId]), [['photo.add', '55', `${items[0].clientId}-p0`], ['photo.add', '55', `${items[0].clientId}-p1`]]);
  assert.deepEqual([calls[3].a, calls[3].body.state, calls[3].body.day], ['update.save', 'finished', '2026-10-21'], 'then Finished, on the day the server saved the first part for');
  assert.deepEqual(calls.slice(4).map((c) => c.a), ['comment.add', 'project.addStep', 'suggest']);
  assert.equal(calls[4].body.day, '2026-10-22', 'a message counts for the day it was written');
  assert.equal((await ob.list()).length, 0);
  assert.equal(box.items.size, 1, 'the other person\'s item stays');
});

test('one app — offline sender: still offline = kept; a server hiccup = kept and tried again; refused = given back (words not lost); signed out = kept; one sender at a time', async () => {
  const box = staffBox.memOutbox();
  let mode = 'offline';
  const given = [];
  const api = async () => {
    if (mode === 'offline') throw Object.assign(new Error('offline'), { offline: true });
    if (mode === 'retry') throw Object.assign(new Error('Busy'), { retry: true });
    if (mode === 'auth') throw Object.assign(new Error('Sign in'), { auth: true });
    throw new Error('This task is closed.');
  };
  const ob = staffBox.createOutbox({ box, api, rules: teamRules, userId: () => 7, signedIn: () => true, lock: null, giveBack: (it, why) => given.push([it.text, why]) });
  await ob.queue({ kind: 'comment', taskId: 11, text: 'Hello' });
  assert.deepEqual(await ob.flush(), { sent: 0, gave: 0 }); assert.equal((await ob.list()).length, 1, 'offline: kept');
  mode = 'auth'; await ob.flush(); assert.equal((await ob.list()).length, 1, 'signed out: kept for after signing in');
  mode = 'retry'; await ob.flush(); assert.equal((await ob.list())[0].tries, 1, 'a hiccup: kept, counted');
  mode = 'refused'; assert.deepEqual(await ob.flush(), { sent: 0, gave: 1 });
  assert.deepEqual(given, [['Hello', 'This task is closed.']], 'given back with the reason');
  assert.equal((await ob.list()).length, 0);
  // one sender at a time, also with the other app (the "wt-outbox" lock): busy = nothing sent now
  const lock = { request: (name, o, fn) => { assert.equal(name, 'wt-outbox'); assert.equal(o.ifAvailable, true); return fn(null); } };
  const ob2 = staffBox.createOutbox({ box, api, rules: teamRules, userId: () => 7, signedIn: () => true, lock });
  assert.equal((await ob2.flush()).busy, true);
});

test('one app — staff view offline: Send / message / step / suggestion are kept on the phone (shown as waiting, the boxes empty) and go out when the internet is back', async () => {
  let online = false;
  const net = (fn) => (body) => { if (!online) throw offlineErr(); return fn(body); };
  const { s, calls, box, toasts } = fakeStaff2({
    'update.save': net((b) => ({ ok: true, update: { id: 77, day: STAFF_DAY, note: b.note } })),
    'comment.add': net(() => ({ ok: true, comments: [] })), 'project.addStep': net(() => ({ ok: true })), suggest: net(() => ({ ok: true })),
  });
  await s.load();
  const t = s.state.data.tasks[0];
  s.state.drafts[t.id] = { note: 'Kiln at 1150', state: 'progress' };
  s.state.files[t.id] = [new Blob(['photo'])];
  assert.equal(await s.act.sendUpdate(t), '');
  assert.equal(s.state.drafts[t.id], undefined, 'the box is empty (the words wait on the phone)');
  assert.ok(toasts.some((x) => /Saved on this phone/.test(x)));
  const kept = [...box.items.values()];
  assert.deepEqual([kept[0].kind, kept[0].taskId, kept[0].note, kept[0].files.length, !!kept[0].clientId], ['update', 11, 'Kiln at 1150', 1, true]);
  // the list and the task page say it waits
  const row11 = rFind(s.view(), (n) => n.nodeName === 'LI' && n.textContent.includes('Check kiln temperature'));
  assert.ok(row11.textContent.includes('⏳ Waiting to send'));
  assert.ok(rFind(row11, (n) => /\bdot yellow\b/.test(n.className || '')), 'written, waiting: yellow');
  assert.match(s.view().textContent, /⏳ 1 waiting to send/);
  s.state.msgDrafts[11] = 'Fan is noisy'; assert.equal(await s.act.sendMessage(11), '');
  s.state.stepDrafts.p1 = 'Order servo'; assert.equal(await s.act.addStep('p1'), '');
  assert.equal(await s.act.suggest({ title: 'Clean filters', details: '', repeat: 'weekly', clientId: 'sg1' }), '');
  assert.deepEqual([...box.items.values()].map((x) => x.kind), ['update', 'comment', 'step', 'suggest']);
  assert.equal(s.state.msgDrafts[11], undefined); assert.equal(s.state.stepDrafts.p1, undefined);
  assert.equal([...box.items.values()][3].clientId, 'sg1', 'the form\'s id is kept (a retry is kept once)');
  // back online: all sent, the waiting list empties
  online = true;
  const r = await s.act.flush();
  assert.equal(r.sent, 4);
  assert.equal(box.items.size, 0);
  assert.ok(calls.some((c) => c.a === 'photo.add'), 'the photo went too');
});

test('one app — staff view: a waiting item the server refuses gives the words back (in the box, and a notice that stays with Copy); an update the server keeps out as older says so', async () => {
  const { s, box } = fakeStaff2({ 'comment.add': () => { throw new Error('This task is closed.'); } });
  await s.load();
  await box.add({ kind: 'comment', taskId: 11, text: 'My long message about the kiln', userId: 7, at: new Date().toISOString(), clientId: 'c1' });
  await s.refreshOutbox();
  await s.act.flush();
  assert.equal(s.state.msgDrafts[11], 'My long message about the kiln', 'back in the message box');
  assert.equal(s.state.notices.length, 1);
  const page = s.view().textContent;
  assert.match(page, /Could not send: This task is closed/);
  assert.match(page, /My long message about the kiln/);
  assert.ok(btn(s.view(), 'Copy') && btn(s.view(), 'Close'));
  btn(s.view(), 'Close').__on.click();
  assert.equal(s.state.notices.length, 0);
  // the server keeps a late update out (a newer one of theirs is there): its words are shown, not lost silently
  const { s: s2, box: box2 } = fakeStaff2({ 'update.save': (b) => ({ ok: true, history: 'older', update: { id: 5, note: 'newer words', day: STAFF_DAY } }) });
  await s2.load();
  await box2.add({ kind: 'update', taskId: 11, note: 'late offline words', state: 'progress', files: [], userId: 7, at: new Date().toISOString(), clientId: 'u1' });
  await s2.refreshOutbox();
  await s2.act.flush();
  assert.match(s2.state.notices.map((n) => n.body).join(), /late offline words/);
});

test('one app — staffApi: offline, a list comes from the saved copy (the same copies Work Task keeps); hiccups, sign-out and refusals are told apart', async () => {
  const mem = new Map();
  const cache = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const nets = [];
  const api = staffMod.staffApi('tok', '../api/', { cache, onNet: (on) => nets.push(on) });
  const was = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, today: '2026-10-22', tasks: [] }), { status: 200 });
    await api('my.today');
    assert.ok(mem.has(staffMod.cacheKey('my.today', {})), 'kept as Work Task keeps it (wt.c.…)');
    assert.equal(staffMod.cacheKey('my.today', {}), 'wt.c.my.today:{}');
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const c = await api('my.today');
    assert.equal(c.fromCache, true, 'offline: the saved copy');
    await assert.rejects(api('comment.add', { taskId: 1, text: 'x' }), (e) => e.offline === true, 'a send offline: .offline (it is kept on the phone)');
    assert.deepEqual(nets, [true, false, false]);
    globalThis.fetch = async () => new Response('{"ok":false,"error":"Busy"}', { status: 503 });
    await assert.rejects(api('comment.add', {}), (e) => e.retry === true);
    globalThis.fetch = async () => new Response('{"ok":false,"error":"Please sign in."}', { status: 401 });
    await assert.rejects(api('my.today'), (e) => e.auth === true);
    globalThis.fetch = async () => new Response('{"ok":false,"error":"Choose your own password first."}', { status: 428 });
    await assert.rejects(api('my.today'), (e) => e.auth === true && e.mustChange === true);
    globalThis.fetch = async () => new Response('<html>403 Forbidden</html>', { status: 403 });
    await assert.rejects(api('comment.add', {}), (e) => !e.offline && !e.retry && !e.auth && /refused/.test(e.message), 'a firewall page: refused (trying again will not help)');
    globalThis.fetch = async () => new Response('{"ok":false,"error":"The message is empty."}', { status: 400 });
    await assert.rejects(api('comment.add', {}), /The message is empty/);
  } finally { globalThis.fetch = was; }
});

test('one app — staff view: instruction photos and PDFs open in the viewer; own messages can be changed or deleted (never someone else\'s or a move note); a photo message needs the internet', async () => {
  const task = { ...staffData().tasks[0], files: [{ id: 3, name: 'drawing.png', image: true }, { id: 4, name: 'kiln-manual.pdf', image: false }] };
  const comments = [{ id: 1, text: 'Please check', mine: false, by: 'Boss', at: '2026-10-22 09:00:00' }, { id: 2, text: 'On it', mine: true, at: '2026-10-22 09:05:00' },
    { id: 9, text: '↔ Moved to you from Ravi', mine: true, at: '2026-10-22 08:00:00' }];
  const answers = {
    'task.get': () => ({ ok: true, task, updates: [], comments }),
    'comment.edit': (b) => ({ ok: true, comments: comments.map((c) => (c.id === b.id ? { ...c, text: b.text, editedAt: 'x' } : c)) }),
    'comment.delete': (b) => ({ ok: true, comments: comments.filter((c) => c.id !== b.id) }),
    'comment.photo': () => ({ ok: true, comments }),
  };
  const { s, calls, shown } = fakeStaff2(answers, {
    photo: async (kind, id) => `blob:${kind}/${id}`,
    ask: { prompt: () => 'On it — 2 left', confirm: () => true },
  });
  await s.load();
  s.open('task:11'); await tick();
  const page = s.view();
  assert.match(page.textContent, /📎 Instructions/);
  assert.ok(btn(page, 'kiln-manual.pdf'), 'a PDF is a chip');
  await s.act.openFile(task.files[1]);
  await s.act.openFile(task.files[0]);
  assert.deepEqual(shown, [{ url: 'blob:task.file/4', name: 'kiln-manual.pdf', image: false }, { url: 'blob:task.file/3', name: 'drawing.png', image: true }]);
  // the picture is part of the drawn page once fetched (a redraw must not take it off again: it did in the browser)
  await tick();
  const thumb = rFind(s.view(), (n) => n.nodeName === 'IMG' && n.getAttribute('title') === 'drawing.png');
  assert.equal(thumb.getAttribute('src'), 'blob:task.file/3');
  // ✎ / 🗑 only on my own messages, never on a move note
  const edits = rAll(page, (n) => n.nodeName === 'BUTTON' && n.getAttribute('aria-label') === 'Change this message');
  assert.equal(edits.length, 1, 'only "On it"');
  await s.act.editMessage(comments[1]);
  assert.deepEqual(calls.filter((c) => c.a === 'comment.edit').map((c) => c.body), [{ id: 2, text: 'On it — 2 left' }]);
  await s.act.deleteMessage(comments[1]);
  assert.deepEqual(calls.filter((c) => c.a === 'comment.delete').map((c) => c.body), [{ id: 2 }]);
  // 📷 with the words in the box: one call with the photo, the words, a clientId
  s.state.msgDrafts[11] = 'Crack near the base';
  const f = new Blob(['jpg'], { type: 'image/jpeg' }); f.name = 'p.jpg';
  assert.equal(await s.act.sendMessagePhoto(11, f), '');
  const ph = calls.find((c) => c.a === 'comment.photo');
  assert.deepEqual([ph.form, ph.body.get('taskId'), ph.body.get('text'), !!ph.body.get('clientId')], [true, '11', 'Crack near the base', true]);
  assert.equal(s.state.msgDrafts[11], undefined, 'the words went with the photo');
  s.setOffline(true);
  assert.match(await s.act.sendMessagePhoto(11, f), /need the internet/);
});

test('one app — staff view: 🔔 Notifications (menu, page, the banner once, Later) through Work Task\'s service worker', async () => {
  let st = 'default';
  const push = { state: () => st, sync: async () => {}, turnOn: async () => { st = 'on'; return 'on'; }, turnOff: async () => { st = 'granted'; }, test: async () => ({ ok: true }) };
  const { s } = fakeStaff2({}, { push });
  await s.load();
  let v = s.view();
  assert.ok(btn(v, '🔔 Notifications') && btn(v, '🔔 Notifications').textContent.includes('Off'));
  assert.match(v.textContent, /Get a message on this phone when a new task/);
  btn(v, 'Later').__on.click();
  assert.ok(!/Get a message on this phone when a new task/.test(s.view().textContent), 'Later: the banner goes');
  s.open('notify');
  assert.ok(btn(s.view(), 'Turn on notifications'));
  await s.act.notifyOn();
  v = s.view();
  assert.match(v.textContent, /On for this phone/);
  assert.ok(btn(v, 'Send me a test') && btn(v, 'Turn off'));
  assert.match(v.textContent, /Notifications are on/, 'said once');
  await s.act.notifyOff();
  assert.ok(btn(s.view(), 'Turn on notifications'));
  // the browser part: only Work Task's own service worker (the site root) shows them; push.* are staff calls
  const src = readFileSync(new URL('../docs/ui/staff.js', import.meta.url), 'utf8');
  assert.match(src, /navigator\.serviceWorker\.getRegistration\('\.\.\/'\)\) \|\| await navigator\.serviceWorker\.register\('\.\.\/sw\.js', \{ scope: '\.\.\/' \}\)/);
  for (const a of ['push.key', 'push.subscribe', 'push.unsubscribe', 'push.test']) assert.ok(staffMod.STAFF_CALLS.includes(a), a);
  assert.match(src, /const offKey = \(\) => 'wt\.pushOff\.' \+ userId;/, 'the same "turned off here" mark as Work Task');
});

test('one app wiring (step 2): offline sending, the shared outbox, #open from a notification, signing out clears the saved copies; the offline copy keeps Work Task\'s rules and look', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const st = app.slice(app.indexOf('async function startStaff(user, openTask = 0) {'), app.indexOf('const saved = device.ui();'));
  assert.match(st, /const push = browserPush\(api, user\.id\);/); assert.match(st, /box: idbOutbox\(\), shrink: shrinkPhoto, push \}\);/);
  assert.match(st, /staffApi\(serverToken\(\), '\.\.\/api\/', \{ onNet: \(on\) => \{ if \(staff\) staff\.setOffline\(!on\); \} \}\)/);
  // a notification's #open=<task> is read before the owner's reminder link takes the same hash away (it did in the browser)
  const begin = app.slice(app.indexOf('function start() {'), app.indexOf("/** The owner's Daily Projects. */"));
  // (step 4: "#team-task=<id>" too, the notifications' new link)
  assert.ok(begin.indexOf('const teamTask = teamTaskInHash();') >= 0 && begin.indexOf('const teamTask') < begin.indexOf('takeOpenFromHash();'), 'read first');
  assert.match(app, /const teamTaskInHash = \(\) => Number\(\(\/\^#\(\?:open\|team-task\)=\(\\d\+\)\$\/\.exec\(location\.hash\)/);
  assert.match(st, /if \(openTask\) \{ if \(teamTaskInHash\(\) === openTask\) history\.replaceState\(null, '', location\.pathname \+ location\.search\); staff\.open\('task:' \+ openTask\); \}/, 'that task, taken off the address (a reload does not open it again)');
  assert.match(st, /window\.addEventListener\('online', \(\) => \{ staff\.setOffline\(false\); staff\.act\.flush\(\); \}\);/);
  assert.match(st, /setInterval\(\(\) => \{ if \(staff\.state\.outbox\.length\) staff\.act\.flush\(\); \}, 30000\);/);
  // (signing out is shared by the staff view and the team pages now: serverTools)
  const tools = app.slice(app.indexOf('function serverTools(api, more = {}) {'), app.indexOf('/** The team pages (ui/team.js)'));
  assert.match(st, /const \{ photo, viewer, signOut \} = serverTools\(api, \{ waiting: \(\) => \(staff \? staff\.state\.outbox\.length : 0\), push: \(\) => push \}\);/);
  assert.match(tools, /if \(k\.startsWith\('wt\.c\.'\)\) localStorage\.removeItem\(k\);/, 'signing out leaves no saved lists for the next person');
  const box = readFileSync(new URL('../docs/ui/staffbox.js', import.meta.url), 'utf8');
  assert.match(box, /indexedDB\.open\('worktask', 1\)/, 'Work Task\'s own outbox (both apps send what waits)');
  assert.match(box, /createObjectStore\('outbox', \{ keyPath: 'id', autoIncrement: true \}\)/);
  const sw = readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const TEAM_FILES = \['\.\.\/logic\.js'\];/, 'Work Task\'s rules only (its styles are not used: staff see the owner\'s design)');
  assert.match(sw, /Promise\.all\(TEAM_FILES\.map\(\(u\) => c\.add\(u\)\.catch\(\(\) => \{\}\)\)\)/, 'best effort: only worktask.in has them');
  assert.match(sw, /'ui\/staff\.js', 'ui\/staffbox\.js'/);
});

// ---------------------------------------------------------------- one app, step 3: what staff had in Work Task, now in the staff view
test('one app — staff view: 🔍 Search (their own tasks, messages, updates; 2 letters or more) opens the task', async () => {
  const { s, calls } = fakeStaff2({ search: (b) => ({ ok: true, results: [{ taskId: 12, title: 'Pack the samples', who: 'Valar', kind: 'message', text: 'brown boxes', at: '2026-10-22 10:00:00' }] }) }, { searchWait: 0 });
  await s.load();
  assert.ok(btn(s.view(), '🔍'), '🔍 at the top of the list (owner, 23 Oct: the staff view looks like the projects page — a search box in the menu, 🔍 on the list)');
  s.act.show('search');
  assert.match(s.view().textContent, /Type 2 or more letters/);
  s.act.search('b'); await tick(); await tick();
  assert.ok(!calls.some((c) => c.a === 'search'), 'one letter: not asked');
  s.act.search('brown'); await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.a === 'search').map((c) => c.body), [{ q: 'brown' }]);
  const v = s.view();
  assert.match(v.textContent, /💬 Pack the samples/);
  btn(v, 'Pack the samples').__on.click();
  assert.equal(s.state.sel, 'task:12');
});

test('one app — staff view: 📷 more photos on today\'s sent update (up to 5; the rest wait on the phone when offline); Ctrl+V puts a photo in the update or, in the message box, sends it as a message', async () => {
  let online = true;
  const sent = { ...staffData().tasks[2], today: { id: 90, note: 'Called Ravi', state: 'progress', at: '2026-10-22 10:30:00', photos: [1, 2, 3, 4] } };
  const { s, calls, box } = fakeStaff2({
    'photo.add': () => { if (!online) throw offlineErr(); return { ok: true }; },
    'task.get': () => ({ ok: true, task: sent, updates: [], comments: [] }),
    'comment.photo': () => ({ ok: true, comments: [] }),
  });
  await s.load();
  const img = (n) => Object.assign(new Blob(['x'], { type: 'image/png' }), { name: n });
  assert.equal(await s.act.addPhotos(sent, [img('a'), img('b')]), '');
  assert.deepEqual(calls.filter((c) => c.a === 'photo.add').map((c) => c.body.get('updateId')), ['90'], 'only 1 more fits (5 in all)');
  online = false;
  assert.equal(await s.act.addPhotos({ ...sent, today: { ...sent.today, photos: [] } }, [img('c'), img('d')]), '');
  const kept = [...box.items.values()][0];
  assert.deepEqual([kept.kind, kept.updateId, kept.files.length, kept.photoNo], ['photos', 90, 2, 0], 'offline: they wait on the phone, as in Work Task');
  online = true;
  // Ctrl+V
  s.open('task:13'); await tick();
  assert.equal(s.act.paste({ files: [img('p')], text: '', inMessageBox: false }), true);
  assert.equal(s.act.paste({ files: [img('p')], text: 'cells from Excel', inMessageBox: false }), false, 'text with a picture of it: the text');
  s.state.msgDrafts[13] = 'see this';
  assert.equal(s.act.paste({ files: [img('m')], inMessageBox: true }), true);
  await tick(); await tick();
  assert.ok(calls.some((c) => c.a === 'comment.photo' && c.body.get('text') === 'see this'), 'in the message box: a photo message');
  // the update waits on the phone: a pasted photo would go nowhere, so it is refused (pasteWaits, as in Work Task)
  const { s: s2, box: box2, toasts } = fakeStaff2({ 'task.get': () => ({ ok: true, task: staffData().tasks[0], updates: [], comments: [] }) });
  await s2.load();
  await box2.add({ kind: 'update', taskId: 11, note: 'waiting', state: 'progress', files: [], userId: 7, at: new Date().toISOString(), clientId: 'w' });
  await s2.refreshOutbox();
  s2.open('task:11'); await tick();
  s2.act.paste({ files: [img('p')], inMessageBox: false });
  assert.ok(toasts.includes('Wait until your update is sent, then add the photo.'));
  assert.equal(s2.state.files[11], undefined);
  s2.state.editing[11] = true; // changing the update: the photo goes with it
  s2.act.paste({ files: [img('p')], inMessageBox: false });
  assert.equal(s2.state.files[11].length, 1);
});

test('one app — staff view: every 20 s new work comes in by itself — "New" on the rows and a bar to open it; never their own new step or suggestion; a saved copy never counts', async () => {
  let next = staffData();
  const { s } = fakeStaff2({ 'my.today': () => next, 'project.addStep': () => ({ ok: true, task: { id: 31 } }) });
  await s.load();
  // their own step (just added) and a suggestion they made are not news
  s.state.stepDrafts.p1 = 'Mine'; await s.act.addStep('p1');
  next = { ...staffData(), other: [...staffData().other, { id: 31, title: 'Mine', projectRef: 'p1', seq: 3, queued: true, status: 'open', createdBy: 7 }],
    suggestions: [...staffData().suggestions, { id: 32, title: 'My idea', status: 'suggested', createdBy: 7 }] };
  await s.act.liveCheck();
  assert.equal(s.state.newIds.size, 0);
  assert.equal(s.state.news.length, 0);
  // the manager gives a new task
  next = { ...next, tasks: [...next.tasks, { id: 40, title: 'Clean kiln 2', status: 'open', repeat: 'once', createdBy: 1 }] };
  await s.act.liveCheck();
  assert.ok(s.state.newIds.has(40));
  const v = s.view();
  assert.match(v.textContent, /📥 New task for you/);
  assert.ok(rFind(v, (n) => n.nodeName === 'LI' && n.textContent.includes('Clean kiln 2') && n.textContent.includes('New')));
  btn(v, 'Open').__on.click();
  assert.equal(s.state.sel, 'task:40');
  assert.ok(!s.state.newIds.has(40), 'opened: no longer New');
  // two new steps in one project: said as steps of that project
  next = { ...next, other: [...next.other, { id: 41, title: 'Glaze test', projectRef: 'p1', seq: 4, queued: true, status: 'open', createdBy: 1, project: 'Kiln trial' }, { id: 42, title: 'Report', projectRef: 'p1', seq: 5, queued: true, status: 'open', createdBy: 1, project: 'Kiln trial' }] };
  await s.act.liveCheck();
  assert.equal(s.state.news[0].title, '➕ 2 new steps in Kiln trial');
  // offline (the saved copy): nothing is new
  const before = s.state.data;
  next = { ...staffData(), tasks: [{ id: 50, title: 'From the saved copy', status: 'open' }], fromCache: true };
  await s.act.liveCheck();
  assert.equal(s.state.data, before);
});

test('one app wiring (step 3): Ctrl+V and the 20 s check are hooked up for staff; the app icon shows tasks still to send', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const st = app.slice(app.indexOf('async function startStaff(user, openTask = 0) {'), app.indexOf('const saved = device.ui();'));
  assert.match(st, /setInterval\(\(\) => \{ if \(document\.visibilityState === 'visible'\) staff\.act\.liveCheck\(\); \}, 20000\);/);
  // (code-review 23 Oct: one paste helper for the staff view and the team pages)
  assert.match(st, /document\.addEventListener\('paste', \(e\) => pasteToView\(staff, e, STAFF_BOX\)\);/);
  assert.match(app, /const TEAM_BOX = \/\^Reply or give\/, STAFF_BOX = \/\^Ask or reply\/;/);
  assert.match(app, /if \(view\.act\.paste\(\{ files: \[\.\.\.\(e\.clipboardData\.files \|\| \[\]\)\], text: e\.clipboardData\.getData\('text\/plain'\) \|\| '', inMessageBox \}\)\) e\.preventDefault\(\);/);
  assert.equal((app.match(/\.act\.paste\(/g) || []).length, 1, 'one copy');
  const src = readFileSync(new URL('../docs/ui/staff.js', import.meta.url), 'utf8');
  assert.match(src, /const n = \(state\.data\.tasks \|\| \[\]\)\.filter\(\(t\) => !t\.today && t\.kind !== 'log'\)\.length;/, 'tasks still to send today (a 📒 record never is: owner asked 24 Oct)');
  assert.match(src, /\(n \? navigator\.setAppBadge\(n\) : navigator\.clearAppBadge\(\)\)/);
});

test('one app — the staff view has the owner\'s design: only this app\'s styles, its own building blocks (sections, the blue update box, segmented choice, team messages, tags); staff-only extras never touch the owner\'s screens', async () => {
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  const src = readFileSync(new URL('../docs/ui/staff.js', import.meta.url), 'utf8');
  // every style the staff view uses is in this app's style file
  const used = new Set([...src.matchAll(/class: '([^']+)'/g)].flatMap((m) => m[1].split(' ')).filter(Boolean));
  for (const c of used) assert.ok(new RegExp('\\.' + c.replace(/-/g, '\\-') + '([^a-zA-Z0-9_-]|$)', 'm').test(css), 'styled by this app: .' + c);
  // the extras are only inside the staff view (.layout.staff), so the owner's screens are unchanged
  const extra = css.slice(css.indexOf('/* ---------------------------------------------------------------- the staff view'));
  for (const rule of extra.split('\n').filter((l) => /^[^ /*].*\{/.test(l))) assert.match(rule, /^\.layout\.staff /, 'scoped: ' + rule.slice(0, 60));
  // the owner's building blocks
  const { s } = fakeStaff2({ 'task.get': () => ({ ok: true, task: staffData().tasks[0], updates: [], comments: [{ id: 1, text: 'Hi', mine: true, at: '2026-10-22 09:00:00' }] }) });
  await s.load();
  s.open('task:11'); await tick();
  const v = s.view();
  const has = (cls) => rFind(v, (n) => (' ' + (n.className || '') + ' ').includes(' ' + cls + ' '));
  for (const cls of ['block', 'update-form', 'segmented', 'seg', 'team-msgs', 'team-msg', 'info-chips', 'diary-head', 'plist']) assert.ok(has(cls), 'uses the owner\'s .' + cls);
  for (const gone of ['card', 'list-body', 'chip on']) assert.ok(!has(gone), 'no Work Task-only .' + gone);
  assert.ok(rFind(v, (n) => n.nodeName === 'TEXTAREA' && /^What happened today\?/.test(n.getAttribute('placeholder') || '')), 'the owner\'s words in the update box');
  const top = rFind(v, (n) => n.className === 'detail-top');
  assert.ok(rFind(top, (n) => /\bdot (red|yellow|grey|green)\b/.test(n.className || '')), 'the dot before the title, as on the owner\'s task page (owner asked 24 Oct: yellow until updates are due, then red)');
});

// ---------------------------------------------------------------- one app, step 4: the team pages (ui/team.js)
const teamMod = await import('../docs/ui/team.js');
const TD = '2026-10-22';
function teamToday() {
  const valar = { id: 7, name: 'Valar' }, ravi = { id: 8, name: 'Ravi' };
  return {
    today: TD, fillBy: '18:00', late: false, stuckSince: { 21: '2026-10-20' },
    people: [{ ...valar, role: 'staff', lastUpdate: TD }, { ...ravi, role: 'staff', lastUpdate: '2026-10-19' }],
    tasks: [
      { id: 21, title: 'Fix kiln 2 fan', assignee: valar, status: 'open', repeat: 'daily', dueToday: true, stuck: true, today: { id: 1, note: 'Fan part missing', state: 'stuck', at: TD + ' 10:00:00', photos: [] } },
      { id: 22, title: 'Pack samples', assignee: valar, status: 'open', repeat: 'once', dueDate: '2026-10-20', dueToday: true, today: null },
      { id: 23, title: 'Sweep kiln room', assignee: ravi, status: 'open', repeat: 'daily', dueToday: true, today: null, unread: 1, lastMessage: { text: 'Done by noon?' } },
    ],
    stuck: [{ id: 21, title: 'Fix kiln 2 fan', assignee: valar, today: { note: 'Fan part missing' } }],
    unread: [{ id: 23, title: 'Sweep kiln room', assignee: ravi, unread: 1, lastMessage: { text: 'Done by noon?' } }],
    suggestions: [{ id: 24, title: 'Clean dryer filters', assignee: valar, status: 'suggested' }],
  };
}
function fakeTeam(answers = {}, more = {}) {
  const calls = [];
  const box = staffBox.memOutbox();
  const api = async (a, body, form) => {
    calls.push({ a, body, form });
    if (answers[a]) return answers[a](body);
    if (a === 'team.today') return teamToday();
    if (a === 'users.list') return { users: [{ id: 7, name: 'Valar', role: 'staff', active: true, username: 'valar' }, { id: 8, name: 'Ravi', role: 'staff', active: true, username: 'ravi' }, { id: 1, name: 'Boss', role: 'admin', active: true, username: 'boss' }] };
    return { ok: true };
  };
  const toasts = [];
  const t = teamMod.createTeam({ root: null, api, rules: teamRules, user: { id: 1, name: 'Boss', role: 'admin', owner: true }, box, lock: null, searchWait: 0,
    toast: (x) => toasts.push(x), ask: { prompt: () => '', confirm: () => true }, ...more });
  return { t, calls, toasts, box };
}

test('one app — team pages: Team today in the owner\'s design (progress line, Needs you, each person\'s tasks with dots, 📧 Morning email); the menu has every team page and, for the owner, 📋 My projects', async () => {
  let back = 0;
  const { t } = fakeTeam({}, { toProjects: () => { back++; } });
  t.go('today'); await tick(); await tick();
  const v = t.view();
  const text = v.textContent;
  // (owner, 23 Oct: the team menu is the same as the projects page's — a search box on top instead of "🔍 Search", 📂 Projects)
  assert.match(readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8'), /h\('input', \{ class: 'search', type: 'search', placeholder: 'Search…', key: 'team-menu-search'/);
  assert.match(readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8'), /h\('button', \{ class: 'icon head-icon', title: 'Search', 'aria-label': 'Search', onClick: \(\) => \{ go\('search'\); focusLater\('team-search'\); \} \}, '🔍', h\('span', \{ class: 'icon-cap', 'aria-hidden': 'true' \}, 'Find'\)\)/, 'and 🔍 at the top of the list (phones), with its word on a computer (owner asked 24 Oct)');
  const TEAMSRC = readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8');
  assert.match(TEAMSRC, /h\('button', \{ class: 'btn primary new-project', onClick: \(\) => open\('give'\) \}, '\+ Give a task'\)/, '"+ Give a task" at the top of the list, as "+ New task"');
  assert.match(TEAMSRC, /h\('li', \{ class: 'menu-dots', key: 'dots'/, 'the red / yellow / green count under Team today');
  assert.doesNotMatch(TEAMSRC, /menu-give/, 'no longer in the menu');
  for (const bit of ['📋 My projects', 'Team today', '🔁 Follow-up', 'Tasks', 'Done / cancelled', '📂 Projects', '📊 Weekly report', 'People', 'Settings', '+ Give a task',
    '1 of 3', 'updates in today', 'Not yet: Valar, Ravi', 'Stuck: Valar (2 days)', 'No update for: Ravi (3 days)', '⚠️ Stuck 1', '💬 New messages 1', '💡 Suggestions 1', '💡 Suggestion — yes or no?', 'Pack samples', '⏰ Late (by', '📧 Morning email']) assert.ok(text.includes(bit), bit);
  assert.ok(!text.includes('Needs you'), 'owner, 23 Oct: no "Needs you" list — stuck, new messages and suggestions are in the table with their counts');
  const has = (cls) => rFind(v, (n) => (' ' + (n.className || '') + ' ').includes(' ' + cls + ' '));
  for (const cls of ['layout', 'progress', 'progress-bar', 'board-table', 'sub-table']) assert.ok(has(cls), 'the owner\'s .' + cls + ' (owner, 23 Oct: Team today is one table, as the owner\'s Tasks table)');
  assert.ok(!has('card') && !has('summary') && !has('trow'), 'no Work Task-only styles');
  // (owner, 23 Oct: Team today is one table — each task a row of it)
  const pack = rFind(v, (n) => n.nodeName === 'TR' && n.textContent.includes('Pack samples'));
  assert.ok(rFind(pack, (n) => /\bdot red\b/.test(n.className || '')), 'late: red');
  const sweep = rFind(v, (n) => n.nodeName === 'TR' && n.textContent.includes('Sweep kiln room'));
  assert.ok(rFind(sweep, (n) => /\bdot yellow\b/.test(n.className || '')), 'not yet (before the time): the owner\'s yellow');
  btn(v, '📋 My projects').__on.click();
  assert.equal(back, 1, 'back to the projects');
  // another manager: no My projects
  const { t: m } = fakeTeam({}, { user: { id: 2, name: 'Meena', role: 'admin', owner: false } });
  m.go('today'); await tick(); await tick();
  assert.ok(!m.view().textContent.includes('📋 My projects'));
});

test('one app — team pages: a task\'s page (who, Mark done, ⋯ Edit / Move / instruction file / Cancel, a suggestion\'s Yes / Not now, messages, what\'s happening) — each button does what Work Task did', async () => {
  const task = { id: 22, title: 'Pack samples', assignee: { id: 7, name: 'Valar' }, status: 'open', repeat: 'once', dueDate: '2026-10-20', files: [{ id: 5, name: 'guide.pdf', image: false }], createdBy: 1 };
  const { t, calls } = fakeTeam({ 'task.get': () => ({ ok: true, task, updates: [], comments: [{ id: 9, text: 'Please hurry', mine: true, at: TD + ' 09:00:00' }] }), 'task.move': () => ({ ok: true, moved: 1 }) });
  t.go('today'); await tick();
  t.open('task:22'); await tick(); await tick();
  let v = t.view();
  for (const bit of ['👤 Valar', '⏰ Late — was by', '📎 Instructions', 'guide.pdf', '💬 Messages', 'Please hurry', "📅 What's happening", 'Finish task']) assert.ok(v.textContent.includes(bit), bit);
  assert.ok(rFind(v, (n) => n.nodeName === 'TEXTAREA' && /^Reply or give an instruction/.test(n.getAttribute('placeholder') || '')));
  assert.ok(rFind(v, (n) => n.nodeName === 'BUTTON' && n.getAttribute('aria-label') === 'Remove guide.pdf'), 'the manager can take an instruction file off');
  btn(v, 'Finish task').__on.click(); await tick();
  assert.deepEqual(calls.filter((c) => c.a === 'task.status').map((c) => c.body), [{ id: 22, status: 'done' }]);
  rFind(v, (n) => n.nodeName === 'BUTTON' && n.getAttribute('aria-label') === 'More actions').__on.click();
  v = t.view();
  for (const bit of ['✎ Edit task', '↔ Move to another person…', '📎 Add instruction photo / PDF', '✖ Cancel task']) assert.ok(v.textContent.includes(bit), bit);
  btn(v, '↔ Move to another person…').__on.click();
  v = t.view();
  assert.match(v.textContent, /Move "Pack samples" to:/);
  const moveBox = rFind(v, (n) => /\bbanner\b/.test(n.className || '') && n.textContent.includes('Move "Pack samples" to:'));
  btn(moveBox, 'Ravi').__on.click(); await tick();
  assert.deepEqual(calls.filter((c) => c.a === 'task.move').map((c) => c.body), [{ id: 22, toId: 8 }]);
  // a message: comment.add with a clientId (kept once), the shared message box
  t.state.msgDrafts[22] = 'Use the brown boxes';
  assert.equal(await t.act.sendMessage(22), '');
  const m = calls.find((c) => c.a === 'comment.add');
  assert.deepEqual([m.body.taskId, m.body.text, !!m.body.clientId], [22, 'Use the brown boxes', true]);
  // a suggestion: Yes / Not now
  const sug = { id: 24, title: 'Clean dryer filters', assignee: { id: 7, name: 'Valar' }, status: 'suggested' };
  const { t: t2, calls: c2 } = fakeTeam({ 'task.get': () => ({ ok: true, task: sug, updates: [], comments: [] }) }, { ask: { prompt: () => 'Next month', confirm: () => true } });
  t2.open('task:24'); await tick(); await tick();
  const v2 = t2.view();
  assert.match(v2.textContent, /💡 Suggested by Valar/);
  await t2.act.answerSuggestion(sug, true);
  await t2.act.answerSuggestion(sug, false);
  assert.deepEqual(c2.filter((c) => /task\.(approve|decline)/.test(c.a)).map((c) => [c.a, c.body]), [['task.approve', { id: 24 }], ['task.decline', { id: 24, reason: 'Next month' }]]);
});

test('one app — team pages: Give a task (the same id for the same words: given once; from "Give to team" it goes back to the projects); work in one line', async () => {
  let back = 0;
  const { t, calls } = fakeTeam({ 'task.save': (b) => ({ ok: true, task: { id: 40, assignee: { id: 7, name: 'Valar' }, title: b.title } }) }, { toProjects: () => { back++; } });
  await t.start({ sel: 'give', prefill: { title: 'Order clay', project: 'Kiln trial', projectRef: 'p1', stepRef: 's1' }, fromProjects: true });
  await tick(); await tick();
  const v = t.view();
  assert.match(v.textContent, /Give a task/);
  assert.equal(t.state.giveForm.title, 'Order clay', 'filled in from the projects page');
  t.state.giveForm.assigneeId = 7;
  const fields = { id: 0, assigneeId: 7, title: 'Order clay', details: '', project: 'Kiln trial', repeat: 'daily', skipSunday: true, weekday: 1, dueDate: '', projectRef: 'p1', stepRef: 's1', needsPhoto: false, startDate: '' };
  // a lost answer, then the same words again: the same clientId (the server makes it once)
  const { t: lost, calls: lc } = fakeTeam({ 'task.save': () => { throw new Error('Server busy, try again.'); } });
  await lost.act.saveTask(fields); await lost.act.saveTask(fields);
  const ids = lc.filter((c) => c.a === 'task.save').map((c) => c.body.clientId);
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  assert.equal(await t.act.saveTask(fields), '');
  assert.equal(back, 1, 'given from the projects page: back there');
  assert.equal(calls.find((c) => c.a === 'task.save').body.stepRef, 's1');
  // work in one line
  const { t: q, calls: qc } = fakeTeam({ 'task.save': (b) => ({ ok: true, task: { id: 41, assignee: { id: 7, name: 'Valar' }, title: b.title } }) });
  q.state.quick = { text: 'Valar: send kiln photos by Friday', sig: '', cid: 'q1' };
  const r = teamRules.parseQuickTask(q.state.quick.text, [{ id: 7, name: 'Valar', role: 'staff' }], TD);
  assert.equal(await q.act.giveQuick(r), '');
  const s = qc.find((c) => c.a === 'task.save').body;
  assert.deepEqual([s.assigneeId, s.title, s.repeat, s.dueDate, s.clientId], [7, 'Send kiln photos', 'once', '2026-10-23', 'q1']);
  assert.equal(q.state.quick, null, 'the box empties');
});

test('one app — team pages: 🔁 Follow-up (worst first, Chase / Done / Take back, the round), Tasks, Projects, Weekly report, Search, People, Settings all draw', async () => {
  const rows = [{ kind: 'task', taskId: 30, title: 'Fix fan', person: { id: 7, name: 'Valar' }, stuck: true, lastUpdate: { day: '2026-10-21', note: 'part missing' } },
    { kind: 'task', taskId: 31, title: 'Glaze test', person: { id: 8, name: 'Ravi' }, silentDays: 0, lastUpdate: { day: TD, note: 'done half' } }];
  const answers = {
    'followup.list': () => ({ ok: true, today: TD, rows }),
    'tasks.list': () => ({ ok: true, tasks: teamToday().tasks }),
    'projects.overview': () => ({ ok: true, today: TD, projects: [{ ref: 'p1', name: 'Kiln trial', open: 2, done: 1, people: ['Valar'], lastUpdate: TD, current: { title: 'Order clay', sentToday: true }, stuck: false }] }),
    'report.week': () => ({ ok: true, today: TD, from: '2026-10-16', end: TD, people: [{ name: 'Valar', workDays: 5, sentDays: 4, missed: ['2026-10-19'], updates: 6, stuck: 1, finished: 2, stepsAdded: 1 }] }),
    search: () => ({ ok: true, results: [{ taskId: 21, title: 'Fix kiln 2 fan', who: 'Valar', kind: 'update', text: 'fan part', at: TD + ' 10:00:00' }] }),
    'people.morning': () => ({ ok: true, people: [] }),
  };
  const { t, calls } = fakeTeam(answers, { user: { id: 2, name: 'Meena', role: 'admin', owner: false } });
  t.go('followup'); await tick(); await tick();
  let v = t.view();
  assert.match(v.textContent, /2 given out/);
  assert.ok(v.textContent.indexOf('Fix fan') < v.textContent.indexOf('Glaze test'), 'worst first');
  for (const b of ['🔔 Chase', '✓ Done', '↩ Take back', '▶ Start round (2 min)']) assert.ok(btn(v, b), b);
  await t.act.chase(t.state.data.rows[0] && teamRules.followupRows(rows, TD)[0]);
  assert.deepEqual(calls.filter((c) => c.a === 'task.chase').map((c) => c.body), [{ id: 30 }]);
  btn(v, '▶ Start round (2 min)').__on.click();
  v = t.view();
  assert.match(v.textContent, /Daily follow-up round/); assert.match(v.textContent, /Item 1 of 2/);
  btn(v, '👍 OK').__on.click();
  assert.match(t.view().textContent, /Item 2 of 2/);
  for (const [view, bits] of [['tasks', ['Open', 'Done / cancelled', 'Fix kiln 2 fan']], ['projects', ['📁 Kiln trial', '1 of 3 done']], ['report', ['Week before', 'Valar', '4 of 5']], ['people', ['Add a person', 'Valar', '🔑 New password']], ['settings', ['Updates are due by']]]) {
    t.go(view); await tick(); await tick();
    const text = t.view().textContent;
    for (const b of bits) assert.ok(text.includes(b), `${view}: ${b}`);
  }
  assert.ok(!t.view().textContent.includes('📧 Outlook'), 'Outlook is only for the owner');
  t.go('search'); await tick();
  t.act.search('fan'); await tick(); await tick();
  assert.match(t.view().textContent, /📝 Fix kiln 2 fan/);
});

test('one app — team pages: the owner\'s Settings has 📧 Outlook (moved from Work Task); the client secret is never shown back', async () => {
  const { t } = fakeTeam({ 'outlook.status': () => ({ ok: true, outlook: { clientId: 'cid-1', tenantId: 'tid-1', secretEnd: 'ab12', redirectUri: 'https://worktask.in/outlook.php', connected: true, account: 'boss@x.com', today: TD } }) });
  t.go('settings');
  for (let i = 0; i < 10 && !t.view().textContent.includes('ab12'); i++) await tick();
  const v = t.view();
  assert.match(v.textContent, /📧 Outlook/);
  assert.match(v.textContent, /saved ✓ \(ends …ab12\)/);
  const secret = rFind(v, (n) => n.nodeName === 'INPUT' && n.getAttribute('placeholder') === 'Client secret Value');
  assert.equal(secret.value, '', 'never filled from the server');
  for (const b of ['Connect again', 'Check now', 'Disconnect']) assert.ok(btn(v, b), b);
});

test('one app — team pages: every 20 s a new suggestion or a team update comes in as a bar to open; a message waits on the phone when offline', async () => {
  let next = teamToday();
  const { t, box } = fakeTeam({ 'team.today': () => next, 'comment.add': () => { throw Object.assign(new Error('offline'), { offline: true }); } });
  t.go('today'); await tick(); await tick();
  next = { ...teamToday(), suggestions: [...teamToday().suggestions, { id: 50, title: 'New idea', assignee: { id: 8, name: 'Ravi' }, status: 'suggested', createdBy: 8 }] };
  next.tasks = [...next.tasks]; // (the suggestion is new)
  await t.act.liveCheck();
  assert.equal(t.state.news[0].title, '💡 Ravi suggests a task');
  next = { ...next, tasks: next.tasks.map((x) => (x.id === 23 ? { ...x, today: { id: 9, note: 'Swept', state: 'finished', at: TD + ' 12:00:00', by: 'Ravi', byId: 8 } } : x)) };
  await t.act.liveCheck();
  assert.equal(t.state.news[0].title, '✅ Ravi finished a task');
  t.state.msgDrafts[23] = 'Thanks';
  assert.equal(await t.act.sendMessage(23), '');
  assert.deepEqual([...box.items.values()].map((x) => [x.kind, x.taskId, x.text]), [['comment', 23, 'Thanks']], 'kept on the phone, sent when online');
});

test('one app wiring (step 4): 👥 Team, a team task chip and "Give to team" open the team pages inside this app (no more Work Task links); a manager who is not the owner gets them; the projects\' keys and redraws leave them alone', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const detailSrc = readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8');
  for (const [name, src] of [['app.js', app], ['detail.js', detailSrc]]) assert.ok(!/\.\.\/\?team|\.\.\/#task=|\.\.\/#new=/.test(src), name + ': no links to Work Task\'s team pages');
  assert.match(app, /href: '#team'/);
  assert.match(detailSrc, /href: `#team-task=\$\{t\.id\}`/);
  assert.match(detailSrc, /'#team-new=' \+ encodeURIComponent/);
  const hashFn = app.slice(app.indexOf('function teamHowFromHash() {'), app.indexOf('/** A manager who is not the owner'));
  assert.match(hashFn, /if \(hsh === '#team'\) how = \{\};/);
  assert.match(hashFn, /how = \{ sel: 'task:' \+ m\[1\], fromProjects: true \};/);
  assert.match(hashFn, /how = \{ sel: 'give', prefill: p && typeof p === 'object' \? p : null, fromProjects: true \};/);
  assert.match(app, /function render\(\) \{\n\s*if \(space === 'team'\) return;/, 'the projects never draw over the team pages');
  assert.match(app, /function onKey\(e\) \{\n.*dropMenuFocus.*\n.*\n\s*if \(space === 'team'\) \{ pageKey\(e, document, teamView, \{ say: toast, owner: true \}\); return; \}/, 'the projects\' keys are off on the team pages (they get their own: ui/listkeys.js; first the menu lets go of the focus, owner asked 24 Oct)');
  const st = app.slice(app.indexOf('function start() {'), app.indexOf("/** The owner's Daily Projects. */"));
  assert.match(st, /if \(known === 'manager'\) \{ startManager\(undefined, teamTask\); return; \}/);
  // one copy of a task page's pieces: both views use ui/workparts.js
  for (const f of ['staff.js', 'team.js']) {
    const src = readFileSync(new URL('../docs/ui/' + f, import.meta.url), 'utf8');
    assert.match(src, /from '\.\/workparts\.js';/, f);
    for (const own of ['function diaryRows', "h('ul', { class: 'diary-days' }", "class: 'banner team-msgs'"]) assert.ok(!src.includes(own), `${f} has no own copy of: ${own}`);
  }
  const sw = readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'ui\/team\.js'/); assert.match(sw, /'ui\/workparts\.js'/);
});

// ---------------------------------------------------------------- one app, step 4 part 2: signing in inside the one app
const signMod = await import('../docs/ui/signin.js');
const fakeForm = (vals) => ({ elements: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, { value: v }])), querySelector: () => ({ disabled: false }) });
const submit = async (card, vals) => { await card.__on.submit({ preventDefault() {} }, fakeForm(vals)); };
const shown = (card) => { const m = rFind(card, (n) => /\bkey-msg\b/.test(n.className || '')); const hid = m && (m.hidden === undefined ? m.hasAttribute('hidden') : m.hidden); return m && !hid ? m.textContent : ''; };

test('one app — sign in: the key screen\'s card asks for the username and password, signs in with the server and hands over the sign-in; wrong words or no internet say so', async () => {
  const posts = [];
  let got = null;
  const card = signMod.signInCard({ post: async (a, body) => { posts.push({ a, body }); return body.password === 'right-one' ? { status: 200, out: { ok: true, token: 't'.repeat(64), user: { id: 7, name: 'Valar', role: 'staff' } } } : { status: 401, out: { ok: false, error: 'Wrong username or password.' } }; }, onSignedIn: (x) => { got = x; } });
  assert.equal(card.nodeName, 'FORM'); assert.match(card.className, /\bkey-card\b/, 'the owner\'s key screen card');
  const text = card.textContent;
  for (const bit of ['Task List', 'Username', 'Password', 'Sign in']) assert.ok(text.includes(bit), bit);
  assert.ok(rFind(card, (n) => n.nodeName === 'INPUT' && n.getAttribute('autocomplete') === 'current-password' && n.getAttribute('type') === 'password'), 'a password box the phone can fill');
  await submit(card, { username: '', password: '' });
  assert.equal(posts.length, 0, 'empty: nothing is sent'); assert.match(shown(card), /Type your username and password/);
  await submit(card, { username: ' valar ', password: 'wrong' });
  assert.deepEqual(posts[0], { a: 'login', body: { username: 'valar', password: 'wrong' } }, 'the username without spaces around it');
  assert.equal(got, null); assert.equal(shown(card), 'Wrong username or password.');
  await submit(card, { username: 'valar', password: 'right-one' });
  assert.equal(got.token.length, 64); assert.equal(got.user.name, 'Valar');
  const off = signMod.signInCard({ post: async () => { throw new TypeError('Failed to fetch'); }, onSignedIn: () => assert.fail('never') });
  await submit(off, { username: 'valar', password: 'x' });
  assert.match(shown(off), /No connection/);
  assert.match(shown(signMod.signInCard({ post: async () => ({}), onSignedIn: () => {}, message: 'Please sign in again.' })), /Please sign in again/, 'the reason it is shown again');
});

test('one app — first password: chosen before anything else (8 or more, the same twice), then saved with the server', async () => {
  const calls = [];
  let done = null;
  const api = async (a, body) => { calls.push({ a, body }); if (body.old !== 'from-manager') throw new Error('Your current password is not right.'); return { ok: true, user: { id: 7, mustChange: false } }; };
  const card = signMod.firstPasswordCard({ api, user: { id: 7, name: 'Valar', mustChange: true }, onDone: (u) => { done = u; }, onSignOut: () => {} });
  const text = card.textContent;
  for (const bit of ['Choose your own password', 'Welcome, Valar!', 'Password from your manager', 'New password', 'New password again', 'Save password', 'Sign out']) assert.ok(text.includes(bit), bit);
  await submit(card, { old: 'from-manager', new1: 'short', new2: 'short' });
  assert.match(shown(card), /8 or more/); assert.equal(calls.length, 0);
  await submit(card, { old: 'from-manager', new1: 'longer-one', new2: 'longer-two' });
  assert.match(shown(card), /not the same/); assert.equal(calls.length, 0);
  await submit(card, { old: 'guess', new1: 'longer-one', new2: 'longer-one' });
  assert.match(shown(card), /not right/); assert.equal(done, null);
  await submit(card, { old: 'from-manager', new1: 'longer-one', new2: 'longer-one' });
  assert.deepEqual(calls[1], { a: 'password', body: { old: 'from-manager', new: 'longer-one' } });
  assert.deepEqual(done, { id: 7, mustChange: false });
});

test('one app wiring (step 4 part 2): no sign-in → this app\'s sign-in card, then the person\'s own screens (their first password first); a sign-in that stops working shows it again; sign out comes back here', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.ok(!/\.\.\/\?next=projects/.test(app), 'never sent to Work Task\'s old sign-in page');
  assert.ok(!/location\.href = '\.\.\/'/.test(app), 'nothing goes to the old Work Task page');
  assert.match(app, /import \{ signInCard, firstPasswordCard \} from '\.\/ui\/signin\.js';/);
  const fns = app.slice(app.indexOf('// ---------------------------------------------------------------- signing in'), app.indexOf('// ---------------------------------------------------------------- one app for everyone'));
  assert.match(fns, /function showCard\(el\) \{ const s = signScreen\(\); root\.hidden = true; s\.hidden = false; s\.replaceChildren\(el\); if \(bell\) bell\.el\.hidden = true; \}/, 'the card covers the app (nothing of it shows or is drawn over it; the 🔔 hides too)');
  assert.match(fns, /onSignedIn: \(\{ token, user \}\) => \{ keepSignIn\(token, user\); hideCard\(\); then\(user\); \}/);
  assert.match(fns, /localStorage\.setItem\(SERVER_TOKEN_KEY, token\);\n\s*localStorage\.removeItem\(WHO_KEY\);/, 'the new sign-in is kept; who it is is asked again');
  assert.match(fns, /if \(localStorage\.getItem\(LAST_USER_KEY\) !== String\(user\.id\)\) \{\n\s*for \(const k of Object\.keys\(localStorage\)\) if \(k\.startsWith\('wt\.c\.'\)\) localStorage\.removeItem\(k\);/, 'someone else on this phone: the last person\'s saved lists go');
  assert.match(fns, /if \(user && user\.mustChange\) \{ showFirstPassword\(user, \(u\) => openFor\(u, teamTask\)\); return; \}/, 'their own password first');
  assert.match(fns, /if \(who === 'staff'\) startStaff\(user, teamTask\);\n\s*else if \(who === 'manager'\) startManager\(user, teamTask\);\n\s*else startOwner\(\);/);
  // (code-review 23 Oct: a sign-in that still works is never dropped — the right screens open again, once; never a reload loop)
  assert.match(fns, /if \(user && user\.mustChange\) \{ showFirstPassword\(user, \(\) => location\.reload\(\)\); return; \}\n[^\n]*\n\s*if \(who && !reloadedJustNow\(\)\) \{ location\.reload\(\); return; \}\n\s*dropSignIn\(\);[^\n]*\n\s*showSignIn\(\(\) => location\.reload\(\), 'Please sign in again\.'\);/, 'stopped working: a new password if the manager reset it; still works: open again (once); else sign in again');
  assert.match(fns, /if \(Date\.now\(\) - at < 60000\) return true;/, 'at most one reload a minute');
  assert.match(app, /function toSignIn\(\) \{ signInAgain\(\); \}/, 'the owner\'s projects (what waits to be saved stays on this device)');
  assert.match(app, /onAuth: \(\) => signInAgain\(\)/, 'the team pages');
  assert.match(app, /const onAuth = \(\) => signInAgain\(\);/, 'the staff view');
  const tools = app.slice(app.indexOf('function serverTools(api, more = {}) {'), app.indexOf('/** The team pages (ui/team.js)'));
  assert.match(tools, /location\.replace\(location\.pathname\); \/\/ this app's sign-in/, 'signing out comes back to this app\'s sign-in');
  assert.match(app.slice(app.indexOf('async function signOutServer()')), /location\.replace\(location\.pathname\); \/\/ this app's sign-in/, 'the owner too');
  assert.match(readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8'), /'ui\/signin\.js'/, 'kept for offline');
  assert.match(readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8'), /\.key-card \.sign-field \{/, 'in the key screen\'s own style');
});

test('one app wiring (step 4 part 3): a notification tapped while the app is open opens its task in the staff view or the team pages; arriving, the news is looked for at once', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const staff = app.slice(app.indexOf('async function startStaff('), app.indexOf('const saved = device.ui();'));
  assert.match(staff, /window\.addEventListener\('hashchange', \(\) => \{[^]*const id = teamTaskInHash\(\);[^]*if \(id\) staff\.open\('task:' \+ id\);/, 'the staff view');
  const mgr = app.slice(app.indexOf('async function startManager('), app.indexOf('const teamTaskInHash'));
  assert.match(mgr, /const how = teamHowFromHash\(\) \|\| \(teamTask \? \{ sel: 'task:' \+ teamTask \} : \{\}\);/, 'a manager opens on the task (or Give a task) from the link');
  assert.match(mgr, /window\.addEventListener\('hashchange', \(\) => \{ const h2 = teamHowFromHash\(\); if \(h2\) teamView\.start\(\{ \.\.\.h2, fromProjects: false \}\); \}\);/, 'the team pages');
  assert.match(app, /else if \(d\.type === 'push'\) \{ if \(staffView\) staffView\.act\.liveCheck\(\); else if \(teamView\) teamView\.act\.liveCheck\(\); \}/);
});

test('one app — team pages: "turn on notifications" at the top (Later hides it for 3 days), 🎤 only where the browser can listen, the People card\'s about line and "no email — add one", and a message given back is "back in the box" only when the box was empty', async () => {
  localStorage.removeItem('wt.pushLater'); localStorage.removeItem('wt.pushOff.1'); // (left by earlier checks)
  let state = 'default';
  const push = { state: () => state, sync: async () => {}, turnOn: async () => 'on' };
  const { t } = fakeTeam({}, { push });
  t.go('today'); await tick(); await tick();
  let v = t.view();
  assert.ok(v.textContent.includes('🔔 Get a message on this phone'), 'the banner');
  btn(v, 'Later').__on.click();
  assert.ok(!t.view().textContent.includes('🔔 Get a message on this phone'), 'Later: gone');
  assert.ok(Number(localStorage.getItem('wt.pushLater')) > Date.now() + 2 * 86400000, 'for 3 days');
  localStorage.removeItem('wt.pushLater'); state = 'on';
  const { t: t2 } = fakeTeam({}, { push });
  t2.go('today'); await tick(); await tick();
  assert.ok(!t2.view().textContent.includes('🔔 Get a message on this phone'), 'already on: no banner');
  // 🎤
  t2.go('followup'); await tick(); await tick();
  assert.ok(!btn(t2.view(), '🎤'), 'no 🎤 where the browser cannot listen');
  globalThis.window = { SpeechRecognition: class { start() {} } };
  try { assert.ok(btn(t2.view(), '🎤'), 'the 🎤 where it can'); } finally { delete globalThis.window; }
  // People: the about line and the missing email
  const { t: m } = fakeTeam({ 'users.list': () => ({ users: [{ id: 7, name: 'Valar', role: 'staff', active: true, username: 'valar' }] }), 'people.morning': () => ({ people: [{ id: 7, sentAt: null, items: [{ kind: 'project', title: 'Basin glaze', about: 'New glaze for line 2', now: 'Test 3 samples' }] }] }) }, { user: { id: 2, name: 'Meena', role: 'admin', owner: false } });
  m.go('people'); await tick(); await tick();
  v = m.view();
  assert.ok(v.textContent.includes('New glaze for line 2'), 'the project\'s about line');
  assert.ok(btn(v, 'no email — add one'), 'a missing email can be added from the card');
  // a message given back
  const { t: g, box } = fakeTeam({ 'comment.add': () => { throw new Error('This task is closed.'); } });
  await box.add({ kind: 'comment', taskId: 5, text: 'Please hurry', clientId: 'c', userId: 1, at: new Date().toISOString() });
  g.state.msgDrafts[5] = 'other words typed meanwhile';
  await g.act.flush();
  assert.equal(g.state.msgDrafts[5], 'other words typed meanwhile', 'the words being typed stay');
  assert.ok(!/also back in the box/.test(g.state.notices.map((n) => n.body).join('\n')), 'never says it is back in the box when it is not');
  const { t: g2, box: box2 } = fakeTeam({ 'comment.add': () => { throw new Error('This task is closed.'); } });
  await box2.add({ kind: 'comment', taskId: 5, text: 'Please hurry', clientId: 'c', userId: 1, at: new Date().toISOString() });
  await g2.act.flush();
  assert.equal(g2.state.msgDrafts[5], 'Please hurry', 'an empty box gets the words back');
});

test('one app — signing out (staff view and team pages): asks first while items still wait to be sent, and stops this phone getting that person\'s notifications (without turning them off for their next sign-in)', async () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const tools = app.slice(app.indexOf('function serverTools(api, more = {}) {'), app.indexOf('/** A photo or PDF on top of the page'));
  assert.match(tools, /const n = more\.waiting \? more\.waiting\(\) : 0;\n\s*if \(n && !confirm\(`\$\{n\} item/, 'asks first');
  assert.ok(tools.indexOf('p.unlink()') > 0 && tools.indexOf('p.unlink()') < tools.indexOf("api('logout')"), 'notifications off for this phone before the sign-in ends');
  for (const who of ['async function teamPages(', 'async function startStaff(']) assert.match(app.slice(app.indexOf(who)), /serverTools\(api, \{ waiting: \(\) => \([a-z]+ \? [a-z]+\.state\.outbox\.length : 0\), push: \(\) => push \}\)/, who);
  const { browserPush } = await import('../docs/ui/staff.js');
  const calls = [];
  let unsubscribed = 0;
  const sub = { endpoint: 'https://fcm.googleapis.com/x', unsubscribe: async () => { unsubscribed++; } };
  globalThis.window = { PushManager: 1, Notification: 1 };
  globalThis.Notification = { permission: 'granted' };
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'x', serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) } } });
  try {
    const p = browserPush(async (a, b) => { calls.push({ a, b }); return {}; }, 7);
    await p.unlink();
    assert.deepEqual(calls, [{ a: 'push.unsubscribe', b: { endpoint: sub.endpoint } }]); assert.equal(unsubscribed, 1);
    assert.equal(localStorage.getItem('wt.pushOff.7'), null, 'not "turned off by them": it links again at their next sign-in');
    await p.turnOff();
    assert.equal(localStorage.getItem('wt.pushOff.7'), '1', 'Turn off still stays off');
  } finally { delete globalThis.window; delete globalThis.Notification; if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; localStorage.removeItem('wt.pushOff.7'); }
});

test('giving a 📂 project (owner, 23 Oct): the give box lists its tasks — ticked ones go, untick the ones you do yourself, ones given to someone else stay with them; the app sends them and keeps them in step', async () => {
  const s = sampleState();
  applyOps(s, [
    makeOp('createMainProject', { projectId: 'm', name: 'Kilns' }),
    makeOp('createProject', { projectId: 't1', name: 'Fix fan', parentId: 'm' }),
    makeOp('createProject', { projectId: 't2', name: 'Order bricks', parentId: 'm' }),
    makeOp('createProject', { projectId: 't3', name: 'Call the fitter', parentId: 'm' }),
    makeOp('setProjectTeam', { projectId: 't2', userId: 8, name: 'Ravi' }),
    makeOp('setProjectTeam', { projectId: 't3', userId: null, keepOff: true }),
  ]);
  const ui = { selected: 'm', update: {}, giveOpen: 'm' };
  const ctx = { ...fakeCtx(s, ui), onServer: true, teamPeople: () => [{ id: 7, name: 'Valar' }], teamBusy: () => false, giveProject: () => {}, setGivePhoto: () => {} };
  const el = renderDetail(ctx);
  const box = rFind(el, (n) => /\bgive-tasks\b/.test(n.className || ''));
  assert.ok(box, 'the list of its tasks');
  const row = (name) => rFind(box, (n) => n.nodeName === 'LABEL' && n.textContent.includes(name));
  const tick = (name) => rFind(row(name), (n) => n.nodeName === 'INPUT');
  assert.ok(tick('Fix fan') && tick('Fix fan').hasAttribute('checked'), 'a free task: ticked, it goes');
  assert.ok(!tick('Order bricks') && row('Order bricks').textContent.includes('stays with Ravi'), 'given to Ravi on its own: stays, no box');
  assert.ok(tick('Call the fitter') && !tick('Call the fitter').hasAttribute('checked') && row('Call the fitter').textContent.includes('stays with you'), 'kept before: unticked, stays with you');
  const tick2 = (name) => { const b = rFind(renderDetail(ctx), (n) => /\bgive-tasks\b/.test(n.className || '')); rFind(rFind(b, (n) => n.nodeName === 'LABEL' && n.textContent.includes(name)), (n) => n.nodeName === 'INPUT').__on.change({}, { checked: false }); };
  tick('Fix fan').__on.change({}, { checked: false });
  assert.ok(ui.giveKeep.has('t1'), 'unticked: you keep it');
  assert.match(box.textContent, /Tasks you add to it later go to the same person/);
  // (code-review 23 Oct) a box opened on another project (even an empty one) starts from that project's own ticks
  applyOps(s, [makeOp('createMainProject', { projectId: 'm2', name: 'Empty one' })]);
  ui.selected = 'm2'; ui.giveOpen = 'm2';
  renderDetail(ctx);
  assert.equal(ui.giveKeepFor, 'm2'); assert.equal(ui.giveKeep.size, 0, 'nothing carried over from Kilns');
  ui.selected = 'm'; ui.giveOpen = 'm'; ui.giveKeep = null;
  renderDetail(ctx); tick2('Fix fan');
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const give = app.slice(app.indexOf('async function giveProject('), app.indexOf('/** "4 tasks go with it'));
  assert.match(give, /\.\.\.\(main && person \? \{ giveTasks: true \} : \{\}\)/, 'giving a 📂 project gives its tasks again');
  // (code-review 23 Oct: only this project's own ticks, and only its own tasks — never ticks left from another project's box)
  assert.match(give, /if \(main && person && keep\) for \(const id of keep\) if \(kids\.has\(id\)\) store\.dispatch\('setProjectTeam', \{ projectId: id, userId: null, keepOff: true \}\);/, 'the ones you keep');
  assert.match(give, /keep = ui\.giveKeepFor === p\.id \? ui\.giveKeep : null\) \{/, 'the ticks of this project\'s box only');
  assert.match(give, /\.\.\.\(!main && !person \? \{ keepOff: true \} : \{\}\)/, 'a task taken back on its own stays off');
  assert.match(give, /if \(main\) syncGivenProjects\(\);/, 'its tasks reach the person now');
  // (taken back by you: the tasks that went with it leave the person's list at once, not a minute later at the next sync)
  assert.match(give, /for \(const id of moved\.backIds\) \{[^]*await teamApi\('project\.sync', \{ projectRef: id, project: t \? t\.name : '', assigneeId: 0, steps: \[\], reason: 'taken'[^]*rememberSync\(id, null\);/);
  assert.match(app, /if \(!c\.team\) out\.backIds\.push\(c\.projectId\);/);
  assert.match(app, /followProjects\(\{ onlyFresh: true \}\); \/\/ a task added to \(or taken out of\) a given 📂 project follows it/, 'kept in step by the sync');
  // (code-review 23 Oct: the background sync follows only on data just checked with the server — an old copy on a phone never re-gives)
  assert.match(app, /if \(onlyFresh && \(store\.status !== 'saved' \|\| !dataFreshAt \|\| Date\.now\(\) - dataFreshAt > 2 \* 60000\)\) return out;/);
  // (code-review 23 Oct: a task no longer given is taken off the person's list only once saved, after its Undo time, and
  // only if no other device saved since — the server answers "stale" then)
  assert.match(app, /if \(store\.pending\.length \|\| !saved \|\| saved\.team \|\| Date\.now\(\) - Date\.parse\(still\.updatedAt \|\| 0\) < UNDO_GRACE_MS\) continue;/);
  assert.match(app, /reason: 'taken', ifHead: store\.base\.commit \}\);\n\s*if \(!out\.stale\) rememberSync\(ref, null\);/);
  assert.match(app, /const out = await teamApi\('project\.sync', \{ projectRef: ref, project: still\.name, assigneeId: 0, steps: \[\], reason: 'taken', ifHead/, 'taken back: off the person\'s list');
  assert.match(app, /if \(isMainProject\(store\.view\.data, p\)\) return \[\]; \/\/ a 📂 project: its tasks go/, 'a 📂 project is never one task with its name');
  // the take back question
  const { takeBackQuestion } = await import('../docs/ui/detail.js');
  applyOps(s, [makeOp('setProjectTeam', { projectId: 'm', userId: 7, name: 'Valar' }), makeOp('setProjectTeam', { projectId: 't1', userId: 7, name: 'Valar', viaProject: 'm' })]);
  assert.match(takeBackQuestion(s.data, s.data.projects.find((x) => x.id === 'm')), /The 1 task that went with it comes back too\. Tasks given to someone on their own stay with them\./);
  // the chip on a task that went with its project
  const t1 = renderDetail({ ...ctx, ui: { selected: 't1', update: {} } }).textContent;
  assert.ok(t1.includes('👥 Valar (with 📂 Kilns)'));
});

test('review r4-1 (whole code): typing the same phone number written another way (spaces, +91) is not called "not a phone number" and is left as it is; a wrong one still is', () => {
  const s = sampleState();
  applyOps(s, [makeOp('setPersonContact', { personId: 'r', phone: '919876543210' })]);
  const toasts = [];
  const ctx = { ...fakeCtx(s, { person: 'r' }), toast: (t) => toasts.push(t) };
  ctx.store.dispatch = (type, args) => applyOps(s, [makeOp(type, args)]).length > 0;
  const box = () => rFind(renderPerson(ctx), (n) => n.nodeName === 'INPUT' && n.getAttribute('type') === 'tel');
  for (const typed of ['98765 43210', '+91 98765 43210', '0098 7654 3210'.replace('0098', '0091 98')]) {
    const el = { value: typed };
    box().__on.change({}, el);
    assert.equal(el.value, '+919876543210', 'shown as it is saved: ' + typed);
  }
  assert.deepEqual(toasts, [], 'no "That does not look like a phone number"');
  const bad = { value: '12' };
  box().__on.change({}, bad);
  assert.deepEqual(toasts, ['That does not look like a phone number']);
});

test('review r4-2 (whole code): the server\'s own notes (a move, a chase) show no change/delete buttons; the owner\'s sign out sends this phone\'s notification address so it stops', async () => {
  const { readFileSync } = await import('node:fs');
  const parts = readFileSync(new URL('../docs/ui/workparts.js', import.meta.url), 'utf8');
  assert.match(parts, /c\.mine && [^?]*c\.kind !== 'move' && c\.kind !== 'chase' \? h\('span', \{ class: 'msg-acts' \}/);
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const out = app.slice(app.indexOf('async function signOutServer()'), app.indexOf('// ---------------------------------------------------------------- key screen'));
  assert.match(out, /pushManager\.getSubscription\(\)/);
  assert.match(out, /a=logout'[^\n]*body: JSON\.stringify\(\{ endpoint \}\)/);
});

test('review r4-4 (whole code): an error under a form shows even after the screen was drawn again, and stays through later redraws until it is cleared', async () => {
  const { h, morph, errLine } = await import('../docs/ui/dom.js');
  // a little more of a page than the pretend DOM above: enough for morph() (attributes, moving and removing children)
  class El {
    constructor(tag) { this.nodeName = tag.toUpperCase(); this.nodeType = 1; this.childNodes = []; this.attributes = []; this.dataset = {}; this.style = { cssText: '' }; this.className = ''; this.value = ''; }
    appendChild(c) { return this.insertBefore(c, null); }
    insertBefore(c, at) { if (c.parentNode) c.parentNode.childNodes.splice(c.parentNode.childNodes.indexOf(c), 1); const i = at ? this.childNodes.indexOf(at) : -1; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c); c.parentNode = this; return c; }
    remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; }
    replaceWith(n) { this.parentNode.insertBefore(n, this); this.remove(); }
    setAttribute(n, v) { this.removeAttribute(n); this.attributes.push({ name: n, value: String(v) }); }
    removeAttribute(n) { this.attributes = this.attributes.filter((x) => x.name !== n); }
    getAttribute(n) { const a = this.attributes.find((x) => x.name === n); return a ? a.value : null; }
    hasAttribute(n) { return this.attributes.some((x) => x.name === n); }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    set textContent(t) { this.childNodes = [{ nodeType: 3, nodeValue: String(t), remove() {} }]; }
    get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(''); }
  }
  const realDoc = globalThis.document, RealNode = globalThis.Node;
  globalThis.Node = El;
  globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => ({ nodeType: 3, nodeValue: t, remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); } }), activeElement: null };
  try {
  const draw = () => { const err = errLine('t-err'); return { err, el: h('div', null, h('input', { key: 'box' }), err) }; };
  const page = draw().el;
  const again = draw();
  morph(page, again.el); // e.g. a photo picked: the page keeps its own error line
  again.err.say('📷 Add a photo to finish this task.');
  const line = () => page.childNodes[1];
  assert.equal(line().textContent, '📷 Add a photo to finish this task.', 'written into the line on the page');
  assert.equal(line().hidden, false);
  const later = draw();
  morph(page, later.el); // the next redraw (new work every 20 s) keeps it
  assert.equal(line().textContent, '📷 Add a photo to finish this task.');
  assert.ok(!line().hasAttribute('hidden'), 'still shown');
  later.err.clear(); // typing again
  assert.equal(line().hidden, true);
  morph(page, draw().el);
  assert.ok(line().hasAttribute('hidden'), 'and stays gone');
  for (const f of ['staff.js', 'team.js', 'workparts.js']) {
    const src = (await import('node:fs')).readFileSync(new URL('../docs/ui/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /err\.(textContent|hidden) =/, f + ': every form error goes through errLine');
  }
  } finally { globalThis.document = realDoc; globalThis.Node = RealNode; }
});

test('review r4-5 (whole code): an answer in the team box goes on the newest message\'s task and marks only that person\'s messages read; another person\'s question stays new', async () => {
  const s = sampleState();
  const ctx = fakeCtx(s, { selected: 'p1', update: {} });
  ctx.onServer = true;
  ctx.teamInfo = () => ({ byStep: new Map(), fillBy: '18:00' });
  ctx.teamPeople = () => [];
  ctx.teamTask = () => null;
  ctx.teamDaily = () => ({ data: { tasks: [], updates: [], comments: [
    { id: 45, taskId: 7, by: 'Valar', at: '2026-10-21 10:05:00', text: 'Fired', unread: true },
    { id: 44, taskId: 6, by: 'Valar', at: '2026-10-21 10:01:00', text: 'Step 1 done', unread: true },
    { id: 43, taskId: 8, by: 'Ravi', at: '2026-10-21 10:00:00', text: 'Which clay?', unread: true },
  ] } });
  const calls = [];
  ctx.teamReply = (p, taskId, text, ids, cid, upTo) => { calls.push([taskId, ids.slice().sort(), upTo]); return Promise.resolve(); };
  const el = renderDetail(ctx);
  const find = (node, f) => (f(node) ? node : (node.childNodes || []).map((c) => find(c, f)).find(Boolean));
  const form = find(el, (n) => n.nodeName === 'FORM' && find(n, (x) => x.textContent === 'Send'));
  form.elements = { reply: { value: 'Well done', disabled: false } };
  form.__on.submit({ preventDefault() {}, target: form });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [[7, [6, 7], 45]], 'to Valar; Ravi\'s question (task 8) is not marked read');
});

test('🔔 in the app (23 Oct): the bell counts what is not seen, lists the newest, and a tap opens its task (the phone notification\'s address) and marks it seen; on every screen', async () => {
  const { createBell, bellHash, bellCount, bellWhen } = await import('../docs/ui/bell.js');
  assert.equal(bellHash('/projects/#team-task=41'), '#team-task=41');
  assert.equal(bellHash('/projects/#open=kp1'), '#open=kp1');
  assert.equal(bellHash('/projects/#apps'), '#apps');
  assert.equal(bellHash('/'), '', 'nothing to open: the list is enough');
  assert.equal(bellHash('/projects/#team-task=4;evil'), '');
  assert.deepEqual([bellCount(0), bellCount(3), bellCount(140)], ['', '3', '99+']);
  assert.match(bellWhen('2026-10-23 10:05:00', '2026-10-23'), /^10:05/);
  assert.match(bellWhen('2026-10-21 10:05:00', '2026-10-23'), /^21 Oct 10:05/);
  // the bell itself, with a pretend server and page
  const calls = [];
  const list = [{ id: 7, kind: 'msg', title: '💬 Valar · Kiln', body: 'Is it at 1150?', url: '/projects/#team-task=41', at: '2026-10-23 10:05:00', read: false },
    { id: 6, kind: 'task', title: '📥 New task for you', body: 'Pack', url: '/', at: '2026-10-22 09:00:00', read: true }];
  const post = async (a, body) => { calls.push([a, body]); return a === 'notifs.list' ? { notifs: list.map((x) => ({ ...x })), unread: 1 } : {}; };
  const on = {};
  const win = { location: { hash: '' }, addEventListener: () => {}, document: { visibilityState: 'visible', addEventListener: (t, f) => { on[t] = f; } } };
  const bell = createBell({ post, every: 0, today: () => '2026-10-23', win });
  await new Promise((r) => setTimeout(r, 0));
  const find = (node, f) => (f(node) ? node : (node.childNodes || []).map((c) => find(c, f)).find(Boolean));
  const btn = () => find(bell.el, (n) => n.nodeName === 'BUTTON' && (n.className || '').startsWith('bell-btn'));
  assert.equal(btn().textContent, '🔔1', 'one not seen');
  await btn().__on.click();
  await new Promise((r) => setTimeout(r, 0));
  const items = [];
  (function walk(n) { if ((n.className || '').startsWith('bell-item')) items.push(n); (n.childNodes || []).forEach(walk); })(bell.el);
  assert.deepEqual(items.map((n) => n.className), ['bell-item new', 'bell-item'], 'newest first; the new one stands out');
  assert.match(items[0].textContent, /Valar · Kiln.*Is it at 1150\?/);
  await items[0].__on.click();
  assert.equal(win.location.hash, '#team-task=41', 'its task opens');
  assert.deepEqual(calls.at(-1), ['notifs.read', { ids: [7] }]);
  assert.equal(btn().textContent, '🔔', 'nothing new now');
  // wiring: the owner, a manager and a team member all get it (signed in on worktask.in); it is kept for offline
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.equal((app.match(/startBell\(\);/g) || []).length, 3, 'staff view, team pages, owner');
  assert.match(app, /if \(onServer && !isMock\) startBell\(\);/);
  assert.match(readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8'), /'ui\/bell\.js'/);
  assert.match(readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8'), /body\.has-bell \.detail-top \{ padding-right: 56px; \}/, 'it never covers a header\'s buttons');
});

test('every page the same as the owner\'s (23 Oct): "What\'s happening" on the team pages and the staff view is drawn like the owner\'s — 7-day strip, the box under the heading, day + date, time on the right, the same day tags; buttons under the title', async () => {
  const { diaryBlock } = await import('../docs/ui/workparts.js');
  const { readFileSync } = await import('node:fs');
  const TODAY = '2026-10-21', TEAM = readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8');
  const rules = await import('../team/public_html/logic.js');
  const t = { status: 'open', repeat: 'daily', skipSunday: true, startDate: '2026-10-15', createdAt: '2026-10-15 09:00:00' };
  const ups = [{ day: TODAY, note: 'plates kept for drying', state: 'progress', at: `${TODAY} 14:24:00`, by: 'Valar', byId: 3, photos: [] }];
  const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.childNodes || []).forEach((c) => all(c, f, out)); return out; };
  const cls = (n, c) => (n.className || '').split(' ').includes(c);
  const box = document.createElement('div');
  const el = diaryBlock({ rules, t, updates: ups, td: TODAY, staff: true, meId: 3, n: 14, fillBy: '18:00', photos: () => null, onMore: () => {}, box, todayInRows: true });
  assert.ok(cls(el, 'diary'), 'the owner\'s diary section');
  assert.equal(all(el, (n) => cls(n, 'wk')).length, 7, 'the last-7-days strip');
  assert.ok(el.childNodes.includes(box), 'the update box is under the heading');
  const today = all(el, (n) => cls(n, 'diary-day'))[0];
  assert.match(today.textContent, /^Today.*Wed 21 Oct/, 'the day in bold, its date under it');
  assert.ok(all(today, (n) => cls(n, 'diary-time')).length === 1, 'the time on the right');
  assert.match(today.textContent, /You “plates kept for drying”/, 'staff: their own words say You; today is a row too');
  assert.ok(all(el, (n) => cls(n, 'day-tag') && cls(n, 'miss')).length > 0 && all(el, (n) => cls(n, 'day-tag') && cls(n, 'off')).length > 0, 'No progress / Off tags');
  assert.match(TEAM, /h\('h2', null, title\), actions \? h\('div', \{ class: 'state-buttons' \}, actions\) : null\)/, 'team pages: the buttons under the title');
  assert.match(readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8'), /\.detail-top h2 ~ \.state-buttons \{ flex-basis: 100%; justify-content: flex-start; \}/);
});

test('staff view looks like the owner\'s projects page (owner, 23 Oct): search box on top of the menu, Today with its count and dots, 📂 projects, "💡 Suggest a task" at the top of the list, 🔍 on the list, a project\'s steps in a Steps box', async () => {
  const { readFileSync } = await import('node:fs');
  const S = readFileSync(new URL('../docs/ui/staff.js', import.meta.url), 'utf8');
  assert.match(S, /h\('input', \{ class: 'search', type: 'search', placeholder: 'Search…', key: 'staff-menu-search'/);
  assert.match(S, /item\('Today', !state\.sel && state\.section === 'today', \(\) => show\('today'\), d \? String\(d\.tasks\.length\) : null\)/);
  assert.match(S, /h\('li', \{ class: 'menu-dots', key: 'dots'/);
  assert.match(S, /h\('button', \{ class: 'btn primary new-project', onClick: \(\) => open\('suggest'\) \}, '💡 Suggest a task'\)/);
  assert.doesNotMatch(S, /item\('💡 Suggest a task'/, 'no longer in the menu');
  assert.match(S, /block\('Steps', h\('ul', \{ class: 'plist' \}/);
  assert.match(S, /h\('form', \{ class: 'row add-step'/, 'the add-step box takes the line, as the owner\'s');
  assert.doesNotMatch(S, /'📁 '|sec\('📁/, 'projects are 📂, as on the owner\'s page');
});

test('staff ✅ Tasks / 📂 Projects pages: the menu as the owner\'s, ✅ Tasks lists each task with its 📂, ‹ › go one by one, a 📂 project lists its tasks; the owner\'s app sends the 📂 name with each given task', async () => {
  const task = (id, x = {}) => ({ id, title: 'Task ' + id, status: 'open', seq: null, repeat: 'once', dueToday: true, today: null, ...x });
  const data = { today: '2026-10-23', fillBy: '18:00', tasks: [task(11, { folder: 'Ceramic Media', projectRef: 'a', seq: 1, project: 'A' }), task(12)], other: [task(13, { dueToday: false })], suggestions: [] };
  const { s } = fakeStaff2({ 'my.today': () => data, 'task.get': (b) => ({ task: { ...[...data.tasks, ...data.other].find((t) => t.id === b.id) }, updates: [], comments: [] }) });
  await s.load();
  const text = () => s.view().textContent;
  assert.match(text(), /✅ Tasks3/, 'menu: ✅ Tasks with its count');
  assert.match(text(), /📂 Projects1/, 'menu: 📂 Projects with its count (real projects only, owner asked 24 Oct: was 2 with "In no project")');
  s.act.show('tasks');
  assert.match(text(), /3 open tasks · red first/);
  assert.match(text(), /Task 11📂 Ceramic Media/, 'each task with its 📂');
  assert.ok(text().includes('Task 13') && !/Task 13📂 (Other tasks|In no project)/.test(text()), 'a task in no project: no "📂 Other tasks" chip on its row (owner asked 24 Oct, round 3)');
  s.act.open('task:11'); await new Promise((r) => setTimeout(r, 0));
  const nav = (label) => { let f = null; (function w(n) { if (!f && n.nodeName === 'BUTTON' && n.getAttribute && n.getAttribute('aria-label') === label) f = n; (n.childNodes || []).forEach(w); })(s.view()); return f; };
  assert.ok(nav('Previous task').hasAttribute('disabled'), 'first: no previous');
  nav('Next task').__on.click(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.state.sel, 'task:12', '› the next one');
  assert.ok(!/📂 (Other tasks|In no project) ›/.test(text()), 'in no project: no "📂 Other tasks ›" on the task, as on the owner\'s task (owner asked 24 Oct, round 3)');
  s.act.show('projects');
  assert.match(text(), /📂 Ceramic Media1 task( · 1 red)?/); // (owner asked 24 Oct: a task not sent is yellow until updates are due, red after)
  s.act.open('folder:f:Ceramic Media');
  assert.match(text(), /Tasks \(1\).*Task 11/, 'a 📂 project lists its tasks');
  const { readFileSync } = await import('node:fs');
  const DP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.equal((DP.match(/teamApi\('project\.sync', \{ projectRef: p\.id, [^}]*folder: folderOf\(p\)/g) || []).length, 2, 'both sends carry the 📂 name');
  assert.match(DP, /JSON\.stringify\(\[userId, p\.name, steps, !!needsPhoto, folderOf\(p\), p\.about \|\| '', !!\(p\.team && p\.team\.record\)\]\)/, 'a new 📂 sends it again (the signature also has 📒 record, owner asked 24 Oct)');
  assert.match(DP, /\.find\(\(x\) => x && !x\.misc\)/, '📂 Misc is no folder for the team');
});

test('a task\'s chips never repeat its own name as its project (one task given alone)', async () => {
  const { chipsFor } = await import('../docs/ui/workparts.js');
  const base = { status: 'open', repeat: 'once', seq: 1, today: null };
  assert.ok(!chipsFor({ ...base, title: 'Feldspar testing', project: 'Feldspar testing' }, '2026-10-23').textContent.includes('📁'));
  assert.ok(chipsFor({ ...base, title: 'Shoot the tiles', project: 'Glaze photos' }, '2026-10-23').textContent.includes('📁 Glaze photos'));
});

test('Team today table on screen: the counts filter it, By person | By 📂 project, a row opens the task, the table fills the screen until a task is open', async () => {
  const today = { ok: true, today: '2026-10-23', fillBy: '18:00', late: false, people: [{ id: 3, name: 'Valar' }],
    tasks: [{ id: 41, title: 'Fire the kiln', assignee: { id: 3, name: 'Valar' }, status: 'open', repeat: 'daily', today: { at: '2026-10-23 10:00:00', note: 'at 1150', photos: [1] }, unread: 1, lastMessage: { by: 'Valar', text: 'Which clay?', mine: false }, folder: 'Kilns' },
      { id: 42, title: 'Order clay', assignee: { id: 3, name: 'Valar' }, status: 'open', repeat: 'daily', today: null, unread: 0, folder: '' }],
    stuck: [], unread: [], suggestions: [] };
  const { t } = fakeTeam({ 'team.today': () => today, 'task.get': () => ({ task: today.tasks[0], updates: [], comments: [] }), 'users.list': () => ({ users: [] }) });
  t.go('today'); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  let v = t.view();
  assert.match(v.className, /\bwide\b/, 'fills the screen');
  const text = () => t.view().textContent;
  for (const bit of ['✓ Sent 1', '⏳ Not yet 1', '⚠️ Stuck 0', '⏰ Late 0', '💬 New messages 1', 'By person', 'By 📂 project', 'Fire the kiln', '📂 Kilns', 'at 1150', '📷1', 'Valar: Which clay?', '💬 New', '📧 Morning email'])
    assert.ok(text().includes(bit), bit);
  assert.ok(!t.view().textContent.includes('📂 Misc'), 'a task in no project: no "📂 Misc" chip (owner asked 24 Oct)');
  const find = (n, f) => (f(n) ? n : (n.childNodes || []).map((c) => find(c, f)).find(Boolean));
  find(t.view(), (n) => n.nodeName === 'BUTTON' && (n.textContent || '').startsWith('✓ Sent')).__on.click();
  assert.ok(!text().includes('Order clay') && text().includes('Fire the kiln'), 'only the sent ones');
  find(t.view(), (n) => n.nodeName === 'BUTTON' && (n.textContent || '').startsWith('✓ Sent')).__on.click();
  assert.ok(text().includes('Order clay'), 'pressed again: all');
  find(t.view(), (n) => n.nodeName === 'BUTTON' && n.textContent === 'By 📂 project').__on.click();
  assert.equal(t.state.boardGroup, 'project');
  find(t.view(), (n) => n.nodeName === 'TR' && (n.textContent || '').includes('Fire the kiln')).__on.click();
  assert.equal(t.state.sel, 'task:41', 'a row opens its task');
  assert.doesNotMatch(t.view().className, /\bwide\b/, 'with a task open: the table and the task side by side');
});

test('Team today table on screen: 20 tasks a page, ‹ Previous / Next ›, and back to page 1 when the counts or the grouping change', async () => {
  const V = { id: 3, name: 'Valar' };
  const tasks = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, title: 'Job ' + (i + 1), assignee: V, status: 'open', repeat: 'daily', today: null, unread: 0 }));
  const { t } = fakeTeam({ 'team.today': () => ({ ok: true, today: '2026-10-23', fillBy: '18:00', late: false, people: [V], tasks, stuck: [], unread: [], suggestions: [] }) });
  t.go('today'); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  const find = (n, f) => (f(n) ? n : (n.childNodes || []).map((c) => find(c, f)).find(Boolean));
  const rows = () => { const out = []; (function w(n) { if (n.nodeName === 'TR' && / board-row/.test(' ' + (n.className || ''))) out.push(n); (n.childNodes || []).forEach(w); })(t.view()); return out; };
  assert.equal(rows().length, 20, '20 on a page');
  assert.match(t.view().textContent, /Page 1 of 2 · 23 tasks/);
  find(t.view(), (n) => n.nodeName === 'BUTTON' && n.textContent === 'Next ›').__on.click();
  assert.equal(rows().length, 3, 'the rest');
  assert.match(t.view().textContent, /Page 2 of 2/);
  find(t.view(), (n) => n.nodeName === 'BUTTON' && (n.textContent || '').startsWith('⏳ Not yet')).__on.click();
  assert.equal(t.state.boardPage, 1, 'a count pressed: page 1');
});

// ---------------------------------------------------------------- Stage label (owner approved, 23 Oct)
const stageChips = (el) => rAll(el, (n) => / stage-chip /.test(' ' + (n.className || '') + ' ') && !/\bstage-opts\b/.test(n.parentNode && n.parentNode.className || ''));
const btnText = (el, t) => rFind(el, (n) => n.nodeName === 'BUTTON' && (n.textContent || '').startsWith(t));

test('Stage on a task page: the chip near the top (worked out by itself), tap → the 4 stages; a stage chosen is saved; "Automatic" puts it back', () => {
  const s = sampleState(); // p1 Kiln has a ticked step: in progress by itself
  const ui = { selected: 'p1', update: {} };
  const ctx = liveCtx(s, ui);
  let el = renderDetail(ctx);
  const chip = stageChips(el)[0];
  assert.equal(chip.textContent, '🔵 In progress');
  assert.match(chip.className, /stage-inprogress/, 'blue');
  assert.equal(chip.nodeName, 'BUTTON', 'tap to change');
  chip.__on.click();
  el = renderDetail(ctx);
  const opts = rAll(el, (n) => n.nodeName === 'BUTTON' && /\bstage-chip\b/.test(n.className || '') && /stage-opts/.test(n.parentNode.className || ''));
  assert.deepEqual(opts.map((o) => o.textContent), ['⚪ Not started', '🔵 In progress', '🟠 Waiting', '✅ Done']);
  assert.ok(!el.textContent.includes('Automatic'), 'already automatic: no "Automatic"');
  opts[3].__on.click();
  assert.deepEqual(ctx.calls.at(-1), ['setStage', { projectId: 'p1', stage: 'done' }]);
  assert.equal(s.data.projects[0].stage, 'done');
  assert.equal(ui.stageOpen, null, 'the chooser closes');
  el = renderDetail(ctx);
  assert.equal(stageChips(el)[0].textContent, '✅ Done');
  stageChips(el)[0].__on.click();
  btnText(renderDetail(ctx), 'Automatic').__on.click();
  assert.deepEqual(ctx.calls.at(-1), ['setStage', { projectId: 'p1', stage: null }]);
  assert.equal(stageChips(renderDetail(ctx))[0].textContent, '🔵 In progress');
});

test('Stage on a task page: Waiting asks "Waiting for whom?" on the page (no prompt) — quick picks Approval, Management, Info and the people; or a few words typed and Save', () => {
  const s = sampleState(); // People: Ravi
  const ui = { selected: 'p1', update: {} };
  const ctx = liveCtx(s, ui);
  stageChips(renderDetail(ctx))[0].__on.click();
  btnText(renderDetail(ctx), '🟠 Waiting').__on.click();
  let el = renderDetail(ctx);
  assert.ok(el.textContent.includes('Waiting for whom?'));
  const picks = rAll(el, (n) => n.nodeName === 'BUTTON' && /stage-picks/.test(n.parentNode.className || '')).map((b) => b.textContent);
  assert.deepEqual(picks, ['Approval', 'Management', 'Info', 'Ravi']);
  btnText(el, 'Ravi').__on.click();
  assert.deepEqual(ctx.calls.at(-1), ['setStage', { projectId: 'p1', stage: 'waiting', waitingFor: 'Ravi' }]);
  el = renderDetail(ctx);
  assert.equal(stageChips(el)[0].textContent, '🟠 Waiting: Ravi');
  assert.match(stageChips(el)[0].className, /stage-waiting/, 'amber');
  assert.match(stageChips(el)[0].getAttribute('title'), /Waiting since/, 'the day the wait began');
  // typed words
  stageChips(el)[0].__on.click();
  rFind(renderDetail(ctx), (n) => n.nodeName === 'BUTTON' && /stage-opts/.test(n.parentNode.className || '') && n.textContent === '🟠 Waiting').__on.click();
  el = renderDetail(ctx);
  const input = rFind(el, (n) => n.nodeName === 'INPUT' && n.getAttribute('aria-label') === 'Waiting for whom?');
  assert.equal(input.value, 'Ravi', 'what it waits for now, to change');
  assert.equal(input.getAttribute('maxlength'), '80');
  input.__on.input({}, { value: 'Drawing from the client' });
  rFind(el, (n) => n.nodeName === 'FORM' && /stage-wait/.test(n.className)).__on.submit({ preventDefault() {} });
  assert.deepEqual(ctx.calls.at(-1), ['setStage', { projectId: 'p1', stage: 'waiting', waitingFor: 'Drawing from the client' }]);
  const src = readFileSync(new URL('../docs/ui/stage.js', import.meta.url), 'utf8');
  assert.ok(!/\bprompt\(/.test(src), 'no prompt()');
  assert.ok(!/style=/.test(src), 'no inline style (strict CSP)');
});

test('Stage on a task page: a task given to the team that is stuck shows "Waiting" with what they wait for; a 📂 project has no stage chip', () => {
  const s = mainsState(); // c2 given to Ravi; m = 📂 Kilns
  const ctx = liveCtx(s, { selected: 'c2', update: {} });
  ctx.teamProgress = () => ({ stuck: true, waitingFor: 'Material: clay', stuckSince: '2026-10-21' });
  assert.equal(stageChips(renderDetail(ctx))[0].textContent, '🟠 Waiting: Material: clay');
  ctx.ui.selected = 'm';
  assert.ok(!rFind(renderDetail(ctx), (n) => /\bstage-line\b/.test(n.className || '')), 'a 📂 project: no chip of its own (its tasks have theirs)');
});

test('Stage in a 📂 project\'s task table: a chip on each row, filter chips with counts (All N | Not started N | In progress N | Waiting N | Done N); the grip moves rows only when all show', () => {
  const s = mainsState(); // 📂 Kilns: p1 (ticked: in progress), c2 (nothing yet)
  applyOps(s, [makeOp('setStage', { projectId: 'c2', stage: 'waiting', waitingFor: 'Approval' })]);
  const ctx = liveCtx(s, { selected: 'm' });
  const m = s.data.projects.find((p) => p.id === 'm');
  let el = mains.subProjectsBlock(ctx, m);
  const bar = rFind(el, (n) => /\bstage-filters\b/.test(n.className || ''));
  assert.deepEqual(rAll(bar, (n) => n.nodeName === 'BUTTON').map((b) => b.textContent), ['All 2', 'Not started 0', 'In progress 1', 'Waiting 1', 'Done 0']);
  const rowText = () => rAll(el, (n) => n.nodeName === 'TR' && /sub-row/.test(n.className)).map((r) => r.textContent);
  assert.ok(rowText().some((t) => t.includes('Kiln 2') && t.includes('🟠 Waiting: Approval')));
  assert.ok(rowText().some((t) => t.includes('Kiln') && t.includes('🔵 In progress')));
  rAll(bar, (n) => n.nodeName === 'BUTTON')[3].__on.click();
  assert.equal(ctx.ui.subStage.m, 'waiting');
  el = mains.subProjectsBlock(ctx, m);
  assert.equal(rowText().length, 1, 'only the waiting one');
  assert.equal(rAll(el, (n) => n.className === 'sub-grip').length, 0, 'no moving while filtered (the order has gaps)');
  assert.match(el.textContent, /TASKS \(2\)/, 'the title still counts them all');
});

test('Stage on ✅ Tasks (app.js): the chip on each row, the filter chips under All tasks | No project (counts in that list), 📋 Copy list copies what is on screen', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(ui\.view === 'all' && stage\) return byStage\(visibleProjects\(\{ stage: false \}\), ui\.stageFilter, \(p\) => taskStage\(p\)\.stage\);/);
  assert.match(app, /stageFilterBar\(stageCounts\(visibleProjects\(\{ stage: false \}\), \(p\) => taskStage\(p\)\.stage\), ui\.stageFilter,/, 'counts within the All / No project list');
  assert.match(app, /taskListView\(\) && !ui\.search && !ui\.adding \? stageFilterChips\(\) : null,/);
  assert.match(app, /ui\.view === 'all' && !isMainProject\(store\.view\.data, p\) \? stageChip\(taskStage\(p\)\) : null/);
  assert.match(app, /return stageOf\(p, p\.team \? teamProgress\(p\.id\) : null\);/, 'a given task: stuck on the team = waiting');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  for (const c of ['.stage-chip.stage-inprogress', '.stage-chip.stage-waiting', '.stage-chip.stage-done', '.stage-filter.on']) assert.ok(css.includes(c), c);
  assert.match(readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8'), /'ui\/stage\.js'/, 'offline copy has it');
});

test('Stage in the staff view: a chip on each row, filter chips on Today and ✅ Tasks; Stuck asks "Waiting for what?" (Manager, Material, Another person, Other + a few words)', async () => {
  const data = staffData();
  data.tasks[2].today = { id: 90, note: 'No clay', state: 'stuck', waitingFor: 'Material: clay', day: STAFF_DAY, at: STAFF_DAY + ' 10:30:00', photos: [] };
  const { s } = fakeStaff2({ 'my.today': () => data, 'task.get': (b) => ({ task: data.tasks.find((t) => t.id === b.id), updates: [], comments: [] }) });
  await s.load();
  let v = s.view();
  assert.ok(v.textContent.includes('🟠 Waiting: Material: clay'));
  assert.ok(v.textContent.includes('⚪ Not started'));
  const bar = rFind(v, (n) => /\bstage-filters\b/.test(n.className || ''));
  assert.deepEqual(rAll(bar, (n) => n.nodeName === 'BUTTON').map((b) => b.textContent), ['All 3', 'Not started 2', 'In progress 0', 'Waiting 1', 'Done 0']);
  rAll(bar, (n) => n.nodeName === 'BUTTON')[3].__on.click();
  v = rFind(s.view(), (n) => n.getAttribute && n.getAttribute('id') === 'list'); // (the list only: the empty right side lists what is still to send, owner asked 24 Oct)
  assert.ok(v.textContent.includes('Order clay') && !v.textContent.includes('Pack the samples'), 'only the waiting one');
  s.act.show('tasks');
  assert.ok(rFind(s.view(), (n) => /\bstage-filters\b/.test(n.className || '')), '✅ Tasks has them too');
  // Stuck in the update box: "Waiting for what?"
  s.state.stageFilter = '';
  s.act.open('task:11'); await new Promise((r) => setTimeout(r, 0));
  s.state.drafts[11] = { note: 'x', state: 'stuck' };
  v = s.view();
  assert.ok(v.textContent.includes('Waiting for what?'));
  for (const k of ['Manager', 'Material', 'Another person', 'Other']) assert.ok(btnText(v, k), k);
  btnText(v, 'Manager').__on.click();
  assert.equal(s.state.drafts[11].waitPick, 'Manager');
  s.state.drafts[11].state = 'progress';
  assert.ok(!s.view().textContent.includes('Waiting for what?'), 'only with Stuck');
});

test('Stage on the Team today table and a team task: the chip on each row; stuck for "Manager" shows "Waiting: you"; a "Waiting for you" filter', async () => {
  const today = teamToday();
  today.tasks[0].today.waitingFor = 'Manager: which fan?';
  const { t } = fakeTeam({ 'team.today': () => today, 'task.get': () => ({ task: today.tasks[0], updates: [], comments: [] }) });
  t.go('today'); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  const v = t.view();
  assert.ok(v.textContent.includes('🟠 Waiting: you'), 'waiting for the manager: "you"');
  assert.ok(v.textContent.includes('⚪ Not started'));
  const you = btnText(v, '🟠 Waiting for you');
  assert.equal(you.textContent, '🟠 Waiting for you 1');
  you.__on.click();
  assert.equal(t.state.boardFilter, 'you');
  const rows = rAll(t.view(), (n) => n.nodeName === 'TR' && /board-row/.test(n.className || ''));
  assert.deepEqual(rows.map((r) => r.textContent.includes('Fix kiln 2 fan')), [true], 'only the one waiting for you');
  rows[0].__on.click(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  assert.ok(rFind(t.view(), (n) => /\bstage-line\b/.test(n.className || '') && n.textContent === '🟠 Waiting: you'), 'on the task page too');
});

test('Team today table on screen: the 💡 Suggestions count stays while it is pressed, even at 0 (so it can be turned off)', async () => {
  const V = { id: 3, name: 'Valar' };
  const tasks = [{ id: 1, title: 'Job 1', assignee: V, status: 'open', repeat: 'daily', today: null, unread: 0 }];
  const { t } = fakeTeam({ 'team.today': () => ({ ok: true, today: '2026-10-23', fillBy: '18:00', late: false, people: [V], tasks, stuck: [], unread: [], suggestions: [] }) });
  t.state.boardFilter = 'sugg';
  t.go('today'); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  assert.match(t.view().textContent, /💡 Suggestions 0/);
});

test('Team today (review): a stuck task of someone no longer on the team list, with nothing due today, still shows the table (never "No team members yet")', async () => {
  const gone = { id: 9, name: 'Mohan' };
  const stuck = { id: 77, title: 'Fix the dryer', assignee: gone, status: 'open', repeat: 'weekly', dueToday: false, today: null, stuck: true, unread: 0, last: { note: 'part missing' } };
  const { t } = fakeTeam({ 'team.today': () => ({ ok: true, today: '2026-10-23', fillBy: '18:00', late: false, people: [], tasks: [], stuck: [stuck], unread: [], suggestions: [] }) });
  t.go('today'); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  const text = t.view().textContent;
  assert.ok(!text.includes('No team members yet'));
  assert.ok(text.includes('Fix the dryer') && text.includes('Mohan'), 'the stuck task is a row');
});

test('Team today (review 2): a "📅 Not due today" count shows those rows alone; a person\'s "x of y sent" is never green beside a red row', async () => {
  const R = { id: 4, name: 'Ravi' };
  const sent = { id: 81, title: 'Sweep floor', assignee: R, status: 'open', repeat: 'daily', dueToday: true, late: false, today: { at: '2026-10-23 10:00:00', note: 'done' }, unread: 0 };
  const stuckWeekly = { id: 82, title: 'Fix the fan', assignee: R, status: 'open', repeat: 'weekly', dueToday: false, late: false, stuck: true, today: null, unread: 0 };
  const quiet = { id: 83, title: 'Order bags', assignee: R, status: 'open', repeat: 'weekly', dueToday: false, late: false, today: null, unread: 1, lastMessage: { by: 'Ravi', text: 'Which size?' } };
  const { t } = fakeTeam({ 'team.today': () => ({ ok: true, today: '2026-10-23', fillBy: '18:00', late: false, people: [R], tasks: [sent], stuck: [stuckWeekly], unread: [quiet], suggestions: [] }) });
  t.go('today'); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  const find = (n, f) => (f(n) ? n : (n.childNodes || []).map((c) => find(c, f)).find(Boolean));
  const tag = find(t.view(), (n) => n.nodeName === 'SPAN' && n.textContent === '1 of 1 sent');
  assert.ok(tag && !/\bdone-tag\b/.test(tag.className) && /\blate\b/.test(tag.className), 'red, not green: ' + (tag && tag.className));
  find(t.view(), (n) => n.nodeName === 'BUTTON' && (n.textContent || '').startsWith('📅 Not due today 1')).__on.click();
  const text = t.view().textContent;
  assert.ok(text.includes('Order bags') && !text.includes('Sweep floor') && !text.includes('Fix the fan'), 'only the not-due one');
});

test('Right-click in a 📂 project\'s task table opens the menu for that task (with the project it is in); right-click on a step opens the step menu', () => {
  const s = mainsState();
  const ctx = liveCtx(s, { selected: 'm' });
  ctx.openRowMenu = (id, e, from) => ctx.calls.push(['menu', id, from]);
  ctx.openStepMenu = (projectId, stepId) => ctx.calls.push(['stepMenu', projectId, stepId]);
  const m = s.data.projects.find((p) => p.id === 'm');
  const row = rFind(mains.subProjectsBlock(ctx, m), (n) => n.nodeName === 'TR' && /sub-row/.test(n.className) && n.textContent.includes('Kiln 2'));
  row.__on.contextmenu({ preventDefault() {} });
  assert.deepEqual(ctx.calls.at(-1), ['menu', 'c2', 'm']);
  ctx.ui.selected = 'p1';
  ctx.ui.update = {};
  const p1 = s.data.projects.find((p) => p.id === 'p1');
  const step = rFind(renderDetail(ctx), (n) => n.nodeName === 'LI' && /\bstep\b/.test(n.className) && n.dataset.key === 's-' + p1.steps.find((x) => !x.done).id);
  step.__on.contextmenu({ preventDefault() {} });
  assert.deepEqual(ctx.calls.at(-1), ['stepMenu', 'p1', p1.steps.find((x) => !x.done).id]);
});

test('Move box (right-click → Move to another project…): the projects it can go to; Enter moves it (out of the one it was in, one Undo); a typed new name makes the project; Esc closes', () => {
  const s = mainsState(); // c2 in 📂 Kilns
  applyOps(s, [makeOp('createMainProject', { projectId: 'sa', name: 'Supplier approval' })]);
  const ctx = liveCtx(s, {});
  ctx.actMany = (projectId, steps, message) => { ctx.calls.push(['actMany', projectId, steps, message]); for (const [t, a] of steps) applyOps(s, [makeOp(t, a)]); return {}; };
  const c2 = () => s.data.projects.find((p) => p.id === 'c2');
  mains.openMoveBox(ctx, c2(), 'm');
  let el = mains.moveBox(ctx);
  assert.match(el.textContent, /Out of 📂 Kilns, into:/);
  assert.deepEqual(rAll(el, (n) => /main-box-item/.test(n.className || '')).map((b) => b.textContent), ['📂 Supplier approval'], 'not Kilns (it is leaving it)');
  rFind(el, (n) => n.nodeName === 'INPUT').__on.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(ctx.calls.at(-1)[0], 'actMany');
  assert.equal(ctx.calls.at(-1)[3], 'Kiln 2 moved to 📂 Supplier approval');
  assert.deepEqual(c2().parentIds, ['sa'], 'out of Kilns, into Supplier approval');
  assert.equal(ctx.ui.moveBox, null, 'closed');
  assert.equal(mains.moveBox(ctx), null);
  // a new project
  mains.openMoveBox(ctx, c2(), 'sa');
  ctx.ui.moveBox.q = 'Dryers';
  el = mains.moveBox(ctx);
  const create = rFind(el, (n) => /main-box-item/.test(n.className || '') && /create/.test(n.className));
  assert.equal(create.textContent, "+ Create 'Dryers' as a new project");
  create.__on.click();
  const dryers = s.data.projects.find((p) => p.name === 'Dryers');
  assert.ok(dryers, 'the new project');
  assert.deepEqual(c2().parentIds, [dryers.id], 'in the new one only (out of Supplier approval)');
  // Esc
  mains.openMoveBox(ctx, c2(), null);
  rFind(mains.moveBox(ctx), (n) => n.nodeName === 'INPUT').__on.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(ctx.ui.moveBox, null);
});

test('Right-click menu (app.js): drawn over the whole page (list or task page); keeps the browser menu in a text box; stage buttons, Move, Take out, Rename, Finish / Reopen; a step menu and an Inbox menu', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(app, /ui\.capture \? captureBox\(\) : null,\n  rowMenu\(\), \/\/ right-click menu: over the list or the task's page\n  moveBox\(ctx\),/);
  assert.ok(!app.includes('rowMenu())') && !app.includes('empty,\n    rowMenu()'), 'drawn once (no longer only inside the list column)');
  assert.ok(app.includes(`e.target.closest('input:not([type="checkbox"]):not([data-rowmenu]), textarea, select, [contenteditable="true"]')) return;`), 'a text box keeps the browser menu (not a tick box or a step name)');
  assert.ok(readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8').includes("class: 'step-text', value: s.text, 'aria-label': 'Step', key: 'st-' + s.id, 'data-mention': '1', 'data-rowmenu': '1',"), 'a step name opens the step menu');
  for (const label of ["'Move to another project…'", "'Add to a project…'", '`Take out of 📂 ${from.name}`', "'Rename…'", '`Finish ${kindWord(p)}`', '`Reopen ${kindWord(p)}`',
    "'Tick (done)'", "'Waiting on someone'", "'Give to team…'", "'Make it a task'", "'Delete step'", "'Make it a new task'", "'Make it a task in a project…'"]) {
    assert.ok(app.includes(label), label);
  }
  assert.match(app, /task && p\.state !== 'finished' \? stageButtons\(p\) : null,/);
  assert.match(app, /const waiting = !s\.waiting; \/\/ \(read first: the change updates s\)\n      store\.dispatch\('setStepField', \{ projectId: p\.id, stepId: s\.id, field: 'waiting', value: waiting \}\);\n      if \(waiting\) ui\.openStep = s\.id;/, 'Waiting on someone opens "on whom?"');
  assert.match(app, /onContextmenu: \(e\) => openRowMenu\(\{ kind: 'inbox', id: item\.id \}, e\)/);
  assert.match(app, /if \(ui\.moveBox\) \{ ui\.moveBox = null; render\(\); return; \}/, 'Esc closes the move box');
  assert.match(app, /playMoves\(moves\);\n  if \(ui\.rowMenu\) fitMenu\(\);/, 'a menu near the bottom moves up to show all of it');
  assert.match(app, /if \(r\.bottom > window\.innerHeight - 8\) el\.style\.top = Math\.max\(8, window\.innerHeight - 8 - r\.height\) \+ 'px';/);
  assert.ok(!/style=/.test(readFileSync(new URL('../docs/ui/mains.js', import.meta.url), 'utf8')), 'no inline style (strict CSP)');
});

// ---------------------------------------------------------------- keys and right-click on the team / staff pages (owner, 23 Oct)
const listKeys = await import('../docs/ui/listkeys.js');

/** A tiny page for the keys: rows in #list (li.prow with a .prow-btn, or tr.sub-row); a click marks it current. */
function keyDoc(kinds, current = -1) {
  const clicked = [];
  const rows = kinds.map((kind, i) => {
    const r = { nodeName: kind === 'tr' ? 'TR' : 'LI', className: kind === 'tr' ? 'sub-row' : 'prow', i, scrollIntoView() {} };
    const btn = { click: () => { clicked.push(i); rows.forEach((x) => { x.className = x.className.replace(' current', ''); }); r.className += ' current'; } };
    if (kind === 'tr') r.click = btn.click; else r.querySelector = (q) => (q === '.prow-btn' ? btn : null);
    if (i === current) r.className += ' current';
    return r;
  });
  const doc = {
    activeElement: null, clicked,
    getElementById: (id) => (id === 'list' ? { querySelectorAll: () => rows } : id === 'viewer' ? { hidden: true } : null),
    querySelector: () => null,
  };
  return doc;
}
const keyEv = (key, more = {}) => ({ key, prevented: false, preventDefault() { this.prevented = true; }, ...more });

test('Keys on the team / staff pages: ↓ ↑ (and j k) open the next / previous task in the list or Team today table; not while typing, not with ⌘ / Ctrl; Esc closes the menu, then the task; ? shows the keys; n gives a task (owner)', () => {
  const page = { state: { sel: null }, render() {}, back() { this.state.sel = null; this.backs = (this.backs || 0) + 1; }, open(sel) { this.opened = sel; }, go(v) { this.went = v; } };
  let doc = keyDoc(['li', 'tr', 'tr']);
  let e = keyEv('ArrowDown');
  assert.equal(listKeys.pageKey(e, doc, page), true);
  assert.deepEqual(doc.clicked, [0], 'nothing open: ↓ opens the first');
  assert.ok(e.prevented, 'the page does not scroll');
  listKeys.pageKey(keyEv('ArrowDown'), doc, page);
  listKeys.pageKey(keyEv('j'), doc, page);
  assert.deepEqual(doc.clicked, [0, 1, 2], 'next, next (table rows too)');
  listKeys.pageKey(keyEv('ArrowDown'), doc, page);
  assert.deepEqual(doc.clicked, [0, 1, 2], 'at the last: stays');
  listKeys.pageKey(keyEv('k'), doc, page);
  listKeys.pageKey(keyEv('ArrowUp'), doc, page);
  assert.deepEqual(doc.clicked, [0, 1, 2, 1, 0]);
  doc = keyDoc(['li', 'li'], -1);
  listKeys.pageKey(keyEv('ArrowUp'), doc, page);
  assert.deepEqual(doc.clicked, [1], 'nothing open: ↑ opens the last');
  doc = keyDoc(['li', 'li']);
  doc.activeElement = { nodeName: 'TEXTAREA' };
  assert.equal(listKeys.pageKey(keyEv('ArrowDown'), doc, page), false, 'typing in a box: the key is for the box');
  doc.activeElement = null;
  assert.equal(listKeys.pageKey(keyEv('ArrowDown', { metaKey: true }), doc, page), false);
  assert.deepEqual(doc.clicked, []);
  assert.equal(listKeys.pageKey(keyEv('ArrowDown'), keyDoc([]), page), false, 'no rows: the page scrolls');
  // Esc
  page.state.rowMenu = { t: {} }; page.state.sel = 'task:1';
  listKeys.pageKey(keyEv('Escape'), doc, page);
  assert.equal(page.state.rowMenu, null, 'the right-click menu first');
  assert.equal(page.state.sel, 'task:1');
  listKeys.pageKey(keyEv('Escape'), doc, page);
  assert.equal(page.backs, 1, 'then the open task');
  // ? and n
  const said = [];
  listKeys.pageKey(keyEv('?'), doc, page, { say: (x) => said.push(x) });
  assert.equal(said[0], listKeys.STAFF_KEYS_HELP); // (owner asked 24 Oct: staff get their own list, with t a m)
  assert.equal(listKeys.pageKey(keyEv('n'), doc, page), false, 'staff: no "give a task"');
  listKeys.pageKey(keyEv('n'), doc, page, { owner: true });
  assert.equal(page.opened, 'give');
  // wired: the team pages and the staff app
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes("if (space === 'team') { pageKey(e, document, teamView, { say: toast, owner: true }); return; }"));
  assert.ok(app.includes('if (staffView && !store) { pageKey(e, document, staffView, { say: toast }); return; }'));
  // the keys are switched on for every kind of sign-in (they were on for the owner only: staff and managers had none)
  assert.match(app, /staffView = staff;\n  listenKeys\(\);/, 'staff');
  assert.match(app, /space = 'team';\n  listenKeys\(\);/, 'a manager who is not the owner');
  assert.match(app, /store\.setStatus\('offline', 'No connection'\)\);\n  listenKeys\(\);/, 'the owner');
  assert.equal((app.match(/addEventListener\('keydown', onKey\)/g) || []).length, 1, 'once');
  assert.match(readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8'), /'ui\/listkeys\.js', 'ui\/mains\.js', 'ui\/rowmenu\.js',/, 'kept for offline use');
});

test('Right-click on the team pages (Team today table, Tasks list): the task\'s menu — open, message, finish, edit, move to another person, cancel; a suggestion: yes / not now; a closed task: open again', async () => {
  const { t, calls } = fakeTeam();
  t.go('today'); await tick(); await tick();
  const row = rFind(t.view(), (n) => n.nodeName === 'TR' && /board-row/.test(n.className) && n.textContent.includes('Pack samples'));
  row.__on.contextmenu({ preventDefault() {}, clientX: 50, clientY: 60, target: {} });
  let menu = rFind(t.view(), (n) => n.className === 'row-menu');
  assert.ok(menu, 'the menu opens');
  const labels = () => rAll(rFind(t.view(), (n) => n.className === 'row-menu'), (n) => /row-menu-item/.test(n.className || '')).map((b) => b.textContent);
  assert.deepEqual(labels(), ['↗Open', '💬Message Valar', '🏁Finish task', '✎Edit task', '↔Move to another person…', '✖Cancel task']);
  rAll(menu, (n) => /row-menu-item/.test(n.className || '')).find((b) => b.textContent.includes('Finish task')).__on.click();
  await tick();
  assert.deepEqual(calls.find((c) => c.a === 'task.status').body, { id: 22, status: 'done' });
  assert.equal(t.state.rowMenu, null, 'closed');
  // move: opens the task with "move to" ready
  rFind(t.view(), (n) => n.nodeName === 'TR' && /board-row/.test(n.className) && n.textContent.includes('Pack samples')).__on.contextmenu({ preventDefault() {}, target: {} });
  rAll(rFind(t.view(), (n) => n.className === 'row-menu'), (n) => /row-menu-item/.test(n.className || '')).find((b) => b.textContent.includes('Move to another person')).__on.click();
  assert.equal(t.state.sel, 'task:22');
  assert.equal(t.state.moving, 22);
  // a suggestion
  t.state.rowMenu = { t: teamToday().suggestions[0] };
  assert.deepEqual(labels(), ['↗Open', '✓Yes, add it', '✗Not now…']);
  // a closed task
  t.state.rowMenu = { t: { id: 30, title: 'Old', status: 'done', assignee: { id: 7, name: 'Valar' } } };
  assert.deepEqual(labels(), ['↗Open', '💬Message Valar', '↺Open again']);
  // the Tasks list rows (li) have it too
  const W = readFileSync(new URL('../docs/ui/workparts.js', import.meta.url), 'utf8');
  assert.ok(W.includes("return h('li', { key, class: 'prow' + (current ? ' current' : ''), onContextmenu: onMenu || undefined },"));
  assert.ok(readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8').includes("onOpen: () => open('task:' + t.id), onMenu: (e) => openMenuAt(state, render, { t }, e),"));
});

test('Right-click in the staff app (my tasks, a folder\'s table): open, write today\'s update, send a message', async () => {
  const { s } = fakeStaff2();
  s.start(); await tick(); await tick();
  const row = rFind(s.view(), (n) => n.nodeName === 'LI' && /\bprow\b/.test(n.className) && n.__on && n.__on.contextmenu);
  assert.ok(row, 'a task row with a right-click menu');
  row.__on.contextmenu({ preventDefault() {}, target: {} });
  const items = rAll(rFind(s.view(), (n) => n.className === 'row-menu'), (n) => /row-menu-item/.test(n.className || '')).map((b) => b.textContent);
  assert.deepEqual(items.map((x) => x.slice(0, 2)), ['↗O', '📝', '💬']);
  assert.match(items[1], /today's update/);
  rAll(rFind(s.view(), (n) => n.className === 'row-menu'), (n) => /row-menu-item/.test(n.className || ''))[0].__on.click();
  assert.match(s.state.sel, /^task:/, 'opened');
  assert.equal(s.state.rowMenu, null);
  const S = readFileSync(new URL('../docs/ui/staff.js', import.meta.url), 'utf8');
  assert.ok(S.includes("class: 'sub-row', onClick: () => open('task:' + x.t.id), onContextmenu: (e) => openMenuAt(state, render, { t: x.t }, e) },"), 'the folder table too');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes("for (const v of [teamView, staffView]) if (v && v.state.rowMenu && !(e && e.target && e.target.closest && e.target.closest('.row-menu'))) { v.state.rowMenu = null; v.render(); }"), 'a click elsewhere closes it');
});

test('📂 A project\'s page lists the projects inside it (each opens; right-click: its menu) above its TASKS table; "+ 📂 Project inside" makes one; the TASKS table has only tasks', () => {
  const s = mainsState(); // 📂 Kilns: p1, c2
  applyOps(s, [makeOp('createMainProject', { projectId: 'big', name: 'Plant upgrade' }), makeOp('addToProject', { projectId: 'm', parentId: 'big' }), makeOp('addToProject', { projectId: 'o', parentId: 'big' })]);
  const ctx = liveCtx(s, { selected: 'big' });
  ctx.openRowMenu = (id, e, from) => ctx.calls.push(['menu', id, from]);
  const big = s.data.projects.find((p) => p.id === 'big');
  const el = mains.subProjectsBlock(ctx, big);
  assert.match(el.textContent, /PROJECTS INSIDE \(1\)/);
  const inner = rFind(el, (n) => n.nodeName === 'LI' && /inner-project/.test(n.className));
  assert.match(inner.textContent, /📂 Kilns/);
  assert.match(inner.textContent, /2 tasks/, 'its own line');
  rFind(inner, (n) => n.nodeName === 'BUTTON').__on.click();
  assert.deepEqual(ctx.calls.at(-1), ['open', 'm']);
  inner.__on.contextmenu({ preventDefault() {} });
  assert.deepEqual(ctx.calls.at(-1), ['menu', 'm', 'big']);
  assert.match(el.textContent, /TASKS \(1\)/, 'only the task Office move: Kilns is listed above');
  // + 📂 Project inside
  const btn = rFind(el, (n) => n.nodeName === 'BUTTON' && n.textContent === '+ 📂 Project inside');
  globalThis.prompt = () => 'Dryers';
  ctx.toast = (t) => ctx.calls.push(['toast', t]);
  btn.__on.click();
  delete globalThis.prompt;
  const dryers = s.data.projects.find((p) => p.name === 'Dryers');
  assert.deepEqual(dryers.parentIds, ['big']);
  assert.deepEqual(ctx.calls.at(-1), ['toast', 'New project 📂 Dryers inside 📂 Plant upgrade']);
  // the right-click menu and the ⋯ menu offer it for projects (never 📂 Misc)
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes("movable ? item('🔀', task ? 'Move to another project…' : 'Move inside another project…'"));
  assert.ok(app.includes("!task && !p.misc && p.state !== 'finished' ? item('＋', 'New project inside…', () => newInnerProject(ctx, p)) : null,"));
  assert.ok(readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8').includes("p.misc ? null : item(isMainProject(store.view.data, p) ? '📂 Put inside a project…' : '📂 Add to a project…'"));
});

test('Review fixes (23 Oct): staff / manager menus close on a click elsewhere; Move → a new project from a list row leaves its old projects; Copy list on a project copies its tasks only; take-back counts the tasks of its inner projects; one isTyping, one menu item builder', async () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const keys = app.slice(app.indexOf('function listenKeys() {'), app.indexOf('function onKey(e) {'));
  assert.ok(keys.includes("document.addEventListener('click', closeTheirs);"), 'set up for every sign-in (it was only in startOwner)');
  assert.ok(keys.includes("window.addEventListener('scroll', () => closeTheirs(null), true);"));
  assert.ok(!/^function isTyping/m.test(app), 'isTyping comes from ui/listkeys.js');
  assert.equal((app.match(/class: 'row-menu-item'/g) || []).length, 1, 'one menu item builder (menuItem)');
  // Move → new project from a list row (no "from"): only in the new one
  const s = mainsState(); // c2 in 📂 Kilns
  const ctx = liveCtx(s, {});
  const c2 = () => s.data.projects.find((p) => p.id === 'c2');
  mains.openMoveBox(ctx, c2(), null);
  ctx.ui.moveBox.q = 'Dryers';
  rFind(mains.moveBox(ctx), (n) => /main-box-item/.test(n.className || '') && /create/.test(n.className)).__on.click();
  const dryers = s.data.projects.find((p) => p.name === 'Dryers');
  assert.deepEqual(c2().parentIds, [dryers.id], 'out of Kilns too');
  // Copy list: tasks only (not the projects inside)
  applyOps(s, [makeOp('createMainProject', { projectId: 'big', name: 'Plant upgrade' }), makeOp('addToProject', { projectId: 'm', parentId: 'big' }), makeOp('addToProject', { projectId: 'o', parentId: 'big' })]);
  let copied = null;
  ctx.copyList = (list) => { copied = list.map((p) => p.id); };
  rFind(mains.subProjectsBlock(ctx, s.data.projects.find((p) => p.id === 'big')), (n) => n.nodeName === 'BUTTON' && n.textContent === '📋 Copy list').__on.click();
  assert.deepEqual(copied, ['o']);
  // take back: the tasks inside its projects that went with it are counted
  const { takeBackQuestion } = await import('../docs/ui/detail.js');
  const big = s.data.projects.find((p) => p.id === 'big');
  big.team = { userId: 7, name: 'Ravi' };
  s.data.projects.find((p) => p.id === 'p1').team = { userId: 7, name: 'Ravi', viaProject: 'big' };
  assert.match(takeBackQuestion(s.data, big), /The 1 task that went with it comes back too/);
});

test('🔁 Move every (owner asked 23 Oct): a chip on the task page ("🔁 every 3 days") opens 1 2 3 5 7 14 30 days; picking saves it; the dot says why; Today says "on track"; the right-click menu has the same choices', () => {
  const s = mainsState(); // p1 'Kiln' in 📂 Kilns
  const ctx = liveCtx(s, { selected: 'p1', update: {} });
  ctx.toast = (t) => ctx.calls.push(['toast', t]);
  let el = renderDetail(ctx);
  const chip = rFind(el, (n) => n.nodeName === 'BUTTON' && /info-chip/.test(n.className || '') && n.textContent === '🔁 every 3 days');
  assert.ok(chip, 'the chip, with the 3-day start');
  chip.__on.click();
  el = renderDetail(ctx);
  const picks = rAll(rFind(el, (n) => /every-picker/.test(n.className || '')), (n) => n.nodeName === 'BUTTON');
  assert.deepEqual(picks.map((b) => b.textContent), ['1 day', '2 days', '3 days', '5 days', '7 days', '14 days', '30 days']);
  assert.equal(picks[2].getAttribute('aria-pressed'), 'true', 'the one now');
  picks[4].__on.click();
  assert.deepEqual(ctx.calls.find((c) => c[0] === 'setMoveEvery'), ['setMoveEvery', { projectId: 'p1', days: 7 }]);
  assert.equal(s.data.projects.find((p) => p.id === 'p1').moveEvery, 7);
  assert.ok(ctx.calls.some((c) => c[0] === 'toast' && c[1] === 'Kiln: should move every 7 days'));
  assert.equal(ctx.ui.everyOpen, null, 'closed');
  const dot = rFind(renderDetail(ctx), (n) => n.nodeName === 'SPAN' && /^dot /.test(n.className || ''));
  assert.match(dot.getAttribute('title'), /should move every 7 days/, 'the dot says why');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes("!p.misc && p.state !== 'finished' ? everyButtons(p) : null,"), 'right-click: the same choices');
  assert.ok(app.includes("store.dispatch('setMoveEvery', { projectId: p.id, days: n })"));
  assert.ok(app.includes("' on track'") && app.includes('On track (${done.length})'), 'Today: "on track", not "done today" (short, so it fits one line: owner 24 Oct)');
  assert.ok(!readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8').includes('Not looked at today'), 'no old daily words');
});

// ---------------------------------------------------------------- 📒 record tasks + 📷 step photos (owner asked 24 Oct)
test('📒 offline sender: an entry kept on the phone goes as entry.add (written time, clientId), then its photos one by one (entry.photo, clientId-p0…); more than 2 days old is given back with its words', async () => {
  const box = staffBox.memOutbox();
  const calls = [];
  const api = async (a, body, form) => {
    calls.push({ a, body: form ? Object.fromEntries([...body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : 'file'])) : body });
    if (a === 'entry.add') return { ok: true, entry: { id: 77 } };
    return { ok: true };
  };
  let at = new Date('2026-10-22T06:00:00Z');
  const given = [];
  const ob = staffBox.createOutbox({ box, api, rules: teamRules, userId: () => 7, signedIn: () => true, lock: null, now: () => at, giveBack: (it, why) => given.push([it.text, why]) });
  await ob.queue({ kind: 'entry', taskId: 21, text: 'Dispatch Monday', files: [new Blob(['a']), new Blob(['b'])] });
  const [it] = await ob.list();
  assert.deepEqual(await ob.flush(), { sent: 1, gave: 0 });
  assert.equal(calls[0].a, 'entry.add');
  assert.deepEqual([calls[0].body.taskId, calls[0].body.text, calls[0].body.clientId, calls[0].body.writtenAt], [21, 'Dispatch Monday', it.clientId, at.toISOString()]);
  assert.deepEqual(calls.slice(1).map((c) => [c.a, c.body.entryId, c.body.clientId]), [['entry.photo', '77', `${it.clientId}-p0`], ['entry.photo', '77', `${it.clientId}-p1`]]);
  // too old: given back (the words are shown to copy)
  await ob.queue({ kind: 'entry', taskId: 21, text: 'Old one', files: [] });
  at = new Date('2026-10-26T06:00:00Z');
  const r = await ob.flush();
  assert.equal(r.gave, 1);
  assert.match(given[0][1], /too long ago/);
  const show = teamRules.giveBackShow({ kind: 'entry', text: 'Old one' }, 'too old', false);
  assert.equal(show.sticky, true, 'the words stay to copy');
  assert.match(show.body, /Old one/);
});

test('📒 staff app: a record is always on the list, never red and never counted as "to send"; its page has "Add an entry" and the logbook (newest first, your own recent ones can be removed); Add sends entry.add then its photos; offline it is kept on the phone', async () => {
  const rec = { id: 21, title: 'Follow up clay order', kind: 'log', status: 'open', repeat: 'daily', entriesToday: 2, today: { id: 5, day: STAFF_DAY, note: 'x', state: 'progress', at: STAFF_DAY + ' 11:00:00', photos: [] } };
  const quiet = { ...rec, id: 22, title: 'Glaze stock', entriesToday: 0, today: null };
  const entries = [
    { id: 3, taskId: 21, text: 'Dispatch Monday', at: STAFF_DAY + ' 11:00:00', day: STAFF_DAY, byId: 7, by: 'Valar', photos: [9] },
    { id: 2, taskId: 21, text: 'PO sent', at: STAFF_DAY + ' 10:42:00', day: STAFF_DAY, byId: 1, by: 'Boss', photos: [] },
  ];
  const { s, calls } = fakeStaff2({
    'my.today': () => ({ ...staffData(), tasks: [...staffData().tasks, rec, quiet] }),
    'task.get': () => ({ task: rec, updates: [], comments: [], entries }),
    'entry.add': () => ({ entry: { id: 4 } }),
  });
  s.start(); await tick(); await tick();
  let v = s.view();
  const rows = rAll(v, (n) => n.nodeName === 'LI' && /\bprow\b/.test(n.className || ''));
  const r21 = rows.find((r) => r.textContent.includes('Follow up clay order'));
  const r22 = rows.find((r) => r.textContent.includes('Glaze stock'));
  assert.match(r21.textContent, /📒 2 entries today/);
  assert.match(r22.textContent, /📒 Record · add entries when something happens/);
  assert.ok(rFind(r22, (n) => /\bdot grey\b/.test(n.className || '')), 'never red');
  assert.match(v.textContent, /2 of 4 sent/, 'a record with entries today counts as sent, one without is not counted (owner asked 24 Oct: the same count as Team today; was "1 of 3")');
  s.open('task:21'); await tick(); await tick();
  v = s.view();
  assert.ok(rFind(v, (n) => n.nodeName === 'TEXTAREA' && n.dataset.key === 'up-21'), 'the entry box');
  const book = rFind(v, (n) => n.className === 'logbook');
  assert.deepEqual(rAll(book, (n) => /\blog-entry\b/.test(n.className || '')).map((e) => e.textContent.includes('Dispatch') ? 'Dispatch' : 'PO'), ['Dispatch', 'PO'], 'newest first');
  assert.match(book.textContent, /PO sent · Boss/, 'who, when it is not you');
  assert.equal(rAll(book, (n) => n.nodeName === 'BUTTON' && n.textContent === '✕').length, 1, 'only your own entry can be removed');
  assert.ok(!rFind(v, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Send'), 'no daily update box');
  // add an entry with a photo
  s.state.entryDrafts[21] = 'Truck left';
  s.state.entryFiles[21] = [new Blob(['p'])];
  assert.equal(await s.act.sendEntry(rec), '');
  const add = calls.find((c) => c.a === 'entry.add');
  assert.deepEqual([add.body.taskId, add.body.text], [21, 'Truck left']);
  const ph = calls.find((c) => c.a === 'entry.photo');
  assert.ok(ph, 'then its photo');
  assert.equal(s.state.entryDrafts[21], undefined, 'the box is empty again');
  assert.equal(await s.act.sendEntry(rec), 'Write the entry first.');
});

test('📒 team pages: "Give a task" has 📅 Daily update | 📒 Record (sends kind "log"); a record\'s page shows its logbook; the Tasks list says "📒 Record · 2 entries today"; 📷 counts on a project\'s steps', async () => {
  const { t, calls } = fakeTeam({ 'task.save': (b) => ({ task: { id: 99, ...b } }) });
  t.open('give'); await tick(); await tick();
  let v = t.view();
  const seg = rFind(v, (n) => n.nodeName === 'BUTTON' && n.textContent === '📒 Record (entries)');
  assert.ok(seg);
  seg.__on.click();
  t.state.giveForm.assigneeId = 7; t.state.giveForm.title = 'Follow up clay';
  v = t.view();
  assert.match(v.textContent, /They add an entry/);
  rFind(v, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Give task').__on.click();
  await tick(); await tick();
  assert.equal(calls.find((c) => c.a === 'task.save').body.kind, 'log');
  const TEAM = readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8');
  assert.ok(TEAM.includes("t.kind === 'log' ? block('📒 Record', logbookBlock({ entries: state.detail.entries || [], photos, meId: state.user.id, td }))"), 'its page: the logbook');
  assert.ok(TEAM.includes("t.kind === 'log' ? recordLine(t) : repeatLabel(t)"), 'the Tasks list line');
  assert.ok(TEAM.includes("+ pics(t),"), 'the 📷 count on a project\'s steps');
});

test('📷 Daily Projects: a step given to the team shows the photos the person sent on it (small, a tap opens one); the give box has "📒 Record", sent with project.sync as kind "log" and kept on the task (p.team.record)', async () => {
  const { stepPhotos } = await import('../docs/ui/detail.js');
  const ctx = { teamPhoto: (id) => (id === 2 ? 'blob:x' : null) };
  const el = stepPhotos(ctx, { id: 5, today: { photos: [1, 2] }, last: { photos: [2] } });
  assert.equal(rAll(el, (n) => n.nodeName === 'IMG').length, 1, 'the one loaded');
  assert.equal(el.childNodes.length, 2, 'each photo once (today and the one before)');
  assert.equal(stepPhotos(ctx, { id: 6, today: null, last: null }), null);
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes("kind: record ? 'log' : '', reason: person ? '' : 'taken'"), 'giving sends the kind');
  assert.ok(app.includes("kind: p.team.record ? 'log' : '', reason: p.state,"), 'and every later sync');
  assert.ok(readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8').includes("' 📒 Record (entries, not a daily update)'"));
  // the task keeps it
  const s = mainsState();
  applyOps(s, [makeOp('setProjectTeam', { projectId: 'o', userId: 7, name: 'Ravi', record: true })]);
  assert.deepEqual(s.data.projects.find((p) => p.id === 'o').team.record, true);
  assert.equal(applyOps(s, [makeOp('setProjectTeam', { projectId: 'o', userId: 7, name: 'Ravi', record: true })])[0], undefined, 'the same again: no change');
  applyOps(s, [makeOp('setProjectTeam', { projectId: 'o', userId: 7, name: 'Ravi' })]);
  assert.equal(s.data.projects.find((p) => p.id === 'o').team.record, undefined, 'back to a daily update');
});

test('📒 the chips on a record say "📒 Record" and "✓ 3 entries today" (not "Every day" / "Sent today")', async () => {
  const wp = await import('../docs/ui/workparts.js');
  const chips = (t) => rAll(wp.chipsFor(t, '2026-10-24'), (n) => String(n.className || '').split(' ').includes('info-chip')).map((n) => n.textContent);
  assert.deepEqual(chips({ kind: 'log', repeat: 'daily', status: 'open', entriesToday: 3, today: { id: 1 } }), ['📒 Record', '✓ 3 entries today']);
  assert.deepEqual(chips({ kind: 'log', repeat: 'daily', status: 'open', entriesToday: 0, today: null }), ['📒 Record']);
  assert.ok(chips({ kind: 'task', repeat: 'daily', skipSunday: true, status: 'open', today: { id: 1 } }).includes('✓ Sent today'), 'a daily update as before');
});

test('The app is called "Task List" for everyone (owner asked 24 Oct): home-screen names, page titles, the header, sign-in, notifications; old "Marked done in Work Task" history lines still read as the team\'s work', () => {
  const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  for (const p of ['docs/manifest.webmanifest', 'team/public_html/manifest.webmanifest']) {
    const m = JSON.parse(read(p));
    assert.deepEqual([m.name, m.short_name], ['Task List', 'Task List'], p);
  }
  assert.match(read('docs/index.html'), /<title>Task List<\/title>/);
  assert.match(read('docs/index.html'), /apple-mobile-web-app-title" content="Task List"/);
  assert.match(read('team/public_html/index.html'), /<title>Task List<\/title>/);
  assert.match(read('docs/ui/signin.js'), /h\('h1', null, 'Task List'\)/);
  assert.match(read('docs/ui/staff.js'), /h\('span', null, 'Task List'\)\)/, 'staff header');
  assert.match(read('docs/ui/team.js'), /h\('span', null, 'Task List'\)\)/, 'team pages header');
  assert.match(read('docs/app.js'), /h\('span', null, 'Task List'\)\)/, 'owner header');
  assert.match(read('team/public_html/sw.js'), /showNotification\(m\.title \|\| 'Task List',/);
  // no old name left in what people see (strings in the screens' code, not notes for developers)
  for (const p of ['docs/app.js', 'docs/ui/staff.js', 'docs/ui/team.js', 'docs/ui/people.js', 'docs/ui/signin.js', 'docs/ui/detail.js']) {
    const shown = read(p).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/\s.*$/, ''));
    const left = shown.filter((l) => /(['"`])[^'"`]*(Daily Projects|Work Task)/.test(l) && !l.includes('Marked done (in Work Task|by the team)'));
    assert.deepEqual(left, [], p);
  }
  assert.match(read('docs/ui/detail.js'), /!\/\^👥 Marked done \(in Work Task\|by the team\)\/\.test\(String\(n\.text\)\)/, 'old history lines still count as the team\'s');
});

// ---------------------------------------------------------------- screen review fixes 3–25 (owner, 24 Oct)
test('Review 3: Today and the tracker speak of "on track", never "got your attention today" / "not looked at"', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('`🎉 All ${sc.total} tasks on track!`'));
  assert.ok(!app.includes('Every task got your attention today.'));
  const tr = readFileSync(new URL('../tools/tracker.mjs', import.meta.url), 'utf8');
  assert.ok(!tr.includes('red (not looked at)') && tr.includes('green (on track)'));
});

test('Review 4: the staff ✅ Tasks page shows a record as "📒 3 entries today", not "✓ Sent"', async () => {
  const rec = { id: 21, title: 'Follow up clay', kind: 'log', status: 'open', repeat: 'daily', entriesToday: 3, today: { id: 5, day: STAFF_DAY, note: 'x', state: 'progress', at: STAFF_DAY + ' 11:00:00', photos: [] } };
  const { s } = fakeStaff2({ 'my.today': () => ({ ...staffData(), tasks: [...staffData().tasks, rec] }) });
  s.start(); await tick(); await tick();
  s.act.show('tasks');
  const row = rAll(s.view(), (n) => n.nodeName === 'LI' && /\bprow\b/.test(n.className || '')).find((r) => r.textContent.includes('Follow up clay'));
  assert.match(row.textContent, /📒 3 entries today/);
  assert.doesNotMatch(row.textContent, /✓ Sent/);
});

test('Review 5: a cancelled (taken back) step says "✖ Cancelled", never "✅ Done"', async () => {
  const { stageText } = await import('../docs/rules.js');
  const { stageChip } = await import('../docs/ui/stage.js');
  const st = teamRules.teamStage({ status: 'cancelled', today: { state: 'progress' } });
  assert.equal(st.cancelled, true);
  assert.equal(stageText(st), '✖ Cancelled');
  assert.match(stageChip(st).className, /stage-cancelled/);
  assert.equal(stageText(teamRules.teamStage({ status: 'done' })), STAGE_DONE_LABEL);
});
const STAGE_DONE_LABEL = '✅ Done';

test('Review 7: the dashboard\'s "Most worked" counts real work only (not adding steps); "Needs attention" lists the red and yellow ones with why', () => {
  const s = { data: emptyData(), history: {} };
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  applyOps(s, [makeOp('createProject', { projectId: 'a', name: 'Only steps added', deadline: null }), makeOp('addStep', { projectId: 'a', stepId: 's1', text: 'x' }), makeOp('addStep', { projectId: 'a', stepId: 's2', text: 'y' }),
    makeOp('createProject', { projectId: 'b', name: 'Worked on', deadline: null }), makeOp('addWorkNote', { projectId: 'b', noteId: 'n', text: 'did it' }),
    makeOp('createProject', { projectId: 'c', name: 'Late one', deadline: null }), makeOp('setProjectField', { projectId: 'c', field: 'deadline', value: '2020-01-01' })]);
  const el = renderDashboard(fakeCtx(s, {}));
  const card = (title) => rFind(el, (n) => n.nodeName === 'H3' && n.textContent === title).parentNode;
  const worked = card('Most worked this month').textContent;
  assert.ok(worked.includes('Worked on') && !worked.includes('Only steps added'), worked);
  const att = card('Needs attention').textContent;
  assert.match(att, /Late one.*Overdue · /); // (owner asked 24 Oct, was "Target date passed")
  assert.ok(!att.includes('Worked on'));
  assert.ok(today);
});

test('Review 8: a 📂 project that only holds projects says where its tasks are, and its diary does not ask it for an update of its own', () => {
  const s = mainsState(); // 📂 Kilns holds p1, c2
  applyOps(s, [makeOp('createMainProject', { projectId: 'big', name: 'Plant upgrade' }), makeOp('addToProject', { projectId: 'm', parentId: 'big' })]);
  const ctx = liveCtx(s, { selected: 'big', update: {} });
  const big = s.data.projects.find((p) => p.id === 'big');
  assert.match(mains.subProjectsBlock(ctx, big).textContent, /No tasks right in it — the projects above hold 2 tasks\./);
  const text = renderDetail(ctx).textContent;
  assert.ok(!text.includes('Waiting for today\'s update') && !text.includes('No progress'), 'no update of its own is asked for');
});

test('Review 9: People lists your team members who are not in People yet (one tap adds them); not off the server', async () => {
  const s = sampleState();
  const ctx = liveCtx(s, {});
  ctx.onServer = true;
  ctx.teamAccounts = () => [{ id: 3, name: 'Ruturaj', username: 'ruturaj', active: true }, { id: 1, name: 'Boss', owner: true, active: true }];
  ctx.selectPerson = () => {}; ctx.toast = () => {};
  const { renderPeopleList: list } = await import('../docs/ui/people.js');
  let el = list(ctx);
  const btn = rFind(el, (n) => n.nodeName === 'BUTTON' && n.textContent === '+ Ruturaj');
  assert.ok(btn, 'shown, the owner never');
  assert.ok(!rFind(el, (n) => n.nodeName === 'BUTTON' && n.textContent === '+ Boss'));
  btn.__on.click();
  assert.ok((s.data.people || []).some((p) => p.name === 'Ruturaj'), 'added');
  el = list(ctx);
  assert.ok(!rFind(el, (n) => n.nodeName === 'BUTTON' && n.textContent === '+ Ruturaj'), 'then not offered again');
  ctx.onServer = false;
  assert.ok(!rFind(list(ctx), (n) => /team-join/.test(n.className || '')));
});

test('Review 11 + 19: team / staff forms put the words above a full-width box and keep buttons their own size; the person page\'s email box is wide; sign-in date as a day', () => {
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.layout\.staff \.stack > label:not\(\.row\):not\(\.check\) \{ display: flex; flex-direction: column; gap: 4px; \}/);
  assert.match(css, /\.layout\.staff \.stack > \.btn \{ align-self: flex-start; \}/);
  assert.match(css, /\.layout\.staff \.stack > label > code \{ display: block;/, 'the Redirect URI on its own line (no "registerhttp")');
  const people = readFileSync(new URL('../docs/ui/people.js', import.meta.url), 'utf8');
  assert.ok(people.includes("type: 'email', class: 'wide-input',"));
  assert.ok(people.includes('last signed in ${fmtDay(String(u.lastLogin).slice(0, 10))}'));
});

test('Review 12–14 + 16 + 18: top icons have a small word on a computer (phone: the title gets the room); Team in the menu; phone steps on one line; bottom bar Today | Tasks | Projects | Inbox | More; "👥 Give" and "📅 History"', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  for (const w of ["iconCap('Capture')", "iconCap('Find')", "iconCap('Refresh')", "iconCap('Saved')", "iconCap('Team')"]) assert.ok(app.includes(w), w);
  assert.ok(app.includes("h('a', { class: 'menu-item', href: '#team', title: 'Tasks you gave and their daily updates' }, h('span', null, '👥 Team'))"));
  assert.match(app, /tab\('today', '☀︎', 'Today'\),\n\s*tab\('all', '✅', 'Tasks'\),\n\s*tab\('mains', '📂', 'Projects'\),\n\s*tab\('inbox', '📥', 'Inbox'/);
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.icon-cap \{ display: none; \}\n\s*\.list-head \.status\.sync\.ok, \.list-head \.capture-btn \{ display: none; \}/);
  assert.match(css, /\.step-main \.tag\.me, \.step-main \.days-link \{ display: none; \}/);
  assert.match(css, /body\.has-bell \.detail-top \{ padding-right: 56px; \}/);
  const det = readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8');
  assert.ok(det.includes("'👥 Give'") && det.includes("'📅 History'"));
});

test('Review 15: a red / yellow task says why under its title ("🔴 Target date passed …")', () => {
  const s = sampleState();
  applyOps(s, [makeOp('setProjectField', { projectId: 'p1', field: 'deadline', value: '2020-01-01' })]);
  const why = rFind(renderDetail(fakeCtx(s, { selected: 'p1', update: {} })), (n) => /why-line/.test(n.className || ''));
  assert.ok(why);
  assert.match(why.className, /red/);
  assert.match(why.textContent, /^🔴 Overdue · /); // (owner asked 24 Oct, was "Target date passed")
});

test('Review 17: a task in no project has no "📂 Misc" chip on its row', () => {
  const s = sampleState();
  applyOps(s, [makeOp('makeMisc', {})]);
  assert.equal(mains.projectChips(s.data, s.data.projects.find((p) => p.id === 'p1')), null);
});

test('Review 21: the Give a task form hides "How often" for a 📒 Record', async () => {
  const { t } = fakeTeam();
  t.open('give'); await tick(); await tick();
  assert.ok(t.view().textContent.includes('How often'));
  t.state.giveForm.record = true;
  assert.ok(!t.view().textContent.includes('How often'));
});

test('Review 23: Today with nothing to do opens the On track list by itself (never an empty page); a tap folds it', () => {
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes("const showDone = ui.showDoneToday === undefined || ui.showDoneToday === null ? !open.length : !!ui.showDoneToday;"));
  assert.equal((app.match(/const showDone = ui\.showDoneToday === undefined/g) || []).length, 2, 'the list and ↓ ↑ agree');
});

test('Review 24: Inbox suggestions need two words in common (one, e.g. "glaze", is too weak) or the person named; "+ New task" is on each item', async () => {
  const { inboxMatches } = await import('../docs/rules.js');
  const s = { data: emptyData(), history: {} };
  applyOps(s, [makeOp('createProject', { projectId: 'g', name: 'Glaze trial batch 7' }), makeOp('addStep', { projectId: 'g', stepId: 'x', text: 'Mix' }),
    makeOp('createProject', { projectId: 'k', name: 'Kiln door seal' }), makeOp('addStep', { projectId: 'k', stepId: 'y', text: 'Order rope' })]);
  assert.deepEqual(inboxMatches(s.data, 'Ask Satheesh about the new glaze supplier'), [], 'one word is not enough');
  assert.deepEqual(inboxMatches(s.data, 'Kiln door seal rope arrived').map((p) => p.id), ['k']);
  assert.ok(readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8').includes("}, '+ New task'),"));
});

test('Review 25: the Diary shows your team\'s newest updates on the tasks you gave, and uses the whole page', async () => {
  const { diaryEntries } = await import('../docs/reports.js');
  const s = sampleState(); // p1 'Kiln'
  const byDay = diaryEntries(s.data, s.history, [{ projectRef: 'p1', title: 'Fire samples', assignee: { name: 'Ravi' }, today: { id: 9, day: '2026-10-24', note: 'Fired at 1150', at: '2026-10-24 10:00:00' }, last: null }]);
  const line = (byDay.get('2026-10-24') || []).find((l) => l.text.startsWith('👥'));
  assert.ok(line);
  assert.equal(line.text, '👥 Ravi (Fire samples): Fired at 1150');
  assert.equal(line.projectId, 'p1');
  assert.match(readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8'), /\.layout\.wide \.diary \{ max-width: none; \}/);
});

test('Review2 2 (owner, 24 Oct): a paused or finished task never says "Waiting for today\'s update" (it says ⏸ Paused / ✓ Finished)', () => {
  for (const [op, word] of [['pause', '⏸ Paused'], ['finish', '✓ Finished']]) {
    const s = { data: emptyData(), history: {} };
    applyOps(s, [makeOp('createProject', { projectId: 'q', name: 'Stopped one', deadline: null }), makeOp(op, { projectId: 'q' })]);
    const text = renderDetail(liveCtx(s, { selected: 'q', update: {} })).textContent;
    assert.ok(!text.includes('Waiting for today\'s update') && !text.includes('No progress'), op + ': ' + text.slice(0, 200));
    assert.ok(text.includes(word), op);
  }
});

test('Review2 3 (owner, 24 Oct): a finished task shows "✓ Finished <day>", no target date and no "+ Add the next step"', () => {
  const s = { data: emptyData(), history: {} };
  applyOps(s, [makeOp('createProject', { projectId: 'f', name: 'All done', deadline: '2030-01-05' }), makeOp('finish', { projectId: 'f' })]);
  const el = renderDetail(liveCtx(s, { selected: 'f', update: {} }));
  assert.ok(!rFind(el, (n) => n.nodeName === 'FORM' && /add-step/.test(n.className || '')), 'no add-step form');
  assert.match(el.textContent, /✓ Finished \d/);
  assert.ok(!el.textContent.includes('Target 5 Jan'), 'no target any more');
});

test('Review2 5 (owner, 24 Oct): the Daily round, week boxes and dashboard say "on track", never "N of M green"', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['../docs/app.js', '../docs/ui/dashboard.js', '../docs/rules.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/of \$\{[^}]+\} green|all green[`'🎉 ]|'tasks green'/.test(src), f);
  }
  const { readFileSync: r } = await import('node:fs');
  assert.match(r(new URL('../docs/app.js', import.meta.url), 'utf8'), /`\$\{greenCount\} of \$\{active\.length\} on track · \$\{left\} left`/);
});

test('Review2 7 (owner, 24 Oct): your own note about a step shows its 📷 photo under the step, not only in What\'s happening', () => {
  const s = { data: emptyData(), history: {} };
  applyOps(s, [makeOp('createProject', { projectId: 'ph', name: 'Test the glaze', deadline: null }), makeOp('addStep', { projectId: 'ph', stepId: 'st1', text: 'Fire test tile' }),
    makeOp('addWorkNote', { projectId: 'ph', noteId: 'wn1', text: 'Tile came out fine', stepId: 'st1' }),
    makeOp('addFile', { projectId: 'ph', fileId: 'f1', name: 'tile.jpg', sha: 'abc123', size: 10, type: 'image/jpeg', noteId: 'wn1' })]);
  const el = renderDetail(fakeCtx(s, { selected: 'ph', update: {} }));
  const notes = rFind(el, (n) => /step-notes/.test(n.className || ''));
  assert.ok(notes && notes.textContent.includes('Tile came out fine'));
  assert.ok(rFind(notes, (n) => /step-photos/.test(n.className || '')), 'the photo sits under the step');
});

test('Review2 8 + 9 (owner, 24 Oct): the 🔔 never covers the Daily round\'s End or the keyboard shortcuts list; the list scrolls instead of being cut off', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /body\.has-bell \.round-top \{ padding-right: 56px; \}/);
  assert.match(css, /body:has\(\.keys-help\) \.bell-wrap \{ display: none; \}/);
  assert.match(css, /\.keys-help \{[^}]*max-height: calc\(100vh - 100px\); overflow-y: auto;/);
});

test('Review2 10 (owner, 24 Oct): "👥 Team" in the menu looks like the other items (not a blue link) and "More ▸" lines up with them', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /a\.menu-item \{ color: inherit; text-decoration: none; \}/);
  assert.match(css, /\.menu-list \.menu-item\.more-toggle \{ padding: 7px 10px;/);
});

test('Review2 11 (owner, 24 Oct): "9 of 11 on track" stays on one line; the Summary / Daily round buttons wrap under it instead', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.progress-row \{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.progress-row \.progress-text \{ margin: 0; white-space: nowrap; \}/);
  assert.ok(!readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8').includes('all green!'));
});

test('Review2 12 (owner, 24 Oct): the staff task page has today\'s update box above 💬 Messages', async () => {
  const { s } = fakeStaff2({ 'task.get': () => ({ ok: true, task: staffData().tasks[0], updates: [], comments: [{ id: 3, by: 'Boss', text: 'Please send a photo', mine: false, at: '2026-10-21 11:30:00' }] }) });
  s.start(); await tick(); await tick();
  s.act.open('task:' + staffData().tasks[0].id); await tick(); await tick();
  const txt = s.view().textContent;
  const box = txt.indexOf('Send'), msgs = txt.indexOf('Please send a photo');
  assert.ok(box >= 0 && msgs > box, 'the update box comes first: ' + txt.slice(0, 300));
});

test('Review2 13 + 14 (owner, 24 Oct): staff and team pages have the phone bottom bar (☰ More opens the menu); staff rows have no empty left gap; Team today\'s chips are one sideways line on a phone', async () => {
  const labels = (v) => rAll(v, (n) => n.nodeName === 'NAV' && /tabbar/.test(n.className || ''))[0];
  const { s } = fakeStaff2();
  s.start(); await tick(); await tick();
  let bar = labels(s.view());
  assert.ok(bar, 'staff: a bottom bar');
  assert.deepEqual(rAll(bar, (n) => /tab-label/.test(n.className || '')).map((n) => n.textContent), ['Today', 'Tasks', 'Projects', 'Search', 'More']);
  rAll(bar, (n) => n.nodeName === 'BUTTON').find((b) => b.textContent.includes('Tasks')).__on.click();
  assert.equal(s.state.section, 'tasks');
  rAll(labels(s.view()), (n) => n.nodeName === 'BUTTON').pop().__on.click();
  assert.equal(s.state.menuOpen, true, '☰ More opens the menu');
  const { t } = fakeTeam();
  t.go('today'); await tick(); await tick();
  bar = labels(t.view());
  assert.deepEqual(rAll(bar, (n) => /tab-label/.test(n.className || '')).map((n) => n.textContent), ['Today', 'Tasks', 'Projects', 'Follow-up', 'More']);
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.layout\.staff \.prow > \.quick-tick-space \{ display: none; \}/);
  assert.match(css, /\.layout\.staff \.board-counts \{ flex-wrap: nowrap; overflow-x: auto;/);
});

test('Review2 15 (owner, 24 Oct): a red / yellow list row says why in a chip ("Target 25 Oct is near", "No update for 4 days")', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const fn = APP.slice(APP.indexOf('function noWorkTag'), APP.indexOf('/** "Waiting: Ravi'));
  assert.match(fn, /const why = isOverdue\(p, today\) \? '' : colourShort\(p, today\);/);
  const { colourShort, todayIndia: td, addDays: plus } = await import('../docs/rules.js');
  const s = { data: emptyData(), history: {} };
  applyOps(s, [makeOp('createProject', { projectId: 'r', name: 'Quiet one', deadline: null })]);
  const p = s.data.projects[0];
  p.createdAt = plus(td(), -5) + 'T09:00:00+05:30'; p.activeSince = plus(td(), -5);
  assert.match(colourShort(p, td()), /^No update for \d+ days$/);
});

test('Review2 16 (owner, 24 Oct): team pages never show "📂 Misc" on a task in no project', async () => {
  const { t } = fakeTeam();
  t.go('today'); await tick(); await tick();
  assert.ok(!t.view().textContent.includes('📂 Misc'), 'Team today rows');
  const { chipsFor } = await import('../docs/ui/workparts.js');
  assert.ok(!chipsFor({ title: 'x', project: 'Misc', status: 'open', repeat: 'once' }, '2026-10-24').textContent.includes('Misc'), 'a task\'s chips');
});

test('Review2 17 (owner, 24 Oct): the project table\'s take-out button is a quiet ✕ that says "Take out of project" (never looks like delete); "Last update" stays on one line', () => {
  const s = mainsState();
  const page = renderDetail(liveCtx(s, { selected: 'm', update: {} }));
  const btn = rAll(page, (n) => n.nodeName === 'BUTTON' && /sub-remove/.test(n.className || ''))[0];
  assert.equal(btn.textContent, '✕');
  assert.match(btn.getAttribute('title'), /^Take out of project — .+ is kept$/);
  assert.ok(rAll(page, (n) => n.nodeName === 'TH' && n.textContent === 'Last update' && /nowrap/.test(n.className || '')).length);
});

test('Review2 18 (owner, 24 Oct): team "Done / cancelled" lists newest closed first with the day each was closed; a taken-back step says so (not "no update yet")', async () => {
  const valar = { id: 7, name: 'Valar' };
  const closed = [
    { id: 31, title: 'Older done', assignee: valar, status: 'done', repeat: 'once', doneAt: '2026-10-18 10:00:00', last: { day: '2026-10-18' } },
    { id: 32, title: 'Taken back one', assignee: valar, status: 'cancelled', repeat: 'once', doneAt: '2026-10-22 12:00:00', last: null, today: null },
  ];
  const { t } = fakeTeam({ 'tasks.list': (b) => ({ tasks: b && b.status === 'closed' ? closed : [] }) });
  t.state.closed = true; t.go('tasks'); await tick(); await tick();
  const rows = rAll(t.view(), (n) => n.nodeName === 'LI' && /\bprow\b/.test(n.className || '')).map((r) => r.textContent);
  assert.match(rows[0], /Taken back one.*✖ Cancelled 22 Oct.*taken back before any update/);
  assert.match(rows[1], /Older done.*✓ Done 18 Oct/);
  assert.ok(!rows.join(' ').includes('no update yet'));
});

test('Review2 19 (owner, 24 Oct): a paused row says "paused since <day>" and has ▶ Unpause on it', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(APP, /\$\{p\.state === 'paused' \? 'paused since' : 'finished'\} \$\{fmtDay\(indiaDate\(p\.stateChangedAt\)\)\}/); // (finished rows too, round 3)
  const ra = APP.slice(APP.indexOf('function rowAction'), APP.indexOf('function chase('));
  assert.match(ra, /if \(p\.state === 'paused'\) return h\('button', \{ class: 'row-act'.*act\('unpause', \{ projectId: p\.id \}/);
  const s = { data: emptyData(), history: {} };
  applyOps(s, [makeOp('createProject', { projectId: 'z', name: 'Rest', deadline: null }), makeOp('pause', { projectId: 'z' }), makeOp('unpause', { projectId: 'z' })]);
  assert.equal(s.data.projects[0].state, 'active', 'unpause brings it back');
});

test('Review2 20 (owner, 24 Oct): staff and team Search put the cursor in the box; a 📒 record\'s result shows only the lines with the words', async () => {
  const { hitLines } = await import('../docs/ui/workparts.js');
  assert.equal(hitLines('8:53 am Got 12 bags\n9:10 am Used 2 bags\n4:00 pm Sent the invoice', 'invoice'), '4:00 pm Sent the invoice');
  assert.equal(hitLines('one line only', 'x'), 'one line only');
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../docs/ui/staff.js', import.meta.url), 'utf8'), /function openSearch\(\) \{ show\('search'\); focusLater\('staff-search'\); \}/);
  assert.match(readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8'), /go\('search'\); focusLater\('team-search'\);/);
  const { s } = fakeStaff2({ search: () => ({ results: [{ kind: 'update', taskId: 11, title: 'Clay record', who: 'You', at: '2026-10-24', text: '8:53 am Got 12 bags\n4:00 pm Sent the invoice' }] }) }, { searchWait: 0 });
  s.start(); await tick(); await tick();
  s.act.show('search');
  const input = rFind(s.view(), (n) => n.nodeName === 'INPUT' && n.getAttribute('aria-label') === 'Search' && /search/.test(n.className || '') && n.getAttribute('placeholder') === 'Search tasks, messages, updates…');
  input.value = 'invoice'; input.__on.input({}, input);
  await new Promise((r) => setTimeout(r, 10)); await tick();
  const txt = s.view().textContent;
  assert.ok(txt.includes('Sent the invoice') && !txt.includes('Got 12 bags'), txt.slice(-300));
});

test('Review2 21 (owner, 24 Oct): an empty 🔌 From apps page says what it is for and links to Settings → 🔌 Connections', async () => {
  cnx.resetConnections();
  let opened = 0;
  const c = { ...appsCtx({ 'conn.items': { items: [] } }), openConnections: () => { opened++; } };
  cnx.renderFromApps(c); await flush();
  const el = cnx.renderFromApps(c);
  assert.match(el.textContent, /Nothing waiting for you ✓/);
  const link = walk(el, (n) => n.nodeName === 'BUTTON' && /Connections/.test(n.textContent))[0];
  assert.ok(link, 'a link to Connections');
  link.__on.click();
  assert.equal(opened, 1);
});

test('Review2 22 (owner, 24 Oct): Settings has the 🔁 default, a link to the team\'s Settings (Outlook) and Android phone help, not only iPhone', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const st = APP.slice(APP.indexOf('function renderSettings'), APP.indexOf('async function signOutServer'));
  assert.match(st, /store\.dispatch\('setEveryDefault'/);
  assert.match(st, /href: '#team-settings'/);
  assert.match(st, /'Android: '/);
  assert.match(APP, /else if \(hsh === '#team-settings'\) how = \{ view: 'settings' \}/);
  const { t } = fakeTeam();
  await t.start({ view: 'settings' }); await tick();
  assert.equal(t.state.view, 'settings', 'the team pages open on Settings');
});

test('Review2 23 (owner, 24 Oct): keys for ✅ Tasks (a) and Inbox (i); team pages t a m f; staff t a m; both listed in the help', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(APP, /else if \(k === 'a'\) go\('all'\);\n  else if \(k === 'i'\) go\('inbox'\);/);
  assert.match(APP, /\['a  i', 'Go to ✅ Tasks \/ 📥 Inbox'\]/);
  assert.match(APP, /\['👥 Team pages', 't a m f:/);
  const ev = (key) => ({ key, preventDefault() {}, metaKey: false, ctrlKey: false, altKey: false, repeat: false });
  const doc = { activeElement: null, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  const went = [];
  const team = { state: { closed: true }, go: (v) => went.push(v) };
  for (const k of ['t', 'a', 'm', 'f']) assert.ok(listKeys.pageKey(ev(k), doc, team, { owner: true }), k);
  assert.deepEqual(went, ['today', 'tasks', 'projects', 'followup']);
  assert.equal(team.state.closed, false, 'a: the open tasks');
  const shown = [];
  const staff = { state: {}, act: { show: (v) => shown.push(v) } };
  for (const k of ['t', 'a', 'm', 'f']) listKeys.pageKey(ev(k), doc, staff);
  assert.deepEqual(shown, ['today', 'tasks', 'projects'], 'staff: no Follow-up page');
  assert.match(listKeys.PAGE_KEYS_HELP, /t a m: Today \/ Tasks \/ Projects · f: Follow-up/);
});

test('Review2 25 (owner, 24 Oct): with no task open the right side shows today at a glance (counts, the red / yellow ones with why, tap to open)', () => {
  const s = { data: emptyData(), history: {} };
  applyOps(s, [makeOp('createProject', { projectId: 'late', name: 'Late one', deadline: null }), makeOp('setProjectField', { projectId: 'late', field: 'deadline', value: '2020-01-01' }),
    makeOp('createProject', { projectId: 'fine', name: 'Fine one', deadline: null }), makeOp('addWorkNote', { projectId: 'fine', noteId: 'n', text: 'did it' })]);
  const opened = [];
  const ctx = { ...liveCtx(s, { selected: null, update: {} }), openProject: (id) => opened.push(id) };
  const el = renderDetail(ctx);
  assert.match(el.textContent, /Today at a glance/);
  assert.match(el.textContent, /1 on track/);
  assert.match(el.textContent, /Late one.*Overdue · /); // (owner asked 24 Oct, was "Target date passed")
  rFind(el, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Late one').__on.click();
  assert.deepEqual(opened, ['late']);
});

test('Review2 24 (owner, 24 Oct): changing pages (or ending the Daily round) does not keep an old task open on the right', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const go = APP.slice(APP.indexOf('function go(view)'), APP.indexOf("const TASK_PAGES"));
  assert.match(go, /if \(ui\.selected && \(!TASK_PAGES\.includes\(view\) \|\| !visibleProjects\(\{ stage: false \}\)\.some\(\(p\) => p\.id === ui\.selected\)\)\) ui\.selected = null;/);
  assert.match(APP, /const TASK_PAGES = \['today', 'all', 'mains', 'paused', 'finished'\];/);
  assert.match(APP.slice(APP.indexOf('function endRound'), APP.indexOf('function roundProject')), /ui\.selected = null;/);
});

test('Review2 25 (owner, 24 Oct): the staff app\'s empty right side says what is still to send today (tap to open)', async () => {
  const { s } = fakeStaff2();
  s.start(); await tick(); await tick();
  const el = s.view();
  const glance = rFind(el, (n) => /today-glance/.test(n.className || ''));
  assert.ok(glance, 'a glance, not an empty side');
  assert.match(glance.textContent, /still to send today|All of today's updates are sent/);
});

test('Review3 1 (owner, 24 Oct): the staff dot is yellow until updates are due (red only after fill-by, past its by-date, or stuck), as on Team today', async () => {
  const { staffDot } = await import('../docs/ui/workparts.js');
  const due = { status: 'open', dueToday: true, today: null };
  assert.equal(staffDot(due, { pastFillBy: false }), 'yellow', '11 am, not sent yet');
  assert.equal(staffDot(due, { pastFillBy: true }), 'red', 'after 6 pm');
  assert.equal(staffDot({ ...due, late: true }), 'red', 'past its by-date');
  assert.equal(staffDot({ ...due, stuck: true }), 'red');
  assert.equal(staffDot({ ...due, today: { note: 'x' } }), 'green');
  assert.equal(staffDot({ status: 'open', kind: 'log', today: null }), 'grey', 'a record with nothing today');
  assert.equal(staffDot({ ...due, status: 'cancelled' }), 'grey');
});

test('Review3 2 (owner, 24 Oct): Done / cancelled counts an update sent on the day it was closed (it never says "taken back before any update" then)', async () => {
  const valar = { id: 7, name: 'Valar' };
  const closed = [{ id: 41, title: 'Weigh the test bars', assignee: valar, status: 'cancelled', repeat: 'once', doneAt: '2026-10-24 12:00:00', today: { day: '2026-10-24', note: 'Weighed 10 bars' }, last: null }];
  const { t } = fakeTeam({ 'tasks.list': (b) => ({ tasks: b && b.status === 'closed' ? closed : [] }) });
  t.state.closed = true; t.go('tasks'); await tick(); await tick();
  const row = rAll(t.view(), (n) => n.nodeName === 'LI' && /\bprow\b/.test(n.className || ''))[0].textContent;
  assert.match(row, /last update 24 Oct/);
  assert.ok(!row.includes('before any update'));
});

test('Review3 6 (owner, 24 Oct): a 📂 project whose tasks hold the updates never shows an orange "waiting" box in its 7-day strip', () => {
  const s = mainsState(); // 📂 Kilns holds p1, c2
  const ctx = liveCtx(s, { selected: 'm', update: {} });
  const el = renderDetail(ctx);
  const week = rFind(el, (n) => n.className === 'week');
  assert.ok(week);
  assert.ok(!rAll(week, (n) => /\bwk wait\b|\bwk miss\b/.test(n.className || '')).length, week.innerHTML || '');
});

test('Review3 7 + 8 (owner, 24 Oct): Settings shows which "move every" is chosen; no "Green days" / "tasks green" label is left', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.every-picks \.chip\.on \{/);
  for (const f of ['../docs/app.js', '../docs/ui/dashboard.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/'Green days'|`Green days|tasks green each day|'Green today/.test(src), f);
  }
});

test('Review3 9 (owner, 24 Oct): a task in no project has no "📂 Misc ›" on its page', () => {
  const s = { data: emptyData(), history: {} };
  applyOps(s, [makeOp('createProject', { projectId: 'lone', name: 'Lone task', deadline: null })]);
  const text = renderDetail(liveCtx(s, { selected: 'lone', update: {} })).textContent;
  assert.ok(!text.includes('Misc ›'), text.slice(0, 200));
});

test('Review3 10 (owner, 24 Oct): the menu shows the right key letters: A for ✅ Tasks, I for Inbox (Q is Capture)', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(APP, /const MENU_KEYS = \{ today: 'T', all: 'A', dashboard: 'B', people: 'P', diary: 'D', inbox: 'I', replies: 'E', mains: 'M' \}/);
});

test('Review3 11 + Review5 1 (owner, 24 Oct): the stage filter buttons stay on one line on a phone (scroll sideways); on a computer they wrap, so "Done 0" can be clicked', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  // (owner asked 24 Oct, round 5: one line only on a phone; on a computer it hid "Done 0" with no way to scroll by mouse)
  assert.match(css, /\.stage-filters \{ display: flex; flex-wrap: wrap;[^}]*\}/);
  assert.ok(!/\.stage-filters \{ display: flex; flex-wrap: wrap;[^}]*overflow-x/.test(css), 'no hidden overflow on a computer');
  assert.match(css, /@media \(max-width: 760px\) \{ \.stage-filters \{ flex-wrap: nowrap; overflow-x: auto;/);
  assert.match(css, /\.stage-filter \{ font-size: 12px; padding: 3px 6px;/, 'small enough that all five fit the list on a computer');
  assert.match(css, /\.stage-filters > \* \{ flex: none; white-space: nowrap; \}/);
});

test('Review3 12 (owner, 24 Oct): no key letters or Enter tips on a phone-size screen', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 760px\) \{ kbd\.hint, \.key-tip, \.keys-hint \{ display: none; \} \}/);
  assert.match(readFileSync(new URL('../docs/ui/detail.js', import.meta.url), 'utf8'), /class: 'muted small key-tip' \}, hint\)/);
});

test('Review3 13 (owner, 24 Oct): on a phone the 🔔 steps aside once the page is scrolled (never covers a box), and comes back at the top', async () => {
  const { bellAway } = await import('../docs/ui/bell.js');
  assert.equal(bellAway(200, 375), true);
  assert.equal(bellAway(20, 375), false, 'at the top');
  assert.equal(bellAway(200, 1300), false, 'a computer keeps it');
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8'), /\.bell-wrap\.away \{ opacity: 0;[^}]*pointer-events: none; \}/);
});

test('Review3 14 (owner, 24 Oct): the staff task page keeps its stage and chips on one wrapping line', async () => {
  const { s } = fakeStaff2({ 'task.get': () => ({ ok: true, task: staffData().tasks[0], updates: [], comments: [] }) });
  await s.load();
  s.open('task:' + staffData().tasks[0].id); await tick(); await tick();
  const meta = rFind(s.view(), (n) => n.className === 'task-meta');
  assert.ok(meta && rFind(meta, (n) => /stage-line/.test(n.className || '')) && rFind(meta, (n) => /info-chips/.test(n.className || '')));
});

test('Review3 16 (owner, 24 Oct): a key pressed after clicking a menu item takes the focus box off that item', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const fn = APP.slice(APP.indexOf('export function dropMenuFocus'), APP.indexOf('function onKey(e)'));
  const dropMenuFocus = new Function('return ' + fn.replace('export ', ''))();
  let blurred = 0;
  const btn = { nodeName: 'BUTTON', closest: (q) => (q.includes('#menu') ? {} : null), blur: () => { blurred++; } };
  dropMenuFocus({ activeElement: btn });
  assert.equal(blurred, 1);
  dropMenuFocus({ activeElement: { ...btn, nodeName: 'INPUT' } });
  assert.equal(blurred, 1, 'the menu search box keeps its cursor');
  assert.match(APP, /if \(!\['Enter', ' ', 'Tab'\]\.includes\(e\.key\)\) dropMenuFocus\(document\);/);
});

test('Review3 17 (owner, 24 Oct): a finished row says "finished <day>" and has ↺ Reopen', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(APP, /\$\{p\.state === 'paused' \? 'paused since' : 'finished'\} \$\{fmtDay\(indiaDate\(p\.stateChangedAt\)\)\}/);
  const ra = APP.slice(APP.indexOf('function rowAction'), APP.indexOf('function chase('));
  assert.match(ra, /if \(p\.state === 'finished' && !p\.misc\) return h\('button'.*act\('reopen', \{ projectId: p\.id \}/);
  const s = { data: emptyData(), history: {} };
  applyOps(s, [makeOp('createProject', { projectId: 'z', name: 'Done one', deadline: null }), makeOp('finish', { projectId: 'z' }), makeOp('reopen', { projectId: 'z' })]);
  assert.equal(s.data.projects[0].state, 'active', 'reopen brings it back');
});

test('Review3 18 (owner, 24 Oct): team pages with no task open show Team today at a glance (who is still to send, tap to open)', async () => {
  const { t } = fakeTeam({ 'tasks.list': () => ({ tasks: [] }) });
  t.go('today'); await tick(); await tick();
  t.go('tasks'); await tick(); await tick();
  const glance = rFind(t.view(), (n) => /today-glance/.test(n.className || ''));
  assert.ok(glance, 'a glance, not an empty side');
  assert.match(glance.textContent, /Team today at a glance/);
  assert.match(glance.textContent, /Sweep kiln room/, 'a task still to send');
  rFind(glance, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Sweep kiln room').__on.click();
  assert.equal(t.state.sel, 'task:23');
});

test('Review3 19 (owner, 24 Oct): 📂 Projects counts real projects only (not 📂 Misc) and the same tasks as ✅ Tasks', () => {
  const s = mainsState(); // 📂 Kilns holds p1, c2
  applyOps(s, [makeOp('createProject', { projectId: 'loose', name: 'Loose task', deadline: null }),
    makeOp('createProject', { projectId: 'rest', name: 'Resting', deadline: null }), makeOp('addToProject', { projectId: 'rest', parentId: 'm' }), makeOp('pause', { projectId: 'rest' })]);
  const head = mains.renderProjectsHead(liveCtx(s, { view: 'mains', update: {} }));
  assert.match(head.textContent, /^1 project · 2 tasks in them · \d+ in no project · red first/, head.textContent);
});

test('Review3 20 (owner, 24 Oct): "1 step done" (not "1 steps"); an overdue task says "Overdue · 21 Oct" everywhere', async () => {
  const { colourWhy } = await import('../docs/rules.js');
  assert.equal(colourWhy({ state: 'active', steps: [], deadline: '2026-10-21', targetSet: true }, '2026-10-24'), 'Overdue · 21 Oct');
  const s = { data: emptyData(), history: {} };
  applyOps(s, [makeOp('createProject', { projectId: 'o', name: 'One step', deadline: null }), makeOp('addStep', { projectId: 'o', stepId: 's1', text: 'Only step' })]);
  const text = renderDetail(liveCtx(s, { selected: 'o', update: {} })).textContent;
  assert.ok(text.includes('0 of 1 step done') && !text.includes('1 steps'), text.slice(0, 300));
});

test('Review3 1 (owner, 24 Oct): every staff dot (Today rows, menu count, task page) is yellow before updates are due and red after', async () => {
  for (const [fillBy, colour] of [['23:59', 'yellow'], ['00:00', 'red']]) {
    const data = { ...staffData(), fillBy };
    const { s } = fakeStaff2({ 'my.today': () => data, 'task.get': (b) => ({ ok: true, task: data.tasks.find((t) => t.id === b.id), updates: [], comments: [] }) });
    await s.load();
    const unsent = data.tasks.find((t) => !t.today && t.kind !== 'log');
    const row = rAll(s.view(), (n) => n.nodeName === 'LI' && /\bprow\b/.test(n.className || '')).find((r) => r.textContent.includes(unsent.title));
    assert.ok(rFind(row, (n) => new RegExp('\\bdot ' + colour + '\\b').test(n.className || '')), `${fillBy}: the row is ${colour}`);
    s.open('task:' + unsent.id); await tick(); await tick();
    const top = rFind(s.view(), (n) => n.className === 'detail-top');
    assert.ok(rFind(top, (n) => new RegExp('\\bdot ' + colour + '\\b').test(n.className || '')), `${fillBy}: the task page is ${colour}`);
  }
});

test('Review4 1 + 4 (owner, 24 Oct): staff 📂 Projects counts real projects only; tasks in no project are their own count, named "In no project"', async () => {
  const { s } = fakeStaff2();
  s.start(); await tick(); await tick();
  s.act.show('projects');
  const text = s.view().textContent;
  assert.match(text, /1 project · 2 tasks in them · 2 in no project · red first/, text.slice(0, 400));
  assert.match(text, /📂 In no project/);
  assert.ok(!text.includes('Other tasks'));
});

test('Review4 2 + 3 + 4 (owner, 24 Oct): the 📂 In no project page counts open tasks like its row, has no Start / Snooze / priority / target / time / status, and is named "In no project"', async () => {
  const { MISC_ID } = await import('../docs/rules.js');
  const s = { data: emptyData(), history: {} };
  applyOps(s, [makeOp('makeMisc', {}), makeOp('createProject', { projectId: 'a', name: 'Loose one', deadline: null }), makeOp('addToProject', { projectId: 'a', parentId: MISC_ID }),
    makeOp('createProject', { projectId: 'b', name: 'Loose done', deadline: null }), makeOp('addToProject', { projectId: 'b', parentId: MISC_ID }), makeOp('finish', { projectId: 'b' })]);
  const misc = s.data.projects.find((p) => p.id === MISC_ID);
  assert.ok(misc && misc.misc, 'Misc made');
  const el = renderDetail(liveCtx(s, { selected: MISC_ID, update: {} }));
  const text = el.textContent;
  assert.match(text, /📂 In no project/);
  assert.match(text, /TASKS \(1\) \+ 1 paused \/ finished/);
  for (const gone of ['▶ Start', '💤 Snooze', '+ Target date', 'Add time', 'Medium']) assert.ok(!text.includes(gone), gone);
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8'), /p\.misc \? IN_NO_PROJECT : p\.name/);
});

test('Review4 5 (owner, 24 Oct): rows on 📂 Projects have no empty tick-box gap on the left', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8'), /: asProject \? null : h\('span', \{ class: 'quick-tick-space', 'aria-hidden': 'true' \}\)/);
});

test('Review4 6 (owner, 24 Oct): the team task page has ‹ › through the list on screen, and its stage and chips on one line', async () => {
  const tt = teamToday();
  const { t } = fakeTeam({ 'task.get': (b) => ({ ok: true, task: tt.tasks.find((x) => x.id === b.id), updates: [], comments: [] }) });
  t.go('today'); await tick(); await tick();
  t.open('task:21'); await tick(); await tick();
  const v = t.view();
  const btn = (label) => rFind(v, (n) => n.nodeName === 'BUTTON' && n.getAttribute && n.getAttribute('aria-label') === label);
  assert.ok(btn('Previous task') && btn('Next task'), '‹ › are there');
  assert.ok(rFind(v, (n) => n.className === 'task-meta'), 'stage and chips together');
  btn('Next task').__on.click(); await tick();
  assert.notEqual(t.state.sel, 'task:21', '› goes to the next one');
});

test('Review4 10 (owner, 24 Oct): a 📒 record shows no stage chip (staff rows and page, team rows and page)', async () => {
  const { readFileSync } = await import('node:fs');
  const staff = readFileSync(new URL('../docs/ui/staff.js', import.meta.url), 'utf8');
  const team = readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8');
  assert.ok((staff.match(/t\.kind === 'log' \? null : (stageChip|h\('div', \{ class: 'stage-line')/g) || []).length >= 2, 'staff: row chips and task page');
  assert.match(staff, /t\.status === 'suggested' \|\| t\.kind === 'log' \? null : stageChip/, 'staff: Today rows');
  assert.match(team, /r\.stage && t\.kind !== 'log' \? \[' ', stageChip/);
  assert.match(team, /t\.status === 'suggested' \|\| t\.kind === 'log' \? null : h\('div', \{ class: 'stage-line' \}/);
});

test('Review4 7 (owner, 24 Oct): Team today on a phone shows today\'s words under the task name (the Today column is hidden there)', async () => {
  const { t } = fakeTeam();
  t.go('today'); await tick(); await tick();
  const inline = rFind(t.view(), (n) => /board-today-inline/.test(n.className || ''));
  assert.ok(inline && inline.textContent.includes('Fan part missing'), inline && inline.textContent);
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8'), /\.board-today-inline \{ display: none; \}\n@media \(max-width: 760px\) \{ \.board-today-inline \{ display: block;/);
});

test('Review4 8 (owner, 24 Oct): the Today page\'s 👥 Team band lines up with the 📥 Inbox band (same side space)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /a\.team-line \{[^}]*margin: 6px 8px 4px;/);
  assert.match(css, /\.inbox-reminder \{[^}]*margin: 4px 8px 8px;/);
});

test('Review4 9 (owner, 24 Oct): the Inbox 🗑 sits in the item\'s top-right corner, not alone on a line', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.inbox-actions \.inbox-del \{ position: absolute; top: 6px; right: 6px; \}/);
  assert.match(readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8'), /class: 'icon inbox-del', title: 'Delete'/);
});

test('Review5 3 + 5 (owner, 24 Oct): staff "My suggestions" points at the button above (not the menu); "Coming next" says nothing twice', async () => {
  const { s } = fakeStaff2({ 'my.today': () => ({ ...staffData(), other: [], suggestions: [] }) });
  s.start(); await tick(); await tick();
  s.act.show('sugg');
  let text = s.view().textContent;
  assert.match(text, /No suggestions yet\. Tap 💡 Suggest a task above\./);
  assert.ok(!text.includes('in the menu'));
  assert.ok(!/0 suggestions/i.test(text), 'said once');
  s.act.show('next');
  text = s.view().textContent;
  assert.match(text, /Nothing coming next\./);
  assert.ok(!/0 coming next/i.test(text), text.slice(0, 300));
});

test('Review5 7 (owner, 24 Oct): changing a password asks for the new one twice, on the staff app and the team pages; two different ones are not sent', async () => {
  const { s, calls } = fakeStaff2();
  s.start(); await tick(); await tick();
  s.act.open('password'); await tick();
  const v = s.view();
  const box = (k) => rFind(v, (n) => n.nodeName === 'INPUT' && n.dataset && n.dataset.key === k);
  assert.ok(box('pw-again'), 'the "again" box');
  box('pw-old').__on.input({}, { value: 'old-pass-1' });
  box('pw-new').__on.input({}, { value: 'new-pass-123' });
  box('pw-again').__on.input({}, { value: 'new-pass-124' });
  rFind(v, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Change password').__on.click(); await tick(); await tick();
  assert.ok(!calls.some((c) => c.a === 'password'), 'not sent');
  assert.match(s.view().textContent, /The two new passwords are not the same/);
  const { readFileSync } = await import('node:fs');
  assert.ok(readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8').includes("key: 'pw-again'"), 'team pages too');
});

test('Review5 4 (owner, 24 Oct): notification words fit the device: "this computer" and address-bar steps on a computer, the app-icon steps on a phone (staff app and team pages)', async () => {
  const wp = await import('../docs/ui/workparts.js');
  assert.match(wp.blockedSteps(true).join(' '), /address bar/);
  assert.ok(!wp.blockedSteps(true).join(' ').includes('press and hold'));
  assert.match(wp.blockedSteps(false).join(' '), /press and hold the Task List icon/);
  assert.equal(wp.HERE, 'this phone', 'no mouse here (tests): a phone');
  const { readFileSync } = await import('node:fs');
  for (const f of ['staff.js', 'team.js']) {
    const src = readFileSync(new URL('../docs/ui/' + f, import.meta.url), 'utf8');
    assert.ok(!/'[^'\n]*this phone[^'\n]*'/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), f + ': no fixed "this phone" words');
    assert.match(src, /blockedSteps\(\)\.map/, f + ': blocked steps for this device');
  }
});

test('Review5 6 + 9 (owner, 24 Oct): Give a task — the one-line example uses a real team member; files are picked with the app\'s own button', async () => {
  const wp = await import('../docs/ui/workparts.js');
  assert.equal(wp.quickExample([{ name: 'Ruturaj Patil', active: true }]), 'Ruturaj: send kiln photos by Friday');
  assert.equal(wp.quickExample([{ name: 'Old One', active: false }, { name: 'Mira', active: true }]), 'Mira: send kiln photos by Friday');
  assert.equal(wp.quickExample([]), 'Name: send kiln photos by Friday');
  assert.equal(wp.quickExample([{ id: 1, name: 'Venkat', role: 'admin' }, { id: 2, name: 'Asha', role: 'admin' }, { id: 3, name: 'Ruturaj', role: 'staff' }], 1), 'Ruturaj: send kiln photos by Friday', 'a staff member, never the writer');
  const { t } = fakeTeam();
  await t.start({ sel: 'give' }); await tick(); await tick();
  const v = t.view();
  const file = rFind(v, (n) => n.nodeName === 'INPUT' && n.getAttribute && n.getAttribute('type') === 'file' && n.dataset.key === 'g-files');
  assert.ok(file && /visually-hidden/.test(file.className), 'the browser button is hidden');
  assert.match(file.parentNode.className, /\bbtn\b/, 'inside the app\'s button');
  assert.match(file.parentNode.textContent, /📎 Add files/);
  assert.ok(v.textContent.includes('None chosen'));
  const quick = rFind(v, (n) => n.nodeName === 'INPUT' && n.dataset && n.dataset.key === 'quick-in');
  assert.match(quick.getAttribute('placeholder'), /^\S+: send kiln photos by Friday$/, 'a name from the team list');
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8'), /placeholder: quickExample\(people, state\.user\.id\)/, 'not a fixed "Valar"');
});

test('Review5 8 + 10 (owner, 24 Oct): the person page keeps "Remove" apart from "Send pending list" (small, with space), no gap under the account box; Team Settings has no line above its first block', async () => {
  const s = sampleState();
  const el = renderPerson(fakeCtx(s, { person: 'r' }));
  const rm = rFind(el, (n) => n.nodeName === 'BUTTON' && n.textContent === 'Remove');
  assert.match(rm.className, /\bperson-remove\b/);
  assert.ok(rFind(el, (n) => /\blinked-note\b/.test(n.className || '')));
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  const cut = css.indexOf('the staff view (one app');
  for (const rule of [/\.state-buttons \.person-remove \{ margin-left: 28px;/, /\.report > \.block:first-child \{ border-top: 0;/, /\.meta-line\.linked-note \{ padding: 0 0 8px; \}/, /\.team-account\.block \{ padding-bottom: 4px; \}/]) {
    const m = rule.exec(css);
    assert.ok(m && m.index < cut, String(rule));
  }
});

test('Review5 11 (owner, 24 Oct): each sign-in box is tied to its words for screen readers (id, for, aria-label)', async () => {
  const card = signMod.signInCard({ post: async () => ({}), onSignedIn: () => {} });
  for (const [name, label] of [['username', 'Username'], ['password', 'Password']]) {
    const inp = rFind(card, (n) => n.nodeName === 'INPUT' && n.getAttribute('name') === name);
    assert.equal(inp.getAttribute('aria-label'), label);
    assert.equal(inp.parentNode.getAttribute('for'), inp.id);
    assert.equal(inp.id, 'sign-' + name);
  }
});

test('Which step an update is about (owner, 24 Oct): "📝 Writing about:", the box asks about that step, the button names the step it ticks, and the step is marked in the list', async () => {
  const s = sampleState();
  applyOps(s, [makeOp('addStep', { projectId: 'p1', stepId: 's3', text: 'Residue photos' })]);
  let el = renderDetail(liveCtx(s, { selected: 'p1', update: {} }));
  const marked = () => rAll(el, (n) => /\bwriting-about\b/.test(n.className || '')).map((n) => n.getAttribute('data-id'));
  assert.deepEqual(marked(), ['s2'], 'the next step is the one written about');
  assert.ok(el.textContent.includes('📝 writing'));
  assert.ok(el.textContent.includes('✓ Save + tick “Fire samples”'));
  assert.ok(rFind(el, (n) => n.getAttribute && /What happened on “Fire samples”\?/.test(n.getAttribute('data-placeholder') || n.getAttribute('placeholder') || '')), 'the box asks about that step');
  el = renderDetail(liveCtx(s, { selected: 'p1', update: { p1: { note: '', next: '', about: 's3' } } }));
  assert.deepEqual(marked(), ['s3'], 'choosing "Residue photos" moves the mark');
  assert.ok(el.textContent.includes('✓ Save + tick “Residue photos”'));
  el = renderDetail(liveCtx(s, { selected: 'p1', update: { p1: { note: '', next: '', about: 'project' } } }));
  assert.deepEqual(marked(), [], 'the whole task: no step marked');
  assert.ok(!el.textContent.includes('Save + tick'), 'and nothing to tick');
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  for (const rule of [/\.about-row \.chip\.on \{ background: var\(--brand-soft\); border-color: var\(--brand\);/, /\.step\.writing-about \{ background: var\(--brand-soft\);/]) {
    const m = rule.exec(css); assert.ok(m && m.index < css.indexOf('the staff view (one app'), String(rule));
  }
});

test('Which step an update is about (owner, 24 Oct): ✎ on a saved update can move it to another step (a done one too) or the whole task; the history says "step:"', () => {
  const s = sampleState();
  const ctx = liveCtx(s, { selected: 'p1', update: { p1: { note: '', next: '', editing: 'n1' } }, openParts: { history: true } });
  const el = renderDetail(ctx);
  const row = rFind(el, (n) => /\babout-row\b/.test(n.className || '') && n.textContent.includes('This update is about:'));
  assert.ok(row, 'the move row while changing an update');
  const chip = (t) => rFind(row, (n) => n.nodeName === 'BUTTON' && n.textContent === t);
  assert.match(chip('✓ Call @Ravi').className, /\bon\b/, 'its step now (done)');
  chip('Fire samples').__on.click();
  assert.equal(s.data.projects[0].workNotes.find((n) => n.id === 'n1').stepId, 's2', 'moved');
  chip('Whole task').__on.click();
  assert.equal(s.data.projects[0].workNotes.find((n) => n.id === 'n1').stepId, null, 'to the whole task');
  applyOps(s, [makeOp('setNoteStep', { projectId: 'p1', noteId: 'n1', stepId: 's1' })]);
  assert.ok(renderDetail(liveCtx(s, { selected: 'p1', update: {} })).textContent.includes(' · step: Call @Ravi'), 'the history line names the step');
});

test('Review6 1 (owner, 24 Oct): iPhone photos (.heic) become JPEG pictures — at upload (owner app, staff, team) and when an old one is shown; the decoder is our own copy, loaded only when needed, with no eval', async () => {
  const { readFileSync } = await import('node:fs');
  const heic = await import('../docs/ui/heic.js');
  assert.ok(heic.isHeic('IMG_0878.HEIC') && heic.isHeic('a.heif') && heic.isHeic('x', 'image/heic'));
  assert.ok(!heic.isHeic('a.jpg', 'image/jpeg'));
  assert.ok(heic.isPhoto({ name: 'IMG_1.HEIC', type: '' }), 'no type from the browser: still a photo');
  assert.ok(heic.isPhoto({ name: 'a.png', type: 'image/png' }) && !heic.isPhoto({ name: 'a.pdf', type: 'application/pdf' }));
  assert.equal(heic.jpegName('IMG_0878.HEIC'), 'IMG_0878.jpg');
  // the decoder really reads an iPhone photo (made with macOS "sips"), and the page's rules allow it (no eval / new Function)
  const vendor = new URL('../docs/vendor/libheif.js', import.meta.url);
  assert.ok(!/new Function|\beval\(/.test(readFileSync(vendor, 'utf8')));
  const vm = await import('node:vm'); // run as the browser does: a plain <script> that makes a global "libheif"
  const sandbox = vm.createContext({ console, WebAssembly, setTimeout, clearTimeout, TextDecoder, Uint8Array, Promise });
  const lib = vm.runInContext(readFileSync(vendor, 'utf8') + '\n;libheif', sandbox);
  const L = await Promise.resolve(lib());
  const im = new L.HeifDecoder().decode(readFileSync(new URL('./fixtures/tiny.heic', import.meta.url)))[0];
  const w = im.get_width(), hh = im.get_height();
  const px = await new Promise((r) => im.display({ data: new Uint8ClampedArray(w * hh * 4), width: w, height: hh }, r));
  assert.ok(px && w > 0 && hh > 0, 'decoded');
  const files = readFileSync(new URL('../docs/ui/files.js', import.meta.url), 'utf8');
  assert.match(files, /if \(isHeic\(file\.name, file\.type\)\) \{[^}]*heicToJpeg\(file, IMAGE_MAX_WIDTH\)/, 'owner upload: JPEG, even a small one');
  assert.match(files, /heic \? await heicToJpeg\(bytes, 800\)/, 'an old one shown as a picture');
  assert.match(files, /if \(isHeic\(file\.name\)\) body = h\('img'/, 'and in the viewer');
  assert.match(readFileSync(new URL('../docs/ui/staff.js', import.meta.url), 'utf8'), /if \(isHeic\(file\.name, file\.type\)\) \{ try \{ return await heicToJpeg\(file, 1600\)/, 'staff and team uploads');
  for (const f of ['team.js', 'detail.js', 'richedit.js', 'staff.js']) assert.ok(!/files\.filter\(\(f\) => [^)]*startsWith\('image\/'\)\)/.test(readFileSync(new URL('../docs/ui/' + f, import.meta.url), 'utf8')), f + ': iPhone photos count as photos');
  assert.ok(readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8').includes("'ui/heic.js'"));
});

test('Review6 2 (owner, 24 Oct): a step shows 5 photos and "+N more" (it opens that step\'s days), never hides one silently', () => {
  const s = sampleState();
  const files = Array.from({ length: 6 }, (_, i) => makeOp('addFile', { projectId: 'p1', fileId: 'f' + i, name: `IMG_087${i}.HEIC`, sha: 'sha' + i, size: 10, type: '', noteId: 'n1' }));
  applyOps(s, files);
  const ctx = liveCtx(s, { selected: 'p1', update: {}, showDone: true });
  const el = renderDetail(ctx);
  const notes = rFind(el, (n) => n.className === 'step-photos');
  assert.ok(notes, 'photos under the step');
  assert.equal(rAll(notes, (n) => /rich-photo/.test(n.className || '')).length, 5);
  const more = rFind(notes, (n) => n.nodeName === 'BUTTON' && n.textContent === '+1 more');
  assert.ok(more, '+1 more');
  more.__on.click();
  assert.deepEqual(ctx.ui.diaryTask, { projectId: 'p1', stepId: 's1' }, 'opens that step\'s days');
});

test('Review6 5 (owner, 24 Oct): "Today at a glance" shows red, yellow, then green (the menu\'s order)', () => {
  const s = sampleState();
  const el = renderDetail(liveCtx(s, { selected: null }));
  const counts = rFind(el, (n) => /glance-counts/.test(n.className || ''));
  assert.deepEqual(rAll(counts, (n) => /\bdot\b/.test(n.className || '')).map((n) => n.className.replace('dot ', '')), ['red', 'yellow', 'green']);
  assert.match(counts.textContent, /on track$/);
});

test('Review6 3 + 8 (owner, 24 Oct): the menu\'s 📂 Projects count leaves out "In no project"; Settings says where Outlook, the due time and the morning email are', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(app, /item\('mains', '📂 Projects', mainProjects\(data\)\.filter\(\(m\) => m\.state !== 'finished' && !m\.misc\)\.length\)/);
  assert.ok(app.includes("The morning email is on each person\\'s page (People)."));
  assert.ok(!app.includes('the time updates are due are in'), 'the muddled sentence is gone');
});

test('Review6 4 + 6 + 9 (owner, 24 Oct): Team today marks a 📒 record; team ✅ Tasks has the Stage buttons (they filter); Follow-up\'s one-line box has a heading', async () => {
  const base = teamToday();
  const rec = { ...base.tasks[0], id: 99, title: 'Clay order record', kind: 'log', repeat: 'daily', entriesToday: 1 };
  const { t } = fakeTeam({ 'team.today': () => ({ ...base, tasks: [...base.tasks, rec] }), 'tasks.list': () => ({ tasks: [...base.tasks, rec] }) });
  t.go('today'); await tick(); await tick();
  const row = rAll(t.view(), (n) => n.nodeName === 'TR' && /board-row/.test(n.className || '')).find((r) => r.textContent.includes('Clay order record'));
  assert.ok(row && rFind(row, (n) => /record-tag/.test(n.className || '') && n.textContent === '📒 Record'), 'marked');
  t.go('tasks'); await tick(); await tick();
  const bar = rFind(t.view(), (n) => /\bstage-filters\b/.test(n.className || ''));
  assert.ok(bar, 'Stage buttons on team ✅ Tasks');
  const all = rAll(t.view(), (n) => n.nodeName === 'LI' && /\bprow\b/.test(n.className || '')).length;
  const pick = rAll(bar, (n) => n.nodeName === 'BUTTON').find((b) => /^Not started [1-9]/.test(b.textContent)) || rAll(bar, (n) => n.nodeName === 'BUTTON').find((b) => / [1-9]\d*$/.test(b.textContent) && !b.textContent.startsWith('All'));
  const want = Number(pick.textContent.match(/(\d+)$/)[1]);
  pick.__on.click(); await tick();
  assert.equal(rAll(t.view(), (n) => n.nodeName === 'LI' && /\bprow\b/.test(n.className || '')).length, want, 'the list is cut to that stage');
  assert.ok(want < all || all === want);
  t.go('followup'); await tick(); await tick();
  assert.ok(t.view().textContent.includes('✍ Give work in one line'));
});

test('Review6 7 (owner, 24 Oct): the staff update box offers "tap 🎤 on the keyboard" only on a phone', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../docs/ui/staff.js', import.meta.url), 'utf8'), /placeholder: HERE === 'this phone' \? 'What happened today\? \(you can tap 🎤 on the keyboard to speak\)' : 'What happened today\?'/);
});

test('A photo pasted in a step\'s box goes with the step (owner, 29 Oct): on a step that is there at once; in "+ Add the next step" it waits and goes with the step on Enter; the app sends it there', async () => {
  const { pasteIntoStep } = await import('../docs/ui/detail.js');
  const s = sampleState();
  const ctx = liveCtx(s, { selected: 'p1', update: {} });
  ctx.store.isOffline = () => false; ctx.store.canEdit = () => true;
  ctx.store.repo = { createBlobBase64: async () => 'sha-' + Math.random().toString(36).slice(2) };
  ctx.actMany = (pid, steps, msg) => { ctx.calls.push(['many', msg]); return applyOps(s, steps.map(([t, a]) => makeOp(t, a))); };
  const photo = (n) => new File([new Uint8Array([1, 2, 3])], n, { type: 'image/jpeg' });
  // 1. on the step "Fire samples" (s2)
  await pasteIntoStep(ctx, s.data.projects[0], [photo('3.jpg')], 's2');
  let p = s.data.projects[0];
  assert.equal(p.files.filter((f) => f.stepId === 's2').length, 1, 'added to that step');
  let el = renderDetail(ctx);
  const row = rAll(el, (n) => n.nodeName === 'LI' && n.getAttribute && n.getAttribute('data-id') === 's2')[0];
  assert.ok(rFind(row, (n) => /step-own-photos/.test(n.className || '')), 'shown under the step');
  // 2. in "+ Add the next step": waits, then goes with the new step
  await pasteIntoStep(ctx, p, [photo('4.jpg')], null);
  assert.equal(ctx.ui.stepPhotos.p1.length, 1);
  el = renderDetail(ctx);
  assert.ok(rFind(el, (n) => /step-wait-photos/.test(n.className || '')) && el.textContent.includes('goes with the step'), 'waits under the box');
  const form = rFind(el, (n) => n.nodeName === 'FORM' && /add-step/.test(n.className || ''));
  const input = { value: '  Measure the cut angle ', focus() {} };
  form.__on.submit({ preventDefault() {}, target: { elements: { text: input } } });
  p = s.data.projects[0];
  const step = p.steps.find((x) => x.text === 'Measure the cut angle');
  assert.ok(step, 'the step is added');
  assert.equal(p.files.filter((f) => f.stepId === step.id).length, 1, 'with its photo');
  assert.equal(input.value, '', 'the box empties');
  assert.ok(!(ctx.ui.stepPhotos || {}).p1, 'nothing waits any more');
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8'), /if \(stepLi \|\| \(at && at\.closest && at\.closest\('form\.add-step'\)\)\) \{ pasteIntoStep\(ctx, p, files, stepLi \? stepLi\.getAttribute\('data-id'\) : null\); return; \}/, 'Ctrl+V in a step\'s box goes there, not to the update box');
});
