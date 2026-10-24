// The pieces of a Work Task page, in the owner's design, shared by the staff view (ui/staff.js) and the team pages
// (ui/team.js): one task page, one message box, one day-by-day history — so a change here reaches everyone.
// The rules behind them (the history rows, what is late) come from Work Task's logic.js, passed in as `rules`.

import { h, fmtDay as dayOf, errLine } from './dom.js';

// the server's times are India time as "2026-10-22 10:30:00"
export const fmtDay = (d) => (d ? dayOf(String(d).slice(0, 10)) : '');
export const fmtTime = (dt) => {
  const [hh, mm] = String(dt || '').slice(11, 16).split(':').map(Number);
  return Number.isFinite(hh) && Number.isFinite(mm) ? `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}` : '';
};
export const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const STATES = [['progress', 'Working on it'], ['stuck', 'Stuck'], ['finished', 'Finished']];
const stateName = (s) => (STATES.find((x) => x[0] === s) || STATES[0])[1];
// (the owner's tags: Stuck as late, Finished as done, Working on it as waiting)
export const stateTag = (s) => h('span', { class: 'tag ' + (s === 'stuck' ? 'late' : s === 'finished' ? 'done-tag' : 'waiting') }, stateName(s));
export const newClientId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
export const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const nowHm = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** "Every day", "By Mon 3 Nov · 2 days late", "Current step — send an update each day" … */
export function repeatLabel(t, today) {
  const by = t.dueDate ? (today && t.status === 'open' && t.dueDate < today ? ` · ⏰ late, was by ${fmtDay(t.dueDate)}` : ` · by ${fmtDay(t.dueDate)}`) : '';
  if (t.seq !== null && t.seq !== undefined && t.status === 'open') return (t.queued ? 'Coming next' : 'Current step — send an update each day') + by;
  if (today && t.startDate && t.startDate > today && t.status === 'open') return `Starts ${fmtDay(t.startDate)}`;
  if (t.repeat === 'daily') return t.skipSunday ? 'Every day (Mon–Sat)' : 'Every day';
  if (t.repeat === 'weekly') return `Every ${LONG_DAYS[t.weekday ?? 1]}`;
  if (!t.dueDate) return 'One time';
  const late = today && t.status === 'open' ? daysBetween(t.dueDate, today) : 0;
  return late > 0 ? `By ${fmtDay(t.dueDate)} · ${late} day${late > 1 ? 's' : ''} late` : `By ${fmtDay(t.dueDate)}`;
}

/** A part of the page with its small grey title, as on the owner's project page ("STEPS", "WHAT'S HAPPENING"). */
export const block = (title, ...children) => h('section', { class: 'block' }, h('h3', null, title), ...children);

/** A list section's small title (with a count or tag on the right). */
export const sec = (label, extra) => h('div', { class: 'list-sec' }, h('span', null, label), extra || null);

/** One row of a list, as the owner's rows: dot · title (tags) · the line under it. */
export function taskRow({ key, title, sub, dot, current = false, warn = false, tags = null, onOpen, onMenu = null }) {
  return h('li', { key, class: 'prow' + (current ? ' current' : ''), onContextmenu: onMenu || undefined }, // (right-click: its menu)
    h('span', { class: 'quick-tick-space', 'aria-hidden': 'true' }),
    h('button', { class: 'prow-btn', onClick: onOpen },
      dot ? h('span', { class: 'dot ' + dot, 'aria-label': dot }) : null,
      h('span', { class: 'prow-text' },
        h('span', { class: 'prow-name' }, title, tags),
        sub ? h('span', { class: 'prow-next' + (warn ? ' warn' : '') }, sub) : null)));
}

/** The small chips under a task's title: who (team pages), project, how often, its date, the photo rule, closed. */
export function chipsFor(t, td, { who = false } = {}) {
  const c = (text, cls = '') => h('span', { class: 'info-chip static' + cls }, text);
  const late = t.status === 'open' && t.dueDate && t.dueDate < td;
  return h('div', { class: 'info-chips' },
    who && t.assignee ? c(`👤 ${t.assignee.name}`, ' team') : null,
    t.project && t.project !== t.title && t.project !== 'Misc' ? c(`📁 ${t.project}`) : null, // (not when it only says the task's own name again, nor "Misc")
    t.kind === 'log' ? c('📒 Record') : c(repeatLabel({ ...t, dueDate: null }, td)), // (a record has no "every day": entries come when something happens)
    t.dueDate ? c(late ? `⏰ Late — was by ${fmtDay(t.dueDate)}` : `By ${fmtDay(t.dueDate)}`, late ? ' bad' : '') : null,
    t.needsPhoto ? c('📷 Photo to finish') : null,
    t.status === 'done' ? c('✓ Done', ' good') : t.status === 'cancelled' ? c('Cancelled', ' bad') : t.status === 'suggested' ? c('💡 Suggestion') : t.kind === 'log' ? (t.entriesToday ? c(`✓ ${t.entriesToday} entr${t.entriesToday === 1 ? 'y' : 'ies'} today`, ' good') : null) : t.today ? c('✓ Sent today', ' good') : null);
}

/**
 * Pictures fetched with the sign-in: pic(kind, id) is the address once fetched (else null, and it is fetched, then the
 * page is drawn again). Drawn as part of the page, so a redraw keeps it (set on the element afterwards it was taken off).
 */
export function makePics(photo, render) {
  const pics = new Map(); // kind:id -> address, '' (missing), or 'loading'
  return (kind, id) => {
    const k = kind + ':' + id, v = pics.get(k);
    if (v !== undefined) return v === 'loading' ? null : v;
    pics.set(k, 'loading');
    photo(kind, id).then((u) => { pics.set(k, u); render(); }, () => { pics.set(k, ''); render(); });
    return null;
  };
}

/** A row of small photos (tap = the viewer). */
export function photosRow(pic, viewer, kind, list) {
  if (!list || !list.length) return null;
  return h('div', { class: 'row' }, list.map((id) => {
    const src = pic(kind, id);
    return h('img', { key: kind + id, alt: src === '' ? 'Photo missing' : 'Photo', class: 'diary-photo', src: src || undefined, onClick: () => { if (src) viewer(src, 'Photo', true); } });
  }));
}

/** 📎 Instruction photos / PDFs on a task. Tap to open; the manager can take one off (✕). */
export function filesBlock(t, { pic, openFile, onRemove = null }) {
  if (!t.files || !t.files.length) return null;
  return block('📎 Instructions', h('div', { class: 'row' }, t.files.map((f) => {
    const box = !f.image ? h('button', { class: 'chip', key: 'f' + f.id, title: f.name, onClick: () => openFile(f) }, '📄 ' + (f.name.length > 18 ? f.name.slice(0, 16) + '…' : f.name))
      : (() => { const src = pic('task.file', f.id); return h('img', { key: 'f' + f.id, alt: src === '' ? f.name + ' (missing)' : f.name, title: f.name, class: 'diary-photo', src: src || undefined, onClick: () => openFile(f) }); })();
    if (!onRemove) return box;
    return h('span', { key: 'fw' + f.id, class: 'row' }, box, h('button', { class: 'link small', title: 'Remove', 'aria-label': `Remove ${f.name}`, onClick: () => onRemove(f) }, '✕'));
  })));
}

/**
 * 📅 What's happening on a task, day by day (the rule: logic.js diaryRows): every update with its time, Sunday = Off,
 * a due day with nothing = No progress. staff: their own words say "You". Drawn exactly like the owner's
 * "What's happening" (ui/detail.js): the last-7-days strip, box (today's update form) under the heading, the day in
 * bold with its date under it, the time on the right, the same day tags.
 */
export function diaryBlock({ rules, t, updates, td, staff, meId, n, fillBy, photos, onMore, box = null, todayInRows = false }) {
  // todayInRows: today's update is a "Today" row too (the box above only writes or changes it)
  const { rows, more } = rules.diaryRows(t, updates, td, { staff: staff && !todayInRows, n, fillBy, nowHm: nowHm() });
  const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeek = (day) => new Date(day + 'T00:00:00Z').getUTCDay();
  const back = (day, k) => new Date(Date.parse(day + 'T00:00:00Z') - k * 864e5).toISOString().slice(0, 10);
  const byDay = new Map(rows.map((r) => [r.day, r.kind]));
  const STATE = { ups: 'ok', off: 'off', wait: 'wait', miss: 'miss' }, WHAT = { ok: 'updated', off: 'off', wait: 'waiting', miss: 'no progress', none: '—' };
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const day = back(td, i), st = STATE[byDay.get(day)] || (dayOfWeek(day) === 0 ? 'off' : 'none');
    week.push(h('span', { class: `wk ${st}`, key: 'wk-' + day, title: `${SHORT[dayOfWeek(day)]} ${fmtDay(day)}: ${WHAT[st]}` }, SHORT[dayOfWeek(day)][0]));
  }
  return h('section', { class: 'block diary' },
    h('div', { class: 'diary-head' }, h('h3', null, "📅 What's happening"), h('div', { class: 'week', title: 'Last 7 days' }, week)),
    box,
    rows.length ? h('ul', { class: 'diary-days' }, rows.map(({ day, kind, ups }) => h('li', { class: 'diary-day', key: 'd-' + day },
      h('div', { class: 'diary-date' }, h('strong', null, day === td ? 'Today' : LONG_DAYS[dayOfWeek(day)]),
        h('span', { class: 'muted small' }, day === td ? `${SHORT[dayOfWeek(day)]} ${fmtDay(day)}` : fmtDay(day))),
      h('div', { class: 'diary-items' }, kind === 'ups' ? ups.map((u) => h('div', { class: 'diary-entry', key: 'u-' + u.at },
        h('div', { class: 'diary-line' },
          h('span', { class: 'diary-icon' }, u.state === 'stuck' ? '⚠️' : u.state === 'finished' ? '✅' : '📝'),
          h('div', { class: 'diary-text' }, h('strong', null, (staff && u.byId === meId ? 'You' : u.by) + ' '), u.state !== 'progress' ? [stateTag(u.state), ' '] : null, `“${u.note}”`, photos('photo', u.photos))),
        h('span', { class: 'diary-time' }, fmtTime(u.at))))
        : kind === 'off' ? h('span', { class: 'day-tag off' }, 'Off')
          : kind === 'wait' ? h('span', { class: 'day-tag wait' }, 'Waiting for today\'s update')
            : [h('span', { class: 'day-tag miss' }, 'No progress'), h('span', { class: 'muted small' }, staff ? ' no update' : ' no update from anyone')])))) : h('p', { class: 'muted small' }, 'Nothing yet.'),
    more ? h('button', { class: 'link small', onClick: onMore }, 'Show older days') : null);
}

/**
 * 💬 Messages on a task, in the owner's team-messages box: each message (✎ / ✕ on your own, never on a move note),
 * what waits on the phone, the box and Send, and 📷 a photo with the words in the box.
 * onSend / onPhoto resolve to '' or the words to show under the box.
 */
/**
 * The ticks on my own message, like WhatsApp: ✓ sent (grey), ✓✓ seen (blue) once someone else on the task has read it;
 * null on someone else's message and on the server's own notes. Pure: tested.
 */
export function msgTicks(c) {
  if (!c || !c.mine || c.kind === 'move' || c.kind === 'chase') return null;
  const by = Array.isArray(c.seenBy) ? c.seenBy : [];
  return by.length ? { cls: 'ticks seen', text: '✓✓', title: 'Seen by ' + by.join(', ') } : { cls: 'ticks', text: '✓', title: 'Sent — not seen yet' };
}

export function messagesBlock({ taskId, comments, waiting = [], draft, sending, placeholder, onInput, onSend, onPhoto, onEdit, onDelete, photos }) {
  const err = errLine('merr-' + taskId);
  const say = (m) => err.say(m);
  const pick = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', onChange: (e, el) => { const f = el.files[0]; el.value = ''; if (f) onPhoto(f).then(say); } });
  return block('💬 Messages', h('div', { class: 'banner team-msgs' },
    comments.length ? comments.map((c) => h('div', { class: 'team-msg' + (c.mine ? ' mine' : ''), key: 'c-' + c.id },
      h('div', { class: 'row small' }, h('strong', null, c.mine ? 'You' : c.by), h('span', { class: 'muted' }, `${fmtDay(c.at)} ${fmtTime(c.at)}${c.editedAt ? ' · edited' : ''}`),
        ((t) => (t ? h('span', { class: t.cls, title: t.title, 'aria-label': t.title }, t.text) : null))(msgTicks(c)),
        c.mine && !String(c.text || '').startsWith('↔ Moved') && c.kind !== 'move' && c.kind !== 'chase' ? h('span', { class: 'msg-acts' }, // (the server's own notes stay as they are)
          h('button', { class: 'link small', title: 'Change', 'aria-label': 'Change this message', onClick: () => onEdit(c) }, '✎'),
          h('button', { class: 'link small', title: 'Delete', 'aria-label': 'Delete this message', onClick: () => onDelete(c) }, '✕')) : null),
      c.photo ? photos('comment.photo', [c.id]) : null,
      c.text ? h('div', { class: 'pre' }, c.text) : null)) : (waiting.length ? null : h('span', { class: 'muted small' }, 'No messages yet.')),
    waiting.map((x) => h('div', { class: 'team-msg mine', key: 'wc-' + x.id },
      h('div', { class: 'row small' }, h('strong', null, 'You'), h('span', { class: 'tag remind' }, '⏳ Waiting to send')), h('div', { class: 'pre' }, x.text))),
    h('textarea', { key: 'msg-' + taskId, placeholder, value: draft || '', onInput: (e, el) => { onInput(el.value); err.clear(); } }),
    err,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary small', disabled: sending ? true : undefined, onClick: () => onSend().then(say) }, 'Send message'),
      h('label', { class: 'btn small', title: 'Send a photo (with the words in the box)' }, '📷 Photo', pick))));
}

/**
 * The phone's Back button closes the open page (or the menu) instead of leaving the app: one Back step is added while
 * something is open, and taken off again when it is closed another way (← or a tap). Returns sync(), called after each
 * redraw. isOpen() → is a page or the menu open; close() closes the top one.
 */
export function phoneBack(win, isOpen, close) {
  if (!win || !win.history || !win.addEventListener) return () => {};
  let skip = 0;
  const marked = () => !!(win.history.state && win.history.state.dpBack);
  if (marked()) win.history.replaceState(null, ''); // a reload keeps the old step: it would leave on the first Back
  win.addEventListener('popstate', () => { if (skip) { skip--; return; } if (isOpen()) close(); });
  return () => {
    if (isOpen() && !marked()) win.history.pushState({ dpBack: 1 }, '');
    else if (!isOpen() && marked()) { skip++; win.history.back(); }
  };
}

/**
 * 📒 A record's logbook: its entries by day, newest first — the time, the line, who (when it is not you), its photos.
 * waiting = entries kept on the phone (no internet yet). onDelete(entry) on your own entries of the last 2 days.
 */
export function logbookBlock({ entries = [], waiting = [], photos, meId = 0, td = '', onDelete = null }) {
  const days = [];
  for (const e of entries) { const d = e.day || String(e.at).slice(0, 10); if (!days.length || days[days.length - 1].day !== d) days.push({ day: d, list: [] }); days[days.length - 1].list.push(e); }
  const recent = (e) => !td || (e.day || String(e.at).slice(0, 10)) >= addDaysIso(td, -2);
  return h('div', { class: 'logbook', key: 'logbook' },
    waiting.map((w) => h('div', { class: 'log-entry waiting', key: 'lw-' + w.id }, h('span', { class: 'tag remind' }, '⏳ Waiting to send'), ' ', w.text, (w.files || []).length ? h('span', { class: 'muted small' }, ` 📷 ${w.files.length}`) : null)),
    !entries.length && !waiting.length ? h('p', { class: 'muted small' }, 'No entries yet.') : null,
    days.map((d) => h('div', { class: 'log-day', key: 'ld-' + d.day },
      h('div', { class: 'log-day-head' }, d.day === td ? 'Today' : fmtDay(d.day)),
      d.list.map((e) => h('div', { class: 'log-entry', key: 'le-' + e.id },
        h('div', { class: 'log-line' },
          h('span', { class: 'muted small log-time' }, fmtTime(e.at)),
          h('span', { class: 'pre' }, e.text),
          e.byId !== meId && e.by ? h('span', { class: 'muted small' }, ` · ${e.by}`) : null,
          onDelete && e.byId === meId && recent(e) ? h('button', { class: 'link small danger', type: 'button', title: 'Remove this entry', onClick: () => onDelete(e) }, '✕') : null),
        photos ? photos('photo', e.photos) : null)))));
}
const addDaysIso = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

/**
 * The phone's bottom bar on the team and staff pages, as on the owner's pages (owner, 24 Oct): the pages used most,
 * then ☰ More (the menu). tabs: [icon, label, on, onTap, count?]. Shown only on a phone (styles.css .tabbar).
 */
export function bottomBar(tabs, onMore, moreOn = false) {
  const tab = ([icon, label, on, onTap, count], i) => h('button', { class: 'tab' + (on ? ' current' : ''), key: 'tab-' + i, 'aria-label': label, onClick: onTap },
    h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, icon), h('span', { class: 'tab-label' }, label),
    count ? h('span', { class: 'tab-count' }, String(count)) : null);
  return h('nav', { class: 'tabbar', key: 'tabbar', 'aria-label': 'Main pages' }, tabs.filter(Boolean).map(tab),
    h('button', { class: 'tab' + (moreOn ? ' current' : ''), key: 'tab-more', 'aria-label': 'More pages', onClick: onMore },
      h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, '☰'), h('span', { class: 'tab-label' }, 'More')));
}

/** A search result's words: a 📒 record's day has many lines, so only the lines with the words searched (up to 2). */
export function hitLines(text, q) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return lines[0] || '';
  const words = String(q || '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hit = lines.filter((l) => words.some((w) => l.toLowerCase().includes(w)));
  return (hit.length ? hit : lines).slice(0, 2).join(' · ');
}

/**
 * A task's dot in the staff app, the same rule as Team today (owner, 24 Oct: red at 11 am was wrong):
 * sent today = green; waiting on the phone = yellow; due and not sent = yellow until the updates are due
 * (fill-by), red after that, or when it is past its by-date, or stuck; a 📒 record with nothing today, or not due = grey.
 */
export function staffDot(t, { waiting = false, pastFillBy = false } = {}) {
  if (!t || t.status !== 'open') return 'grey';
  if (t.today) return 'green';
  if (waiting) return 'yellow';
  if (t.kind === 'log') return 'grey';
  if (t.stuck) return 'red';
  const late = t.late === true;
  if (t.dueToday === false && !late) return 'grey'; // (the server always says; on today's list a task is due)
  return late || pastFillBy ? 'red' : 'yellow';
}
