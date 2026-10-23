// The right-click menu on the team pages (ui/team.js) and the staff app (ui/staff.js): the same look as Daily Projects'
// (.row-menu). state.rowMenu = { id, x, y } opens it; a click on an item, a click elsewhere or Esc closes it.

import { h } from './dom.js';

/** Right-click on a row: open the menu there (inside a text box the browser's own menu stays). */
export function openMenuAt(state, render, what, e) {
  if (e.target && e.target.closest && e.target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')) return;
  if (e.preventDefault) e.preventDefault();
  state.rowMenu = { ...what, x: e.clientX || 0, y: e.clientY || 0 };
  render();
}

/** The menu: a title and items [icon, label, fn, danger?] (null items are left out). */
export function menuBox(state, render, title, items) {
  const m = state.rowMenu;
  if (!m) return null;
  const item = ([icon, label, fn, danger]) => h('button', {
    class: 'row-menu-item' + (danger ? ' danger' : ''), role: 'menuitem', key: 'rm-' + label,
    onClick: () => { state.rowMenu = null; render(); fn(); },
  }, h('span', { class: 'rm-icon', 'aria-hidden': 'true' }, icon), label);
  const el = h('div', { class: 'row-menu', role: 'menu', key: 'row-menu', 'aria-label': `Actions for ${title}` },
    h('div', { class: 'row-menu-title' }, title),
    items.filter(Boolean).map(item));
  // keep it on the screen (style object: allowed by the page's safety rules)
  const w = typeof window !== 'undefined' ? window : { innerWidth: 1024, innerHeight: 768 };
  el.style.left = Math.max(8, Math.min(m.x, w.innerWidth - 290)) + 'px';
  el.style.top = Math.max(8, Math.min(m.y, w.innerHeight - 340)) + 'px';
  return el;
}

/** Put the cursor in a box once the page that holds it has loaded (it may come a moment after the click). */
export function focusLater(key, tries = 20) {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  const el = document.querySelector(`[data-key="${key}"]`);
  if (el && el.focus) { el.focus(); if (el.scrollIntoView) el.scrollIntoView({ block: 'center' }); return; }
  if (tries > 0) setTimeout(() => focusLater(key, tries - 1), 150);
}
