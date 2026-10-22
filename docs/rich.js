// Rich updates ("What happened today?" with tables, lists, bold, photos).
// A small tag-whitelist cleaner that works without a browser (the tests run it in Node), used when an update
// is SAVED and again when it is SHOWN. Only these tags survive; every other tag is dropped (its words kept),
// and scripts, styles and frames go completely. No style, class or on… attributes ever. Photos are never
// stored in the note: <img data-file="ID"> points at the update's own uploaded photo.

export const RICH_MAX = 100 * 1024; // the cleaned HTML of one update
export const RAW_MAX = 2 * 1024 * 1024; // pasted HTML bigger than this is not even read

const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img']);
// other block tags become a paragraph, so their lines stay apart
const AS_P = new Set(['div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'aside', 'main', 'nav', 'figure', 'figcaption', 'address', 'dt', 'dd', 'caption', 'center', 'hr']);
const ALIAS = { tfoot: 'tbody' };
// dropped with everything inside them
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'textarea', 'select', 'frame', 'frameset', 'xml', 'applet', 'canvas', 'audio', 'video', 'button', 'form', 'input', 'option', 'xmp', 'noembed', 'noframes', 'plaintext']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'iframe', 'xmp', 'noembed', 'noframes', 'noscript', 'template', 'svg', 'math', 'object', 'select']);
const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'col', 'area', 'base', 'wbr', 'source', 'embed', 'param', 'track', 'keygen']);
const MAX_DEPTH = 60;
const FILE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', deg: '°', times: '×', divide: '÷', middot: '·', bull: '•', hellip: '…',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£',
  plusmn: '±', micro: 'µ', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', laquo: '«', raquo: '»', ensp: ' ', emsp: ' ', thinsp: ' ',
};
function decode(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8}\d?);?/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }
    const v = ENT[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

function parseAttrs(s) {
  const out = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** Read HTML (any HTML, even broken) into a tree: { tag, attrs, children } and strings. Nothing is cleaned yet. */
function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const popTo = (i) => { stack.length = i; };
  const findOpen = (names, stopAt) => { // the nearest open element named one of `names`, not past a `stopAt` one
    for (let i = stack.length - 1; i > 0; i--) {
      if (names.includes(stack[i].tag)) return i;
      if (stopAt.includes(stack[i].tag)) return -1;
    }
    return -1;
  };
  const s = String(html);
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { top().children.push(decode(s.slice(i))); break; }
    if (lt > i) top().children.push(decode(s.slice(i, lt)));
    i = lt;
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s[i + 1] === '!' || s[i + 1] === '?') { const e = s.indexOf('>', i); i = e < 0 ? s.length : e + 1; continue; } // doctype, CDATA, <?xml
    const end = /^<\/([a-zA-Z][\w:-]*)[^>]*>/.exec(s.slice(i, i + 200));
    if (end) {
      const tag = end[1].toLowerCase();
      for (let j = stack.length - 1; j > 0; j--) if (stack[j].tag === tag) { popTo(j); break; }
      i += end[0].length;
      continue;
    }
    const start = /^<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(s.slice(i));
    if (!start) { top().children.push('<'); i += 1; continue; } // a lone "<" is just text
    i += start[0].length;
    const tag = start[1].toLowerCase();
    if (RAW_TEXT.has(tag)) { // skip to its end tag: what is inside is never shown
      const close = s.toLowerCase().indexOf('</' + tag, i);
      if (close < 0) { i = s.length; continue; }
      const gt = s.indexOf('>', close);
      i = gt < 0 ? s.length : gt + 1;
      continue;
    }
    // tags that close an open one of the same kind (a new list item, row, cell or paragraph)
    if (tag === 'li') { const j = findOpen(['li'], ['ul', 'ol', 'table']); if (j > 0) popTo(j); }
    else if (tag === 'td' || tag === 'th') { const j = findOpen(['td', 'th'], ['tr', 'table']); if (j > 0) popTo(j); }
    else if (tag === 'tr') { const j = findOpen(['tr'], ['table', 'thead', 'tbody', 'tfoot']); if (j > 0) popTo(j); }
    else if (tag === 'p') { const j = findOpen(['p'], ['li', 'td', 'th', 'table', 'div', 'blockquote']); if (j > 0) popTo(j); }
    if (stack.length > MAX_DEPTH) continue; // far too deep: the tag is dropped, its words are kept
    const el = { tag, attrs: parseAttrs(start[2]), children: [] };
    top().children.push(el);
    if (!VOID.has(tag) && !/\/\s*$/.test(start[2])) stack.push(el);
  }
  return root;
}

const okHref = (v) => {
  const u = String(v || '').trim();
  return /^(https?:\/\/|mailto:)/i.test(u) && !/[\u0000-\u001f\s"<>]/.test(u) ? u : null;
};

/** Keep only the allowed tags and attributes. Returns a clean tree (same shape as parse). */
function clean(node, depth = 0, inP = false) {
  const out = [];
  for (const c of node.children) {
    if (typeof c === 'string') { out.push(c); continue; }
    let tag = ALIAS[c.tag] || (AS_P.has(c.tag) ? 'p' : c.tag);
    if (DROP.has(tag)) continue;
    const kids = clean(c, depth + 1, inP || tag === 'p');
    if (c.tag === 'hr') { out.push({ tag: 'br', attrs: {}, children: [] }); continue; }
    if (!ALLOWED.has(tag) || depth >= MAX_DEPTH) { out.push(...kids); continue; } // other tags: keep their words
    // Google Docs wraps the whole copy in <b style="font-weight:normal" id="docs-internal-guid-…">: not bold, keep its words only
    if ((tag === 'b' || tag === 'strong') && (/^docs-internal-guid/i.test(c.attrs.id || '') || /font-weight\s*:\s*(normal|[1-4]00)\b/i.test(c.attrs.style || ''))) { out.push(...kids); continue; }
    if (tag === 'p' && inP) { out.push({ tag: 'br', attrs: {}, children: [] }, ...kids); continue; } // never a paragraph inside a paragraph
    const attrs = {};
    if (tag === 'img') {
      const id = c.attrs['data-file'];
      if (!id || !FILE_ID.test(id)) continue; // only our own photos (never a picture from the web, or base64)
      out.push({ tag, attrs: { 'data-file': id }, children: [] });
      continue;
    }
    if (tag === 'a') {
      const href = okHref(c.attrs.href);
      if (!href) { out.push(...kids); continue; }
      attrs.href = href; attrs.rel = 'noopener noreferrer'; attrs.target = '_blank';
    }
    if (tag === 'br') { out.push({ tag, attrs, children: [] }); continue; }
    // spaces between rows, cells and list items are not words
    const kept = ['table', 'thead', 'tbody', 'tr', 'ul', 'ol'].includes(tag) ? kids.filter((k) => typeof k !== 'string' || k.trim()) : kids;
    out.push({ tag, attrs, children: kept });
  }
  return out;
}

function serialize(nodes) {
  let s = '';
  for (const n of nodes) {
    if (typeof n === 'string') { s += esc(n); continue; }
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
    s += VOID.has(n.tag) ? `<${n.tag}${attrs}>` : `<${n.tag}${attrs}>${serialize(n.children)}</${n.tag}>`;
  }
  return s;
}

/** The clean tree of an update's HTML (for drawing it with h(), never innerHTML). */
export function richTree(html) {
  const s = String(html ?? '');
  if (s.length > RAW_MAX) return [];
  return clean(parse(s));
}

/** Clean HTML: only the allowed tags and attributes are left. Safe to call again on its own output. */
export function sanitizeRich(html) {
  return serialize(richTree(html)).trim();
}

/** The photo ids used inside an update (<img data-file="ID">). */
export function richFileIds(html) {
  const ids = [];
  const walk = (nodes) => { for (const n of nodes) if (typeof n !== 'string') { if (n.tag === 'img') ids.push(n.attrs['data-file']); walk(n.children); } };
  walk(richTree(html));
  return ids;
}

/**
 * Photos inside pasted HTML (<img data-file="ID">, e.g. an update copied from another task): `keep(id)` true = this
 * box's own photo, kept as it is; otherwise `bring(id)` gives a new id for a copy of it here (or null: the photo is
 * left out, it would only show a grey 📷 that can never open). Returns { html, dropped }.
 */
export function remapPhotos(html, keep, bring) {
  let dropped = 0;
  const map = new Map();
  const walk = (nodes) => nodes.flatMap((n) => {
    if (typeof n === 'string') return [n];
    if (n.tag !== 'img') return [{ ...n, children: walk(n.children) }];
    const id = n.attrs['data-file'];
    if (keep(id)) return [n];
    if (!map.has(id)) map.set(id, bring(id) || null);
    const to = map.get(id);
    if (!to || !FILE_ID.test(to)) { dropped++; return []; }
    return [{ ...n, attrs: { 'data-file': to } }];
  });
  return { html: serialize(walk(richTree(html))).trim(), dropped };
}

/** True when the HTML has more than plain words and line breaks (a table, list, bold, link or photo). */
export function isRich(html) {
  let rich = false;
  const walk = (nodes) => { for (const n of nodes) if (typeof n !== 'string') { if (!['p', 'br'].includes(n.tag)) rich = true; walk(n.children); } };
  walk(richTree(html));
  return rich || htmlToText(html).includes('\n');
}

const BLOCK = new Set(['p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr']);

/**
 * The plain words of an update (for search, emails, the team app, summaries…):
 * a table row → "a | b | c", a list item → "• item" (numbered list "1. item"), paragraphs and <br> → new lines.
 */
export function htmlToText(html) {
  const lines = [];
  let cur = '';
  const flush = () => { lines.push(cur.replace(/[ \t\u00a0]+/g, ' ').trim()); cur = ''; };
  const inline = (nodes) => { // the words inside one cell / item, on one line
    let t = '';
    for (const n of nodes) {
      if (typeof n === 'string') t += n.replace(/\s+/g, ' ');
      else if (n.tag === 'br') t += ' ';
      else if (n.tag === 'a') { const w = inline(n.children).trim(); const href = n.attrs.href.replace(/^mailto:/i, ''); t += w && !w.includes(href) ? `${w} (${href})` : w || href; }
      else t += ((BLOCK.has(n.tag) || n.tag === 'td' || n.tag === 'th') && t ? ' ' : '') + inline(n.children);
    }
    return t;
  };
  const walk = (nodes, list = null) => {
    let num = 0;
    for (const n of nodes) {
      if (typeof n === 'string') { cur += n.replace(/\s+/g, ' '); continue; }
      const { tag } = n;
      if (tag === 'br') { flush(); continue; }
      if (tag === 'a') { cur += inline([n]); continue; }
      if (tag === 'tr') {
        if (cur.trim()) flush();
        const cells = n.children.filter((c) => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th')).map((c) => inline(c.children).replace(/\s+/g, ' ').trim());
        if (cells.some(Boolean)) { cur = cells.join(' | '); flush(); }
        continue;
      }
      if (tag === 'li') {
        if (cur.trim()) flush();
        num += 1;
        cur = list === 'ol' ? `${num}. ` : '• ';
        walk(n.children.filter((c) => typeof c === 'string' || !['ul', 'ol'].includes(c.tag)));
        flush();
        walk(n.children.filter((c) => typeof c !== 'string' && ['ul', 'ol'].includes(c.tag)));
        continue;
      }
      if (BLOCK.has(tag)) {
        if (cur.trim()) flush();
        walk(n.children, tag === 'ul' || tag === 'ol' ? tag : list);
        if (cur.trim()) flush();
        continue;
      }
      walk(n.children, list); // b, i, u, strong, em, td outside a row, img (nothing)
    }
  };
  walk(richTree(html));
  if (cur.trim()) flush();
  const out = [];
  for (const l of lines) if (l || (out.length && out[out.length - 1])) out.push(l); // at most one empty line in a row
  return out.join('\n').trim();
}

/** Plain words as safe HTML (to open an old plain update in the rich box). */
export function textToHtml(text) {
  return String(text ?? '').split('\n').map((l) => esc(l)).join('<br>');
}

/** A table to put in the box: 3 × 3 empty cells. */
export const TABLE_HTML = `<table><tbody>${'<tr><td><br></td><td><br></td><td><br></td></tr>'.repeat(3)}</tbody></table><p><br></p>`;

/**
 * What a key press does in the update box:
 *   'save'     — Enter on a quick one-line note (nothing rich inside, not in a list or table)
 *   'saveDone' — Ctrl/⌘+Enter on a quick note: save and tick the step (as before)
 *   'saveOnly' — Ctrl/⌘+Enter when the box has a table, list… (Enter there makes a new line)
 *   null       — let the box do its normal thing (a new line, a new list item…)
 */
export function enterAction({ key, shift = false, mod = false, inBlock = false, rich = false }) {
  if (key !== 'Enter') return null;
  if (mod) return rich || inBlock ? 'saveOnly' : 'saveDone';
  if (shift || inBlock || rich) return null;
  return 'save';
}
