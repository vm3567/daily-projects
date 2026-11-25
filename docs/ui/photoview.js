// 🖼 Photos, like Facebook photos (owner, 30 Oct: "make the design of the image frame better, like a facebook photos"):
// a black page with the photo big in the middle, a round ✕ at the top, ‹ › and "2 / 5" when there are more,
// arrow keys and a swipe on the phone to move, Escape or a tap on the black space to close.
// One viewer for every photo: the owner's pages, the team pages and the staff view.

import { h } from './dom.js';

/**
 * The next photo's number, going round at the ends (pure: tested).
 * step: +1 (next) or -1 (back).
 */
export const nextIndex = (i, step, n) => (n ? (((i + step) % n) + n) % n : 0);

/**
 * Show photos in the #viewer box. items: a list of () => address (or a Promise of one), so a photo is fetched only
 * when it is shown. index: the one to start on. name: words under the photo (e.g. "Ruturaj · 29 Oct"), or none.
 * onClose: what closing does (default: hide the box).
 */
export function showPhotos(v, { items, index = 0, name = '', onClose = null }) {
  const list = (items || []).filter(Boolean);
  if (!v || !list.length) return;
  let at = Math.min(Math.max(0, index), list.length - 1);
  let seq = 0;
  let startX = null;
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose(); else { v.hidden = true; v.replaceChildren(); }
  };
  const img = h('img', { class: 'pv-img', alt: name || 'Photo' });
  const count = h('span', { class: 'pv-count' });
  const save = h('a', { class: 'pv-btn', title: 'Download', 'aria-label': 'Download this photo', download: 'photo.jpg' }, '⬇');
  const many = list.length > 1;
  const arrow = (step, text, label) => (many
    ? h('button', { class: 'pv-btn pv-arrow ' + (step < 0 ? 'pv-prev' : 'pv-next'), type: 'button', title: label, 'aria-label': label, onClick: (e) => { e.stopPropagation(); go(step); } }, text)
    : null);
  const stage = h('div', { class: 'pv-stage', onClick: (e) => { if (e.target === stage) close(); } }, img);
  const root = h('div', { class: 'pv', role: 'dialog', 'aria-label': 'Photo', 'aria-modal': 'true' },
    h('div', { class: 'pv-top' },
      count,
      h('span', { class: 'pv-gap' }),
      save,
      h('button', { class: 'pv-btn pv-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onClick: close }, '✕')),
    stage,
    arrow(-1, '‹', 'Previous photo'),
    arrow(1, '›', 'Next photo'),
    name ? h('div', { class: 'pv-name' }, name) : null);
  async function show() {
    const my = ++seq;
    count.textContent = many ? `${at + 1} / ${list.length}` : '';
    img.classList.add('loading');
    try {
      const url = await list[at]();
      if (my !== seq) return; // moved on meanwhile
      img.src = url; save.href = url;
    } catch { if (my === seq) img.alt = 'Could not load this photo'; }
    img.classList.remove('loading');
  }
  function go(step) { if (!many) return; at = nextIndex(at, step, list.length); show(); }
  function onKey(e) {
    if (v.hidden || !v.contains(root)) { document.removeEventListener('keydown', onKey, true); return; } // closed another way
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }
  // a swipe left / right on the phone
  root.addEventListener('touchstart', (e) => { startX = e.touches && e.touches[0] ? e.touches[0].clientX : null; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    const t = e.changedTouches && e.changedTouches[0];
    if (startX === null || !t) return;
    const dx = t.clientX - startX; startX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
  v.classList.remove('sheet-mode');
  v.replaceChildren(root);
  v.hidden = false;
  document.addEventListener('keydown', onKey, true);
  show();
}
