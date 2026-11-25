// Keys on the team pages (the owner's Team today, Tasks, People…) and the staff app — the same keys as Daily Projects:
// ↓ / j next task, ↑ / k previous (it opens, like a click), Esc closes (the menu, then the open task), / search,
// n give a task (owner), ? shows the keys. Not while typing in a box, and never with Ctrl / ⌘ / Alt.
// It works on what is on screen: the rows in the list column (#list): list rows (li.prow) and table rows (tr.sub-row).

export const PAGE_KEYS_HELP = '↓ ↑ (or j k): next / previous task · t a m: Today / Tasks / Projects · f: Follow-up · Esc: close · /: search · n: give a task · ?: these keys';
export const STAFF_KEYS_HELP = '↓ ↑ (or j k): next / previous task · t a m: Today / Tasks / Projects · Esc: close · /: search · ?: these keys';
/** t a m (f): go to a page (owner, 24 Oct: the same letters as on the owner's pages: t Today, a ✅ Tasks, m 📂 Projects). */
const PAGE_LETTERS = { t: 'today', a: 'tasks', m: 'projects', f: 'followup' };

export function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.nodeName === 'TEXTAREA' || el.nodeName === 'SELECT') return true;
  return el.nodeName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type);
}

const hasClass = (el, c) => (' ' + (el.className || '') + ' ').includes(' ' + c + ' ');

/** The rows ↓ ↑ move through, in screen order (a row with no way to open it, like a group heading, is left out). */
export function listRows(doc) {
  const list = doc.getElementById('list');
  if (!list) return [];
  return [...list.querySelectorAll('li.prow, tr.sub-row')].filter((r) => (r.nodeName === 'TR' ? true : !!r.querySelector('.prow-btn')));
}

/** The row after (step 1) or before (step -1) the open one; none open: the first (↓) or the last (↑). */
export function nextRow(rows, step) {
  if (!rows.length) return null;
  const i = rows.findIndex((r) => hasClass(r, 'current'));
  if (i < 0) return step > 0 ? rows[0] : rows[rows.length - 1];
  return rows[Math.min(rows.length - 1, Math.max(0, i + step))];
}

/**
 * A key on the team / staff pages. `page` = the page object (createTeam / createStaff: state, back, go, open);
 * `say` shows a short message. Returns true when the key was used.
 */
export function pageKey(e, doc, page, { say = () => {}, owner = false } = {}) {
  if (!page || e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key;
  const st = page.state || {};
  if (k === 'Escape') {
    const open = doc.getElementById('viewer');
    if (open && !open.hidden) { open.hidden = true; open.classList.remove('sheet-mode'); open.replaceChildren(); return true; } // a photo on top closes first (owner, 29 Oct)
    if (isTyping(doc.activeElement)) { doc.activeElement.blur(); return true; }
    if (st.rowMenu) { st.rowMenu = null; page.render(); return true; } // (the right-click menu first)
    if (st.menuOpen) { st.menuOpen = false; page.render(); return true; }
    if (st.sel && page.back) { page.back(); return true; }
    return false;
  }
  if (isTyping(doc.activeElement)) return false;
  const viewer = doc.getElementById('viewer');
  if (viewer && !viewer.hidden) return false; // a photo is open on top
  if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'j' || k === 'k') {
    const focused = doc.activeElement;
    if (focused && (focused.type === 'radio' || focused.nodeName === 'SUMMARY')) return false;
    const row = nextRow(listRows(doc), k === 'ArrowDown' || k === 'j' ? 1 : -1);
    if (!row) return false; // nothing to move through: the page scrolls
    e.preventDefault();
    if (hasClass(row, 'current')) return true; // (at the first / last already)
    const btn = row.nodeName === 'TR' ? row : row.querySelector('.prow-btn');
    btn.click(); // opens it, as a click does
    const now = listRows(doc).find((r) => hasClass(r, 'current')) || row;
    if (now.scrollIntoView) now.scrollIntoView({ block: 'nearest' });
    return true;
  }
  if (e.repeat) return false;
  if (k === '/') {
    const box = doc.querySelector('#menu input.search, #list input.search, #list input[type="search"]');
    if (box && box.offsetParent !== null) { e.preventDefault(); box.focus(); return true; }
    if (page.go) { e.preventDefault(); page.go('search'); return true; }
    return false;
  }
  if (k === 'n' && owner && page.open) { e.preventDefault(); page.open('give'); return true; }
  if (PAGE_LETTERS[k]) {
    if (owner && page.go) { e.preventDefault(); if (k === 'a') st.closed = false; if (k === 't') st.personFilter = 0; page.go(PAGE_LETTERS[k]); return true; }
    if (!owner && k !== 'f' && page.act && page.act.show) { e.preventDefault(); page.act.show(PAGE_LETTERS[k]); return true; }
  }
  if (k === '?') { e.preventDefault(); say(owner ? PAGE_KEYS_HELP : STAFF_KEYS_HELP, 8000); return true; }
  return false;
}
