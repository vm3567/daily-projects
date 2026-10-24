// Work Task (team app): the rules behind the screens (team/public_html/logic.js).
// Each check here guards a fix, so a later change cannot quietly bring the problem back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDay, weekdayOf, dueOn, itemKey, diaryRows, fieldChanged, lateValue, afterFlush, boxStillThere, updateSaveBody, redrawHow, projectRowState, giveBackShow, keptNotice, noticeHow, pasteWaits, msgBoxSent, msgBoxLeft, updateBoxLeft, redrawAfterSend, taskSaveBody, giveId, aboutShort, projectAboutOf, morningMail, morningOrder, morningSummary, sentTag, sentTime, escHtml, followupRule, followupRows, followupGroups, followupSummary, roundKey, roundSaved, roundPlan, roundMark, parseQuickTask, outlookLine } from '../team/public_html/logic.js';
const APP = readFileSync(new URL('../team/public_html/app.js', import.meta.url), 'utf8');
// one app (step 4): the managers' screens are the team pages of the one app (docs/ui/team.js); Work Task's old page
// (APP) only forwards there. The checks that read the old screens read the team pages (or the one app) now.
const TEAM = readFileSync(new URL('../docs/ui/team.js', import.meta.url), 'utf8');
const DP = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
async function teamPages(answers = {}, more = {}) {
  const { createTeam } = await import('../docs/ui/team.js');
  const { memOutbox } = await import('../docs/ui/staffbox.js');
  const rules = await import('../team/public_html/logic.js');
  const calls = [], toasts = [];
  const api = async (a, body) => { calls.push({ a, body }); if (answers[a]) return answers[a](body); return { ok: true }; };
  const t = createTeam({ root: null, api, rules, user: { id: 1, name: 'Boss', role: 'admin', owner: true }, box: memOutbox(), lock: null, toast: (m) => toasts.push(m), win: null, ...more });
  return { t, calls, toasts };
}
// one app (step 3): the staff screens moved to the staff view of the projects app; their checks read it here
const STAFF = readFileSync(new URL('../docs/ui/staff.js', import.meta.url), 'utf8');
const STAFFBOX = readFileSync(new URL('../docs/ui/staffbox.js', import.meta.url), 'utf8');
async function staffView(answers = {}) {
  const { createStaff } = await import('../docs/ui/staff.js');
  const { memOutbox } = await import('../docs/ui/staffbox.js');
  const rules = await import('../team/public_html/logic.js');
  const calls = [], box = memOutbox();
  const api = async (a, body) => { calls.push({ a, body }); if (answers[a]) return answers[a](body); if (a === 'my.today') return { today: '2026-10-22', fillBy: '18:00', tasks: [], other: [{ id: 5, title: 'S', projectRef: 'p1', seq: 1, status: 'open' }], suggestions: [] }; return { ok: true }; };
  const s = createStaff({ root: null, api, rules, user: { id: 3, name: 'Valar', role: 'staff' }, box, lock: null, toast: () => {} });
  await s.load();
  return { s, calls, box };
}
const offline = () => Object.assign(new Error('offline'), { offline: true });

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
  // (one app, step 4: the team pages never hold back a redraw — every box is drawn from what the page keeps for it and
  // the page is updated in place, so Mark done / Move redraw at once and the search words stay)
  assert.match(TEAM, /key: 'team-search', [^\n]*value: state\.searchQ, onInput: \(e, el\) => search\(el\.value\)/, 'the search box is drawn from the kept words');
  assert.match(TEAM, /morph\(root\.firstChild, next\)/, 'redrawn in place');
});

test('team: Settings "due by" — the saved time arriving late fills only an untouched box', () => {
  assert.equal(lateValue('18:00', '18:00', '17:30'), '17:30', 'untouched: the saved time is shown');
  assert.equal(lateValue('19:00', '18:00', '17:30'), '19:00', 'changed meanwhile: their choice stays');
  // (one app: the team pages' Settings keep the box in state; a late answer fills it only while it is untouched)
  assert.match(TEAM, /if \(d\.fillBy && !s\.touched\) \{ s\.fillBy = d\.fillBy;/, 'the saved time fills only an untouched box');
  assert.match(TEAM, /onInput: \(e, el\) => \{ s\.fillBy = el\.value; s\.touched = true; \}/, 'typing marks it touched');
});

test('team: after sending the outbox, an item given back also redraws the screen', () => {
  assert.equal(afterFlush({ sent: 0, gaveBack: 1, view: 'task:5' }), 'reload', 'refused and given back: the Waiting card goes');
  assert.equal(afterFlush({ sent: 0, gaveBack: 1, view: 'today' }), 'reload');
  assert.equal(afterFlush({ sent: 2, view: 'tasks' }), 'reload');
  assert.equal(afterFlush({ sent: 1, gaveBack: 1, typing: true, view: 'today' }), 'later', 'never over typing');
  assert.equal(afterFlush({ sent: 0, gaveBack: 0, view: 'today' }), 'bar');
  assert.equal(afterFlush({ sent: 1, view: 'people' }), 'bar');
  // (one app: one outbox for everyone, ui/staffbox.js; the team pages reload when anything was sent or given back —
  // their boxes keep what is typed, so it is never over typing)
  assert.match(STAFFBOX, /gave\b/, 'the outbox counts what it gave back');
  assert.match(TEAM, /if \(r\.sent \|\| r\.gave\) reload\(\);/, 'the team pages redraw after a give-back too');
});

test('team: a refused update says "back in the box" only when the box is still there', () => {
  const t = { id: 4, status: 'open', assignee: { id: 3 } };
  assert.ok(boxStillThere(t, 3));
  assert.ok(!boxStillThere({ ...t, assignee: { id: 9 } }, 3), 'moved to someone else: no box');
  assert.ok(!boxStillThere({ ...t, status: 'done' }, 3), 'closed: no box');
  assert.ok(!boxStillThere(undefined, 3), 'not on this phone any more');
  // (the words are built by giveBackShow in logic.js; one app: the team pages show them in a notice that stays, with Copy)
  assert.match(TEAM, /if \(show\.sticky\) kept\(show\.title, show\.body\); else toast\(show\.text, show\.ms\);/, 'the whole words are shown, and stay until closed');
  assert.match(TEAM, /'Copy'\),\n\s*h\('button', \{ class: 'btn small', onClick: \(\) => \{ state\.notices\.splice\(i, 1\); render\(\); \} \}, 'Close'\)/, 'Copy, and Close');
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
  // (one app: the online save and its Finished are in the staff view; one outbox sends for everyone, ui/staffbox.js)
  const where = { 'staff view': STAFF, 'the outbox': STAFFBOX };
  for (const [name, src] of Object.entries(where)) {
    const calls = src.match(/api\('update\.save',[^\n]*/g) || [];
    assert.ok(calls.length >= 2, `${name}: the save and its Finished`);
    for (const c of calls) assert.match(c, /updateSaveBody\(\{[^}]*clientId/, `${name}: update.save without a clientId: ${c.slice(0, 80)}`);
  }
  assert.ok(!/update\.save/.test(APP), 'the old Work Task page sends nothing any more');
});

test('team: menu and list clicks never redraw over a half-filled Give / Edit form', async () => {
  assert.equal(redrawHow({ typed: false }), 'all');
  assert.equal(redrawHow({ typed: true, hasDetail: true }), 'lists', 'typed in the form on the right: only the menu and list');
  assert.equal(redrawHow({ typed: true, listTyped: true, hasDetail: true }), 'later');
  assert.equal(redrawHow({ typed: true, hasDetail: false }), 'later');
  // (one app: the team pages keep the form's words in their own state; a menu tap changes the list and leaves a
  // half-filled Give / Edit form open on the right, with its words)
  const { t } = await teamPages();
  t.state.sel = 'give'; t.state.giveForm = { key: 'give', title: 'Record kiln 3 temperature', details: '', files: [] };
  t.go('tasks');
  assert.equal(t.state.view, 'tasks', 'the list changes');
  assert.equal(t.state.sel, 'give', 'the typed form stays open');
  assert.equal(t.state.giveForm.title, 'Record kiln 3 temperature', 'with its words');
  t.state.giveForm.title = ''; t.go('today');
  assert.equal(t.state.sel, null, 'an empty form closes as before');
  t.state.sel = 'give'; t.state.giveForm = { key: 'give', title: 'x', details: '', files: [] };
  t.state.menuOpen = true; t.render(); t.state.menuOpen = false; t.render();
  assert.equal(t.state.giveForm.title, 'x', 'opening / closing the menu leaves the form alone');
});

test('team: a project given as one task (no steps yet) is live work, not "all done"', () => {
  const whole = { open: 0, done: 0, stuck: false, current: { title: 'Paint line 2', sentToday: false } };
  assert.deepEqual(projectRowState(whole), { dot: 'orange', now: 'now: whole project' }, 'no update today: orange, never green "all done"');
  assert.equal(projectRowState({ ...whole, current: { ...whole.current, sentToday: true } }).dot, 'green');
  assert.deepEqual(projectRowState({ open: 0, done: 3, current: null }), { dot: 'green', now: 'all done ✓' });
  assert.deepEqual(projectRowState({ open: 2, done: 1, current: { title: 'Step B', sentToday: false } }), { dot: 'orange', now: 'now: Step B' });
  assert.equal(projectRowState({ ...whole, stuck: true }).dot, 'red');
  assert.match(TEAM, /const \{ dot, now \} = rules\.projectRowState\(p\)/, 'the team pages\' projects list uses the rule');
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
  // (one app: steps and suggestions are the staff view's; it looks for the step box in its own projects)
  assert.match(STAFF, /it\.kind === 'step' \? !typing && myProjects\(state\.data\)\.some\(\(p\) => p\.ref === it\.projectRef\)/, 'the step box is looked for in my projects (and must not hold other words being typed)');
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
  // (one app: on the team pages the words to copy are a list of their own — each stays until closed — and news has its
  // own place, so news can never take the words' place)
  assert.match(TEAM, /const kept = \(title, body\) => \{ state\.notices\.push\(\{ title, body \}\); render\(\); \};/, 'each one is added, never replaced');
  assert.match(TEAM, /const news = \(title, body, sel\) => \{ state\.news = \[\{ title, body, sel \}\]; render\(\); \};/, 'news only replaces news');
  assert.ok(!/state\.notices = \[/.test(TEAM), 'the words to copy are never wiped by other news');
});

test('team: the offline bar redraw keeps the "turn on notifications" banner', () => {
  // (one app: the team pages draw the banner, the offline bar, the words to copy and the news together, every time)
  const fn = TEAM.slice(TEAM.indexOf('function bars()'), TEAM.indexOf('/** Top of Team today'));
  assert.match(fn, /return \[\n\s*pushBanner\(\),\n\s*state\.offline \|\| n \?/);
});

test('team: a finished send never redraws over a form opened and typed in meanwhile', () => {
  // (one app: every box shows what its view keeps for it and each keystroke is kept there, so the redraw after a send
  // never wipes words typed meanwhile — in any box)
  assert.match(STAFF, /h\('textarea', \{ key: 'up-' \+ t\.id,[^\n]*value: d\.note, onInput: \(e, el\) => \{ d\.note = el\.value;/, 'the update box');
  // (the message box is one shared piece, ui/workparts.js; the staff view and the team pages keep its words)
  const PARTS = readFileSync(new URL('../docs/ui/workparts.js', import.meta.url), 'utf8');
  assert.match(PARTS, /h\('textarea', \{ key: 'msg-' \+ taskId, placeholder, value: draft \|\| '', onInput: \(e, el\) => \{ onInput\(el\.value\);/, 'the message box');
  assert.match(STAFF, /draft: state\.msgDrafts\[taskId\],[^\n]*\n\s*onInput: \(v\) => \{ state\.msgDrafts\[taskId\] = v; \},/, 'the staff view keeps the message words');
  assert.match(TEAM, /draft: state\.msgDrafts\[t\.id\], [^\n]*\n\s*onInput: \(v\) => \{ state\.msgDrafts\[t\.id\] = v; \},/, 'the team pages keep the message words');
  assert.match(STAFF, /value: state\.stepDrafts\[ref\] \|\| '', onInput: \(e, el\) => \{ state\.stepDrafts\[ref\] = el\.value;/, 'the Add a step box');
  for (const k of ['title', 'details', 'project']) assert.match(TEAM, new RegExp(`value: f\\.${k}, onInput: set\\('${k}'\\)`), 'Give a task: ' + k);
});

test('team: Ctrl+V of a photo while the update waits on the phone is refused (it would go nowhere)', () => {
  const box = [{ kind: 'update', taskId: 5 }];
  assert.ok(pasteWaits(box, 5, false));
  assert.ok(pasteWaits([{ kind: 'photos', taskId: 5 }], 5, false));
  assert.ok(!pasteWaits(box, 5, true), 'changing the update: the photo goes with it');
  assert.ok(!pasteWaits(box, 6, false)); assert.ok(!pasteWaits([{ kind: 'comment', taskId: 5 }], 5, false)); assert.ok(!pasteWaits(undefined, 5, false));
  // (one app: staff paste in the staff view now)
  const paste = STAFF.slice(STAFF.indexOf('function paste('), STAFF.indexOf('/** 🔍 Search my tasks'));
  assert.ok(paste.indexOf('rules.pasteWaits(state.outbox, t.id') > 0 && paste.indexOf('pasteWaits(') < paste.indexOf('addPhotos(t, images') && paste.indexOf('pasteWaits(') < paste.indexOf('state.files[t.id] = '), 'checked before the photo is added');
});

test('team: a photo message sent with words empties the box (the words are not sent twice) and the photo shows', async () => {
  assert.ok(msgBoxSent('crack near the base', 'crack near the base'), 'the box holds just what went: emptied');
  assert.ok(!msgBoxSent('crack near the base, and more', 'crack near the base'), 'more typed since: kept');
  assert.ok(!msgBoxSent('', '') && !msgBoxSent('later words', ''), 'a photo with no words: the box is left alone');
  // (one app: the team pages send it; the words that went leave the kept box, the photo shows in the messages)
  const { t, calls } = await teamPages({ 'comment.photo': () => ({ ok: true, comments: [{ id: 1, photo: true, text: 'crack near the base' }] }) });
  t.state.sel = 'task:5'; t.state.detail = { task: { id: 5 }, comments: [] }; t.state.msgDrafts[5] = 'crack near the base';
  assert.equal(await t.act.sendMessagePhoto(5, new File(['x'], 'p.jpg', { type: 'image/jpeg' })), '');
  assert.equal(calls.find((c) => c.a === 'comment.photo').body.get('text'), 'crack near the base', 'the words go with the photo');
  assert.equal(t.state.msgDrafts[5], undefined, 'the sent words are taken out of the box');
  assert.equal(t.state.detail.comments.length, 1, 'the photo shows');
  assert.match(TEAM, /onPhoto: \(f\) => sendMessagePhoto\(t\.id, f\)/, 'the 📷 button');
  assert.match(TEAM, /sendMessagePhoto\(t\.id, images\[0\]\)/, 'Ctrl+V in the message box');
});

test('team: opening or closing the ☰ menu never wipes a half-filled form', () => {
  // (one app: the menu is drawn with the rest, in place; the form is drawn from the words the page keeps, so it stays)
  assert.match(TEAM, /'aria-label': 'Menu', onClick: \(\) => \{ state\.menuOpen = true; render\(\); \}/, '☰ opens');
  assert.match(TEAM, /class: 'scrim', onClick: \(\) => \{ state\.menuOpen = false; render\(\); \}/, 'the scrim closes');
  assert.match(TEAM, /if \(state\.menuOpen\) \{ state\.menuOpen = false; render\(\); \} else back\(\);/, 'phone Back closes the menu first');
  assert.match(TEAM, /if \(!state\.giveForm \|\| state\.giveForm\.key !== key\) \{/, 'the form is made once and kept');
});

test("team: 'Give task' carries one clientId per form (a second tap after a lost answer gives the task once)", async () => {
  assert.deepEqual(taskSaveBody({ id: 0, title: 'x' }, 'abc'), { id: 0, title: 'x', clientId: 'abc' }, 'a new task carries it');
  assert.deepEqual(taskSaveBody({ id: 7, title: 'x' }, 'abc'), { id: 7, title: 'x' }, 'a change to a task never does');
  assert.deepEqual(taskSaveBody({ id: 0, title: 'x' }, ''), { id: 0, title: 'x' });
  // (review r15: the id is kept for the same words; one app: the team pages' Give a task)
  assert.match(TEAM, /const formId = editing \? '' : \(state\.giveCid = rules\.giveId\(state\.giveCid, fields, newClientId\)\)\.id;/, 'kept for its retries');
  assert.match(TEAM, /api\('task\.save', rules\.taskSaveBody\(fields, formId\)\);\s*state\.giveCid = null;/);
  let n = 0;
  const { t, calls } = await teamPages({ 'task.save': () => { if (++n === 1) throw new Error('Server busy, try again.'); return { ok: true, task: { id: 9, assignee: { id: 7, name: 'Valar' } } }; } });
  const fields = { id: 0, assigneeId: 7, title: 'Check moulds' };
  assert.match(await t.act.saveTask(fields), /Server busy/);
  await t.act.saveTask(fields);
  const ids = calls.filter((c) => c.a === 'task.save').map((c) => c.body.clientId);
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1], 'the second tap carries the same id');
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
  // (one app: the team pages)
  assert.match(TEAM, /p\.projectAbout \? rules\.aboutShort\(p\.projectAbout\) \+ ' · ' : ''/, 'the Projects list row');
  assert.match(TEAM, /const about = state\.detail && sel\.startsWith\('task:'\) \? rules\.projectAboutOf\(\[state\.detail\.task\]\) : state\.detail && sel\.startsWith\('project:'\) \? rules\.projectAboutOf\(/, 'under the title of the project and task pages');
  assert.match(readFileSync(new URL('../team/public_html/sw.js', import.meta.url), 'utf8'), /const CACHE = 'worktask-v33'/, 'new files reach the phones');
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

test('morning email: the summary line leaves out zero parts; 1 item is singular (used on the People page; not in the email any more)', () => {
  assert.ok(!/5 items · 1 late · 1 stuck/.test(MM(mmItems).html), 'no item count in the email (owner asked, to match the Outlook template, 22 Oct)');
  assert.equal(morningSummary(mmItems), '5 items · 1 late · 1 stuck');
  assert.equal(morningSummary([mmItems[4]]), '1 item', 'one item, nothing late or stuck');
  assert.equal(morningSummary([mmItems[1], mmItems[4]]), '2 items · 1 stuck');
  assert.ok(!/5 items/.test(MM(mmItems).text), 'not in the plain words either');
});

test('morning email: the table — columns, greeting, inline styles only, the end lines', () => {
  const { html } = MM(mmItems);
  for (const h of ['#', 'Work', 'Last update', 'What I did today', 'Status']) assert.match(html, new RegExp(`<th[^>]*>${h}</th>`), h);
  assert.match(html, /Dear Mr\. Suresh,<\/p><p[^>]*>Good morning\. Here is your pending work\. Please fill the last two columns and reply by evening\./, 'Dear Mr. <name>, then Good morning on the next line (owner asked, to match the Outlook template, 22 Oct)');
  assert.match(html, /border-collapse:collapse/); assert.match(html, /1px solid #bbb/); assert.match(html, /background:#f2f2f2/); assert.match(html, /Arial/);
  assert.ok(!/<style|var\(--/.test(html), 'Outlook drops <style> and CSS variables');
  assert.match(html, /Status: keep one of Done \/ Going on \/ Stuck\./);
  assert.ok(!/Any problem or help needed/.test(html), 'no "Any problem" line (owner asked, to match the Outlook template, 22 Oct)');
  assert.ok(!/Thanks/.test(html), 'no sign-off: the Outlook template adds it');
  assert.equal((html.match(/Done \/ Going on \/ Stuck<\/td>/g) || []).length, 5, 'each row has the three choices to keep one of');
  assert.match(html, /min-width:\d+px;height:\d+px;">&nbsp;<\/td>/, 'an empty, roomy "What I did today" box');
});

test('morning email: red Late, orange Stuck, Now, about and repeat lines; "—" when no update yet', () => {
  const { html } = MM(mmItems);
  assert.match(html, /color:#c62828[^>]*>Late since 20 Oct</);
  assert.match(html, /color:#e65100[^>]*>Stuck</);
  assert.ok(!/Now: Test 3 samples/.test(html), 'the email shows a project\'s title and description only, not its steps (owner, 22 Oct)');
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
  assert.ok(html.includes('a &amp; b &lt;i&gt;') && html.includes('Raj &lt;b&gt;'));
  assert.ok(text.includes('<script>alert(1)</script>'), 'the plain words stay as typed');
  assert.equal(escHtml(`"'`), '&quot;&#39;');
});

test('morning email: nothing pending — a short friendly line, no table', () => {
  const { html, text } = MM([]);
  assert.ok(!/<table/.test(html));
  assert.match(html, /No pending work today\./);
  assert.match(text, /No pending work today\./);
  assert.ok(!/Thanks/.test(text), 'no sign-off');
});

test('morning email: the plain-words version (for when a table cannot be copied)', () => {
  const { text } = MM(mmItems);
  assert.ok(!/<[a-z]/i.test(text), 'no HTML');
  assert.match(text, /^Dear Mr\. Suresh,\n\nGood morning\./);
  assert.match(text, /3\. 📁 Basin glaze\n   New glaze for line 2\n   Last update: 21 Oct: Mixed 20 kg\n   What I did today: \n   Status: Done \/ Going on \/ Stuck/);
  assert.match(text, /1\. Fix pump\n   Late since 20 Oct\n   Last update: —/);
  assert.match(text, /Status: keep one of Done \/ Going on \/ Stuck\.$/, 'ends with the Status line (owner asked, to match the Outlook template, 22 Oct)');
});

test('morning email: the Team today page has the button, copies the table (HTML + plain words) and opens the email', () => {
  // (one app: the team pages)
  const fn = TEAM.slice(TEAM.indexOf('async function morningEmail('), TEAM.indexOf('// People (another manager'));
  assert.match(TEAM.slice(TEAM.indexOf('function board('), TEAM.indexOf('function followRow(')), /morningEmail\(g\.person\); \} \}, '📧 Morning email'\)/, 'a button on each person\'s line of the Team today table (owner, 23 Oct: one table)');
  assert.match(fn, /api\('morning\.mail', \{ userId: p\.id \}\)/);
  assert.match(fn, /new ClipboardItem\(\{ 'text\/html': [^}]*'text\/plain'/, 'the table and the plain words');
  assert.match(fn, /navigator\.clipboard\.writeText\(mail\.text\)/, 'plain words when a table cannot be copied');
  assert.match(fn, /'mailto:' \+ [^]*'\?subject=' \+ encodeURIComponent\(mail\.subject\)/);
  assert.match(fn, /Table copied — press Ctrl\+V in the email, then Send\./);
  assert.match(fn, /add their email on the People page/);
  assert.match(TEAM, /'Email \(optional, for the morning email\)', h\('input'/, 'People: an Email box');
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
  const card = TEAM.slice(TEAM.indexOf('function peoplePage('), TEAM.indexOf('function settingsPage('));
  assert.match(card, /rules\.morningOrder\(mp\.items\)/, 'the People page uses the same order');
  assert.match(card, /rules\.morningSummary\(list\)/, 'and the same summary');
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
  // (one app: the team pages' People page — another manager's; the owner's People page is the projects' one)
  const people = TEAM.slice(TEAM.indexOf('function peoplePage('), TEAM.indexOf('function settingsPage('));
  assert.match(people, /h\('th', \{ class: 'm-no' \}, '#'\), h\('th', null, 'Work'\), h\('th', \{ class: 'm-last' \}, 'Last update'\)/, 'the three columns');
  assert.match(people, /'No pending work today\.'/);
  assert.match(people, /open\('project:' \+ x\.projectRef\)/, 'a project row opens the project');
  assert.match(people, /open\('task:' \+ x\.taskId\)/, 'a task row opens the task');
  assert.match(people, /Late since \$\{rules\.mailDate\(x\.lateSince\)\}/); assert.match(people, /'Stuck'/); assert.match(people, /Now: \$\{x\.now\}/);
  assert.match(people, /rules\.aboutShort\(x\.about\)/, 'the about line, cut');
  assert.match(people, /sent \? '📧 Send again' : '📧 Morning email'/, 'the button text after sending');
  assert.match(people, /onClick: \(\) => morningEmail\(u\)/, 'it runs the same morning email');
  assert.match(people, /rules\.sentTag\(at, td\)/, 'the sent tag');
  assert.match(people, /'no email — add one'/, 'a link to add a missing email');
  assert.match(people, /`Morning emails today: \$\{sentCount\} of \$\{morning\.people\.length\} sent`/, 'the count at the top');
  assert.match(people, /u\.active && u\.role === 'staff'/, 'managers and switched-off people: no table, no email button');
  assert.match(TEAM, /api\('users\.list'\), api\('people\.morning'\)\.catch\(\(\) => null\)/, 'the page loads it in one request, beside the people');
  const fn = TEAM.slice(TEAM.indexOf('async function morningEmail('), TEAM.indexOf('// People (another manager'));
  assert.match(fn, /markSent\(p\.id, out\.today\)/, 'the morning email marks it sent');
  assert.ok(fn.indexOf('markSent(') < fn.indexOf("'mailto:'"), 'as soon as the email starts');
  assert.match(TEAM, /api\('morning\.sent', \{ userId \}\)\.then\(\(r\) => show\(r\.sentAt\), \(\) => show\(/, 'saved on the server; shown on this device even if that fails');
  const css = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.layout\.staff \.wt-table\.morning \{[^}]*table-layout: fixed/, 'the table never squeezes words to one letter a line');
  assert.match(people, /class: 'wt-table morning'/);
});

test('morning email on People: Team today shows a small ✓ time next to the 📧 Morning email button', () => {
  // (one app: the team pages' Team today)
  assert.match(TEAM.slice(TEAM.indexOf('function board('), TEAM.indexOf('function followRow(')), /'📧 Morning email'\), sentMark\(g\.person\)/, 'on the Team today table (owner, 23 Oct: one table)');
  assert.match(TEAM, /const sentMark = \(p\) => \{ const tm = rules\.sentTime\(sentAtOf\(p\.id, p\.morningSentAt\), istDay\(\)\);/);
  assert.match(TEAM, /' ✓ ' \+ tm/);
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
  // (one app: the team pages)
  assert.match(TEAM, /item\('🔁 Follow-up', listOn\('followup'\), \(\) => go\('followup'\)\)/, 'manager menu item');
  assert.match(TEAM, /api\('followup\.list'\)/);
  assert.match(TEAM, /state\.view === 'followup' \? followupList\(\)/);
  const row = TEAM.slice(TEAM.indexOf('function followRow('), TEAM.indexOf('/** 🎤 only where'));
  assert.match(row, /chase\(r\)\) load\(\); \} \}, '🔔 Chase'/);
  assert.match(row, /closeFollow\(r\)\) load\(\); \} \}, '✓ Done'/);
  assert.match(row, /takeBack\(r\) \}, '↩ Take back'/);
  assert.match(row, /r\.kind === 'project'[^]*open\('project:' \+ r\.projectRef\) \}, '📁 Open project'\)[^]*'Take back on your projects page'/, 'a project is taken back on the projects page');
  const fns = TEAM.slice(TEAM.indexOf('async function chase('), TEAM.indexOf('// the round:'));
  assert.match(fns, /api\('task\.chase', \{ id: r\.taskId \}\)/);
  assert.match(fns, /api\('task\.status', \{ id: r\.taskId, status: 'done' \}\)/, 'Done: the same close as Mark done');
  assert.match(fns, /confirm\(`Take "\$\{r\.title\}" back[^]*api\('task\.status', \{ id: r\.taskId, status: 'cancelled' \}\)/, 'Take back asks first, then the usual cancel');
  assert.match(TEAM.slice(TEAM.indexOf('function followupList('), TEAM.indexOf('function tasksList(')), /onClick: startRound \}, '▶ Start round \(2 min\)'/);
});

test('follow-up round: the screen uses the rule, keeps its place on this device and has OK / Chase / Change person / Close', () => {
  // (one app: the team pages)
  const fn = TEAM.slice(TEAM.indexOf('function roundScreen('), TEAM.indexOf('function followupList('));
  assert.match(fn, /rules\.roundPlan\(R\.rows, R\.saved, td\)/);
  assert.match(fn, /`Item \$\{plan\.pos\} of \$\{plan\.total\}`/);
  assert.match(fn, /progressBar\(part, 'rf'\)/, 'a thin progress bar');
  assert.match(fn, /R\.saved = rules\.roundMark\(R\.saved, rules\.roundKey\(r\), what, td\); roundStore\(R\.saved\)/, 'each item looked at is kept on the device');
  assert.match(fn, /mark\('ok'\) \}, '👍 OK'/);
  assert.match(fn, /chase\(r\)\) mark\('chased'\)/);
  assert.match(fn, /api\('task\.move', \{ id: r\.taskId, toId: p\.id \}\)[^\n]*mark\('changed'\)/, 'Change person: the usual move');
  assert.match(fn, /closeFollow\(r\)\) mark\('closed'\); \} \}, '✕ Close'/);
  assert.match(fn, /'All followed up ✓'[^]*\$\{s\.chased\} chased · \$\{s\.changed\} changed · \$\{s\.closed\} closed/);
  assert.match(TEAM, /const roundLoad = \(\) => \{ try \{ return JSON\.parse\(localStorage\.getItem\(roundKey\(\)\)/, 'read back safely');
});

test('work in one line: the box on Follow-up and on Give a task, 🎤 only where it works, one task for a double tap, ✎ Change fills the form', () => {
  // (one app: the team pages)
  assert.match(TEAM.slice(TEAM.indexOf('function followupList('), TEAM.indexOf('function tasksList(')), /quickBox\(d\.people \|\| \[\]\)/, 'at the top of Follow-up');
  assert.match(TEAM, /!editing \? block\('Work in one line', quickBox\(state\.people\)\) : null/, 'on Give a task');
  const fn = TEAM.slice(TEAM.indexOf('/** 🎤 only where'), TEAM.indexOf('function roundScreen('));
  assert.match(fn, /rules\.parseQuickTask\(q\.text, people, today\(\)\)/);
  assert.match(fn, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(fn, /listen\(\) \? h\('button', [^\n]*'🎤'\) : null/, 'the 🎤 only if the browser can listen');
  assert.match(fn, /rec\.lang = 'en-IN'/);
  assert.match(fn, /rec\.onend = [^\n]*if \(heard\) \(state\.quick \|\| [^\n]*\)\.text = heard;/, 'when it stops, its words go into the box');
  assert.match(fn, /if \(q\.sig !== sig\) \{ q\.sig = sig; q\.cid = newClientId\(\); \}/, 'one id per preview');
  assert.match(TEAM, /api\('task\.save', rules\.taskSaveBody\(\{ assigneeId: r\.person\.id, title: r\.title, [^}]*repeat: 'once'[^}]*dueDate: r\.dueDate \}, q\.cid\)\)/, 'a one-time task with its by-date and the preview\'s id');
  assert.match(TEAM, /news\(`Given to \$\{out\.task\.assignee\.name\} ✓`/);
  assert.ok(!/Email it too|oneTaskMail/.test(TEAM), 'no one-task email (only the morning email)');
  assert.match(fn, /state\.prefill = \{ title: r\.title, assigneeId: r\.person\.id, repeat: 'once', dueDate: r\.dueDate \}; state\.quick = null; open\('give'\); \} \}, '✎ Change'/);
  const form = TEAM.slice(TEAM.indexOf('function taskForm()'), TEAM.indexOf('function passwordPage()'));
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
  // (one app: the team pages' Settings)
  assert.match(TEAM, /owner \? outlookBlock\(\) : null/, 'only the owner of the projects sees it');
  const fn = TEAM.slice(TEAM.indexOf('function outlookBlock()'), TEAM.indexOf('// ---------------------------------------------------------------- the page on the right'));
  assert.match(fn, /block\('📧 Outlook'/);
  for (const label of ['Application \\(client\\) ID', 'Directory \\(tenant\\) ID', 'Client secret ', 'Redirect URI to register']) assert.match(fn, new RegExp(`h\\('label', null, '${label}'`), label);
  assert.match(fn, /h\('input', \{ key: 'ol-secret', type: 'password', autocomplete: 'new-password'/, 'a password box');
  assert.ok(!/o\.secret = (?!el\.value|'')/.test(fn), 'the secret box is only ever typed in or emptied, never filled');
  assert.ok(!/d\.outlook\.secret\b|st\.secret\b/.test(fn), 'nothing but the last 4 letters is read');
  assert.match(fn, /st\.secretEnd \? `saved ✓ \(ends …\$\{st\.secretEnd\}\)`/);
  assert.match(fn, /st \? st\.redirectUri \|\| '' : ''/);
  assert.match(fn, /api\('outlook\.status'\)/);
  assert.match(fn, /run\('save', 'outlook\.save', \{ clientId: o\.clientId\.trim\(\), tenantId: o\.tenantId\.trim\(\), secret: o\.secret\.trim\(\) \}, \(\) => \{ o\.secret = '';/);
  assert.match(fn, /run\('connect', 'outlook\.connect', \{\}, \(out\) => \{ if \(out\.url\) location\.href = out\.url; \}\)/, 'Connect goes to the Microsoft sign-in');
  assert.match(fn, /run\('check', 'outlook\.check'/);
  assert.match(fn, /confirm\('Disconnect Outlook\?[^']*'\)\) run\('off', 'outlook\.disconnect'/);
  assert.match(fn, /st && st\.connected \? h\('button', [^\n]*'Check now'\) : null/);
  assert.match(fn, /rules\.outlookLine\(st, st\.today\)/);
  assert.match(fn, /offline_access, User\.Read and Mail\.ReadWrite \(it only reads your emails; it never sends any\)/, 'the permissions to add in Azure');
  const sw = readFileSync(new URL('../team/public_html/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /url\.pathname === '\/outlook\.php'/, 'the sign-in page is never kept on the phone');
  assert.match(readFileSync(new URL('../team/public_html/outlook.php', import.meta.url), 'utf8'), /href="\/projects\/#team"/, 'its Back link opens the team pages of the one app');
});

test('one People page: Work Task\'s menu opens the People page on the projects page, which opens on People', async () => {
  // (one app: the owner's team pages open the projects' People page; another manager has the team pages' own)
  assert.match(TEAM, /item\('People', listOn\('people'\), \(\) => \(opts\.openPeople \? opts\.openPeople\(\) : go\('people'\)\)\)/);
  assert.match(DP, /openPeople: \(\) => \{ leaveTeam\(\); go\('people'\); \}/, 'the owner: the projects\' People page');
  assert.match(DP, /if \(location\.hash === '#people'\) \{ ui\.view = 'people';/, 'the projects page opens on People');
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
  // (one app: the team pages)
  const fn = TEAM.slice(TEAM.indexOf('async function morningEmail('), TEAM.indexOf('// People (another manager'));
  assert.match(fn, /const connected = outlookConnected\(\);\n\s*const tryDraft = connected && \(p\.email === undefined \|\| rules\.emailPath\(\{ connected, email: p\.email \}\) === 'draft'\);/);
  assert.match(fn, /const tab = tryDraft \? window\.open\('about:blank', '_blank'\) : null;/, 'the tab is opened in the tap');
  assert.ok(fn.indexOf("window.open('about:blank'") < fn.indexOf('await copying;') && fn.indexOf('await copying;') < fn.indexOf('await ready;'), 'the copy is started and the tab opened before anything is awaited');
  assert.match(fn, /if \(tryDraft && rules\.emailPath\(\{ connected, email \}\) === 'draft'\) \{\n\s*try \{\n\s*const r = await api\('outlook\.compose', \{ to: email, subject: mail\.subject, html: mail\.html \}\);\n\s*markSent\(p\.id, out\.today\);/, 'the finished email to the saved address, then marked sent');
  assert.match(fn, /tab\.location\.href = r\.webLink;/);
  assert.match(fn, /'Draft ready in Outlook — check it and press Send\.'/);
  assert.match(fn, /\} catch \(e\) \{ why = rules\.pasteReason\(\{ connected, email, name: out\.person\.name, error: e\.message \}\); \}/, 'a failed draft falls back, saying why');
  assert.match(fn, /if \(tab\) tab\.close\(\);\n\s*markSent\(p\.id, out\.today\);[^]*'mailto:'/, 'the fallback: close the blank tab, mark sent, open the email');
  assert.match(fn, /table copied, paste it with ⌘ Cmd\+V/);
  assert.ok(!/\/send|sendMail/.test(fn), 'never sends');
  assert.match(TEAM, /if \(owner && state\.outlook === null && !outlookAsk\) outlookAsk = api\('outlook\.status'\)/, 'asked once per page load (owner only), kept in memory');
  assert.match(TEAM, /state\.outlook = !!\(o\.status && o\.status\.connected\);/, 'Settings → Outlook keeps it up to date');
  for (const s of ['function teamList() {', 'function peoplePage() {']) assert.match(TEAM.slice(TEAM.indexOf(s), TEAM.indexOf(s) + 200), /outlookConnected\(\);/, `${s} asks before the button is pressed`);
});

test('project reminders: a tap on a "/projects/#open=<id>" notification opens the projects page, never a Work Task task with that number', () => {
  const sw = readFileSync(new URL('../team/public_html/sw.js', import.meta.url), 'utf8');
  // (one app: every notification opens the one app; a project reminder keeps its "#open=<project>", a team task is "#team-task=<id>")
  assert.match(sw, /if \(url\.pathname !== '\/'\) return url;/, 'a /projects/ link is left as it is');
  assert.match(sw, /const c = url\.pathname === '\/projects\/' && url\.hash \? list\.find\(\(x\) => new URL\(x\.url\)\.pathname === '\/projects\/'\) : null;/);
  assert.match(sw, /if \(c\) \{ c\.postMessage\(\{ type: 'open', hash: url\.hash \}\); return c\.focus\(\); \}/, 'an open window opens it itself');
  assert.match(DP, /d\.type === 'open' && typeof d\.hash === 'string' && \/\^#\(\?:team-task=\\d\+\|open=\[\\w-\]\{1,64\}\)\$\/\.test\(d\.hash\)\) location\.hash = d\.hash;/, 'the one app takes it (the owner\'s reminder opens that project)');
});

test('🎤 one-line task: the site lets its own pages use the microphone, so the 🎤 button can work (it was switched off for everyone)', () => {
  const ht = readFileSync(new URL('../team/public_html/.htaccess', import.meta.url), 'utf8');
  const policy = /Permissions-Policy "([^"]*)"/.exec(ht);
  assert.ok(policy, 'a Permissions-Policy is sent');
  assert.match(TEAM, /try \{ rec\.start\(\); state\.listening = true;/, 'the 🎤 button is there (the team pages)');
  assert.match(policy[1], /(^|,\s*)microphone=\(self\)/, 'so the microphone is allowed for this site itself');
  assert.ok(!/microphone=\(\)/.test(policy[1]), 'never switched off for all');
  assert.match(policy[1], /geolocation=\(\)/, 'location stays off');
});

test('sign-out: the next person on the same page never gets the half-typed one-line task, the round, or the owner\'s Outlook status', () => {
  // (one app: signing out leaves the page (a fresh page for the next person: nothing typed stays in memory), and
  // takes this person's saved copies and sign-in off the phone; the round is kept per person; Outlook is the owner's only)
  const out = DP.slice(DP.indexOf('const signOut = async () => {'), DP.indexOf('/** A photo or PDF on top of the page'));
  assert.match(out, /localStorage\.removeItem\(SERVER_TOKEN_KEY\); localStorage\.removeItem\(WHO_KEY\);/);
  assert.match(out, /if \(k\.startsWith\('wt\.c\.'\)\) localStorage\.removeItem\(k\);/);
  assert.match(out, /location\.replace\(location\.pathname\);/, 'a fresh page');
  assert.match(TEAM, /const roundKey = \(\) => 'wt\.round\.' \+ state\.user\.id;/, 'the round is kept per person');
  assert.match(TEAM, /if \(owner && state\.outlook === null/, 'the Outlook status is asked only for the owner');
});

test('Settings asks team.today and outlook.status once per visit, not again on every redraw', async () => {
  // (one app: the team pages' Settings ask once and keep it in the page's state; a new visit asks again)
  const settings = TEAM.slice(TEAM.indexOf('function settingsPage()'), TEAM.indexOf('/**', TEAM.indexOf('function settingsPage()')));
  const card = TEAM.slice(TEAM.indexOf('function outlookBlock()'), TEAM.indexOf('// ---------------------------------------------------------------- the page on the right'));
  assert.match(settings, /if \(!s\.asked\) \{ s\.asked = true; api\('team\.today'\)/, 'asked once');
  assert.match(card, /if \(!o\.asked\) \{\n\s*o\.asked = true;\n\s*api\('outlook\.status'\)/, 'asked once');
  assert.equal((card.match(/api\('outlook\.status'\)/g) || []).length, 1);
  assert.match(card, /o\.status = out\.outlook \|\| o\.status;/, 'Connect / Check now / Save answers are kept too');
  const { t } = await teamPages();
  t.state.settingsForm = { asked: true }; t.state.olForm = { asked: true, secret: '' };
  t.go('settings');
  assert.equal(t.state.settingsForm, null, 'a new visit asks again');
  assert.equal(t.state.olForm, null);
  t.state.olForm = { asked: true, secret: 'typed' }; t.go('settings');
  assert.equal(t.state.olForm.secret, 'typed', 'a secret being typed is not wiped');
});

test('a photo message sent again after a lost answer carries the same clientId (kept once); a different photo or words, a new one', async () => {
  // (one app: the team pages; the staff view has its own check)
  let n = 0;
  const { t, calls } = await teamPages({ 'comment.photo': () => { if (++n === 1) throw new Error('Server busy, try again.'); return { ok: true, comments: [] }; } });
  const f = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
  t.state.msgDrafts[5] = 'see crack';
  assert.match(await t.act.sendMessagePhoto(5, f), /Server busy/);
  await t.act.sendMessagePhoto(5, f);
  const ids = calls.filter((c) => c.a === 'comment.photo').map((c) => c.body.get('clientId'));
  assert.equal(ids[0], ids[1], 'the same id after a lost answer');
  await t.act.sendMessagePhoto(5, new File(['yy'], 'q.jpg', { type: 'image/jpeg' }));
  assert.notEqual(calls.filter((c) => c.a === 'comment.photo')[2].body.get('clientId'), ids[0], 'another photo: a new id');
});

// ---------------------------------------------------------------- review round 13 (Work Task client)
// Runs the real sw.js with a pretend browser: a cache holding the OLD files and a network that is slow (or gone).
async function swHarness({ netNever = false, netFail = false, net = null } = {}) {
  const vm = await import('node:vm');
  const src = readFileSync(new URL('../team/public_html/sw.js', import.meta.url), 'utf8');
  const ORIGIN = 'https://worktask.in';
  const key = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN + '/').href;
  const stores = {};
  const store = (name) => (stores[name] ||= new Map());
  const cacheObj = (name) => ({
    match: async (r) => { const x = store(name).get(key(r)); return x && !x.bodyUsed ? x.clone() : x; }, // like the real Cache API: a fresh copy each time
    put: async (r, res) => { store(name).set(key(r), res); },
    addAll: async (list) => { for (const r of list) store(name).set(key(r), new Response('new ' + key(r))); },
  });
  const handlers = {};
  const timers = [];
  const fetches = [];
  const posted = []; // messages sent to the open pages
  const ctx = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, clients: { matchAll: async () => [], claim: async () => {}, get: async (id) => ({ id, postMessage: (m) => posted.push({ id, ...m }) }) }, skipWaiting: async () => {}, registration: {} },
    location: { origin: ORIGIN },
    caches: { open: async (n) => cacheObj(n), match: async (r) => { for (const n of Object.keys(stores)) { const x = store(n).get(key(r)); if (x) return x; } return undefined; }, keys: async () => Object.keys(stores), delete: async (n) => delete stores[n] },
    fetch: (r, o) => { fetches.push({ url: key(r), cache: o && o.cache }); return net ? net(key(r)) : netNever ? new Promise(() => {}) : netFail ? Promise.reject(new TypeError('offline')) : Promise.resolve(new Response('net ' + key(r))); },
    setTimeout: (f, ms = 0) => { timers.push({ f, ms }); return timers.length; },
    Request: class { constructor(u, o) { this.url = key(u); this.cache = o && o.cache; } },
    Response, URL, Promise, console,
  };
  ctx.self.location = ctx.location;
  vm.runInNewContext(src, ctx);
  const cacheName = /const CACHE = '([^']+)'/.exec(src)[1];
  return {
    cacheName, store, handlers, fetches, posted,
    /** One request; resolves to the body text, or 'PENDING' if nothing answered after the timers up to `upTo` ms fired. */
    async ask(path, mode = 'no-cors', { upTo = 4000, clientId = '', waits = [] } = {}) {
      let answer;
      handlers.fetch({ request: { url: ORIGIN + path, method: 'GET', mode }, clientId, respondWith: (p) => { answer = p; }, waitUntil: (p) => { waits.push(p); } });
      if (!answer) return 'NOT HANDLED';
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      timers.splice(0).forEach((t) => { if (t.ms <= upTo) t.f(); }); // the 4 seconds (or upTo) are up
      const done = await Promise.race([answer.then((r) => r.text()), new Promise((r) => setTimeout(() => r('PENDING'), 30))]);
      return done;
    },
  };
}

test('r13 sw: on a slow network a .js file (app.js / logic.js) is never answered from the old kept copy, so new app.js never meets old logic.js', async () => {
  const h = await swHarness({ netNever: true });
  for (const f of ['/app.js', '/logic.js', '/styles.css']) h.store(h.cacheName).set('https://worktask.in' + f, new Response('old ' + f));
  h.store(h.cacheName).set('https://worktask.in/', new Response('old page'));
  assert.equal(await h.ask('/logic.js'), 'PENDING', 'logic.js waits for the network');
  assert.equal(await h.ask('/app.js'), 'PENDING', 'app.js waits for the network');
  assert.equal(await h.ask('/styles.css'), 'PENDING');
  assert.equal(await h.ask('/', 'navigate'), 'old page', 'the page itself still opens from the phone on a weak signal');
});

test('r13 sw: offline, the code files still come from the kept copy (of this version only)', async () => {
  const h = await swHarness({ netFail: true });
  h.store(h.cacheName).set('https://worktask.in/logic.js', new Response('kept logic'));
  h.store('worktask-v1').set('https://worktask.in/app.js', new Response('very old app'));
  assert.equal(await h.ask('/logic.js'), 'kept logic');
  assert.notEqual(await h.ask('/app.js'), 'very old app', 'a copy left in another (old) cache is never used');
});

test('r13 sw: install keeps all app files at once, fresh from the server, in one named cache', async () => {
  const h = await swHarness();
  let wait;
  h.handlers.install({ waitUntil: (p) => { wait = p; } });
  await wait;
  const keys = [...h.store(h.cacheName).keys()];
  for (const f of ['index.html', 'app.js', 'logic.js', 'styles.css']) assert.ok(keys.includes('https://worktask.in/' + f), f);
  const sw = readFileSync(new URL('../team/public_html/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /c\.addAll\(SHELL\.map\(\(u\) => new Request\(u, \{ cache: 'reload' \}\)\)\)/, 'not the browser\'s possibly older copy');
});

test('r13 Back marker: after a reload the old {wt:1} is dropped at start, so Back / ← / a menu tap never reload the app', async () => {
  // (one app: the team pages' phone Back (workparts.js phoneBack); the step it leaves is { dpBack: 1 })
  const { phoneBack } = await import('../docs/ui/workparts.js');
  const pops = [];
  const hist = { state: { dpBack: 1 }, backs: 0, back() { this.backs++; this.state = null; pops.forEach((f) => f()); }, replaceState(s) { this.state = s; }, pushState(s) { this.state = s; } };
  const win = { history: hist, addEventListener: (k, f) => { if (k === 'popstate') pops.push(f); } };
  let open = false, closed = 0;
  const sync = phoneBack(win, () => open, () => { closed++; open = false; });
  assert.equal(hist.state, null, 'the old step from before the reload is dropped at start');
  sync(); assert.equal(hist.backs, 0, 'nothing open: no Back taken (that would leave the app)');
  open = true; sync(); assert.deepEqual(hist.state, { dpBack: 1 }, 'opening a task gets its own Back step');
  hist.back(); assert.equal(closed, 1, 'the phone Back closes it'); sync(); assert.equal(hist.backs, 1);
  open = true; sync(); open = false; sync();
  assert.equal(hist.backs, 2, 'closed with ←: its Back step is taken off again');
  assert.equal(closed, 1, '… without closing anything else');
  assert.match(TEAM, /const backSync = phoneBack\(/); assert.match(TEAM, /else root\.replaceChildren\(next\);\n\s*backSync\(\);/, 'after each redraw');
});

// ---------------------------------------------------------------- review round 14 (Work Task client)
test('r14 sw: on a stalled network a code file waits about 8 s, then uses THIS version\'s kept copy (never an older cache), so the app is not left blank', async () => {
  const h = await swHarness({ netNever: true });
  h.store(h.cacheName).set('https://worktask.in/app.js', new Response('kept app'));
  h.store(h.cacheName).set('https://worktask.in/styles.css', new Response('kept css'));
  h.store('worktask-v1').set('https://worktask.in/logic.js', new Response('very old logic'));
  assert.equal(await h.ask('/app.js'), 'PENDING', 'still waits for the network at 4 s');
  assert.equal(await h.ask('/app.js', 'no-cors', { upTo: 8000 }), 'kept app', 'after ~8 s: the kept copy');
  assert.equal(await h.ask('/styles.css', 'no-cors', { upTo: 8000 }), 'kept css');
  assert.equal(await h.ask('/logic.js', 'no-cors', { upTo: 60000 }), 'PENDING', 'a copy in another (old) cache is never used');
  const sw = readFileSync(new URL('../team/public_html/sw.js', import.meta.url), 'utf8');
  const wait = Number(/const CODE_WAIT = (\d+);/.exec(sw)[1]);
  assert.ok(wait >= 5000 && wait <= 20000, 'a few seconds, not minutes');
});

test('r14 sw: one page never mixes versions: app.js from the network → logic.js waits for the network; app.js from the kept set → logic.js from the kept set', async () => {
  let slow = false;
  const h = await swHarness({ net: (u) => (slow ? new Promise(() => {}) : Promise.resolve(new Response('new ' + u.slice(u.lastIndexOf('/') + 1)))) });
  for (const f of ['app.js', 'logic.js']) h.store(h.cacheName).set('https://worktask.in/' + f, new Response('kept ' + f));
  assert.equal(await h.ask('/app.js', 'no-cors', { clientId: 'pageA' }), 'new app.js');
  slow = true;
  assert.equal(await h.ask('/logic.js', 'no-cors', { clientId: 'pageA', upTo: 60000 }), 'PENDING', 'new app.js never meets the kept (maybe old) logic.js');
  assert.equal(await h.ask('/app.js', 'no-cors', { clientId: 'pageB', upTo: 8000 }), 'kept app.js');
  slow = false;
  assert.equal(await h.ask('/logic.js', 'no-cors', { clientId: 'pageB' }), 'kept logic.js', 'kept app.js gets the kept logic.js, even when the network is back');
});

test('r14 sw: a code file from the network is not kept on its own (the kept code is one matched set)', async () => {
  const h = await swHarness();
  h.store(h.cacheName).set('https://worktask.in/logic.js', new Response('kept logic'));
  assert.equal(await h.ask('/app.js'), 'net https://worktask.in/app.js');
  await new Promise((r) => setImmediate(r));
  assert.equal(h.store(h.cacheName).get('https://worktask.in/app.js'), undefined, 'app.js alone was not put into the kept set');
  assert.equal(await h.ask('/'), 'net https://worktask.in/', 'other files are still kept as they come');
  await new Promise((r) => setImmediate(r));
  assert.ok(h.store(h.cacheName).get('https://worktask.in/'), 'the page is kept');
});

test('r14 version.txt: never answered from the kept copy (network only, no-store), so "New version ready" is never false; a new version renews the kept set at once', async () => {
  let ver = 'v1';
  const h = await swHarness({ net: (u) => Promise.resolve(new Response(u.endsWith('version.txt') ? ver + '\n' : 'fresh ' + u)) });
  h.store(h.cacheName).set('https://worktask.in/version.txt', new Response('OLD STAMP'));
  const waits = [];
  assert.equal(await h.ask('/version.txt', 'no-cors', { waits }), 'v1\n', 'from the server');
  await Promise.all(waits);
  assert.ok(h.fetches.some((f) => f.url === 'https://worktask.in/version.txt' && f.cache === 'no-store'), 'no-store');
  assert.equal(await h.store(h.cacheName).get('https://worktask.in/kept-version.txt').clone().text(), 'v1', 'first stamp noted');
  assert.equal(h.store(h.cacheName).get('https://worktask.in/app.js'), undefined, 'same as install: nothing downloaded again');
  ver = 'v2'; waits.length = 0;
  assert.equal(await h.ask('/version.txt', 'no-cors', { waits }), 'v2\n');
  await Promise.all(waits);
  for (const f of ['app.js', 'logic.js', 'styles.css', 'index.html']) assert.equal(await h.store(h.cacheName).get('https://worktask.in/' + f).clone().text(), 'new https://worktask.in/' + f, f + ' renewed with the set');
  assert.equal(await h.store(h.cacheName).get('https://worktask.in/kept-version.txt').clone().text(), 'v2');
  const off = await swHarness({ netFail: true });
  off.store(off.cacheName).set('https://worktask.in/version.txt', new Response('OLD STAMP'));
  assert.equal(await off.ask('/version.txt').catch(() => 'NETWORK ERROR'), 'NETWORK ERROR', 'offline: no answer (the page tries later), never the kept stamp');
  // (one app: the old page only forwards; the one app asks for its own version.txt, past the browser's store)
  assert.match(DP, /const \{ url, init \} = versionRequest\(codeStamp\);/, 'the one app asks for the version itself');
});

test('sw: install notes the version of the files it keeps, so a later upload renews the kept set (never old code labelled new)', async () => {
  let ver = 'A';
  const h = await swHarness({ net: (u) => Promise.resolve(new Response(u.endsWith('version.txt') ? ver + '\n' : 'fresh ' + u)) });
  let wait;
  h.handlers.install({ waitUntil: (p) => { wait = p; } });
  await wait;
  assert.ok(h.fetches.some((f) => f.url === 'https://worktask.in/version.txt' && f.cache === 'no-store'), 'asked fresh from the server');
  assert.equal(await h.store(h.cacheName).get('https://worktask.in/kept-version.txt').clone().text(), 'A', 'the stamp is the version of the kept files');
  for (const f of ['app.js', 'logic.js']) h.store(h.cacheName).set('https://worktask.in/' + f, new Response('A ' + f));
  ver = 'B'; // an upload; the page's first version check goes through the worker later
  const waits = [];
  assert.equal(await h.ask('/version.txt', 'no-cors', { waits }), 'B\n');
  await Promise.all(waits);
  for (const f of ['app.js', 'logic.js']) assert.equal(await h.store(h.cacheName).get('https://worktask.in/' + f).clone().text(), 'new https://worktask.in/' + f, f + ': the old A copy was renewed');
  assert.equal(await h.store(h.cacheName).get('https://worktask.in/kept-version.txt').clone().text(), 'B');
  // version.txt not readable at install: the set counts as old, renewed at the first check
  const n = await swHarness({ net: (u) => Promise.resolve(u.endsWith('version.txt') ? new Response('', { status: 404 }) : new Response('x')) });
  n.handlers.install({ waitUntil: (p) => { wait = p; } });
  await wait;
  assert.equal(await n.store(n.cacheName).get('https://worktask.in/kept-version.txt').clone().text(), '');
});

test('r14 Outlook status: one failed outlook.status answer does not switch the no-paste email off for the whole page load; the next redraw asks again', async () => {
  // (one app: the team pages)
  let calls = 0, fail = true;
  const { t } = await teamPages({ 'outlook.status': () => { calls++; if (fail) throw new Error('offline'); return { outlook: { connected: true } }; } });
  const ask = t.act.outlookConnected;
  assert.equal(ask(), false);
  ask(); assert.equal(calls, 1, 'not asked twice while waiting');
  await new Promise((r) => setImmediate(r));
  fail = false;
  assert.equal(ask(), false, 'still unknown');
  assert.equal(calls, 2, 'asked again after the failed answer');
  await new Promise((r) => setImmediate(r));
  assert.equal(ask(), true, 'connected: the no-paste way works');
  assert.equal(calls, 2, 'a good answer is kept');
});

test('review r15: a waiting update sent with sentAt (the server puts a wrong phone clock right); an "older" answer shows the words that were not saved', async () => {
  const { olderShow } = await import('../team/public_html/logic.js');
  const b = updateSaveBody({ taskId: 4, note: 'n', state: 'progress', clientId: 'a', day: 'd', writtenAt: 'w' });
  assert.ok(Date.parse(b.sentAt) > Date.now() - 5000, 'sentAt is now');
  assert.equal(updateSaveBody({ taskId: 4, note: 'n', state: 'progress', clientId: 'a' }).sentAt, undefined, 'only with writtenAt');
  const show = olderShow({ note: 'my late words' }, { note: 'newer words' });
  assert.match(show.body, /my late words/);
  assert.equal(olderShow({ note: 'same' }, { note: 'same' }), null, 'nothing lost: no notice');
  // (one app: one outbox for everyone, ui/staffbox.js; the team pages show it as words to copy)
  assert.match(STAFFBOX, /const kept = out\.history === 'older' \? rules\.olderShow\(it, out\.update\) : null;/);
  assert.match(TEAM, /older: \(k\) => kept\(k\.title, k\.body\),/);
});

test('review r15: work in one line — numbers in the work (sizes, quantities) are not dates; the date word typed is used', () => {
  assert.deepEqual(qt('Valar: fix 3/4 inch valve by Friday'), { person: { id: 1, name: 'Valar' }, title: 'Fix 3/4 inch valve', dueDate: '2026-10-23', error: '' });
  assert.deepEqual(qt('Valar: order 2-3 bags of glaze'), { person: { id: 1, name: 'Valar' }, title: 'Order 2-3 bags of glaze', dueDate: '', error: '' });
  assert.equal(qt('Valar: buy 10/12 mm pipes').title, 'Buy 10/12 mm pipes');
  assert.equal(qt('Valar: buy 10/12 mm pipes').dueDate, '');
  assert.equal(qt('Valar: send 2 may photos').title, 'Send 2 may photos');
  assert.deepEqual([qt('Valar: load 13/14 trolleys').error, qt('Valar: load 13/14 trolleys').title], ['', 'Load 13/14 trolleys'], 'not refused as a wrong date');
  // a date in numbers still counts after by / on, or at the end
  assert.equal(qt('Valar: fix 3/4 inch valve by 5/11').dueDate, '2026-11-05');
  assert.equal(qt('Valar: fix 3/4 inch valve by 5/11').title, 'Fix 3/4 inch valve');
  assert.equal(qt('Valar: order 2-3 bags 24/10.').dueDate, '2026-10-24');
  assert.equal(qt('Valar: send 2 may photos on 3 Nov').dueDate, '2026-11-03');
});

test('review r15: Give a task keeps its clientId for the same words across redraws (a retap after a lost answer is one task); changed words get a new one', () => {
  let n = 0; const make = () => 'id' + (++n);
  const f = { id: 0, assigneeId: 3, title: 'Fire samples', stepRef: 'p1:s2' };
  const first = giveId(null, f, make);
  assert.equal(first.id, 'id1');
  assert.equal(giveId(first, { ...f }, make).id, 'id1', 'the same task again (a new form drawn in between): the same id');
  assert.equal(giveId(first, { ...f, title: 'Fire more samples' }, make).id, 'id2', 'changed: a new task');
  assert.equal(giveId(null, f, make).id, 'id3', 'after a success (saved id cleared): a new id');
});

test('review r15: words typed in the message box while a message is sending stay in the box (only the sent words leave)', async () => {
  assert.equal(msgBoxLeft('crack near the base', 'crack near the base'), '', 'just what went: emptied');
  assert.equal(msgBoxLeft('crack near the base\nAlso the lid', 'crack near the base'), 'Also the lid', 'the words typed after stay');
  assert.equal(msgBoxLeft('something else', 'crack near the base'), 'something else', 'rewritten: all kept');
  assert.equal(msgBoxLeft(undefined, 'x'), '');
  // (one app: the team pages; online and kept on the phone)
  let t;
  ({ t } = await teamPages({ 'comment.add': () => { t.state.msgDrafts[5] = 'crack near the base\nAlso the lid'; return { ok: true, comments: [] }; } }));
  t.state.msgDrafts[5] = 'crack near the base';
  await t.act.sendMessage(5);
  assert.equal(t.state.msgDrafts[5], 'Also the lid', 'online: the words typed meanwhile stay');
  ({ t } = await teamPages({ 'comment.add': () => { t.state.msgDrafts[6] = 'hello\nmore'; throw Object.assign(new Error('offline'), { offline: true }); } }));
  t.state.msgDrafts[6] = 'hello';
  await t.act.sendMessage(6);
  assert.equal(t.state.msgDrafts[6], 'more', 'kept on the phone: the words typed meanwhile stay too');
});

test('review r16: the "Finished" after the photos goes on the day the server saved the first part for (a wrong phone date is put right)', () => {
  // (one app: one outbox for everyone, ui/staffbox.js)
  assert.match(STAFFBOX, /it\.day = out\.update\.day;/);
  assert.match(STAFFBOX, /if \(it\.thenFinish\) await api\('update\.save', rules\.updateSaveBody\(\{ taskId: it\.taskId, note: it\.note, day: it\.day \|\| day,/);
});

test('review r16: words typed in the update box while Send is running are kept (the box stays open as a change), online and when kept on the phone', async () => {
  assert.equal(updateBoxLeft('Fired kiln 3', 'Fired kiln 3'), '', 'just what went: the box closes');
  assert.equal(updateBoxLeft('Fired kiln 3, temp 1180C, crack on tile 4', 'Fired kiln 3'), 'Fired kiln 3, temp 1180C, crack on tile 4', 'more typed: all of it stays, to send again as the change');
  assert.equal(updateBoxLeft('  ', 'Fired kiln 3'), '', 'emptied meanwhile: nothing to keep');
  assert.equal(updateBoxLeft(undefined, 'x'), '');
  // (one app: the update box is in the staff view; the same rule, run for real, online and when kept on the phone)
  for (const net of ['online', 'offline']) {
    let release;
    const { s: v, calls, box } = await staffView({ 'update.save': (b) => new Promise((ok, no) => { release = () => (net === 'online' ? ok({ ok: true, update: { id: 9, note: b.note } }) : no(offline())); }) });
    const t = { id: 7, title: 'Kiln', status: 'open', today: null };
    v.state.drafts[7] = { note: 'Fired kiln 3', state: 'progress' };
    const going = v.act.sendUpdate(t);
    await new Promise((r) => setTimeout(r, 0));
    v.state.drafts[7].note = 'Fired kiln 3, temp 1180C'; // typed while it was sending
    release(); await going;
    assert.deepEqual(v.state.drafts[7], { note: 'Fired kiln 3, temp 1180C', state: 'progress' }, `${net}: the typed words have a draft behind them`);
    assert.equal(v.state.editing[7], true, `${net}: the box stays open (a second Send changes today's update)`);
    const went = net === 'online' ? calls.find((c) => c.a === 'update.save').body.note : [...box.items.values()][0].note;
    assert.equal(went, 'Fired kiln 3', `${net}: what went is the text taken when Send was tapped, not later typing`);
  }
  const { s: v2 } = await staffView({ 'update.save': (b) => ({ ok: true, update: { id: 9, note: b.note } }) });
  v2.state.drafts[8] = { note: 'done', state: 'finished' }; v2.state.editing[8] = true;
  await v2.act.sendUpdate({ id: 8, title: 'x', status: 'open', today: null });
  assert.ok(!(8 in v2.state.drafts) && !(8 in v2.state.editing), 'nothing more typed: emptied as before');
});

test('review r16: a photo message — words typed during the upload stay in the draft and the box, and the caption that went is not sent again', async () => {
  // (one app: the team pages keep the box's words in their state; the box shows them)
  let t;
  ({ t } = await teamPages({ 'comment.photo': () => { t.state.msgDrafts[5] = 'see crack - replace the lid by Friday'; return { ok: true, comments: [{ id: 1 }] }; } })); // typed while it uploads
  t.state.msgDrafts[5] = 'see crack';
  await t.act.sendMessagePhoto(5, new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
  assert.equal(t.state.msgDrafts[5], '- replace the lid by Friday', 'the later words stay; the caption that went leaves the box');
  ({ t } = await teamPages({ 'comment.photo': () => { t.state.msgDrafts[5] = 'see crack - replace the lid by Friday'; return { ok: true, comments: [] }; } }));
  await t.act.sendMessagePhoto(5, new File(['x'], 'p.jpg', { type: 'image/jpeg' })); // a photo with no words: all typed is kept
  assert.equal(t.state.msgDrafts[5], 'see crack - replace the lid by Friday');
});

test('review r16 sw: a page that got old code from the kept set is told a new version is ready when version.txt shows a new one', async () => {
  let slow = true;
  const h = await swHarness({ net: (u) => (u.endsWith('version.txt') ? Promise.resolve(new Response('v2\n')) : slow ? new Promise(() => {}) : Promise.resolve(new Response('net ' + u))) });
  h.store(h.cacheName).set('https://worktask.in/kept-version.txt', new Response('v1'));
  for (const f of ['/app.js', '/logic.js']) h.store(h.cacheName).set('https://worktask.in' + f, new Response('old ' + f));
  assert.equal(await h.ask('/app.js', 'no-cors', { upTo: 8000, clientId: 'p1' }), 'old /app.js', 'weak signal: the kept (v1) code');
  slow = false;
  assert.equal(await h.ask('/app.js', 'no-cors', { clientId: 'p2' }), 'net https://worktask.in/app.js', 'another page got the new code');
  const waits = [];
  assert.equal(await h.ask('/version.txt', 'no-cors', { clientId: 'p2', waits }), 'v2\n', 'the first stamp the page sees is already the new one');
  await Promise.all(waits);
  assert.deepEqual(h.posted, [{ id: 'p1', type: 'new-version' }], 'only the page running the old code is told (it offers the reload)');
  waits.length = 0; h.posted.length = 0;
  await h.ask('/version.txt', 'no-cors', { clientId: 'p1', waits }); await Promise.all(waits);
  assert.deepEqual(h.posted, [], 'no new version since: nothing more');
  // (one app: the old page only forwards; the one app shows "New version ready" itself)
  assert.match(DP, /'✨ New version ready — tap to reload'/, 'the one app offers the reload');
});

test('review sw mix: app.js answered with 503 gets the kept app.js, and then logic.js comes from the kept set too (never the new logic.js); a new version is then offered', async () => {
  const h = await swHarness({ net: (u) => Promise.resolve(u.endsWith('/app.js') ? new Response('busy', { status: 503 }) : new Response(u.endsWith('version.txt') ? 'v2\n' : 'new ' + u.slice(u.lastIndexOf('/') + 1))) });
  for (const f of ['app.js', 'logic.js']) h.store(h.cacheName).set('https://worktask.in/' + f, new Response('kept ' + f));
  h.store(h.cacheName).set('https://worktask.in/kept-version.txt', new Response('v1'));
  assert.equal(await h.ask('/app.js', 'no-cors', { clientId: 'pageA' }), 'kept app.js', 'the host\'s error page swapped for the kept copy');
  assert.equal(await h.ask('/logic.js', 'no-cors', { clientId: 'pageA' }), 'kept logic.js', 'the old app.js gets the old logic.js it was built with');
  const waits = [];
  await h.ask('/version.txt', 'no-cors', { clientId: 'pageA', waits }); await Promise.all(waits);
  assert.ok(h.posted.some((m) => m.id === 'pageA' && m.type === 'new-version'), 'the page running the kept code is offered the reload');
});

test('review sw mix: app.js from the network, then logic.js fails (offline or an error answer): no kept copy is served next to the new app.js', async () => {
  let way = 'ok';
  const h = await swHarness({ net: (u) => (way === 'ok' ? Promise.resolve(new Response('new ' + u.slice(u.lastIndexOf('/') + 1))) : way === 'off' ? Promise.reject(new TypeError('offline')) : Promise.resolve(new Response('busy', { status: 508 }))) });
  for (const f of ['app.js', 'logic.js']) h.store(h.cacheName).set('https://worktask.in/' + f, new Response('kept ' + f));
  assert.equal(await h.ask('/app.js', 'no-cors', { clientId: 'pageA' }), 'new app.js');
  way = 'off';
  const fails = (t) => t === 'NETWORK ERROR' || t === ''; // a rejected answer, or Response.error() (a network error in the browser)
  assert.ok(fails(await h.ask('/logic.js', 'no-cors', { clientId: 'pageA', upTo: 60000 }).catch(() => 'NETWORK ERROR')), 'offline: the load fails cleanly, never the kept logic.js');
  way = 'busy';
  assert.equal(await h.ask('/logic.js', 'no-cors', { clientId: 'pageA', upTo: 60000 }), 'busy', 'an error answer: the error, never the kept logic.js');
  // the same when both start together and app.js arrives first
  way = 'ok';
  const h2 = await swHarness({ net: (u) => (u.endsWith('/app.js') ? Promise.resolve(new Response('new app.js')) : new Promise((r, no) => setImmediate(() => no(new TypeError('offline'))))) });
  for (const f of ['app.js', 'logic.js']) h2.store(h2.cacheName).set('https://worktask.in/' + f, new Response('kept ' + f));
  const both = await Promise.all([h2.ask('/app.js', 'no-cors', { clientId: 'pageB' }), h2.ask('/logic.js', 'no-cors', { clientId: 'pageB' }).catch(() => 'NETWORK ERROR')]);
  assert.equal(both[0], 'new app.js');
  assert.ok(fails(both[1]), 'logic.js fails cleanly, never the kept copy');
});

test('review: words typed in the Add a step box while a step is sending stay (online and when kept on the phone); just the sent step: the box empties', async () => {
  // (one app: the Add a step box is in the staff view; the same rule, run for real, online and when kept on the phone)
  for (const net of ['online', 'offline']) {
    const run = async (typed) => {
      let release;
      const { s: v, box } = await staffView({ 'project.addStep': () => new Promise((ok, no) => { release = () => (net === 'online' ? ok({ ok: true }) : no(offline())); }) });
      v.state.stepDrafts.p1 = 'Order servo motor';
      const going = v.act.addStep('p1');
      await new Promise((r) => setTimeout(r, 0));
      v.state.stepDrafts.p1 = typed; // typed while it was sending
      release(); await going;
      return { left: v.state.stepDrafts.p1, kept: [...box.items.values()].map((x) => x.title) };
    };
    assert.equal((await run('Call vendor for quote')).left, 'Call vendor for quote', `${net}: the next step typed meanwhile stays`);
    assert.equal((await run('Order servo motor ')).left, undefined, `${net}: just what went: emptied (the draft is gone)`);
    assert.equal((await run('Order servo motor\tCall vendor')).left, 'Call vendor', `${net}: typed on after the sent words: only the later words stay`);
    if (net === 'offline') assert.deepEqual((await run('x')).kept, ['Order servo motor'], 'kept on the phone: the step that was sent');
  }
});

test('review: the one-line "Give it" box keeps a line typed while task.save was sending; only the given line is cleared', async () => {
  // (one app: the team pages)
  const r = { person: { id: 7, name: 'Valar' }, title: 'Send kiln photos', dueDate: '' };
  let t;
  ({ t } = await teamPages({ 'task.save': () => { t.state.quick.text = 'Valar: send kiln photos\nVasu: check dryer'; return { ok: true, task: { id: 9, assignee: { id: 7, name: 'Valar' } } }; } }));
  t.state.quick = { text: 'Valar: send kiln photos', sig: '', cid: 'c1' };
  await t.act.giveQuick(r);
  assert.equal(t.state.quick.text, 'Valar: send kiln photos\nVasu: check dryer', 'a line typed meanwhile stays');
  ({ t } = await teamPages({ 'task.save': () => ({ ok: true, task: { id: 9, assignee: { id: 7, name: 'Valar' } } }) }));
  t.state.quick = { text: 'Valar: send kiln photos', sig: '', cid: 'c1' };
  await t.act.giveQuick(r);
  assert.equal(t.state.quick, null, 'just the given line: the box empties');
});

test('review: a given-back step never overwrites the words being typed in the Add a step box; the notice then says to copy them', async () => {
  // (one app: steps are the staff view's; run its give-back through the outbox)
  const run = async (typed) => {
    const { s, box } = await staffView({ 'project.addStep': () => { throw new Error('Busy.'); } });
    if (typed) s.state.stepDrafts.p1 = typed;
    await box.add({ kind: 'step', projectRef: 'p1', title: 'Order servo motor', clientId: 'c', userId: 3, at: new Date().toISOString() });
    await s.act.flush();
    return s.state;
  };
  const typing = await run('Call vendor for quote');
  assert.equal(typing.stepDrafts.p1, 'Call vendor for quote', 'the words being typed stay');
  const body = typing.notices.map((n) => n.body).join('\n');
  assert.match(body, /Order servo motor/, 'the old step is shown to copy');
  assert.ok(!/back in the Add a step box/.test(body), 'never claims it is back in the box');
  assert.match(body, /Copy them if you need them/);
  const empty = await run('');
  assert.equal(empty.stepDrafts.p1, 'Order servo motor', 'an empty box gets the old step back');
  assert.match(empty.notices.map((n) => n.body).join('\n'), /back in the Add a step box/);
});

test('one app, step 3: a team member is sent to the staff view (after sign-in, after their first password, when the app opens; a task link goes along); offline only when that app is kept on the phone', async () => {
  const { staffGoes } = await import('../team/public_html/logic.js');
  assert.equal(staffGoes({ role: 'staff' }), true);
  assert.equal(staffGoes({ role: 'staff', mustChange: true }), false, 'their own password first');
  assert.equal(staffGoes({ role: 'admin' }), false, 'managers stay');
  assert.equal(staffGoes({ role: 'admin', owner: true }), false, 'the owner goes to the projects as before');
  assert.equal(staffGoes(null), false);
  // (one app, step 4: everyone signs in inside the one app; Work Task's old page only forwards there, a task link along)
  assert.match(APP, /location\.replace\(oneAppAddress\(location\.search, location\.hash\)\)/, 'the old page forwards (offline too: the one app keeps itself on the phone)');
  assert.match(DP, /if \(user && user\.mustChange\) \{ showFirstPassword\(user, \(u\) => openFor\(u, teamTask\)\); return; \}/, 'their own password first, then on with the task link');
  assert.match(DP, /if \(who === 'staff'\) startStaff\(user, teamTask\);/, 'after sign-in: the staff view');
  assert.match(DP, /if \(known === 'staff'\) \{ startStaff\(undefined, teamTask\); return; \}/, 'when the app opens');
});

test('one app, step 3: Work Task has no staff screens any more (one design: the staff view of the projects app); a team member who cannot go yet sees "Open my tasks"; managers keep every screen', () => {
  // (one app, step 4: Work Task has no screens at all any more — its page only forwards; the managers' screens are the
  // team pages of the one app, and one outbox sends what waits on a phone for everyone)
  assert.ok(APP.split('\n').length < 20, 'the old page is a few lines');
  for (const gone of ['function teamList(', 'function loginScreen(', 'function passwordScreen(', 'function staffMoved(', 'function taskForm(']) assert.ok(!APP.includes(gone), 'removed: ' + gone);
  for (const keep of ['function teamList(', 'function taskPage(', 'function taskForm(', 'function followupList(', 'function projectPage(', 'function peoplePage(', 'function settingsPage(', 'giveBack: (it, why) =>']) {
    assert.ok(TEAM.includes(keep), 'managers keep: ' + keep);
  }
  assert.match(TEAM, /messagesBlock\(\{/, 'the shared message box');
  for (const kind of ["it.kind === 'comment'", "it.kind === 'step'", "it.kind === 'suggest'", "it.kind === 'update' && !it.updateId"]) {
    assert.ok(STAFFBOX.includes(kind), 'the outbox sends: ' + kind);
  }
});

// ---------------------------------------------------------------- one app, step 4 part 3: Work Task's old addresses go to the one app
test('one app: an old Work Task address goes to the same place in the one app (a task, Give a task, the team pages, else the start)', async () => {
  const { oneAppAddress } = await import('../team/public_html/logic.js');
  assert.equal(oneAppAddress('', '#open=42'), 'projects/#team-task=42', 'an old notification or task link');
  assert.equal(oneAppAddress('', '#task=42'), 'projects/#team-task=42', 'the projects\' old "open the team task" link');
  assert.equal(oneAppAddress('', '#new=%7B%22title%22%3A%22Fire%22%7D'), 'projects/#team-new=%7B%22title%22%3A%22Fire%22%7D', 'Give a task, filled in');
  assert.equal(oneAppAddress('?team', ''), 'projects/#team', 'the team pages');
  assert.equal(oneAppAddress('?next=projects', ''), 'projects/');
  assert.equal(oneAppAddress('', ''), 'projects/', 'worktask.in, an installed app');
  assert.equal(oneAppAddress('', '#open=abc'), 'projects/', 'never a made-up task');
  assert.match(APP, /import \{ oneAppAddress \} from '\.\/logic\.js';/);
  assert.match(APP, /navigator\.serviceWorker\.register\('sw\.js'\)/, 'the notifications\' service worker stays registered');
  const html = readFileSync(new URL('../team/public_html/index.html', import.meta.url), 'utf8');
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  assert.ok(!/href="styles\.css"/.test(html), 'no old Work Task look');
  assert.match(html, /<a href="projects\/">Open Task List<\/a>/, 'without scripts: a plain link');
});

test('one app: a tapped notification opens the one app — an old "/#open=<id>" goes to that task there; an open window of the app takes it without loading again', async () => {
  const vm = await import('node:vm');
  const src = readFileSync(new URL('../team/public_html/sw.js', import.meta.url), 'utf8');
  const run = async (url, windows) => {
    const handlers = {}, opened = [], posted = [], moved = [];
    const list = windows.map((u) => ({ url: 'https://worktask.in' + u, focus: async () => {}, postMessage: (m) => posted.push({ u, ...m }), navigate: async (to) => { moved.push({ u, to }); } }));
    const ctx = { self: { addEventListener: (t, f) => { handlers[t] = f; }, clients: { matchAll: async () => list, openWindow: async (u) => { opened.push(u); } }, registration: {} }, location: { origin: 'https://worktask.in' }, caches: {}, URL, Promise, console, fetch: () => Promise.reject(new Error('no')), setTimeout };
    ctx.self.location = ctx.location;
    vm.runInNewContext(src, ctx);
    let wait;
    handlers.notificationclick({ notification: { close() {}, data: { url } }, waitUntil: (p) => { wait = p; } });
    await wait;
    return { opened, posted, moved };
  };
  assert.deepEqual((await run('/#open=42', [])).opened, ['https://worktask.in/projects/#team-task=42'], 'an old notification: that task in the one app');
  assert.deepEqual((await run('/', [])).opened, ['https://worktask.in/projects/']);
  assert.deepEqual((await run('/projects/#team-task=7', ['/projects/'])).posted, [{ u: '/projects/', type: 'open', hash: '#team-task=7' }], 'the open app opens it itself');
  assert.deepEqual((await run('/projects/#open=rm1', ['/projects/'])).posted, [{ u: '/projects/', type: 'open', hash: '#open=rm1' }], 'a project reminder too');
  assert.deepEqual((await run('/#open=9', ['/'])).moved, [{ u: '/', to: 'https://worktask.in/projects/#team-task=9' }], 'an old Work Task window is moved to the one app');
  assert.deepEqual((await run('https://evil.example/x', [])).opened, ['https://worktask.in/projects/'], 'only ever our own pages');
});

test('review r4-5 (whole code): a message changed or deleted while another task was opened never puts its task\'s messages on the new task\'s page (team pages and staff view)', async () => {
  const ask = { prompt: () => 'changed words', confirm: () => true };
  const mine = [{ id: 1, text: 'on task 5', mine: true }];
  const other = [{ id: 9, text: 'on task 9', mine: true }];
  // team pages
  let opened;
  const { t } = await teamPages({ 'comment.delete': () => { t.state.detail = opened; return { comments: [] }; }, 'comment.edit': () => { t.state.detail = opened; return { comments: [{ id: 1, text: 'changed words' }] }; } }, { ask });
  for (const a of ['deleteMessage', 'editMessage']) {
    t.state.detail = { task: { id: 5 }, comments: mine.slice() };
    opened = { task: { id: 9 }, comments: other.slice() };
    await t.act[a](mine[0]);
    assert.deepEqual(t.state.detail.comments, other, 'team pages, ' + a + ': task 9 keeps its own messages');
  }
  t.state.detail = { task: { id: 5 }, comments: mine.slice() };
  opened = t.state.detail; // nothing else opened meanwhile
  await t.act.deleteMessage(mine[0]);
  assert.deepEqual(t.state.detail.comments, [], 'still on task 5: its list follows the answer');
  // staff view
  const { createStaff } = await import('../docs/ui/staff.js');
  const { memOutbox } = await import('../docs/ui/staffbox.js');
  const rules = await import('../team/public_html/logic.js');
  let s;
  const api = async (a) => {
    if (a === 'comment.delete' || a === 'comment.edit') { s.state.detail = opened; return { comments: [] }; }
    if (a === 'my.today') return { today: '2026-10-22', fillBy: '18:00', tasks: [], other: [], suggestions: [] };
    return { ok: true };
  };
  s = createStaff({ root: null, api, rules, user: { id: 3, name: 'Valar', role: 'staff' }, box: memOutbox(), lock: null, toast: () => {}, ask });
  await s.load();
  for (const a of ['deleteMessage', 'editMessage']) {
    s.state.detail = { task: { id: 5 }, comments: mine.slice() };
    opened = { task: { id: 9 }, comments: other.slice() };
    await s.act[a](mine[0]);
    assert.deepEqual(s.state.detail.comments, other, 'staff view, ' + a + ': task 9 keeps its own messages');
  }
});

test('review r4-5 (whole code): "Give task" tapped twice while it is being given gives it (and sends its files) once', async () => {
  let release;
  const { t, calls } = await teamPages({ 'task.save': () => new Promise((r) => { release = () => r({ task: { id: 41, assignee: { name: 'Valar' } } }); }) });
  const f = { assigneeId: 3, title: 'Glaze the tiles', details: '', project: '', repeat: 'once', skipSunday: true };
  const first = t.act.saveTask(f, []);
  assert.equal(await t.act.saveTask(f, []), '', 'the second tap does nothing');
  release(); await first;
  assert.equal(calls.filter((c) => c.a === 'task.save').length, 1);
  release = null;
  const again = t.act.saveTask({ ...f, title: 'Next one' }, []);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(release, 'once done, the next one goes');
  release(); await again;
});

test('✓✓ seen ticks (23 Oct): ✓ sent, blue ✓✓ seen (who read it in the tip); none on others\' messages or the server\'s notes; while mine wait to be seen the open task is looked at again', async () => {
  const { msgTicks } = await import('../docs/ui/workparts.js');
  assert.deepEqual(msgTicks({ mine: true, seenBy: [] }), { cls: 'ticks', text: '✓', title: 'Sent — not seen yet' });
  assert.deepEqual(msgTicks({ mine: true, seenBy: ['Valar'] }), { cls: 'ticks seen', text: '✓✓', title: 'Seen by Valar' });
  assert.equal(msgTicks({ mine: false, seenBy: null }), null);
  assert.equal(msgTicks({ mine: true, kind: 'chase', seenBy: [] }), null);
  assert.deepEqual(msgTicks({ mine: true }).text, '✓', 'an older saved copy: sent');
  for (const [name, make] of [['team pages', async (answers) => (await teamPages(answers)).t], ['staff view', async (answers) => (await staffView(answers)).s]]) {
    let gets = 0;
    const v = await make({ 'task.get': () => { gets++; return { task: { id: 5, title: 'X' }, updates: [], comments: [{ id: 1, mine: true, seenBy: [] }] }; } });
    v.state.sel = 'task:5'; v.state.detail = { task: { id: 5 }, comments: [{ id: 1, mine: true, seenBy: [] }] };
    await v.act.liveCheck(); await new Promise((r) => setTimeout(r, 0));
    assert.ok(gets >= 1, name + ': not seen yet → looked at again');
    gets = 0; v.state.detail = { task: { id: 5 }, comments: [{ id: 1, mine: true, seenBy: ['Boss'] }] };
    await v.act.liveCheck(); await new Promise((r) => setTimeout(r, 0));
    assert.equal(gets, 0, name + ': all seen → no extra call');
  }
  assert.match(readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8'), /\.ticks\.seen \{ color: #0ea5e9; \}/, 'blue when seen');
});

test('staff ✅ Tasks and 📂 Projects (owner, 23 Oct): every open task once, red first; its 📂 = the owner\'s 📂 project, else a given project with 2+ steps, else 📂 Misc — one task given from the owner\'s project is never also a project', async () => {
  const { staffFolders } = await import('../docs/ui/staff.js');
  const T = (id, x = {}) => ({ id, title: 't' + id, status: 'open', seq: null, projectRef: null, project: '', folder: '', dueToday: true, today: null, ...x });
  const d = {
    tasks: [
      T(1, { today: { at: '2026-10-23 10:00:00' } }), // sent: green
      T(2, { projectRef: 'fs1', seq: 1, stepRef: 'fs1:whole', project: 'Feldspar', title: 'Feldspar', folder: 'Ceramic Media' }), // one task from the owner's 📂
      T(3, { projectRef: 'gl1', seq: 1, stepRef: 'g1', project: 'Glaze photos', folder: 'Ceramic Media' }),
      T(4, { projectRef: 'k1', seq: 1, stepRef: 'k1a', project: 'Kiln trial' }),
      T(5, { projectRef: 'w1', seq: 1, stepRef: 'w1:whole', project: 'Paint door', title: 'Paint door' }), // one task, no 📂: just a task (Misc)
    ],
    other: [T(6, { projectRef: 'k1', seq: 2, stepRef: 'k1b', project: 'Kiln trial', dueToday: false, queued: true }), T(7, { dueToday: false }), T(3)], // (3 again: once)
  };
  const { tasks, folders } = staffFolders(d, (id) => id === 4);
  assert.deepEqual(tasks.map((x) => x.t.id), [2, 3, 5, 4, 1, 6, 7], 'each once; red, then yellow (waiting to send), green, grey');
  assert.deepEqual(tasks.map((x) => x.dot), ['red', 'red', 'red', 'yellow', 'green', 'grey', 'grey']);
  const where = Object.fromEntries(tasks.map((x) => [x.t.id, x.folder.name]));
  assert.deepEqual(where, { 1: 'Misc', 2: 'Ceramic Media', 3: 'Ceramic Media', 4: 'Kiln trial', 5: 'Misc', 6: 'Kiln trial', 7: 'Misc' });
  assert.deepEqual(folders.map((f) => [f.name, f.tasks.length, f.dot, f.red]), [['Ceramic Media', 2, 'red', 2], ['Kiln trial', 2, 'yellow', 0], ['Misc', 3, 'red', 1]], 'worst first; 📂 Misc last');
  assert.equal(folders.find((f) => f.name === 'Kiln trial').ref, 'k1', 'a given project with steps opens its own page (steps in order, add a step)');
  assert.ok(!folders.some((f) => f.name === 'Feldspar' || f.name === 'Paint door'), 'one given task is never also a project');
});

test('Team today as one table (owner, 23 Oct): status of each task (sent / not yet / stuck / late), the counts, red first, a filter, By person or By 📂 project (📂 Misc last)', async () => {
  const { teamBoard } = await import('../team/public_html/logic.js');
  const V = { id: 3, name: 'Valar' }, R = { id: 4, name: 'Ravi' };
  const T = (id, who, x = {}) => ({ id, title: 'T' + id, assignee: who, status: 'open', repeat: 'daily', today: null, stuck: false, unread: 0, project: '', folder: '', ...x });
  const d = { today: '2026-10-23', late: false, tasks: [
    T(1, V, { today: { at: '2026-10-23 10:00:00', note: 'done' } }),
    T(2, V, { stuck: true, folder: 'Kilns' }),
    T(3, R, { repeat: 'once', dueDate: '2026-10-20', project: 'Glaze photos' }),
    T(4, R, { unread: 2, folder: 'Kilns' }),
  ] };
  let b = teamBoard(d);
  assert.deepEqual(b.counts, { sent: 1, notyet: 1, stuck: 1, late: 1, notdue: 0, msg: 1, sugg: 0 });
  assert.deepEqual(b.groups.map((g) => [g.name, g.rows.map((r) => [r.t.id, r.status, r.colour]), g.sent]),
    [['Ravi', [[3, 'late', 'red'], [4, 'notyet', 'yellow']], 0], ['Valar', [[2, 'stuck', 'red'], [1, 'sent', 'green']], 1]], 'by person, red first (both red: by name)');
  assert.equal(b.groups[1].person.id, 3, 'a person\'s line has the person (📧 Morning email)');
  b = teamBoard({ ...d, late: true }, { group: 'project' });
  assert.deepEqual(b.groups.map((g) => [g.name, g.rows.map((r) => r.t.id)]), [['Glaze photos', [3]], ['Kilns', [2, 4]], ['Misc', [1]]], 'by 📂 project: the owner\'s 📂, else its work, else 📂 Misc (last)');
  assert.equal(b.groups[1].rows[1].colour, 'red', 'after the fill-by time "not yet" is red');
  assert.deepEqual(teamBoard(d, { filter: 'msg' }).groups.flatMap((g) => g.rows.map((r) => r.t.id)), [4], 'a count shows only those');
  assert.deepEqual(teamBoard(d, { filter: 'sent' }).groups.flatMap((g) => g.rows.map((r) => r.t.id)), [1]);
  assert.deepEqual(teamBoard(d, { person: 4 }).groups.map((g) => g.name), ['Ravi'], 'a person picked in the menu');
  assert.equal(teamBoard(d, { filter: 'stuck' }).total, 4, 'the counts stay for all');
});

test('Team today table: 20 rows a page (a person\'s line comes again on the next page, its "x of y sent" for the whole group); suggestions are rows with their own count', async () => {
  const { teamBoard, BOARD_PAGE } = await import('../team/public_html/logic.js');
  assert.equal(BOARD_PAGE, 20);
  const V = { id: 3, name: 'Valar' }, R = { id: 4, name: 'Ravi' };
  const T = (id, who, x = {}) => ({ id, title: 'T' + id, assignee: who, status: 'open', repeat: 'daily', today: null, stuck: false, unread: 0, ...x });
  const tasks = [...Array.from({ length: 15 }, (_, i) => T(i + 1, V)), ...Array.from({ length: 10 }, (_, i) => T(i + 101, R, { today: { at: 'x', note: 'ok' } }))];
  const d = { today: '2026-10-23', late: false, tasks, suggestions: [T(900, V, { status: 'suggested' })] };
  const p1 = teamBoard(d);
  assert.deepEqual([p1.page, p1.pages, p1.shown, p1.total], [1, 2, 26, 26]);
  assert.equal(p1.groups.reduce((n, g) => n + g.rows.length, 0), 20, '20 on page 1');
  const p2 = teamBoard(d, { page: 2 });
  assert.equal(p2.groups.reduce((n, g) => n + g.rows.length, 0), 6, 'the rest on page 2');
  assert.deepEqual(p2.groups.map((g) => [g.name, g.rows.length, g.sent, g.all]), [['Ravi', 6, 10, 10]], 'Ravi\'s line again, counted for all of Ravi');
  assert.equal(teamBoard(d, { page: 9 }).page, 2, 'past the end: the last page');
  assert.equal(p1.counts.sugg, 1);
  const s = teamBoard(d, { filter: 'sugg' });
  assert.deepEqual(s.groups.flatMap((g) => g.rows.map((r) => [r.t.id, r.status, r.colour])), [[900, 'sugg', 'yellow']], 'a suggestion: yes or no');
  assert.equal(s.groups[0].all, 0, 'a suggestion is not a task to send an update on');
});

// ---------------------------------------------------------------- Stage of a staff task (owner approved, 23 Oct)
test('Stage of a staff task (logic.js teamStage): no update yet = not started, Working on it = in progress, Stuck = waiting (for what they chose), Finished or closed = done; "Manager" = waiting for you', async () => {
  const { teamStage, waitForText, waitsForManager, WAIT_FOR_PICKS } = await import('../team/public_html/logic.js');
  const t = (x = {}) => ({ id: 1, status: 'open', today: null, last: null, ...x });
  assert.equal(teamStage(t()).stage, 'notstarted');
  assert.equal(teamStage(t({ last: { day: '2026-10-22', state: 'progress' } })).stage, 'inprogress', 'yesterday\'s update counts');
  assert.deepEqual(teamStage(t({ today: { day: '2026-10-23', state: 'stuck', waitingFor: 'Material: clay' } })), { stage: 'waiting', waitingFor: 'Material: clay', since: '2026-10-23', you: false });
  assert.equal(teamStage(t({ today: { day: '2026-10-23', state: 'stuck', waitingFor: 'Manager' } })).you, true, 'waiting for the manager: "Waiting: you"');
  assert.equal(teamStage(t({ today: { day: '2026-10-23', state: 'stuck', waitingFor: 'Manager: the drawing' } })).you, true);
  assert.equal(teamStage(t({ today: { day: '2026-10-23', state: 'stuck', waitingFor: 'Material' } })).you, false);
  assert.equal(teamStage(t({ today: { day: '2026-10-23', state: 'stuck' } })).stage, 'waiting', 'stuck with nothing chosen: still waiting');
  assert.equal(teamStage(t({ today: { day: '2026-10-23', state: 'finished' } })).stage, 'done');
  assert.equal(teamStage(t({ status: 'done' })).stage, 'done');
  assert.deepEqual(WAIT_FOR_PICKS, ['Manager', 'Material', 'Another person', 'Other']);
  assert.equal(waitForText('Material', '  clay  from Morbi '), 'Material: clay from Morbi');
  assert.equal(waitForText('Manager', ''), 'Manager');
  assert.equal(waitForText('', 'the fitter'), 'the fitter');
  assert.equal(waitForText('Bogus', ''), '', 'only the four choices');
  assert.equal(waitForText('Other', 'y'.repeat(200)).length, 80);
  assert.ok(waitsForManager('manager'), 'any case');
  assert.ok(!waitsForManager('Another person'));
});

test('Stage: the update.save body carries "waiting for" only with Stuck (never with Finished, never empty)', () => {
  assert.equal(updateSaveBody({ taskId: 1, note: 'n', state: 'stuck', waitingFor: ' Manager ' }).waitingFor, 'Manager');
  assert.ok(!('waitingFor' in updateSaveBody({ taskId: 1, note: 'n', state: 'progress', waitingFor: 'Manager' })));
  assert.ok(!('waitingFor' in updateSaveBody({ taskId: 1, note: 'n', state: 'stuck', waitingFor: '  ' })));
  assert.ok(!('waitingFor' in updateSaveBody({ taskId: 1, note: 'n', state: 'stuck', waitingFor: 'Manager', finish: true })));
});

test('Stage: Stuck in the staff view sends "waiting for what" — online, and kept on the phone (the outbox carries it when it goes later)', async () => {
  for (const net of ['online', 'offline']) {
    const { s: v, calls, box } = await staffView({ 'update.save': (b) => (net === 'online' ? { ok: true, update: { id: 9, note: b.note, day: '2026-10-22' } } : Promise.reject(offline())) });
    const t = { id: 7, title: 'Kiln', status: 'open', today: null };
    v.state.drafts[7] = { note: 'No clay', state: 'stuck', waitPick: 'Material', waitText: 'clay' };
    await v.act.sendUpdate(t);
    if (net === 'online') assert.equal(calls.find((c) => c.a === 'update.save').body.waitingFor, 'Material: clay');
    else {
      const kept = [...box.items.values()][0];
      assert.equal(kept.waitingFor, 'Material: clay', 'kept on the phone with it');
      assert.match(STAFFBOX, /writtenAt: it\.at, clientId: it\.clientId, waitingFor: it\.waitingFor \|\| '' \}\)/, 'the outbox sends it');
    }
  }
  const { s: v2, calls: c2 } = await staffView({ 'update.save': (b) => ({ ok: true, update: { id: 9, note: b.note } }) });
  v2.state.drafts[8] = { note: 'going on', state: 'progress', waitPick: 'Manager' };
  await v2.act.sendUpdate({ id: 8, title: 'x', status: 'open', today: null });
  assert.ok(!('waitingFor' in c2.find((c) => c.a === 'update.save').body), 'not stuck: no "waiting for"');
});

test('Stage: the outbox sends a kept Stuck update with its "waiting for"', async () => {
  const { createOutbox, memOutbox } = await import('../docs/ui/staffbox.js');
  const rules = await import('../team/public_html/logic.js');
  const box = memOutbox(), sent = [];
  const ob = createOutbox({ box, rules, api: async (a, b) => { sent.push({ a, b }); return { ok: true, update: { id: 3, day: b.day, note: b.note } }; }, userId: () => 3, signedIn: () => true, toast: () => {} });
  await ob.queue({ kind: 'update', taskId: 7, note: 'No clay', state: 'stuck', waitingFor: 'Material: clay', files: [] });
  await ob.flush();
  assert.equal(sent.find((x) => x.a === 'update.save').b.waitingFor, 'Material: clay');
});

test('Team today: "Waiting for you" — stuck tasks waiting for the manager; its own count and filter; each row has its stage', async () => {
  const { teamBoard } = await import('../team/public_html/logic.js');
  const V = { id: 3, name: 'Valar' };
  const T = (id, x = {}) => ({ id, title: 'T' + id, assignee: V, status: 'open', repeat: 'daily', today: null, stuck: false, unread: 0, ...x });
  const d = { today: '2026-10-23', late: false, tasks: [
    T(1, { stuck: true, today: { day: '2026-10-23', state: 'stuck', waitingFor: 'Manager: the drawing' } }),
    T(2, { stuck: true, today: { day: '2026-10-23', state: 'stuck', waitingFor: 'Material' } }),
    T(3, { today: { day: '2026-10-23', state: 'progress' } }),
  ] };
  const b = teamBoard(d);
  assert.equal(b.you, 1);
  assert.deepEqual(teamBoard(d, { filter: 'you' }).groups.flatMap((g) => g.rows.map((r) => r.t.id)), [1]);
  const rows = b.groups.flatMap((g) => g.rows);
  assert.deepEqual(rows.map((r) => [r.t.id, r.stage.stage, r.you]).sort(), [[1, 'waiting', true], [2, 'waiting', false], [3, 'inprogress', false]]);
});

test('Team today table: a stuck task or one with new messages that is not due today is still a row (they were the "Needs you" list), each once', async () => {
  const { teamBoard } = await import('../team/public_html/logic.js');
  const V = { id: 3, name: 'Valar' };
  const T = (id, x = {}) => ({ id, title: 'T' + id, assignee: V, status: 'open', repeat: 'daily', today: null, stuck: false, unread: 0, ...x });
  const due = T(1, { unread: 1 });
  const d = { today: '2026-10-23', late: true, tasks: [due], stuck: [T(2, { repeat: 'weekly', stuck: true, dueToday: false })], unread: [due, T(3, { repeat: 'weekly', unread: 2, dueToday: false })], suggestions: [] }; // (dueToday as the server sends it)
  const b = teamBoard(d);
  assert.deepEqual(b.groups.flatMap((g) => g.rows.map((r) => [r.t.id, r.status])), [[1, 'notyet'], [2, 'stuck'], [3, 'notdue']], 'the stuck one and the one with new messages are in the table; today\'s task once');
  assert.deepEqual([b.counts.stuck, b.counts.msg, b.counts.notyet], [1, 2, 1], 'a task not due today is not "Not yet"');
  assert.equal(b.groups[0].all, 1, '"x of y sent" counts only today\'s tasks');
});

test('Team today table (review): a step waiting its turn with a by-date gone is "Not due today", never ⏰ Late; not due = the server\'s dueToday, not the list it came from; every status has its count', async () => {
  const { teamBoard } = await import('../team/public_html/logic.js');
  const V = { id: 3, name: 'Valar' };
  const T = (id, x = {}) => ({ id, title: 'T' + id, assignee: V, status: 'open', repeat: 'once', today: null, stuck: false, unread: 0, ...x });
  const waiting = T(2, { dueDate: '2026-10-20', unread: 1, dueToday: false, queued: true });
  const dueButMissing = T(4, { stuck: false, unread: 1, dueToday: true }); // due today but (a changed list) not in tasks
  const b = teamBoard({ today: '2026-10-23', late: false, tasks: [T(1, { dueToday: true })], stuck: [], unread: [waiting, dueButMissing], suggestions: [] });
  const st = Object.fromEntries(b.groups.flatMap((g) => g.rows.map((r) => [r.t.id, r.status])));
  assert.deepEqual(st, { 1: 'notyet', 2: 'notdue', 4: 'notyet' });
  assert.equal(b.counts.late, 0, 'not Late');
  assert.deepEqual(Object.keys(b.counts).sort(), ['late', 'msg', 'notdue', 'notyet', 'sent', 'stuck', 'sugg'], 'every status listed');
  assert.equal(b.counts.notdue, 1);
  assert.equal(b.groups[0].all, 2, 'the due ones count in "x of y sent", the waiting step does not');
});

test('Team today table (review 2): Late is the server\'s rule (a Sunday does not hide it; a waiting step never is); no dueToday on a stuck / new-message task = not due; a group with a red row never has a green tag; every filter', async () => {
  const { teamBoard } = await import('../team/public_html/logic.js');
  const V = { id: 3, name: 'Valar' }, R = { id: 4, name: 'Ravi' };
  const T = (id, who, x = {}) => ({ id, title: 'T' + id, assignee: who, status: 'open', repeat: 'once', today: null, stuck: false, unread: 0, ...x });
  const sunday = T(1, V, { dueDate: '2026-10-20', dueToday: false, late: true, skipSunday: true, unread: 1 }); // overdue, comes on a Sunday
  const waiting = T(2, V, { dueDate: '2026-10-20', dueToday: false, late: false, queued: true, unread: 1 });
  const old = T(3, V, { repeat: 'weekly', stuck: false, unread: 2 }); // an older copy: no dueToday, no late
  const sent = T(4, R, { dueToday: true, late: false, today: { at: 'x', note: 'ok' } });
  const stuckWeekly = T(5, R, { repeat: 'weekly', dueToday: false, late: false, stuck: true });
  const d = { today: '2026-10-25', late: false, tasks: [sent], stuck: [stuckWeekly], unread: [sunday, waiting, old], suggestions: [] };
  const b = teamBoard(d);
  const st = Object.fromEntries(b.groups.flatMap((g) => g.rows.map((r) => [r.t.id, r.status])));
  assert.deepEqual(st, { 1: 'late', 2: 'notdue', 3: 'notdue', 4: 'sent', 5: 'stuck' });
  assert.deepEqual([b.counts.late, b.counts.notdue], [1, 2]);
  const ravi = b.groups.find((g) => g.name === 'Ravi');
  assert.deepEqual([ravi.sent, ravi.all, ravi.red], [1, 1, 1], '"1 of 1 sent" but a red ⚠️ Stuck row in it');
  assert.deepEqual(teamBoard(d, { filter: 'notdue' }).groups.flatMap((g) => g.rows.map((r) => r.t.id)), [2, 3], 'Not due today can be shown alone');
  // without the server's field (an older copy): past its by-date and not waiting its turn
  assert.equal(teamBoard({ today: '2026-10-23', tasks: [T(6, V, { dueDate: '2026-10-20' })], suggestions: [] }).groups[0].rows[0].status, 'late');
  assert.equal(teamBoard({ today: '2026-10-23', tasks: [T(7, V, { dueDate: '2026-10-20', queued: true })], suggestions: [] }).groups[0].rows[0].status, 'notyet');
});
