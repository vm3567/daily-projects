// 🔔 Notifications inside the app (like LinkedIn or Facebook): every phone notification is also kept on the server
// (notifs.list), so one missed on the phone is still here. The bell shows how many are not seen yet; tapping one
// opens its task (the same "#team-task=<id>" address a phone notification opens) and marks it seen.
// The same bell for the owner, a manager and a team member: it sits on top of whichever screens are open.

import { h, fmtDay, fmtTime } from './dom.js';
import { todayIndia } from '../rules.js';

/** What tapping a notification puts on the address ('' = nothing to open: the list it is on is enough). Pure: tested. */
export function bellHash(url) {
  const m = /#(team-task=\d+|open=[\w-]{1,64}|apps)$/.exec(String(url || ''));
  return m ? '#' + m[1] : '';
}

/** The number on the bell ('' for none, "99+" for many). Pure: tested. */
export function bellCount(n) {
  return n > 0 ? (n > 99 ? '99+' : String(n)) : '';
}

/** When it came: "10:05" today, else "Mon 21 Oct 10:05". Pure: tested. */
export function bellWhen(at, today) {
  const day = String(at || '').slice(0, 10);
  const time = fmtTime(String(at).replace(' ', 'T') + '+05:30');
  return day === today ? time : `${fmtDay(day)} ${time}`;
}

/**
 * post(action, body) → the server's answer (throws when it fails); every: ms between checks; today(): India's date.
 * Returns { el, refresh, state } — el is added to the page once (document.body: the page's own taps reach it, installEvents).
 */
export function createBell({ post, every = 30000, today = todayIndia, win = window }) {
  const state = { open: false, list: [], unread: 0, loaded: false, failed: false };
  const el = h('div', { class: 'bell-wrap' });
  const baseTitle = () => (document.title || '').replace(/^\(\d+\+?\) /, '');

  const draw = () => {
    const n = bellCount(state.unread);
    try { document.title = (n ? `(${n}) ` : '') + baseTitle(); } catch { /* not a page */ }
    try { if (navigator.setAppBadge) (state.unread ? navigator.setAppBadge(state.unread) : navigator.clearAppBadge()).catch(() => {}); } catch { /* no badge here */ }
    el.replaceChildren(...[
      h('button', { class: 'bell-btn' + (state.unread ? ' has-new' : ''), type: 'button', 'aria-label': n ? `Notifications, ${n} new` : 'Notifications', 'aria-expanded': String(state.open), onClick: toggle },
        '🔔', n ? h('span', { class: 'bell-count' }, n) : null),
      state.open ? h('div', { class: 'bell-panel', role: 'dialog', 'aria-label': 'Notifications' },
        h('div', { class: 'bell-head' }, h('strong', null, 'Notifications'),
          state.unread ? h('button', { class: 'link small', type: 'button', onClick: readAll }, 'Mark all as seen') : null),
        !state.loaded ? h('p', { class: 'muted small bell-empty' }, state.failed ? 'Cannot reach worktask.in right now.' : 'Loading…')
          : !state.list.length ? h('p', { class: 'muted small bell-empty' }, 'No notifications yet. Messages, updates and new work show here.')
            : h('ul', { class: 'bell-list' }, state.list.map((x) => h('li', { key: 'n' + x.id },
              h('button', { class: 'bell-item' + (x.read ? '' : ' new'), type: 'button', onClick: () => pick(x) },
                h('span', { class: 'bell-title' }, x.title),
                x.body ? h('span', { class: 'bell-body' }, x.body) : null,
                h('span', { class: 'bell-when' }, bellWhen(x.at, today()))))))) : null].filter(Boolean));
  };

  async function refresh() {
    try {
      const out = await post('notifs.list', {});
      state.list = out.notifs || []; state.unread = out.unread || 0; state.loaded = true; state.failed = false;
    } catch { state.failed = !state.loaded; }
    draw();
  }
  function toggle() {
    state.open = !state.open;
    draw();
    if (state.open) refresh();
  }
  async function pick(x) {
    state.open = false;
    if (!x.read) { x.read = true; state.unread = Math.max(0, state.unread - 1); post('notifs.read', { ids: [x.id] }).catch(() => {}); }
    draw();
    const hash = bellHash(x.url);
    if (hash) { if (win.location.hash === hash) win.location.hash = ''; win.location.hash = hash; } // (opened again: the same address still counts)
  }
  async function readAll() {
    state.list.forEach((x) => { x.read = true; });
    state.unread = 0;
    draw();
    try { await post('notifs.read', { all: true }); } catch { refresh(); }
  }

  // a tap outside the list closes it
  win.document.addEventListener('pointerdown', (e) => { if (state.open && !el.contains(e.target)) { state.open = false; draw(); } });
  win.document.addEventListener('keydown', (e) => { if (state.open && e.key === 'Escape') { state.open = false; draw(); } });
  win.document.addEventListener('visibilitychange', () => { if (win.document.visibilityState === 'visible') refresh(); });
  win.addEventListener('hashchange', () => setTimeout(refresh, 1500)); // a task opened (from a phone notification too): it counts as seen
  if (every) setInterval(() => { if (win.document.visibilityState === 'visible') refresh(); }, every);
  draw();
  refresh();
  return { el, refresh, state };
}
