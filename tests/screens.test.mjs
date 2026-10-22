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
  const g = s.data.groups[0].id;
  applyOps(s, [
    makeOp('createProject', { projectId: 'p1', name: 'Kiln', groupId: g }, at(300)),
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
    makeOp('addTag', { groupId: g, tagId: 'kiln', name: 'Kiln' }, at(9)),
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
  for (const bit of ['Kiln', 'Fire samples', 'Save + done', 'Work notes', 'Status', 'Finish', 'Ravi', 'Today', 'Spec']) assert.ok(text.includes(bit), bit);
  assert.ok(!text.includes('Snooze'), 'Snooze waits in the ⋯ menu');
  const menu = renderDetail(fakeCtx(s, { selected: 'p1', update: {}, projMenu: 'p1' })).textContent;
  for (const bit of ['Snooze', 'Pause', 'Delete project']) assert.ok(menu.includes(bit), 'menu: ' + bit);
});

test('empty project page draws', () => {
  assert.ok(renderDetail(fakeCtx(sampleState(), { selected: 'nope' })).textContent.includes('Pick a project'));
});

test('dashboard draws (tiles, calendar, time, people) on one screen', () => {
  const text = renderDashboard(fakeCtx(sampleState(), {})).textContent;
  for (const bit of ['Streak', 'Green days', 'Time this week', 'People to contact', 'Needs attention']) assert.ok(text.includes(bit), bit);
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
  const ui = { timeReport: { groupId: s.data.groups[0].id, preset: 'thisWeek', by: 'tag', mode: 'pct', custom: {} } };
  const text = renderTimeReport(fakeCtx(s, ui)).textContent;
  assert.ok(text.includes('time by tag'));
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
    makeOp('createProject', { projectId: 'p2', name: 'Glaze trial', groupId: s.data.groups[0].id }),
    makeOp('okForToday', { projectId: 'p1' }),
  ]);
  const ctx = fakeCtx(s, { selected: 'p1', update: {} });
  ctx.nextOpenProject = () => s.data.projects.find((p) => p.id === 'p2');
  ctx.openNextOpen = () => {};
  const text = renderDetail(ctx).textContent;
  assert.ok(text.includes('Save + done'), 'save + done button');
  assert.ok(text.includes('Next project: Glaze trial'), 'next project offered (at the bottom)');
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
  assert.ok(box.textContent.includes('About:') && box.textContent.includes('Save + done'));
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
  assert.ok(!text.includes('Spec'), 'links are folded away');
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
  assert.equal(full.getAttribute('maxlength'), '300');
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
  assert.match(APP, /function syncSig\(userId, p, steps, needsPhoto\) \{\n\s*return JSON\.stringify\(\[[^\]]*p\.about \|\| ''\]\);/, 'the description is in the change signature');
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
  applyOps(s, [makeOp('createProject', { projectId: 'p9', name: 'Basin mould', groupId: s.data.groups[0].id }),
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
  assert.ok(text.includes('📁 Projects and tasks from Work Task (3)'));
  const rows = allIn(findIn(el, hasClass('wt-table')), (n) => n.nodeName === 'TR');
  assert.deepEqual(rows[0].childNodes.map((c) => c.textContent), ['#', 'Work', 'Last update']);
  assert.deepEqual(rows.slice(1).map((r) => r.childNodes[1].childNodes[0].textContent), ['📁 Basin mould', 'Fix press', 'Clean dryer'], 'late, stuck, then the rest');
  assert.ok(rows[1].textContent.includes('Late since 18 Oct') && rows[1].textContent.includes('Now: Cast moulds') && rows[1].textContent.includes('21 Oct: Half done'));
  assert.ok(rows[2].textContent.includes('Stuck') && rows[3].textContent.includes('Every day') && rows[3].textContent.includes('—'));
  rows[1].__on.click();
  assert.deepEqual(opened, ['p1'], 'tap a project row = open it');
  for (const bit of ['Team account', '@ravi', '🔑 New password', 'Switch off', '↔ Move all tasks to…']) assert.ok(text.includes(bit), bit);
  assert.equal(allIn(el, (n) => n.getAttribute && n.getAttribute('aria-label') === 'Email').length, 0, 'no second email box');
  assert.equal(findIn(el, (n) => n.getAttribute && n.getAttribute('aria-label') === 'Work Task email').value, 'ravi@acton.in');
  const order = ['📋 Send pending list', 'Team account', '📁 Projects and tasks from Work Task', 'To discuss with Ravi', 'Notes about Ravi'].map((t) => text.indexOf(t));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), 'sections in order: ' + order);
  assert.ok(renderPeopleList(Object.assign(fakeCtx(s, {}), { teamLink: () => ({ user, member }) })).textContent.includes('1 project · 2 tasks'));
});

test('People: "+ Add a person" can also give a Work Task sign-in (checkbox, only on the server)', () => {
  const s = sampleState();
  assert.ok(!renderPeopleList(fakeCtx(s, {})).textContent.includes('Work Task sign-in'), 'not off the server');
  const given = [];
  const ui = { addSignIn: true };
  const ctx = Object.assign(fakeCtx(s, ui), { onServer: true, giveSignIn: (person, email) => given.push([person.name, email]) });
  ctx.store.dispatch = (type, args) => applyOps(s, [makeOp(type, args)]).length > 0;
  const list = renderPeopleList(ctx);
  assert.ok(list.textContent.includes('Also give them a Work Task sign-in'));
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
  assert.match(sheet, /const outlook = async \(\) => \{\n\s*if \(html\) \{[^]*?const done = copyTable\(\);[^]*?location\.href = `mailto:\$\{[^`]*\}\?subject=\$\{encodeURIComponent\(subject\)\}`;/, 'copy first (inside the click), then mailto with To and Subject');
  assert.ok(!/mailto:[^`]*body=/.test(sheet), 'no body in the mailto');
  assert.match(sheet, /if \(html\) \{ say\(await copyTable\(\)\); return; \}/, 'Copy copies the table too');
  assert.match(sheet, /const say = \(how\) => \{ const words = copyNotice\(how\);/, 'the honest notice');
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
  assert.match(fn, /teamApi\('task\.save', \{\s*assigneeId: user\.id, title: step\.text, details: '', project: project\.name, projectRef: project\.id, stepRef: step\.id,\s*repeat: 'daily', skipSunday: true, clientId:/);
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
