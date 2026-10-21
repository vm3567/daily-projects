// Work Task (team app): the rules behind the screens (team/public_html/logic.js).
// Each check here guards a fix, so a later change cannot quietly bring the problem back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDay, weekdayOf, dueOn, itemKey, diaryRows, fieldChanged, lateValue, afterFlush, boxStillThere, updateSaveBody, redrawHow, projectRowState, giveBackShow, keptNotice, noticeHow, pasteWaits } from '../team/public_html/logic.js';
const APP = readFileSync(new URL('../team/public_html/app.js', import.meta.url), 'utf8');

// Wed 21 Oct 2026 is "today" in these checks; 18 Oct is a Sunday.
const TODAY = '2026-10-21';
const kinds = (r) => r.rows.map((x) => `${x.day.slice(8)}:${x.kind}`);
const daily = (extra = {}) => ({ status: 'open', repeat: 'daily', skipSunday: true, startDate: '2026-10-15', createdAt: '2026-10-15 09:00:00', ...extra });
const up = (day, note = 'x') => ({ day, note, state: 'progress', at: `${day} 10:00:00`, by: 'Valar', byId: 3 });

test('team: dates and due days', () => {
  assert.equal(addDay('2026-10-31', 1), '2026-11-01');
  assert.equal(weekdayOf('2026-10-18'), 0, 'a Sunday');
  assert.ok(!dueOn(daily(), '2026-10-18'), 'Mon–Sat task: not due on Sunday');
  assert.ok(dueOn(daily({ skipSunday: false }), '2026-10-18'), 'every day incl. Sunday');
  assert.ok(!dueOn(daily({ startDate: '2026-10-22' }), TODAY), 'not before its start day');
  assert.ok(dueOn({ repeat: 'weekly', weekday: 3 }, TODAY) && !dueOn({ repeat: 'weekly', weekday: 1 }, TODAY), 'weekly: its day only');
});

test('team: diary — Sunday Off, a due day with nothing is No progress, today waits until the due-by time', () => {
  const t = daily();
  assert.deepEqual(kinds(diaryRows(t, [up('2026-10-19')], TODAY, { nowHm: '10:00' })),
    ['21:wait', '20:miss', '19:ups', '18:off', '17:miss', '16:miss', '15:miss']);
  assert.equal(diaryRows(t, [], TODAY, { nowHm: '19:00' }).rows[0].kind, 'miss', 'after 18:00 today is No progress');
  assert.equal(diaryRows(t, [], TODAY, { nowHm: '19:00', fillBy: '20:00' }).rows[0].kind, 'wait', 'the real due-by time is used');
  assert.equal(diaryRows(daily({ skipSunday: false }), [], TODAY).rows.find((x) => x.day === '2026-10-18').kind, 'miss', 'Sunday too: Sunday is a working day');
});

test('team: diary — staff see today in its own box, not twice', () => {
  assert.ok(!diaryRows(daily(), [], TODAY, { staff: true }).rows.some((x) => x.day === TODAY));
});

test('team: diary — a step waiting its turn, or a suggestion, has no "No progress" days', () => {
  assert.deepEqual(kinds(diaryRows(daily({ queued: true }), [], TODAY)), ['18:off']);
  assert.deepEqual(kinds(diaryRows(daily({ status: 'suggested' }), [], TODAY)), ['18:off']);
});

test('team: diary — a step counts from when its turn came, but updates written before still show', () => {
  const r = diaryRows(daily({ turnSince: '2026-10-20' }), [up('2026-10-16')], TODAY, { nowHm: '19:00' });
  assert.deepEqual(kinds(r), ['21:miss', '20:miss', '16:ups'], 'no red days while it waited its turn; the early update is kept');
});

test('team: diary — only the days it was closed are skipped after it is opened again', () => {
  const t = daily({ startDate: '2026-10-12', createdAt: '2026-10-12 09:00:00', reopenedAt: '2026-10-20 10:00:00', closedFrom: '2026-10-17 12:00:00' });
  const r = kinds(diaryRows(t, [], TODAY, { nowHm: '19:00' }));
  assert.ok(r.includes('16:miss') && r.includes('14:miss'), 'missed days before the close still show');
  assert.ok(!r.includes('17:miss') && !r.includes('19:miss'), 'closed days are not "No progress"');
  assert.ok(r.includes('20:miss'), 'open again from the reopen day');
});

test('team: diary — a closed task ends on its close day, and that day is not "No progress"', () => {
  const r = kinds(diaryRows(daily({ status: 'done', doneAt: '2026-10-19 11:00:00' }), [], TODAY));
  assert.equal(r[0], '18:off', 'starts the day before it closed (19th is the close day, 20–21 after it)');
});

test('team: diary — never "No progress" for days older than the 60 updates the server sends', () => {
  const ups = Array.from({ length: 60 }, (_, i) => up(addDay('2026-10-20', -i)));
  const t = daily({ startDate: '2026-01-01', createdAt: '2026-01-01 09:00:00' });
  const r = diaryRows(t, ups, TODAY, { n: 200, nowHm: '19:00' });
  assert.equal(r.rows.at(-1).day, ups.at(-1).day, 'stops at the oldest update it has');
  assert.ok(!r.more, 'no "Show older days" past what was loaded');
});

test('team: diary — a weekly task shows only its own day and Sundays', () => {
  const r = kinds(diaryRows({ status: 'open', repeat: 'weekly', weekday: 1, startDate: '2026-10-12', createdAt: '2026-10-12 09:00:00' }, [], TODAY, { nowHm: '19:00' }));
  assert.deepEqual(r, ['19:miss', '18:off', '12:miss']);
});

test('team: outbox — one stuck item only holds back items of the same thing', () => {
  assert.equal(itemKey({ kind: 'update', taskId: 5 }), 't:5');
  assert.equal(itemKey({ kind: 'photos', taskId: 5 }), 't:5');
  assert.equal(itemKey({ kind: 'step', projectRef: 'P1' }), 'p:P1');
  assert.notEqual(itemKey({ kind: 'suggest', id: 1 }), itemKey({ kind: 'suggest', id: 2 }), 'suggestions never block each other');
});

test('team: the search box is never "typing" (a new search must not stop Mark done / Move from redrawing the task)', () => {
  assert.equal(fieldChanged({ tagName: 'INPUT', type: 'search', value: 'kiln 3', init: 'kiln' }), false, 'search box changed since drawn: not typing');
  assert.equal(fieldChanged({ tagName: 'INPUT', type: 'text', value: 'kiln 3', init: 'kiln' }), true, 'a text box changed: typing');
  assert.equal(fieldChanged({ tagName: 'INPUT', type: 'text', value: 'kiln', init: 'kiln' }), false, 'unchanged since drawn');
  assert.equal(fieldChanged({ tagName: 'TEXTAREA', type: 'textarea', value: 'words' }), true, 'no init: text counts');
  assert.equal(fieldChanged({ tagName: 'INPUT', type: 'file', fileCount: 1 }), true, 'a picked file');
  assert.equal(fieldChanged({ tagName: 'INPUT', type: 'password', value: 'x', init: '' }), false);
  assert.match(APP.slice(APP.indexOf('function formHasText')), /^[^]{0,200}fieldChanged\(/, 'formHasText uses this rule');
});

test('team: Settings "due by" — the saved time arriving late fills only an untouched box', () => {
  assert.equal(lateValue('18:00', '18:00', '17:30'), '17:30', 'untouched: the saved time is shown');
  assert.equal(lateValue('19:00', '18:00', '17:30'), '19:00', 'changed meanwhile: their choice stays');
  assert.match(APP, /lateValue\(fill\.value, fill\.dataset\.init, d\.fillBy\)[^\n]*fill\.dataset\.init = d\.fillBy/, 'the box\'s drawn value follows the saved time (else Settings counts as typing for ever)');
});

test('team: after sending the outbox, an item given back also redraws the screen', () => {
  assert.equal(afterFlush({ sent: 0, gaveBack: 1, view: 'task:5' }), 'reload', 'refused and given back: the Waiting card goes');
  assert.equal(afterFlush({ sent: 0, gaveBack: 1, view: 'today' }), 'reload');
  assert.equal(afterFlush({ sent: 2, view: 'tasks' }), 'reload');
  assert.equal(afterFlush({ sent: 1, gaveBack: 1, typing: true, view: 'today' }), 'later', 'never over typing');
  assert.equal(afterFlush({ sent: 0, gaveBack: 0, view: 'today' }), 'bar');
  assert.equal(afterFlush({ sent: 1, view: 'people' }), 'bar');
  assert.match(APP, /afterFlush\(\{ sent, gaveBack: gave,/, 'doFlush counts what it gave back');
});

test('team: a refused update says "back in the box" only when the box is still there', () => {
  const t = { id: 4, status: 'open', assignee: { id: 3 } };
  assert.ok(boxStillThere(t, 3));
  assert.ok(!boxStillThere({ ...t, assignee: { id: 9 } }, 3), 'moved to someone else: no box');
  assert.ok(!boxStillThere({ ...t, status: 'done' }, 3), 'closed: no box');
  assert.ok(!boxStillThere(undefined, 3), 'not on this phone any more');
  // (the words are now built by giveBackShow in logic.js, checked below; here: it is shown in the notice that stays)
  assert.match(APP, /notice\('stuck', show\.title, show\.body, null, \{ stay: true, copy: true \}\)/, 'the whole words are shown, and stay until closed');
  const u = giveBackShow({ kind: 'update', taskId: 4, note: 'All ten pumps checked' }, 'Task moved.', false);
  assert.ok(u.sticky && u.body.includes('All ten pumps checked') && /Copy them/.test(u.body));
  assert.match(giveBackShow({ kind: 'comment', text: 'hi' }, 'x', true).body, /also back in the box/);
});

test('team: every update save carries a clientId (a timed-out online save that is then queued is the same save)', () => {
  const first = updateSaveBody({ taskId: 4, note: 'n', state: 'progress', clientId: 'abc' });
  assert.equal(first.clientId, 'abc');
  const fin = updateSaveBody({ taskId: 4, note: 'n', state: 'progress', clientId: 'abc', finish: true, day: '2026-10-21', writtenAt: 'x' });
  assert.equal(fin.state, 'finished'); assert.equal(fin.clientId, 'abc-f', 'the Finished save has its own id');
  assert.equal(fin.writtenAt, undefined);
  assert.equal(updateSaveBody({ taskId: 4, note: 'n', state: 'stuck', clientId: 'a', day: 'd', writtenAt: 'w' }).writtenAt, 'w');
  const calls = APP.match(/api\('update\.save',[^\n]*/g) || [];
  assert.ok(calls.length >= 4, 'the online save, its Finished, the outbox save, its Finished');
  for (const c of calls) assert.match(c, /updateSaveBody\(\{[^}]*clientId/, `update.save without a clientId: ${c.slice(0, 80)}`);
});

test('team: menu and list clicks never redraw over a half-filled Give / Edit form', () => {
  assert.equal(redrawHow({ typed: false }), 'all');
  assert.equal(redrawHow({ typed: true, hasDetail: true }), 'lists', 'typed in the form on the right: only the menu and list');
  assert.equal(redrawHow({ typed: true, listTyped: true, hasDetail: true }), 'later');
  assert.equal(redrawHow({ typed: true, hasDetail: false }), 'later');
  for (const where of [/'← Show everyone'/, /'Later'\)/]) {
    const line = APP.split('\n').find((l) => where.test(l));
    assert.ok(line && /softRender\(\)/.test(line) && !/[^t]render\(\)/.test(line.replace(/softRender\(\)/g, '')), `uses softRender: ${where}`);
  }
  const push = APP.slice(APP.indexOf('async function turnOnPush'), APP.indexOf('async function pushOff'));
  assert.ok(!/(^|[^t])render\(\)/m.test(push.replace(/softRender\(\)/g, '')), 'Turn on notifications keeps the form');
  const person = APP.slice(APP.indexOf("class: 'menu-item person'"), APP.indexOf("el('span', { class: 'dot ' + dot })"));
  assert.match(person, /softRender\(\)/); assert.match(person, /!formHasText\(\)\) \{ go\('today'\)/, 'go(today) only when nothing is typed');
});

test('team: a project given as one task (no steps yet) is live work, not "all done"', () => {
  const whole = { open: 0, done: 0, stuck: false, current: { title: 'Paint line 2', sentToday: false } };
  assert.deepEqual(projectRowState(whole), { dot: 'orange', now: 'now: whole project' }, 'no update today: orange, never green "all done"');
  assert.equal(projectRowState({ ...whole, current: { ...whole.current, sentToday: true } }).dot, 'green');
  assert.deepEqual(projectRowState({ open: 0, done: 3, current: null }), { dot: 'green', now: 'all done ✓' });
  assert.deepEqual(projectRowState({ open: 2, done: 1, current: { title: 'Step B', sentToday: false } }), { dot: 'orange', now: 'now: Step B' });
  assert.equal(projectRowState({ ...whole, stuck: true }).dot, 'red');
  assert.match(APP, /const \{ dot, now \} = projectRowState\(p\)/, 'the projects list uses the rule');
});

test('team: a refused step or suggestion shows its whole words to copy; "back in the box" only if the box is there', () => {
  const long = 'Order the spare servo motor for line 3 '.repeat(5).trim();
  const gone = giveBackShow({ kind: 'step', projectRef: 'p1', title: long }, 'This project is not given to you.', false);
  assert.ok(gone.sticky, 'stays until closed');
  assert.ok(gone.body.includes(long), 'the whole step, not 60 characters');
  assert.ok(!/Add a step box/.test(gone.body) && /Copy them/.test(gone.body), 'no box: never says it is back in it');
  assert.match(giveBackShow({ kind: 'step', title: 'x' }, 'y', true).body, /back in the Add a step box/);
  const sug = giveBackShow({ kind: 'suggest', title: 'Clean filters', details: 'The dryer clogs every week' }, 'No.', false);
  assert.ok(sug.sticky && sug.body.includes('The dryer clogs every week'), 'a suggestion shows its details too');
  assert.equal(giveBackShow({ kind: 'photos', note: 'n', updateId: 4 }, 'Closed.', false).sticky, false, 'photos: a toast as before');
  assert.match(APP, /it\.kind === 'step' \? myProjects\(\)\.some\(\(p\) => p\.ref === it\.projectRef\)/, 'the step box is looked for in my projects');
});

test('team: two refused items both stay on screen, and other news waits until they are closed', () => {
  const a = { title: 'Could not send: Task moved.', body: 'Your words:\nfirst' }, b = { title: 'Could not send: Task moved.', body: 'Your words:\nsecond' };
  assert.deepEqual(keptNotice([a]), a);
  const two = keptNotice([a, b]);
  assert.ok(two.body.includes('first') && two.body.includes('second'), 'the second never wipes the first');
  assert.match(two.title, /2 items/);
  assert.equal(noticeHow({ copyOpen: true, copy: false }), 'hold', 'news never replaces words still to copy');
  assert.equal(noticeHow({ copyOpen: true, copy: true }), 'add');
  assert.equal(noticeHow({ copyOpen: false, copy: false }), 'show');
  const fn = APP.slice(APP.indexOf('function notice('), APP.indexOf('const DAYS'));
  assert.match(fn, /if \(how === 'hold'\) \{ held = /); assert.match(fn, /kept\.push\(/); assert.match(fn, /notice\(\.\.\.h\)/, 'held news shown once closed');
});

test('team: the offline bar redraw keeps the "turn on notifications" banner', () => {
  const fn = APP.slice(APP.indexOf('function refreshBar()'), APP.indexOf('function idb()'));
  assert.match(fn, /offlineBar\(\), pushBanner\(\)/);
});

test('team: a finished send never redraws over a form opened and typed in meanwhile', () => {
  const photo = APP.slice(APP.indexOf('async function sendMsgPhoto'), APP.indexOf('// Ctrl+V on an open task'));
  assert.match(photo, /finally \{[^\n]*if \(!formHasText\(\)\) render\(\); else state\.reloadLater = true;/);
  assert.ok(!/finally \{ delete state\.sending\[key\]; render\(\); \}/.test(photo));
  const send = APP.slice(APP.indexOf("toast('Sent ✓');\n      if (document.contains(btn)"), APP.indexOf("}, 'Send');"));
  assert.ok(send.length > 0, 'the update Send checks before redrawing');
  assert.match(send, /if \(document\.contains\(btn\) \|\| !formHasText\(\)\) render\(\);[^\n]*\n\s*else state\.reloadLater = true;/);
  assert.match(send, /if \(state\.view === 'today'\) \{ if \(!formHasText\(\)\) render\(\); else state\.reloadLater = true; \}/);
});

test('team: Ctrl+V of a photo while the update waits on the phone is refused (it would go nowhere)', () => {
  const box = [{ kind: 'update', taskId: 5 }];
  assert.ok(pasteWaits(box, 5, false));
  assert.ok(pasteWaits([{ kind: 'photos', taskId: 5 }], 5, false));
  assert.ok(!pasteWaits(box, 5, true), 'changing the update: the photo goes with it');
  assert.ok(!pasteWaits(box, 6, false)); assert.ok(!pasteWaits([{ kind: 'comment', taskId: 5 }], 5, false)); assert.ok(!pasteWaits(undefined, 5, false));
  const paste = APP.slice(APP.indexOf("document.addEventListener('paste'"), APP.indexOf('async function editMessage'));
  assert.ok(paste.indexOf('pasteWaits(state.outbox, t.id') > 0 && paste.indexOf('pasteWaits(') < paste.indexOf('addTaskPhotos('), 'checked before the photo is added');
});
