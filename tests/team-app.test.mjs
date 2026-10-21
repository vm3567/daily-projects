// Work Task (team app): the rules behind the screens (team/public_html/logic.js).
// Each check here guards a fix, so a later change cannot quietly bring the problem back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDay, weekdayOf, dueOn, itemKey, diaryRows } from '../team/public_html/logic.js';

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
