// 📅 The calendar (owner, 25 Nov: "every task I can assign in calendar", a day and a time).
// One drawing for the owner's pages, the team pages and the staff view: Day, Week (Monday first) and Month.
// Week / Day: an "all day" row (target dates), then the hours, each planned task a block at its time. On a computer a
// block can be dragged to another day or time, and a click on an empty time adds a task there (when the page allows).
// Month: each day with its first tasks. The rules (what shows, the weeks) are in rules.js.

import { h, fmtDay } from './dom.js';
import { addDays, mondayOf, monthWeeks, timeToMin, minToTime, slotEnd } from '../rules.js';

export const HOUR_PX = 48; // one hour's height
const SNAP = 15;
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const wd = (day) => new Date(day + 'T00:00:00Z').getUTCDay();
/** Sizes and places go through the style object: the page's safety rules (CSP) block style attributes. */
const css = (el, text) => { if (el.style) el.style.cssText = text; return el; };

/** The days a mode shows around `day`. Pure: tested. */
export function calendarDays(mode, day) {
  if (mode === 'day') return [day];
  if (mode === 'month') return monthWeeks(day).flat();
  const mon = mondayOf(day);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/** ‹ › moves by a day, a week or a month. Pure: tested. */
export function calendarStep(mode, day, dir) {
  if (mode === 'day') return addDays(day, dir);
  if (mode === 'week') return addDays(day, 7 * dir);
  const [y, m] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + dir, 1));
  return t.toISOString().slice(0, 10);
}

/** The page's title: "Wed 25 Nov 2026", "23 – 29 Nov 2026", "November 2026". Pure: tested. */
export function calendarTitle(mode, day) {
  const y = day.slice(0, 4);
  if (mode === 'day') return `${SHORT[wd(day)]} ${fmtDay(day)} ${y}`;
  if (mode === 'month') return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${y}`;
  const days = calendarDays('week', day);
  return `${fmtDay(days[0])} – ${fmtDay(days[6])} ${days[6].slice(0, 4)}`;
}

/** The hours shown: 7:00 to 21:00, wider when a task is planned earlier or later. Pure: tested. */
export function hourRange(items) {
  let from = 7 * 60, to = 21 * 60;
  for (const t of items) {
    const s = timeToMin(t.start);
    if (s === null) continue;
    from = Math.min(from, Math.floor(s / 60) * 60);
    to = Math.max(to, Math.min(24 * 60, Math.ceil((s + t.mins) / 60) * 60));
  }
  return { from, to };
}

/** Side by side when they overlap: each block gets a lane (0, 1, …) and how many lanes its cluster has. Pure: tested. */
export function laneBlocks(items) {
  const list = [...items].sort((a, b) => timeToMin(a.start) - timeToMin(b.start) || b.mins - a.mins);
  const out = [];
  let cluster = [], clusterEnd = -1;
  const close = () => { const n = Math.max(1, ...cluster.map((x) => x.lane + 1)); for (const x of cluster) x.lanes = n; cluster = []; };
  for (const t of list) {
    const s = timeToMin(t.start), e = s + t.mins;
    if (s >= clusterEnd && cluster.length) close();
    const ends = cluster.map((x) => x.end);
    let lane = 0;
    while (cluster.some((x) => x.lane === lane && x.end > s)) lane++;
    const b = { ...t, lane, lanes: 1, end: e };
    cluster.push(b); out.push(b);
    clusterEnd = Math.max(clusterEnd, e, ...ends);
  }
  close();
  return out;
}

/** The time at a height in a day column: the nearest quarter hour (where a dropped block's top lands). Pure: tested. */
export function timeAt(y, from) {
  const min = from + Math.max(0, Math.round(y / HOUR_PX * 60 / SNAP) * SNAP);
  return minToTime(Math.min(min, 24 * 60 - SNAP));
}
/** The quarter hour a click is in (9:25 → 9:15). Pure: tested. */
export function timeIn(y, from) {
  const min = from + Math.max(0, Math.floor(y / HOUR_PX * 60 / SNAP) * SNAP);
  return minToTime(Math.min(min, 24 * 60 - SNAP));
}

/**
 * The calendar. o: { mode, day, today, items: [{ id, title, day, start, mins, colour, sub? }], allDay: [{ id, title, day,
 * colour }], onNav(day), onMode(mode), onOpen(id), onMove?(id, day, start), onDay?(id, day) (dropped on a day's "all day"
 * row or a Month day: same time, another day), onAdd?(day, start), side?: a node beside it, box?: a node above the grid
 * (e.g. the add box) }.
 */
export function calendarView(o) {
  const { mode, day, today } = o;
  const days = calendarDays(mode, day);
  const seg = (m, label) => h('button', { class: 'seg' + (mode === m ? ' on' : ''), type: 'button', 'aria-pressed': String(mode === m), onClick: () => o.onMode(m) }, label);
  const bar = h('div', { class: 'pcal-bar row' },
    h('button', { class: 'btn small', type: 'button', 'aria-label': 'Before', onClick: () => o.onNav(calendarStep(mode, day, -1)) }, '‹'),
    h('button', { class: 'btn small', type: 'button', onClick: () => o.onNav(today) }, 'Today'),
    h('button', { class: 'btn small', type: 'button', 'aria-label': 'After', onClick: () => o.onNav(calendarStep(mode, day, 1)) }, '›'),
    h('strong', { class: 'pcal-title' }, calendarTitle(mode, day)),
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Calendar view' }, seg('day', 'Day'), seg('week', 'Week'), seg('month', 'Month')));
  const body = mode === 'month' ? monthGrid(o, days) : timeGrid(o, days);
  return h('div', { class: 'pcal' + (o.side ? ' with-side' : '') }, bar, o.box || null, h('div', { class: 'pcal-main' }, body, o.side || null));
}

/** Every task on the calendar can be picked up (owner, 25 Nov: "drag and drop on to another slot, or another day"). */
const dragStart = (id) => (e) => { if (e.dataTransfer) { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; } };
/** A day's "all day" row or a Month day takes a dropped task: the same time (or none) on that day. */
const dayDrop = (o, d) => (o.onDay ? {
  onDragover: (e) => e.preventDefault(),
  onDrop: (e) => { e.preventDefault(); const id = e.dataTransfer && e.dataTransfer.getData('text/plain'); if (id) o.onDay(id, d); },
} : {});

function chip(o, t, time) {
  const can = !!(o.onMove || o.onDay);
  return h('button', { class: `pcal-chip ${t.colour || 'grey'}`, type: 'button', key: 'ch-' + t.id + t.day, title: t.title, onClick: () => o.onOpen(t.id),
    draggable: can ? 'true' : undefined, onDragstart: can ? dragStart(t.id) : undefined },
    time ? h('span', { class: 'pcal-time' }, t.start + ' ') : null, t.title);
}

function monthGrid(o, days) {
  const byDay = (list) => { const m = new Map(); for (const t of list) { if (!m.has(t.day)) m.set(t.day, []); m.get(t.day).push(t); } return m; };
  const timed = byDay(o.items), all = byDay(o.allDay || []);
  const month = o.day.slice(0, 7);
  return h('div', { class: 'pcal-month' },
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => h('div', { class: 'pcal-dow', key: 'dw-' + n }, n)),
    days.map((d) => {
      const list = [...(all.get(d) || []).map((t) => [t, false]), ...(timed.get(d) || []).map((t) => [t, true])];
      return h('div', { class: 'pcal-cell' + (d.slice(0, 7) === month ? '' : ' other') + (d === o.today ? ' today' : ''), key: 'mc-' + d, ...dayDrop(o, d) },
        h('button', { class: 'pcal-daynum link', type: 'button', title: 'Open this day', onClick: () => { o.onNav(d); o.onMode('day'); } }, String(Number(d.slice(8)))),
        list.slice(0, 3).map(([t, time]) => chip(o, t, time)),
        list.length > 3 ? h('button', { class: 'link small', type: 'button', onClick: () => { o.onNav(d); o.onMode('day'); } }, `+${list.length - 3} more`) : null);
    }));
}

function timeGrid(o, days) {
  const { from, to } = hourRange(o.items);
  const height = (to - from) / 60 * HOUR_PX;
  const hours = [];
  for (let m = from; m < to; m += 60) hours.push(m);
  const allDay = o.allDay || [];
  const cols = `grid-template-columns:56px repeat(${days.length}, minmax(0, 1fr))`;
  const drop = (d) => (e, el) => {
    if (!o.onMove) return;
    e.preventDefault();
    const id = e.dataTransfer && e.dataTransfer.getData('text/plain');
    if (!id) return;
    const rect = el.getBoundingClientRect();
    o.onMove(id, d, timeAt(e.clientY - rect.top, from));
  };
  const add = (d) => (e, el) => {
    if (!o.onAdd) return;
    const rect = el.getBoundingClientRect();
    o.onAdd(d, timeIn(e.clientY - rect.top, from)); // (the quarter hour the click is in)
  };
  const block = (b) => {
    const el = h('div', {
      class: `pcal-block ${b.colour || 'grey'}`, key: 'bl-' + b.id, draggable: o.onMove ? 'true' : undefined, role: 'button', tabindex: '0',
      title: `${b.title}\n${b.start}–${slotEnd(b.start, b.mins)}${b.sub ? '\n' + b.sub : ''}`,
      onDragstart: o.onMove ? dragStart(b.id) : undefined,
      onClick: () => o.onOpen(b.id),
      onKeydown: (e) => { if (e.key === 'Enter') o.onOpen(b.id); },
    }, h('span', { class: 'pcal-time' }, `${b.start}–${slotEnd(b.start, b.mins)}`), h('span', { class: 'pcal-name' }, b.title), b.sub ? h('span', { class: 'pcal-sub' }, b.sub) : null);
    const top = (timeToMin(b.start) - from) / 60 * HOUR_PX, tall = Math.max(18, b.mins / 60 * HOUR_PX - 2);
    return css(el, `top:${top}px;height:${tall}px;left:${b.lane / b.lanes * 100}%;width:${100 / b.lanes}%`);
  };
  const column = (d) => css(h('div', {
    class: 'pcal-col' + (d === o.today ? ' today' : '') + (o.onAdd ? ' can-add' : ''), key: 'col-' + d, 'data-day': d,
    onDragover: o.onMove ? (e) => e.preventDefault() : undefined, onDrop: drop(d), onClick: add(d),
  }, laneBlocks(o.items.filter((t) => t.day === d)).map(block)), `height:${height}px`);
  const head = css(h('div', { class: 'pcal-head' }, h('div', null),
    days.map((d) => h('div', { class: 'pcal-dayhead' + (d === o.today ? ' today' : ''), key: 'dh-' + d }, `${SHORT[wd(d)]} ${Number(d.slice(8))}`))), cols);
  // (always there when a task can be dropped on a day, so there is somewhere to drop it)
  const allDayRow = o.onDay || allDay.some((t) => days.includes(t.day)) ? css(h('div', { class: 'pcal-allday' }, h('div', { class: 'pcal-gutter small muted' }, 'all day'),
    days.map((d) => h('div', { class: 'pcal-alldaycell', key: 'ad-' + d, ...dayDrop(o, d) }, allDay.filter((t) => t.day === d).map((t) => chip(o, t, false))))), cols) : null;
  const gutter = css(h('div', { class: 'pcal-gutter' }, hours.map((m) => css(h('div', { class: 'pcal-hour', key: 'hr-' + m }, minToTime(m)), `top:${(m - from) / 60 * HOUR_PX}px`))), `height:${height}px`);
  return h('div', { class: 'pcal-week' }, head, allDayRow, css(h('div', { class: 'pcal-body' }, gutter, days.map(column)), cols));
}
