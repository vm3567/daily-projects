// "@" name picker. Works in any text box that has a data-mention attribute:
//   data-mention="1"     → typing "@Ra…" shows matching people; picking inserts "@Ravi Kumar "
//   data-mention="plain" → the whole box is a name (used for "Waiting on whom?")
// Keyboard: ↓ ↑ to move, Enter or Tab to pick, Esc to close. Tapping a name also works.

import { h } from './dom.js';
import { newId } from '../ops.js';

const MAX_ITEMS = 6;
let state = null; // { el, start, end, items, index, plain }
let getCtx = null;

function box() {
  return document.getElementById('mention');
}

function close() {
  state = null;
  const b = box();
  b.hidden = true;
  b.replaceChildren();
}

function findQuery(el) {
  const caret = el.selectionStart ?? el.value.length;
  if (el.dataset.mention === 'plain') {
    const q = el.value.trim();
    return q ? { query: q, start: 0, end: el.value.length, plain: true } : null;
  }
  const before = el.value.slice(0, caret);
  const m = /(^|[\s(,])@([^@\n]{0,40})$/.exec(before);
  if (!m) return null;
  return { query: m[2], start: caret - m[2].length - 1, end: caret, plain: false };
}

function matches(people, query) {
  const q = query.toLowerCase().trim();
  if (!q) return people.slice(0, MAX_ITEMS);
  return people
    .filter((p) => {
      const n = p.name.toLowerCase();
      return n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q));
    })
    .slice(0, MAX_ITEMS);
}

function update(el) {
  if (!el || !el.dataset || !el.dataset.mention || !getCtx) { if (state) close(); return; }
  const ctx = getCtx();
  if (!ctx.store || !ctx.store.view) return;
  const found = findQuery(el);
  if (!found) { close(); return; }
  const people = ctx.store.view.data.people || [];
  const items = matches(people, found.query).map((p) => ({ name: p.name }));
  const q = found.query.trim();
  // Offer "add new" only for a single word, so normal typing after a name does not trigger it.
  const exact = people.some((p) => p.name.toLowerCase() === q.toLowerCase());
  if (q && !exact && !/\s/.test(found.query) && q.length <= 40) items.push({ name: q, isNew: true });
  if (/\s/.test(found.query) && !items.length) { close(); return; }
  if (!items.length) { close(); return; }
  if (found.plain && items.length === 1 && !items[0].isNew && items[0].name === el.value.trim()) { close(); return; }
  state = { el, ...found, items, index: 0 };
  draw();
}

function draw() {
  const b = box();
  b.replaceChildren(...state.items.map((it, i) => h('button', {
    type: 'button', class: 'mention-item' + (i === state.index ? ' on' : ''), role: 'option',
    'aria-selected': String(i === state.index),
    onClick: () => choose(i),
  }, it.isNew ? `+ Add "${it.name}" as a new person` : state.plain ? it.name : `@${it.name}`)));
  const r = state.el.getBoundingClientRect();
  b.hidden = false;
  const below = r.bottom + 4;
  const height = b.offsetHeight;
  b.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - b.offsetWidth - 8))}px`;
  b.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : below}px`;
}

function choose(i) {
  if (!state) return;
  const { el, start, end, plain } = state;
  const it = state.items[i];
  const ctx = getCtx();
  if (it.isNew) {
    const op = ctx.store.dispatch('addPerson', { personId: newId(), name: it.name });
    if (op) ctx.toast(`Added ${it.name} to People`);
  }
  const insert = plain ? it.name : `@${it.name} `;
  el.value = el.value.slice(0, start) + insert + el.value.slice(end);
  const caret = start + insert.length;
  close();
  el.focus();
  try { el.setSelectionRange(caret, caret); } catch { /* some inputs do not allow it */ }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  if (plain) el.dispatchEvent(new Event('change', { bubbles: true }));
}

function onKeyDown(e) {
  if (!state || e.target !== state.el) return;
  const n = state.items.length;
  if (e.key === 'ArrowDown') state.index = (state.index + 1) % n;
  else if (e.key === 'ArrowUp') state.index = (state.index - 1 + n) % n;
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); choose(state.index); return; }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
  else return;
  e.preventDefault();
  e.stopPropagation();
  draw();
}

export function installMentions(ctxGetter) {
  getCtx = ctxGetter;
  const b = box();
  // Keep the text box focused when a name is pressed.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  document.addEventListener('input', (e) => update(e.target), true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusout', () => {
    setTimeout(() => { if (state && document.activeElement !== state.el) close(); }, 200);
  }, true);
  window.addEventListener('resize', () => { if (state) close(); });
  document.addEventListener('scroll', () => { if (state) draw(); }, true);
}
