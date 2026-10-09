// Tiny DOM helpers.
// h() builds elements with text only (never innerHTML), so typed text can never run as code.
// morph() updates the page in place, so a box being typed in keeps its text and focus,
// and a button being clicked is not swapped out from under the finger.

const EVENTS = ['click', 'change', 'input', 'keydown', 'submit', 'dragover', 'dragleave', 'drop', 'focusout'];

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        (el.__on ||= {})[k.slice(2).toLowerCase()] = v;
      } else if (k === 'class') el.className = v;
      else if (k === 'key') el.dataset.key = v;
      else if (k === 'value') { el.value = v; el.setAttribute('data-value', ''); el.__value = v; }
      else if (k === 'checked') { el.checked = true; el.setAttribute('checked', ''); }
      else if (k === 'text') el.textContent = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  if (el.nodeName === 'SELECT' && '__value' in el) el.value = el.__value;
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** One listener per event type on the document; finds the nearest element with a handler. */
export function installEvents(root) {
  for (const type of EVENTS) {
    root.addEventListener(type, (e) => {
      let el = e.target;
      while (el && el !== root.parentNode) {
        const fn = el.__on && el.__on[type];
        if (fn) { fn(e, el); return; }
        el = el.parentNode;
      }
    }, type === 'focusout');
  }
}

function sameKind(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  if (a.nodeType !== 1) return true;
  if ((a.dataset.key ?? null) !== (b.dataset.key ?? null)) return false;
  if (a.nodeName === 'INPUT' && a.type !== b.type) return false;
  return true;
}

/** Make `from` look like `to`, changing as little as possible. */
export function morph(from, to) {
  if (!sameKind(from, to)) { from.replaceWith(to); return; }
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  // attributes
  for (const { name } of [...from.attributes]) if (name !== 'style' && !to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (name !== 'style' && from.getAttribute(name) !== value) from.setAttribute(name, value);
  // Styles are copied through the style object: the page's safety rules (CSP) block style attributes.
  if (from.style && from.style.cssText !== to.style.cssText) from.style.cssText = to.style.cssText;
  from.__on = to.__on;
  // form values: never touch the box being typed in
  const focused = from === document.activeElement;
  if ('__value' in to) { // only boxes the app controls; never wipe a draft the user is typing
    const v = to.__value;
    if (!focused && from.value !== v) from.value = v;
    from.__value = v;
  }
  if (from.nodeName === 'INPUT' && (from.type === 'checkbox' || from.type === 'radio')) from.checked = to.hasAttribute('checked');
  if (from.nodeName === 'SELECT') {
    morphChildren(from, to);
    if ('__value' in to && from.value !== to.__value) from.value = to.__value;
    return;
  }
  if (from.nodeName === 'TEXTAREA') return; // its text is its value
  morphChildren(from, to);
}

function keyOf(n) {
  return n.nodeType === 1 ? (n.dataset.key ?? null) : null;
}

/**
 * Match old children to new ones (by key, else by order among same-kind nodes),
 * remove the old ones that are gone FIRST, then put the rest in place.
 * Removing first means a box being typed in usually never has to move (moving it would lose focus).
 */
function morphChildren(from, to) {
  const a = [...from.childNodes];
  const b = [...to.childNodes];
  const byKey = new Map();
  for (const n of a) { const k = keyOf(n); if (k !== null) byKey.set(k, n); }
  const unkeyed = a.filter((n) => keyOf(n) === null);
  const used = new Set();
  const plan = [];
  let u = 0;
  for (const nb of b) {
    const k = keyOf(nb);
    let m = null;
    if (k !== null) {
      m = byKey.get(k) || null;
      if (m && (used.has(m) || !sameKind(m, nb))) m = null;
    } else {
      for (let j = u; j < unkeyed.length; j++) {
        if (sameKind(unkeyed[j], nb)) { m = unkeyed[j]; u = j + 1; break; }
      }
    }
    if (m) used.add(m);
    plan.push([m, nb]);
  }
  for (const n of a) if (!used.has(n)) n.remove();
  plan.forEach(([m, nb], i) => {
    const at = from.childNodes[i] || null;
    if (m) {
      if (m !== at) from.insertBefore(m, at);
      morph(m, nb);
    } else {
      from.insertBefore(nb, at);
    }
  });
}

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** "15 Oct" for "2026-10-15". */
export function fmtDay(date) {
  return date ? dayFmt.format(new Date(date + 'T00:00:00Z')) : '';
}
export function fmtLongDay(date) {
  return longDayFmt.format(new Date(date + 'T00:00:00Z'));
}
export function fmtTime(iso) {
  return timeFmt.format(new Date(iso));
}
