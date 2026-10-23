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
export function taskRow({ key, title, sub, dot, current = false, warn = false, tags = null, onOpen }) {
  return h('li', { key, class: 'prow' + (current ? ' current' : '') },
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
    t.project ? c(`📁 ${t.project}`) : null,
    c(repeatLabel({ ...t, dueDate: null }, td)),
    t.dueDate ? c(late ? `⏰ Late — was by ${fmtDay(t.dueDate)}` : `By ${fmtDay(t.dueDate)}`, late ? ' bad' : '') : null,
    t.needsPhoto ? c('📷 Photo to finish') : null,
    t.status === 'done' ? c('✓ Done', ' good') : t.status === 'cancelled' ? c('Cancelled', ' bad') : t.status === 'suggested' ? c('💡 Suggestion') : t.today ? c('✓ Sent today', ' good') : null);
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
 * a due day with nothing = No progress. staff: their own words say "You", today has its own box above.
 */
export function diaryBlock({ rules, t, updates, td, staff, meId, n, fillBy, photos, onMore }) {
  const { rows, more } = rules.diaryRows(t, updates, td, { staff, n, fillBy, nowHm: nowHm() });
  return h('section', { class: 'block' },
    h('div', { class: 'diary-head' }, h('h3', null, "📅 What's happening")),
    rows.length ? h('ul', { class: 'diary-days' }, rows.map(({ day, kind, ups }) => h('li', { class: 'diary-day', key: 'd-' + day },
      h('div', { class: 'diary-date' }, day === td ? 'Today' : LONG_DAYS[new Date(day + 'T00:00:00Z').getUTCDay()], h('div', { class: 'muted small' }, fmtDay(day))),
      h('div', { class: 'diary-items' }, kind === 'ups' ? ups.map((u) => h('div', { class: 'diary-line' },
        h('span', { class: 'diary-icon' }, u.state === 'stuck' ? '⚠️' : u.state === 'finished' ? '✅' : '📝'),
        h('div', { class: 'diary-text' }, h('strong', null, (staff && u.byId === meId ? 'You' : u.by) + ' '), u.state !== 'progress' ? [stateTag(u.state), ' '] : null, u.note, photos('photo', u.photos)),
        h('span', { class: 'muted small' }, fmtTime(u.at))))
        : kind === 'off' ? h('span', { class: 'muted' }, 'Off')
          : kind === 'wait' ? h('span', { class: 'diary-none wait' }, 'Waiting for today\'s update')
            : h('span', { class: 'diary-none' }, 'No progress'))))) : h('p', { class: 'muted small' }, 'Nothing yet.'),
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
