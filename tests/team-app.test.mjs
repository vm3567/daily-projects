// Work Task (team app): the rules behind the screens (team/public_html/logic.js).
// Each check here guards a fix, so a later change cannot quietly bring the problem back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDay, weekdayOf, dueOn, itemKey, diaryRows, fieldChanged, lateValue, afterFlush, boxStillThere, updateSaveBody, redrawHow, projectRowState, giveBackShow, keptNotice, noticeHow, pasteWaits, msgBoxSent, redrawAfterSend, taskSaveBody, aboutShort, projectAboutOf, morningMail, morningOrder, morningSummary, sentTag, sentTime, escHtml, followupRule, followupRows, followupGroups, followupSummary, roundKey, roundSaved, roundPlan, roundMark, parseQuickTask, outlookLine } from '../team/public_html/logic.js';
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
  // (round 11: a password typed on Change password now counts as typing, so a redraw cannot empty it; see the password check below)
  assert.equal(fieldChanged({ tagName: 'INPUT', type: 'password', value: 'x', init: '' }), true);
  assert.equal(fieldChanged({ tagName: 'INPUT', type: 'password', value: 'x' }), false, 'a sign-in box (never drawn by render): not typing');
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
  assert.match(photo, /finally \{[^]*if \(!formHasText\(\)\) render\(\); else state\.reloadLater = true;/); // (round 11: the finally block spans lines now)
  assert.ok(!/finally \{ delete state\.sending\[key\]; render\(\); \}/.test(photo));
  const send = APP.slice(APP.indexOf("toast('Sent ✓');\n      if (document.contains(btn)"), APP.indexOf("}, 'Send');"));
  assert.ok(send.length > 0, 'the update Send checks before redrawing');
  assert.match(send, /if \(document\.contains\(btn\) \|\| !formHasText\(\)\) render\(\);[^\n]*\n\s*else state\.reloadLater = true;/);
  // (round 11: the redraw is no longer only on the Today list, see the check below; still never over typing)
  assert.match(send, /if \(redrawAfterSend\(\{ view: state\.view, sel: state\.sel, taskId: t\.id \}\)\) \{ if \(!formHasText\(\)\) render\(\); else state\.reloadLater = true; \}/);
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

test('team: a photo message sent with words empties the box (the words are not sent twice) and the photo shows', () => {
  assert.ok(msgBoxSent('crack near the base', 'crack near the base'), 'the box holds just what went: emptied');
  assert.ok(!msgBoxSent('crack near the base, and more', 'crack near the base'), 'more typed since: kept');
  assert.ok(!msgBoxSent('', '') && !msgBoxSent('later words', ''), 'a photo with no words: the box is left alone');
  const photo = APP.slice(APP.indexOf('async function sendMsgPhoto'), APP.indexOf('// Ctrl+V on an open task'));
  assert.match(photo, /async function sendMsgPhoto\(taskId, f, text, box\)/);
  assert.match(photo, /sent = true;/);
  const fin = photo.slice(photo.indexOf('finally {'));
  assert.ok(fin.indexOf("msgBoxSent(box.value, text)) { box.value = ''; box.dataset.init = ''; }") > 0, 'the sent words are taken out of the box');
  assert.ok(fin.indexOf('msgBoxSent(') < fin.indexOf('if (!formHasText()) render()'), '… before the "are they typing" check, so the redraw happens');
  assert.match(APP, /sendMsgPhoto\(taskId, f, box\.value \|\| '', box\)/, 'the 📷 button passes its box');
  assert.match(APP, /sendMsgPhoto\(t\.id, images\[0\], e\.target\.value \|\| '', e\.target\)/, 'Ctrl+V passes its box');
});

test('team: opening or closing the ☰ menu never wipes a half-filled form', () => {
  const fn = APP.slice(APP.indexOf('function menuRender()'), APP.indexOf('const brandBig'));
  assert.ok(fn.length > 0, 'menuRender exists');
  assert.ok(!/main|listColumn|detailColumn/.test(fn), 'only the menu is drawn again, never the list or the form on the right');
  assert.match(fn, /layout\.className = layoutClass\(isWide\(\)\)/);
  assert.match(APP, /state\.menuOpen = true; pushBack\(\); menuRender\(\);/, '☰ opens with menuRender');
  assert.match(APP, /state\.menuOpen = false; if \(!state\.sel\) dropBack\(\); menuRender\(\);/, 'the scrim closes with menuRender');
  assert.match(APP, /if \(state\.menuOpen\) \{ state\.menuOpen = false; menuRender\(\);/, 'phone Back closes with menuRender');
  assert.ok(!/state\.menuOpen = (true|false);[^\n]{0,40}\brender\(\)/.test(APP), 'no plain render() for the menu');
});

test("team: 'Give task' carries one clientId per form (a second tap after a lost answer gives the task once)", () => {
  assert.deepEqual(taskSaveBody({ id: 0, title: 'x' }, 'abc'), { id: 0, title: 'x', clientId: 'abc' }, 'a new task carries it');
  assert.deepEqual(taskSaveBody({ id: 7, title: 'x' }, 'abc'), { id: 7, title: 'x' }, 'a change to a task never does');
  assert.deepEqual(taskSaveBody({ id: 0, title: 'x' }, ''), { id: 0, title: 'x' });
  const form = APP.slice(APP.indexOf('function taskForm()'), APP.indexOf("'Give task');") + 400);
  assert.match(form, /const formId = editing \? '' : newClientId\(\);/, 'made once when the form is drawn, kept for its retries');
  const submit = APP.slice(APP.indexOf('function taskForm()'));
  assert.match(submit, /api\('task\.save', taskSaveBody\(\{/);
  assert.match(submit, /\}, formId\)\);/);
});

test('team: typed passwords on Change password count as typing (a redraw never empties them)', () => {
  assert.ok(fieldChanged({ type: 'password', value: 'secret12', init: '' }), 'typed since drawn');
  assert.ok(!fieldChanged({ type: 'password', value: '', init: '' }), 'empty');
  assert.ok(!fieldChanged({ type: 'password', value: 'x', init: 'x' }), 'unchanged');
  assert.ok(!fieldChanged({ type: 'password', value: 'autofilled' }), 'a box never drawn by render (sign-in) is not typing');
});

test('team: a refused update Send redraws its greyed Send button on any list the task is open from', () => {
  assert.ok(redrawAfterSend({ view: 'search', sel: 'task:5', taskId: 5 }), 'opened from Search');
  assert.ok(redrawAfterSend({ view: 'tasks', sel: 'task:5', taskId: 5 }), 'opened from Tasks');
  assert.ok(redrawAfterSend({ view: 'today', sel: '', taskId: 5 }), 'Today as before');
  assert.ok(!redrawAfterSend({ view: 'search', sel: 'task:6', taskId: 5 }), 'another task open: left alone');
});

test('project description: the list shows it cut to 90 letters with …; empty shows nothing', () => {
  assert.equal(aboutShort(''), '');
  assert.equal(aboutShort(undefined), '');
  assert.equal(aboutShort('  Glaze  for\nthe basin line '), 'Glaze for the basin line');
  assert.equal(aboutShort('x'.repeat(90)), 'x'.repeat(90), 'exactly 90: whole');
  const cut = aboutShort('word '.repeat(40));
  assert.ok(cut.length <= 90 && cut.endsWith('…') && !cut.includes(' …'), cut);
  assert.equal(aboutShort('abcdefghij', 5), 'abcd…');
});

test('project description: taken from the project\'s tasks (the first one that has it); shown on the project and task pages and the list', () => {
  assert.equal(projectAboutOf([]), '');
  assert.equal(projectAboutOf(undefined), '');
  assert.equal(projectAboutOf([{ projectAbout: '' }, { projectAbout: 'Kiln rebuild' }]), 'Kiln rebuild');
  assert.equal(projectAboutOf([{ title: 'old server, no field' }]), '');
  assert.match(APP, /class: 'prow-about' }, aboutShort\(p\.projectAbout\)\)/, 'manager\'s Projects list row');
  assert.match(APP, /class: 'project-about' }/, 'under the title of the project and task pages');
  assert.match(readFileSync(new URL('../team/public_html/sw.js', import.meta.url), 'utf8'), /const CACHE = 'worktask-v19'/, 'new files reach the phones');
});

// ---------------------------------------------------------------- 📧 morning email (one person's pending work as a table to fill in)
const MM = (items, extra = {}) => morningMail({ person: { name: 'Suresh' }, manager: 'Boss', items, today: '2026-10-22', ...extra });
const mmItems = [
  { kind: 'task', title: 'Zebra daily check', repeat: 'Daily', lateSince: null, stuck: false, lastUpdate: null },
  { kind: 'task', title: 'Clean moulds', repeat: 'Weekly (Mon)', lateSince: null, stuck: true, lastUpdate: { day: '2026-10-21', note: 'No spare brush' } },
  { kind: 'project', title: 'Basin glaze', about: 'New glaze for line 2', now: 'Test 3 samples', lateSince: null, stuck: false, lastUpdate: { day: '2026-10-21', note: 'Mixed 20 kg' } },
  { kind: 'task', title: 'Fix pump', repeat: '', lateSince: '2026-10-20', stuck: false, lastUpdate: null },
  { kind: 'task', title: 'Apple order', repeat: '', lateSince: null, stuck: false, lastUpdate: null },
];
const rowTitles = (html) => [...html.matchAll(/<tr><td[^>]*>\d+<\/td><td[^>]*><b>([^<]*)<\/b>/g)].map((m) => m[1]);

test('morning email: late first, then stuck, then the rest (projects before tasks, then by title)', () => {
  assert.deepEqual(rowTitles(MM(mmItems).html), ['Fix pump', 'Clean moulds', '📁 Basin glaze', 'Apple order', 'Zebra daily check']);
  assert.match(MM(mmItems).text, /1\. Fix pump[\s\S]*2\. Clean moulds[\s\S]*3\. 📁 Basin glaze[\s\S]*4\. Apple order[\s\S]*5\. Zebra daily check/, 'the plain words in the same order');
});

test('morning email: subject has the day name and date', () => {
  assert.equal(MM(mmItems).subject, 'Your work for Thu 22 Oct – please reply by evening');
  assert.equal(MM([], { today: '2026-11-01' }).subject, 'Your work for Sun 1 Nov – please reply by evening');
});

test('morning email: the summary line leaves out zero parts; 1 item is singular', () => {
  assert.match(MM(mmItems).html, /5 items · 1 late · 1 stuck/);
  assert.match(MM([mmItems[4]]).html, />1 item</, 'one item, nothing late or stuck');
  assert.ok(!/late|stuck/i.test(MM([mmItems[4]]).html.match(/>1 item[^<]*</)[0]), 'no "0 late"');
  assert.match(MM([mmItems[1], mmItems[4]]).html, />2 items · 1 stuck</);
  assert.match(MM(mmItems).text, /5 items · 1 late · 1 stuck/);
});

test('morning email: the table — columns, greeting, inline styles only, the end lines', () => {
  const { html } = MM(mmItems);
  for (const h of ['#', 'Work', 'Last update', 'What I did today', 'Status']) assert.match(html, new RegExp(`<th[^>]*>${h}</th>`), h);
  assert.match(html, /Hi Suresh, good morning\. Here is your pending work\. Please fill the last two columns and reply by evening\./);
  assert.match(html, /border-collapse:collapse/); assert.match(html, /1px solid #bbb/); assert.match(html, /background:#f2f2f2/); assert.match(html, /Arial/);
  assert.ok(!/<style|var\(--/.test(html), 'Outlook drops <style> and CSS variables');
  assert.match(html, /Status: keep one of Done \/ Going on \/ Stuck\./);
  assert.match(html, /Any problem or help needed: write below\./);
  assert.match(html, /Thanks,<br>Boss/);
  assert.equal((html.match(/Done \/ Going on \/ Stuck<\/td>/g) || []).length, 5, 'each row has the three choices to keep one of');
  assert.match(html, /min-width:\d+px;height:\d+px;">&nbsp;<\/td>/, 'an empty, roomy "What I did today" box');
});

test('morning email: red Late, orange Stuck, Now, about and repeat lines; "—" when no update yet', () => {
  const { html } = MM(mmItems);
  assert.match(html, /color:#c62828[^>]*>Late since 20 Oct</);
  assert.match(html, /color:#e65100[^>]*>Stuck</);
  assert.match(html, /color:#666[^>]*>Now: Test 3 samples</);
  assert.match(html, /color:#666[^>]*>New glaze for line 2</, 'the project\'s about under its name');
  assert.match(html, />Daily</); assert.match(html, />Weekly \(Mon\)</);
  assert.match(html, />21 Oct: Mixed 20 kg</);
  assert.match(html, /<b>Fix pump<\/b>[\s\S]*?<td[^>]*>—<\/td>/, 'no update yet: a dash');
  assert.ok(!/Late since|Stuck</.test(MM([mmItems[4]]).html.replace('Done / Going on / Stuck', '')), 'a plain task has no Late or Stuck line');
});

test('morning email: names, titles and notes are made safe for HTML', () => {
  const bad = [{ kind: 'task', title: '<script>alert(1)</script>', lateSince: null, stuck: false, lastUpdate: { day: '2026-10-21', note: 'a & b <i>' } }];
  const { html, text } = morningMail({ person: { name: 'Raj <b>' }, manager: 'Boss & Co', items: bad, today: '2026-10-22' });
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('a &amp; b &lt;i&gt;') && html.includes('Raj &lt;b&gt;') && html.includes('Boss &amp; Co'));
  assert.ok(text.includes('<script>alert(1)</script>'), 'the plain words stay as typed');
  assert.equal(escHtml(`"'`), '&quot;&#39;');
});

test('morning email: nothing pending — a short friendly line, no table', () => {
  const { html, text } = MM([]);
  assert.ok(!/<table/.test(html));
  assert.match(html, /No pending work today\./);
  assert.match(text, /No pending work today\./);
  assert.match(text, /Thanks,\nBoss$/);
});

test('morning email: the plain-words version (for when a table cannot be copied)', () => {
  const { text } = MM(mmItems);
  assert.ok(!/<[a-z]/i.test(text), 'no HTML');
  assert.match(text, /^Hi Suresh, good morning\./);
  assert.match(text, /3\. 📁 Basin glaze\n   New glaze for line 2\n   Now: Test 3 samples\n   Last update: 21 Oct: Mixed 20 kg\n   What I did today: \n   Status: Done \/ Going on \/ Stuck/);
  assert.match(text, /1\. Fix pump\n   Late since 20 Oct\n   Last update: —/);
  assert.match(text, /Status: keep one of Done \/ Going on \/ Stuck\.\nAny problem or help needed: write below\.\n\nThanks,\nBoss$/);
});

test('morning email: the Team today page has the button, copies the table (HTML + plain words) and opens the email', () => {
  const fn = APP.slice(APP.indexOf('async function morningEmail('), APP.indexOf('/** Top of Team today'));
  assert.match(APP.slice(APP.indexOf('function teamToday('), APP.indexOf('async function morningEmail(')), /onClick: \(\) => morningEmail\(p\) \}, '📧 Morning email'/, 'a button on each person');
  // the Team today list the app really shows (teamList), not only the older full-page view
  assert.match(APP.slice(APP.indexOf('function teamList('), APP.indexOf('function tasksList(')), /onClick: \(\) => morningEmail\(p\) \}, '📧 Morning email'/, 'a button under each person on the Team today list');
  assert.match(fn, /api\('morning\.mail', \{ userId: p\.id \}\)/);
  assert.match(fn, /new ClipboardItem\(\{ 'text\/html': [^}]*'text\/plain'/, 'the table and the plain words');
  assert.match(fn, /navigator\.clipboard\.writeText\(mail\.text\)/, 'plain words when a table cannot be copied');
  assert.match(fn, /'mailto:' \+ [^]*'\?subject=' \+ encodeURIComponent\(mail\.subject\)/);
  assert.match(fn, /Table copied — press Ctrl\+V in the email, then Send\./);
  assert.match(fn, /add it on the People page/);
  assert.match(APP, /'Email \(optional, for the morning email\)', email/, 'People: an Email box');
});

// ---------------------------------------------------------------- 📧 morning email on the People page (and the sent mark)
test('morning email on People: one order and summary rule, used by the email and the People page', () => {
  const items = [{ kind: 'task', title: 'B task' }, { kind: 'project', title: 'Z project', stuck: true }, { kind: 'task', title: 'A late', lateSince: '2026-10-20' }, { kind: 'project', title: 'C project' }];
  assert.deepEqual(morningOrder(items).map((x) => x.title), ['A late', 'Z project', 'C project', 'B task']);
  assert.equal(items[0].title, 'B task', 'the list given is not changed');
  assert.deepEqual(morningOrder(null), []);
  assert.equal(morningSummary(items), '4 items · 1 late · 1 stuck');
  assert.equal(morningSummary([{ kind: 'task', title: 'x' }]), '1 item');
  const mail = readFileSync(new URL('../team/public_html/logic.js', import.meta.url), 'utf8');
  const fn = mail.slice(mail.indexOf('export function morningMail('), mail.indexOf('/** Days from day a'));
  assert.match(fn, /const list = morningOrder\(items\)/, 'the email uses the shared order');
  assert.match(fn, /morningSummary\(list\)/, 'and the shared summary');
  assert.ok(!/const rank =/.test(fn), 'no second copy of the order rule in the email');
  const card = APP.slice(APP.indexOf('function morningCard('), APP.indexOf('/** Top of Team today'));
  assert.match(card, /morningOrder\(mp\.items\)/, 'the People page uses the same order');
  assert.match(card, /morningSummary\(list\)/, 'and the same summary');
});

test('morning email on People: the sent tag — today\'s time, or "Not sent yet" (yesterday\'s press does not count)', () => {
  assert.equal(sentTag('2026-10-22 09:05:31', '2026-10-22'), 'Sent today 9:05');
  assert.equal(sentTag('2026-10-22 14:30:00', '2026-10-22'), 'Sent today 14:30');
  assert.equal(sentTag('2026-10-21 09:05:00', '2026-10-22'), 'Not sent yet', 'yesterday is not today');
  assert.equal(sentTag(null, '2026-10-22'), 'Not sent yet');
  assert.equal(sentTag('', '2026-10-22'), 'Not sent yet');
  assert.equal(sentTime('2026-10-22 09:05:31', '2026-10-22'), '9:05');
  assert.equal(sentTime('2026-10-21 09:05:31', '2026-10-22'), '');
});

test('morning email on People: each staff card has the table (# | Work | Last update), the button turns to "Send again", and the press is saved on the server', () => {
  const people = APP.slice(APP.indexOf('function peopleScreen('), APP.indexOf('function settingsScreen('));
  const card = APP.slice(APP.indexOf('function morningCard('), APP.indexOf('/** Top of Team today'));
  assert.match(card, /el\('th', \{ class: 'm-no' \}, '#'\), el\('th', null, 'Work'\), el\('th', \{ class: 'm-last' \}, 'Last update'\)/, 'the three columns');
  assert.match(card, /'No pending work today\.'/);
  assert.match(card, /openDetail\('project:' \+ x\.projectRef\)/, 'a project row opens the project');
  assert.match(card, /openDetail\('task:' \+ x\.taskId\)/, 'a task row opens the task');
  assert.match(card, /Late since \$\{mailDate\(x\.lateSince\)\}/); assert.match(card, /'Stuck'/); assert.match(card, /Now: \$\{x\.now\}/);
  assert.match(card, /aboutShort\(x\.about\)/, 'the about line, cut');
  assert.match(people, /sent \? '📧 Send again' : '📧 Morning email'/, 'the button text after sending');
  assert.match(people, /onClick: \(\) => morningEmail\(u\)/, 'it runs the same morning email');
  assert.match(people, /sentTag\(at, today\)/, 'the sent tag');
  assert.match(people, /'no email — add one'/, 'a link to add a missing email');
  assert.match(people, /`Morning emails today: \$\{sentCount\} of \$\{morning\.people\.length\} sent`/, 'the count at the top');
  assert.match(people, /u\.active && u\.role === 'staff'/, 'managers and switched-off people: no table, no email button');
  assert.match(APP, /api\('users\.list'\), api\('people\.morning'\)\.catch\(\(\) => null\)/, 'the page loads it in one request, beside the people');
  const fn = APP.slice(APP.indexOf('async function morningEmail('), APP.indexOf('/** Top of Team today'));
  assert.match(fn, /markSent\(p\.id, out\.today\)/, 'the morning email marks it sent');
  assert.ok(fn.indexOf('markSent(') < fn.indexOf("'mailto:'"), 'as soon as the email starts');
  assert.match(fn, /api\('morning\.sent', \{ userId \}\)\.then\(\(r\) => show\(r\.sentAt\), \(\) => show\(/, 'saved on the server; shown on this device even if that fails');
  assert.match(readFileSync(new URL('../team/public_html/styles.css', import.meta.url), 'utf8'), /table\.mtable \{[^}]*table-layout: fixed/, 'the table never squeezes words to one letter a line');
});

test('morning email on People: Team today shows a small ✓ time next to the 📧 Morning email button', () => {
  assert.match(APP.slice(APP.indexOf('function teamList('), APP.indexOf('function tasksList(')), /'📧 Morning email'\), sentMark\(p, /, 'on the Team today list');
  assert.match(APP.slice(APP.indexOf('function teamToday('), APP.indexOf('async function morningEmail(')), /'📧 Morning email'\), sentMark\(p, /, 'and on the full Team today page');
  const mark = APP.slice(APP.indexOf('function sentMark('), APP.indexOf('function morningCard('));
  assert.match(mark, /sentTime\(sentAtOf\(p\.id, p\.morningSentAt\), today\)/);
  assert.match(mark, /' ✓ ' \+ t/);
});

// ---------------------------------------------------------------- 🔁 Follow-up, the daily round, work in one line
// Thu 22 Oct 2026 is "today" here (a Thursday); 25 Oct is a Sunday.
const FT = '2026-10-22';
const PEOPLE = [{ id: 1, name: 'Valar', role: 'staff' }, { id: 2, name: 'Vasu Dev', role: 'staff' }, { id: 3, name: 'Suresh Kumar', role: 'staff' },
  { id: 4, name: 'Boss', role: 'admin' }, { id: 5, name: 'Old Hand', role: 'staff', active: false }];
const qt = (text, today = FT) => parseQuickTask(text, PEOPLE, today);

test('work in one line: the name before ":" (or the first word), whole or a unique start; managers and switched-off people never', () => {
  assert.deepEqual(qt('Valar: send kiln photos by Friday'), { person: { id: 1, name: 'Valar' }, title: 'Send kiln photos', dueDate: '2026-10-23', error: '' });
  assert.equal(qt('valar send kiln photos').person.id, 1, 'no colon: the first word; any capitals');
  assert.equal(qt('val: send kiln photos').person.id, 1, '"val" → Valar');
  assert.equal(qt('suresh: fix pump').person.id, 3, 'the first name of a longer name');
  assert.equal(qt('Suresh Kumar: fix pump').person.id, 3, 'the whole name');
  assert.equal(qt('kumar: fix pump').person.id, 3, 'the start of any part of the name');
  assert.match(qt('va: fix pump').error, /could be Valar or Vasu Dev\. Type more of the name\./, 'two people start with "va": refused');
  assert.equal(qt('va: fix pump').person, null);
  assert.equal(qt('Ramesh: fix pump').error, "Who should do it? Start with their name, like 'Valar: …'");
  assert.equal(qt('Boss: fix pump').error, "Who should do it? Start with their name, like 'Valar: …'", 'a manager is not given work here');
  assert.equal(qt('Old: fix pump').person, null, 'a switched-off person is not matched');
  assert.match(qt('').error, /Type the work/);
  assert.equal(qt('Valar check kiln at 10:30').person.id, 1, 'a time like 10:30 is not taken for the name');
  assert.equal(qt('Valar check kiln at 10:30').title, 'Check kiln at 10:30');
});

test('work in one line: each date phrase (taken out of the title)', () => {
  const due = (t, today) => qt('Valar: check kiln ' + t, today).dueDate;
  assert.equal(due('today'), FT);
  assert.equal(due('by tomorrow'), '2026-10-23');
  assert.equal(due('day after tomorrow'), '2026-10-24');
  assert.equal(due('by Friday'), '2026-10-23');
  assert.equal(due('on Fri'), '2026-10-23');
  assert.equal(due('by Thursday'), '2026-10-29', 'today is Thursday: "by Thursday" is next week (only "today" means today)');
  assert.equal(due('by Monday'), '2026-10-26');
  assert.equal(due('in 3 days'), '2026-10-25');
  assert.equal(due('by 24 Oct'), '2026-10-24');
  assert.equal(due('24 October'), '2026-10-24');
  assert.equal(due('24/10'), '2026-10-24', 'dd/mm (India)');
  assert.equal(due('24-10'), '2026-10-24');
  assert.equal(due('by 5/1'), '2027-01-05', 'a day already gone this year: next year');
  assert.equal(due('by 20 Oct'), '2027-10-20');
  assert.equal(due('next week'), '2026-10-26', 'next Monday');
  assert.equal(due(''), '', 'no date: no by-date');
  assert.match(qt('Valar: check kiln by 31/02').error, /That date is not right/);
  assert.equal(qt('Valar: check sun dryer').dueDate, '', 'a short day name is a date only after by / on');
});

test('work in one line: Sunday and next-day edges (a fixed today)', () => {
  const sat = '2026-10-24', sun = '2026-10-25';
  assert.equal(qt('Valar: clean dryer tomorrow', sat).dueDate, sun, 'Saturday + 1 = Sunday (as said)');
  assert.equal(qt('Valar: clean dryer by Sunday', sun).dueDate, '2026-11-01', 'on a Sunday, "by Sunday" is the next one');
  assert.equal(qt('Valar: clean dryer by Monday', sun).dueDate, '2026-10-26');
  assert.equal(qt('Valar: clean dryer next week', sun).dueDate, '2026-10-26', 'on Sunday, next week = tomorrow, Monday');
  assert.equal(qt('Valar: clean dryer next week', '2026-10-26').dueDate, '2026-11-02', 'on a Monday: the Monday after');
  assert.equal(qt('Valar: report 1/1', '2026-12-31').dueDate, '2027-01-01', 'across the year end');
});

test('work in one line: the title is cleaned (first letter capital, trailing by / on gone, the date only once)', () => {
  assert.equal(qt('Valar:   send kiln photos   by friday.').title, 'Send kiln photos');
  assert.equal(qt('Valar: send kiln photos by').title, 'Send kiln photos', 'a trailing "by"');
  assert.equal(qt('Valar: send kiln photos on').title, 'Send kiln photos', 'a trailing "on"');
  assert.deepEqual([qt('Valar: Sunday cleaning by sunday').title, qt('Valar: Sunday cleaning by sunday').dueDate], ['Sunday cleaning', '2026-10-25'], 'the last date words are the date');
  assert.match(qt('Valar: by friday').error, /What should they do\?/, 'nothing left to do');
});

const frow = (extra) => ({ taskId: 1, kind: 'task', title: 'T', person: { id: 1, name: 'Valar' }, dueDate: null, lastUpdate: null, silentDays: 0, stuck: false, chasedAt: null, ...extra });
test('follow-up: the colour and the reason line for each case', () => {
  const r = (x) => followupRule(frow(x), FT);
  assert.deepEqual(r({ silentDays: 3, dueDate: '2026-10-20' }), { colour: 'red', reason: 'Silent 3 days · was due 20 Oct', rank: 0 });
  assert.deepEqual(r({ stuck: true, lastUpdate: { day: FT, note: 'Waiting for nozzle' } }).reason, 'Stuck · Waiting for nozzle');
  assert.equal(r({ stuck: true, lastUpdate: { day: FT, note: 'x' } }).colour, 'red', 'stuck is red even when written today');
  assert.deepEqual(r({ dueDate: '2026-10-21', lastUpdate: { day: FT, note: 'half done' } }), { colour: 'red', reason: 'Overdue · was due 21 Oct · last: today half done', rank: 0 });
  assert.deepEqual(r({ silentDays: 2, lastUpdate: { day: '2026-10-19', note: 'ok' } }), { colour: 'red', reason: 'Silent 2 days · last: 19 Oct ok', rank: 0 });
  assert.equal(r({ silentDays: 2 }).reason, 'Silent 2 days · no update yet');
  assert.deepEqual(r({ dueDate: '2026-10-24', lastUpdate: { day: '2026-10-21', note: 'waiting for clamp meter' } }),
    { colour: 'orange', reason: 'Due in 2 days · last: 21 Oct waiting for clamp meter', rank: 1 });
  assert.equal(r({ dueDate: FT }).reason, 'Due today · no update yet');
  assert.equal(r({ dueDate: '2026-10-23' }).reason, 'Due tomorrow · no update yet');
  assert.deepEqual(r({ silentDays: 1, lastUpdate: { day: '2026-10-20', note: 'ok' } }), { colour: 'orange', reason: 'Silent 1 day · last: 20 Oct ok', rank: 1 });
  assert.deepEqual(r({ lastUpdate: { day: FT, note: '42 s, ok' } }), { colour: 'green', reason: 'Updated today · 42 s, ok', rank: 3 });
  assert.deepEqual(r({ dueDate: '2026-10-30', lastUpdate: { day: '2026-10-21', note: 'ok' } }), { colour: 'grey', reason: 'On track · last: 21 Oct ok', rank: 2 }, 'nothing to chase yet');
  assert.equal(r({ silentDays: 2, chasedAt: `${FT} 10:15:00` }).reason, 'Silent 2 days · no update yet · 🔔 chased 10:15', 'chased today shows');
  assert.equal(r({ silentDays: 2, chasedAt: '2026-10-21 10:15:00' }).reason, 'Silent 2 days · no update yet', 'an older chase does not');
});

test('follow-up: worst first, by person, and the top line', () => {
  const rows = [
    frow({ taskId: 1, title: 'Green', lastUpdate: { day: FT, note: 'ok' } }),
    frow({ taskId: 2, title: 'Silent 2', silentDays: 2, person: { id: 2, name: 'Vasu' } }),
    frow({ taskId: 3, title: 'Soon', dueDate: '2026-10-23' }),
    frow({ taskId: 4, title: 'Silent 5', silentDays: 5 }),
    frow({ taskId: 5, title: 'Stuck', stuck: true, person: { id: 2, name: 'Vasu' } }),
    frow({ taskId: 6, title: 'Grey', dueDate: '2026-11-30' }),
  ];
  const sorted = followupRows(rows, FT);
  assert.deepEqual(sorted.map((r) => r.title), ['Stuck', 'Silent 5', 'Silent 2', 'Soon', 'Grey', 'Green']);
  assert.ok(sorted.every((r) => r.colour && r.reason), 'each row gets its colour and reason');
  assert.deepEqual(followupGroups(sorted).map((g) => [g.person.name, g.rows.map((r) => r.taskId)]), [['Vasu', [5, 2]], ['Valar', [4, 3, 6, 1]]], 'the person with the worst row first');
  assert.equal(followupSummary(rows, FT), '6 given out · 2 silent · 1 due soon');
  assert.equal(followupSummary([], FT), '0 given out · 0 silent · 0 due soon');
});

test('follow-up round: worst first, resumes on the same day, starts again the next day, counts what was done', () => {
  const sorted = followupRows([frow({ taskId: 1, title: 'A', silentDays: 3 }), frow({ taskId: 2, title: 'B', dueDate: FT }),
    frow({ taskId: 3, kind: 'project', projectRef: 'p9', title: 'P', lastUpdate: { day: FT, note: '' } })], FT);
  assert.equal(roundKey(sorted[2]), 'p:p9', 'a project is known by its ref');
  assert.equal(roundKey(sorted[0]), 't:1');
  let plan = roundPlan(sorted, null, FT);
  assert.deepEqual([plan.queue.map((r) => r.title), plan.pos, plan.total], [['A', 'B', 'P'], 1, 3]);
  let s = roundMark(null, 't:1', 'ok', FT);
  s = roundMark(s, 't:2', 'chased', FT);
  plan = roundPlan(sorted, s, FT);
  assert.deepEqual([plan.queue.map((r) => r.title), plan.pos, plan.total], [['P'], 3, 3], 'resumes at the item not looked at');
  assert.deepEqual(roundPlan(sorted.filter((r) => r.taskId !== 2), s, FT).total, 3, 'an item closed since still counts in the total');
  s = roundMark(s, 'p:p9', 'closed', FT);
  assert.deepEqual([s.chased, s.changed, s.closed], [1, 0, 1]);
  assert.equal(roundPlan(sorted, s, FT).queue.length, 0, 'all followed up');
  assert.deepEqual(roundMark(s, 'p:p9', 'ok', FT).seen, ['t:1', 't:2', 'p:p9'], 'never twice');
  assert.deepEqual(roundPlan(sorted, s, '2026-10-23').queue.length, 3, 'a new day: a new round');
  assert.deepEqual(roundSaved({ day: FT, seen: 'bad' }, FT).seen, [], 'a broken saved copy is not trusted');
});

test('follow-up: the menu item, the screen and its buttons are wired', () => {
  assert.match(APP, /item\('🔁 Follow-up', state\.view === 'followup', \(\) => go\('followup'\)\)/, 'manager menu item');
  assert.match(APP, /const LIST_VIEWS = \[[^\]]*'followup'\]/, 'a list view');
  assert.match(APP, /api\('followup\.list'\)/);
  assert.match(APP, /else if \(state\.view === 'followup'\) body = followupList\(\);/);
  const row = APP.slice(APP.indexOf('function followRow('), APP.indexOf('async function chaseTask('));
  assert.match(row, /chaseTask\(r\)[^\n]*'🔔 Chase'/);
  assert.match(row, /closeFollow\(r\)[^\n]*'✓ Done'/);
  assert.match(row, /takeBack\(r\) \}, '↩ Take back'/);
  assert.match(row, /r\.kind === 'project'[^]*openDetail\('project:' \+ r\.projectRef\) \}, '📁 Open project'\)[^]*'Take back on your projects page'/, 'a project is taken back on the projects page');
  const fns = APP.slice(APP.indexOf('async function chaseTask('), APP.indexOf('// the round:'));
  assert.match(fns, /api\('task\.chase', \{ id: r\.taskId \}\)/);
  assert.match(fns, /api\('task\.status', \{ id: r\.taskId, status: 'done' \}\)/, 'Done: the same close as Mark done');
  assert.match(fns, /confirm\(`Take "\$\{r\.title\}" back[^]*api\('task\.status', \{ id: r\.taskId, status: 'cancelled' \}\)/, 'Take back asks first, then the usual cancel');
  assert.match(APP.slice(APP.indexOf('function followupList('), APP.indexOf('function followRow(')), /onClick: startRound \}, '▶ Start round \(2 min\)'/);
});

test('follow-up round: the screen uses the rule, keeps its place on this device and has OK / Chase / Change person / Close', () => {
  const fn = APP.slice(APP.indexOf('function roundScreen('), APP.indexOf('function quickBox('));
  assert.match(fn, /roundPlan\(R\.rows, R\.saved, today\)/);
  assert.match(fn, /`Item \$\{plan\.pos\} of \$\{plan\.total\}`/);
  assert.match(fn, /class: 'progress'/, 'a thin progress bar');
  assert.match(fn, /R\.saved = roundMark\(R\.saved, roundKey\(r\), what, today\); roundStore\(R\.saved\)/, 'each item looked at is kept on the device');
  assert.match(fn, /mark\('ok'\) \}, '👍 OK'/);
  assert.match(fn, /chaseTask\(r\)\) mark\('chased'\)/);
  assert.match(fn, /api\('task\.move', \{ id: r\.taskId, toId: p\.id \}\)[^\n]*mark\('changed'\)/, 'Change person: the usual move');
  assert.match(fn, /closeFollow\(r\)\) mark\('closed'\); \} \}, '✕ Close'/);
  assert.match(fn, /'All followed up ✓'[^]*\$\{s\.chased\} chased · \$\{s\.changed\} changed · \$\{s\.closed\} closed/);
  assert.match(APP, /function roundLoad\(\) \{ try \{ return JSON\.parse\(load\(roundStoreKey\(\)\)/, 'read back safely');
});

test('work in one line: the box on Follow-up and on Give a task, 🎤 only where it works, one task for a double tap, ✎ Change fills the form', () => {
  assert.match(APP.slice(APP.indexOf('function followupList('), APP.indexOf('function followRow(')), /quickBox\(d\.people \|\| \[\]\)/, 'at the top of Follow-up');
  assert.match(APP, /if \(sel === 'give'\) \{ title = 'Give a task'; body = state\.people\.length \? \[quickBox\(state\.people\), taskForm\(\)\]/, 'on Give a task');
  const fn = APP.slice(APP.indexOf('function quickBox('), APP.indexOf('// ---------- manager: team today'));
  assert.match(fn, /parseQuickTask\(box\.value, people, today\)/);
  assert.match(fn, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(fn, /if \(Listen\) \{/, 'the 🎤 only if the browser can listen');
  assert.match(fn, /rec\.lang = 'en-IN'/);
  assert.match(fn, /rec\.onend = [^\n]*box\.value = heard; show\(\)/, 'when it stops, its words go into the box');
  assert.match(fn, /if \(q\.sig !== sig\) \{ q\.sig = sig; q\.cid = newClientId\(\); \}/, 'one id per preview');
  assert.match(fn, /api\('task\.save', taskSaveBody\(\{ assigneeId: r\.person\.id, title: r\.title, [^}]*repeat: 'once'[^}]*dueDate: r\.dueDate \}, q\.cid\)\)/, 'a one-time task with its by-date and the preview\'s id');
  assert.match(fn, /notice\('update', `Given to \$\{out\.task\.assignee\.name\} ✓`/);
  assert.ok(!/Email it too|oneTaskMail/.test(APP), 'no one-task email (only the morning email)');
  assert.match(fn, /state\.prefill = \{ title: r\.title, assigneeId: r\.person\.id, repeat: 'once', dueDate: r\.dueDate \};[^]*openDetail\('give'\)[^]*'✎ Change'/);
  const form = APP.slice(APP.indexOf('function taskForm()'), APP.indexOf("'Give task');"));
  assert.match(form, /pre\.assigneeId/); assert.match(form, /pre\.repeat === 'once'/); assert.match(form, /pre\.dueDate/);
});

test('follow-up: the buttons sit on their own line under the words (the words are never squeezed to one letter a line)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../team/public_html/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.fu-row\s*\{[^}]*flex-wrap:\s*wrap/, 'the row wraps');
  assert.match(css, /\.fu-row\s*>\s*\.prow-btn\s*\{[^}]*flex:\s*1 1 100%/, 'the words take the whole width');
  assert.match(css, /\.fu-row\s*>\s*\.fu-btns\s*\{[^}]*flex:\s*1 1 100%/, 'the buttons go on the next line');
});

test('outlook: the status line in plain words (connected, last check, emails today; or the problem)', () => {
  const base = { clientId: 'c', secretEnd: 'ab12', connected: true, account: 'venkat@acton.com', lastCheck: '2026-10-21 10:42:10', addedToday: 3, error: '' };
  assert.equal(outlookLine(base, TODAY), 'Connected as venkat@acton.com · last check 10:42 · 3 emails added today');
  assert.equal(outlookLine({ ...base, addedToday: 1, lastCheck: '2026-10-20 09:05:00' }, TODAY), 'Connected as venkat@acton.com · last check 20/10 09:05 · 1 email added today');
  assert.equal(outlookLine({ ...base, connected: false, error: 'Sign-in expired — press Connect again' }, TODAY), 'Not connected — Sign-in expired — press Connect again');
  assert.equal(outlookLine({ ...base, error: 'Microsoft says: needs admin approval — ask IT' }, TODAY), 'Connected as venkat@acton.com · last check 10:42 · 3 emails added today — Microsoft says: needs admin approval — ask IT');
  assert.equal(outlookLine({ connected: false }, TODAY), 'Not set up yet — fill in the three details from Azure and press Save.');
  assert.equal(outlookLine({ connected: false, clientId: 'c', secretEnd: 'ab12' }, TODAY), 'Not connected yet — press Connect Outlook.');
});

test('outlook: the Settings section (owner only) — three fields, the Redirect URI, Connect / Check now / Disconnect; the secret box is never filled from the server', () => {
  const settings = APP.slice(APP.indexOf('function settingsScreen()'), APP.indexOf('function outlookCard()'));
  assert.match(settings, /state\.user && state\.user\.owner \? outlookCard\(\) : null/, 'only the owner of the projects sees it');
  const fn = APP.slice(APP.indexOf('function outlookCard()'), APP.indexOf('// ---------------------------------------------------------------- start'));
  assert.match(fn, /el\('h2', null, '📧 Outlook'\)/);
  for (const label of ['Application \\(client\\) ID', 'Directory \\(tenant\\) ID', 'Client secret ', 'Redirect URI to register']) assert.match(fn, new RegExp(`el\\('label', null, '${label}'`), label);
  assert.match(fn, /const secret = el\('input', \{ type: 'password', autocomplete: 'new-password'/, 'a password box');
  assert.ok(!/secret\.value = (?!'')/.test(fn), 'the secret box is only ever emptied, never filled');
  assert.ok(!/o\.secret\b(?!End)/.test(fn), 'nothing but the last 4 letters is read');
  assert.match(fn, /secretSaved\.textContent = o\.secretEnd \? `saved ✓ \(ends …\$\{o\.secretEnd\}\)`/);
  assert.match(fn, /redirect\.textContent = o\.redirectUri/);
  assert.match(fn, /api\('outlook\.status'\)/);
  assert.match(fn, /run\(saveBtn, 'outlook\.save', \{ clientId: clientId\.value\.trim\(\), tenantId: tenantId\.value\.trim\(\), secret: secret\.value\.trim\(\) \}, \(\) => \{ secret\.value = '';/);
  assert.match(fn, /run\(connectBtn, 'outlook\.connect', \{\}, \(out\) => \{ if \(out\.url\) location\.href = out\.url; \}\)/, 'Connect goes to the Microsoft sign-in');
  assert.match(fn, /run\(checkBtn, 'outlook\.check'/);
  assert.match(fn, /confirm\('Disconnect Outlook\?[^']*'\)\) run\(offBtn, 'outlook\.disconnect'/);
  assert.match(fn, /checkBtn\.hidden = offBtn\.hidden = !o\.connected/);
  assert.match(fn, /line\.textContent = outlookLine\(o, o\.today\)/);
  assert.match(fn, /offline_access, User\.Read and Mail\.ReadWrite \(it only reads your emails; it never sends any\)/, 'the permissions to add in Azure');
  const sw = readFileSync(new URL('../team/public_html/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /url\.pathname === '\/outlook\.php'/, 'the sign-in page is never kept on the phone');
});

test('one People page: Work Task\'s menu opens the People page on the projects page, which opens on People', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../team/public_html/app.js', import.meta.url), 'utf8');
  const dp = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.ok(!/go\('people'\)/.test(app), 'no link left to the old Work Task People page');
  assert.match(app, /item\('People ↗', false, \(\) => openPeoplePage\(\)\)/);
  assert.match(app, /function openPeoplePage\(\) \{ location\.href = 'projects\/#people'; \}/);
  assert.match(dp, /if \(location\.hash === '#people'\) \{ ui\.view = 'people';/, 'the projects page opens on People');
});

test('no-paste morning email rule (logic.js): draft only when Outlook is connected AND an email is saved; else paste, with why', async () => {
  const { emailPath, pasteReason } = await import('../team/public_html/logic.js');
  assert.equal(emailPath({ connected: true, email: 'nila@acton.test' }), 'draft');
  assert.equal(emailPath({ connected: false, email: 'nila@acton.test' }), 'paste');
  assert.equal(emailPath({ connected: true, email: '' }), 'paste');
  assert.equal(emailPath({ connected: true, email: 'bad' }), 'paste');
  assert.equal(emailPath({ connected: null, email: 'nila@acton.test' }), 'paste', 'still asking: paste');
  assert.equal(pasteReason({ connected: true, email: '', name: 'Nila Devi' }), "Add Nila's email first");
  assert.equal(pasteReason({ connected: false, email: 'nila@acton.test' }), 'Outlook not connected');
  assert.equal(pasteReason({ connected: true, email: 'nila@acton.test', error: 'Microsoft did not answer (error 500). It will try again.' }), 'Microsoft did not answer (error 500). It will try again');
  assert.equal(pasteReason({ connected: true, email: 'nila@acton.test' }), null);
  const dp = await import('../docs/rules.js');
  for (const c of [{ connected: true, email: 'a@b.test' }, { connected: false, email: 'a@b.test' }, { connected: true, email: '' }]) assert.equal(emailPath(c), dp.emailPath(c), 'the same rule in both apps');
});

test('no-paste morning email wiring: connected → outlook.compose with the built html/subject, tab opened in the tap, marked sent; else the copy + mailto way with why', () => {
  const fn = APP.slice(APP.indexOf('async function morningEmail('), APP.indexOf('/** The manager pressed 📧 Morning email'));
  assert.match(fn, /const connected = outlookConnected\(\);\n\s*const tryDraft = connected && \(p\.email === undefined \|\| emailPath\(\{ connected, email: p\.email \}\) === 'draft'\);/);
  assert.match(fn, /const tab = tryDraft \? window\.open\('about:blank', '_blank'\) : null;/, 'the tab is opened in the tap');
  assert.ok(fn.indexOf("window.open('about:blank'") < fn.indexOf('await copying;') && fn.indexOf('await copying;') < fn.indexOf('await ready;'), 'the copy is started and the tab opened before anything is awaited');
  assert.match(fn, /if \(tryDraft && emailPath\(\{ connected, email \}\) === 'draft'\) \{\n\s*try \{\n\s*const r = await api\('outlook\.compose', \{ to: email, subject: mail\.subject, html: mail\.html \}\);\n\s*markSent\(p\.id, out\.today\);/, 'the finished email to the saved address, then marked sent');
  assert.match(fn, /tab\.location\.href = r\.webLink;/);
  assert.match(fn, /'Draft ready in Outlook — check it and press Send\.'/);
  assert.match(fn, /\} catch \(ex\) \{ why = pasteReason\(\{ connected, email, name: out\.person\.name, error: ex\.message \}\); \}/, 'a failed draft falls back, saying why');
  assert.match(fn, /if \(tab\) tab\.close\(\);\n\s*markSent\(p\.id, out\.today\);[^]*'mailto:'/, 'the fallback: close the blank tab, mark sent, open the email');
  assert.match(fn, /table copied, paste it with ⌘ Cmd\+V/);
  assert.ok(!/\/send|sendMail/.test(fn), 'never sends');
  assert.match(APP, /function outlookConnected\(\) \{\n\s*if \(outlookOn === null && state\.user && state\.user\.owner\) \{\n\s*outlookOn = api\('outlook\.status'\)/, 'asked once per page load (owner only), kept in memory');
  assert.match(APP, /outlookOn = !!o\.connected;/, 'Settings → Outlook keeps it up to date');
  for (const s of ['function teamList() {', 'function teamToday() {', 'function peopleScreen() {']) assert.match(APP.slice(APP.indexOf(s), APP.indexOf(s) + 200), /outlookConnected\(\);/, `${s} asks before the button is pressed`);
});
