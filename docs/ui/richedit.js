// Drawing a rich update (table, list, bold, photos) and the small toolbar helpers of the rich update box.
// Saved HTML is cleaned again (rich.js) and drawn with h() — never innerHTML — so nothing in it can run.

import { h, HAS_KEYBOARD } from './dom.js';
import { richTree, sanitizeRich, isRich, htmlToText, richFileIds, remapPhotos, TABLE_HTML, RICH_MAX, RAW_MAX } from '../rich.js';
import { uploadBlob, thumbUrl } from './files.js';
import { newId } from '../ops.js';

const LINK_OK = /^(https?:\/\/|mailto:)/i;

/** Page elements for an update's HTML. `photo(fileId)` gives the element for <img data-file> (or null). */
export function richNodes(html, photo = () => null) {
  const build = (nodes) => nodes.map((n) => {
    if (typeof n === 'string') return n;
    if (n.tag === 'img') return photo(n.attrs['data-file']);
    if (n.tag === 'a') return h('a', { href: n.attrs.href, rel: n.attrs.rel, target: n.attrs.target }, ...build(n.children));
    return h(n.tag, null, ...build(n.children));
  });
  return build(richTree(html));
}

/** A saved rich update, ready to show (the rich-note class styles its tables, lists and photos). */
export function richView(html, photo, key = null) {
  return h('div', { class: 'rich-note', key }, ...richNodes(html, photo));
}

/** The box's HTML right now (the browser's), cleaned. */
export function editorHtml(el) {
  return sanitizeRich(el ? el.innerHTML || '' : '');
}

/** True when the box holds a table, list, bold, link, photo or several lines (then Enter is a new line). */
export function editorIsRich(el) {
  return isRich(editorHtml(el));
}

/** Is the cursor inside a list item or a table cell of the box? */
export function cursorInBlock(el) {
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  let n = sel ? sel.anchorNode : null;
  while (n && n !== el) {
    if (/^(LI|TD|TH)$/.test(n.nodeName)) return true;
    n = n.parentNode;
  }
  return false;
}

/** Run a browser editing command in the box (bold, a list, a table…), keeping the box in focus. */
export function editCommand(el, cmd, value = null) {
  if (!el) return false;
  if (el.focus) el.focus();
  if (typeof document.execCommand !== 'function') return false;
  return document.execCommand(cmd, false, value);
}

/** Put (clean) HTML where the cursor is; if the box is not in focus, at its end. */
export function insertHtml(el, html) {
  if (!el || !html) return;
  const focused = typeof document.activeElement !== 'undefined' && document.activeElement === el;
  if (!focused && el.appendChild) { // not typing in it: add at the end
    for (const n of richNodes(html, (id) => h('img', { 'data-file': id, class: 'rich-photo', alt: '📷' }))) el.appendChild(typeof n === 'string' ? document.createTextNode(n) : n);
    return;
  }
  editCommand(el, 'insertHTML', html);
}

export const insertTable = (el) => editCommand(el, 'insertHTML', TABLE_HTML);

/** 🔗 Link: asks for the address; the chosen words become the link (or the address itself). */
export function insertLink(el, ask = (q) => prompt(q, 'https://')) {
  const url = (ask('Link address (https://…)') || '').trim();
  if (!url || url === 'https://') return false;
  if (!LINK_OK.test(url)) { alert('Only links that start with https://, http:// or mailto: can be added.'); return false; }
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  if (sel && !sel.isCollapsed && el && el.contains && el.contains(sel.anchorNode)) return editCommand(el, 'createLink', url);
  return editCommand(el, 'insertHTML', sanitizeRich(`<a href="${url.replace(/&/g, '&amp;').replace(/"/g, '%22')}">${url.replace(/[<>&]/g, '')}</a>&nbsp;`));
}

/** The rich box on the page with this key (null when it is not drawn). */
export function findEditor(key) {
  return typeof document.querySelector === 'function' ? document.querySelector(`[data-key="${key}"]`) : null;
}

/** Put a photo (<img data-file>, with a small preview picture) where the cursor is, or at the end of the box. */
export function insertPhoto(el, fileId, src = '') {
  if (!el) return false;
  const focused = typeof document.activeElement !== 'undefined' && document.activeElement === el;
  if (focused && typeof document.execCommand === 'function') {
    return document.execCommand('insertHTML', false, `<img data-file="${fileId}" class="rich-photo" alt="📷"${/^blob:[\w:/.%-]+$/.test(src) ? ` src="${src}"` : ''}>`);
  }
  el.appendChild(h('img', { 'data-file': fileId, class: 'rich-photo', alt: '📷', src: src || undefined }));
  return true;
}

/** A pasted screenshot is called "image.png": give it a clearer name with the time. */
export function namePasted(images) {
  const stamp = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return images.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${stamp}${i ? '-' + i : ''}.png`, { type: f.type })));
}

/**
 * Upload photos for a draft (the update box or the new-task box). `inline`: also shown inside the box where the cursor is
 * (a pasted screenshot); otherwise a 📷 chip under the box. Counts uploads in progress, so Save / Create can wait for them.
 */
export async function addDraftPhotos(ctx, d, files, key, { inline = false } = {}) {
  d.uploading = (d.uploading || 0) + files.length;
  ctx.render();
  for (const f of files) {
    try {
      const up = await uploadBlob(ctx, f);
      if (up) {
        if (inline) {
          up.inline = true;
          try { up.preview = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : ''; } catch { up.preview = ''; }
          const el = findEditor(key);
          if (el && insertPhoto(el, up.fileId, up.preview)) d.html = el.innerHTML || `${d.html || ''}<img data-file="${up.fileId}">`;
          else d.html = `${d.html || ''}<img data-file="${up.fileId}">`; // the box is not on screen: it shows when it is drawn
          d.rich = true;
        }
        (d.photos ||= []).push(up);
      }
    } finally {
      d.uploading = Math.max(0, (d.uploading || 1) - 1);
      ctx.render();
    }
  }
}

/**
 * ⌘V / Ctrl+V in a rich box: a screenshot (an image with no words) is uploaded and shown in the box;
 * HTML (Excel, Outlook, Word, a web page) is pasted cleaned — tables, bold, lists and links kept; plain words stay plain.
 */
export function pasteRich(ctx, d, e, el, key, changed, otherFiles = null, ownFiles = null) {
  const cd = e && e.clipboardData;
  if (!cd) return;
  const files = [...(cd.files || [])];
  const plain = cd.getData('text/plain') || '';
  const html = cd.getData('text/html') || '';
  if (files.length && !plain.trim()) {
    e.preventDefault();
    const images = files.filter((f) => (f.type || '').startsWith('image/'));
    const others = files.filter((f) => !(f.type || '').startsWith('image/'));
    if (images.length) addDraftPhotos(ctx, d, namePasted(images), key, { inline: true });
    if (others.length) { if (otherFiles) otherFiles(others); else ctx.toast('Only photos can be pasted here', 2500); }
    return;
  }
  if (!html.trim() && !plain) return;
  e.preventDefault(); // (cells from Excel come with a picture of them too: the cells win)
  let clean = html.trim() ? sanitizeRich(html) : '';
  if (clean.includes('<img')) clean = pastedPhotos(ctx, d, clean, ownFiles);
  if (clean.trim()) insertHtml(el, clean);
  else if (plain) { // no HTML, too much of it (a big Excel copy) or nothing left once cleaned: the plain words, never nothing
    if (html.length > RAW_MAX) ctx.toast('Too big to paste as a table: pasted as plain words', 4000);
    editCommand(el, 'insertText', plain);
  } else { ctx.toast('Nothing could be pasted from this', 2500); return; }
  if (changed) changed(el);
}

/**
 * Photos in pasted HTML (an update copied from another task): this box's own photos stay; a photo of another task
 * is brought along as a new photo of this one (the same saved picture, its own id); one that is nowhere is left out, with a note.
 */
export function pastedPhotos(ctx, d, html, files = null) {
  const own = new Set([...(files || []).map((f) => f.id), ...(d.photos || []).map((ph) => ph.fileId)]);
  const projects = (ctx.store && ctx.store.view && ctx.store.view.data && ctx.store.view.data.projects) || [];
  const bring = (id) => {
    let f = null;
    for (const p of projects) { f = (p.files || []).find((x) => x.id === id && x.sha); if (f) break; }
    if (!f) return null;
    const ph = { fileId: newId(), name: f.name || 'photo.jpg', sha: f.sha, size: f.size || 0, type: f.type || '', inline: true, preview: thumbUrl(f) };
    (d.photos ||= []).push(ph);
    d.rich = true;
    return ph.fileId;
  };
  const r = remapPhotos(html, (id) => own.has(id), bring);
  if (r.dropped) ctx.toast(`${r.dropped} copied photo${r.dropped > 1 ? 's' : ''} could not come along — add ${r.dropped > 1 ? 'them' : 'it'} again with 📷`, 4000);
  return r.html;
}

const photoWord = (n) => `📷 ${n} photo${n > 1 ? 's' : ''}`;

/** What a draft holds now: clean html, its plain words, rich or not, and the photos to keep (a pasted photo deleted from the box is dropped). */
export function readDraft(d, el) {
  const raw = el ? String(el.innerHTML || '') : String(d.html || '');
  const html = el ? editorHtml(el) : sanitizeRich(d.html || '');
  const ids = new Set(richFileIds(html));
  const photos = (d.photos || []).filter((ph) => !ph.inline || ids.has(ph.fileId));
  return { html, text: htmlToText(html), rich: isRich(html), photos, tooBig: html.length > RICH_MAX || raw.length > RAW_MAX, photoWord: photoWord(photos.length) };
}

/** addFile's details of an uploaded photo (without the preview picture). */
export function photoArgs(ph) {
  const { preview, inline, ...rest } = ph;
  return rest;
}

/** Empty the draft and its box (after a save). */
export function clearDraft(d, el) {
  d.html = ''; d.photos = []; d.rich = false; d.uploading = 0;
  if (!el) return;
  if (typeof el.replaceChildren === 'function') el.replaceChildren();
  else if (el.childNodes) el.childNodes = [];
}

/** Fill the box with saved HTML (to change an update). */
export function fillEditor(el, html, photo) {
  if (!el) return;
  const nodes = richNodes(html, photo).map((n) => (typeof n === 'string' ? document.createTextNode(n) : n)).filter(Boolean);
  if (typeof el.replaceChildren === 'function') el.replaceChildren(...nodes);
  else { el.childNodes = []; for (const n of nodes) el.appendChild(n); }
}

/** The picture of a photo inside the box: the upload's own preview, or a saved photo's picture. */
function draftPhoto(d, files, id) {
  const ph = (d.photos || []).find((x) => x.fileId === id);
  const f = (files || []).find((x) => x.id === id);
  return h('img', { 'data-file': id, class: 'rich-photo', alt: '📷', src: (ph && ph.preview) || thumbUrl(f) || undefined });
}

/**
 * The rich box with its toolbar: B · I · • List · 1. List · ⊞ Table · 📷 Photo · 🔗 Link.
 * `d` is the draft ({ html, photos, uploading, rich }); it survives redraws and switching pages.
 * Returns [toolbar, box, "uploading…", photo chips].
 */
export function richArea(ctx, d, { key, placeholder, title = null, files = [], onKey = null, otherFiles = null }) {
  const ed = () => findEditor(key);
  const changed = (el) => {
    if (!el) return;
    d.html = el.innerHTML || '';
    const r = editorIsRich(el);
    if (r !== !!d.rich) { d.rich = r; ctx.render(); } // the Enter hint changes
  };
  const tool = (label, tip, run) => h('button', {
    class: 'tool', type: 'button', title: tip, 'aria-label': tip,
    onClick: () => { const el = ed(); run(el); changed(el); },
  }, label);
  const chips = (d.photos || []).filter((ph) => !ph.inline);
  return [
    h('div', {
      class: 'rich-tools', role: 'toolbar', 'aria-label': 'Format the text', key: key + '-tools',
      // keep the cursor in the box while a button is pressed (not for 📷, which opens the photo picker)
      onMousedown: (e) => { const t = e && e.target; if (!(t && t.closest && t.closest('label'))) e.preventDefault(); },
    },
    tool('B', `Bold (${HAS_KEYBOARD ? 'Ctrl/⌘+B' : 'select words first'})`, (el) => editCommand(el, 'bold')),
    tool('I', 'Italic (slanted)', (el) => editCommand(el, 'italic')),
    tool('• List', 'List with dots', (el) => editCommand(el, 'insertUnorderedList')),
    tool('1. List', 'Numbered list', (el) => editCommand(el, 'insertOrderedList')),
    tool('⊞ Table', 'Add a table (3 rows × 3 columns)', (el) => insertTable(el)),
    h('label', { class: 'tool photo-btn', title: 'Take a photo or choose one' }, '📷 Photo',
      h('input', {
        type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden',
        onChange: (e, el) => { const picked = [...el.files]; el.value = ''; addDraftPhotos(ctx, d, picked, key); },
      })),
    tool('🔗 Link', 'Add a link', (el) => insertLink(el))),
    h('div', {
      class: 'rich-edit', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': placeholder,
      'data-placeholder': placeholder, key, title, spellcheck: 'true',
      onInput: (e, el) => changed(el),
      onKeydown: (e, el) => { if (onKey) onKey(e, el); },
      onPaste: (e, el) => pasteRich(ctx, d, e, el, key, changed, otherFiles, files),
    }, ...(d.html ? richNodes(d.html, (id) => draftPhoto(d, files, id)) : [])),
    d.uploading ? h('div', { class: 'muted small' }, `📷 Uploading ${d.uploading} photo${d.uploading > 1 ? 's' : ''}…`) : null,
    chips.length ? h('div', { class: 'photo-chips' }, chips.map((ph) => h('span', { class: 'tag photo', key: 'ph-' + ph.fileId },
      `📷 ${ph.name}`, h('button', { class: 'icon tiny-x', type: 'button', 'aria-label': 'Remove photo', onClick: () => { d.photos = d.photos.filter((x) => x !== ph); ctx.render(); } }, '✕')))) : null,
  ];
}

/** The photo element for <img data-file> in the box being edited (saved photos of that update included). */
export const editorPhoto = (d, files) => (id) => draftPhoto(d, files, id);

/**
 * Make a new task (inside a 📂 project when parentId is given) and, if the box has something, save it as the task's
 * first update — the same way as "What happened today?" (html + plain words + photos). Returns the new id, or null.
 */
export function createTaskWithNote(ctx, { name, parentId = null, d, editor = null }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  if (d.uploading) { ctx.toast('A photo is still uploading — try again in a moment', 2500); return null; }
  const r = readDraft(d, editor);
  if (r.tooBig) { ctx.toast('The notes are too big (over 100 KB). Make the table smaller, or add it as a file.', 5000); return null; }
  const projectId = newId();
  if (!ctx.store.dispatch('createProject', { projectId, name: clean, ...(parentId ? { parentId } : {}) })) return null;
  if (r.text || r.photos.length) {
    const noteId = newId();
    ctx.store.dispatch('addWorkNote', { projectId, noteId, text: r.text || r.photoWord, ...(r.rich ? { html: r.html } : {}) });
    for (const ph of r.photos) ctx.store.dispatch('addFile', { projectId, ...photoArgs(ph), noteId });
  }
  clearDraft(d, editor);
  d.name = '';
  return projectId;
}

/**
 * The "+ New task" box (instead of the browser's question box): a name, then the same rich box
 * (paste a screenshot, a table or words) and 📷 Photo. Enter in the name creates it when the box is empty; Esc closes.
 */
export function newTaskBox(ctx, d, { key, heading = null, extra = null, onCreate, onCancel }) {
  const richKey = key + '-rich';
  const ed = () => findEditor(richKey);
  const create = () => {
    const name = (d.name || '').trim();
    if (!name) { ctx.toast('Write the task name first', 2000); return; }
    onCreate(name, ed());
  };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); return true; } return false; };
  return h('form', { class: 'new-task-box', key, onSubmit: (e) => { e.preventDefault(); create(); } },
    heading ? h('strong', { class: 'new-task-head' }, heading) : null,
    h('div', { class: 'row' },
      h('input', {
        name: 'name', key: key + '-name', placeholder: 'Task name', 'aria-label': 'Task name', autocomplete: 'off', value: d.name || '',
        onInput: (e, el) => { d.name = el.value; },
        // a screenshot pasted while naming the task goes into this box's notes (never into the task open on the right)
        onPaste: (e) => { const cd = e && e.clipboardData; if (cd && (cd.files || []).length && !(cd.getData('text/plain') || '').trim()) pasteRich(ctx, d, e, ed(), richKey); },
        onKeydown: (e, el) => {
          if (esc(e) || e.key !== 'Enter') return;
          e.preventDefault();
          d.name = el.value;
          const r = readDraft(d, ed());
          if (!r.text && !r.photos.length && !r.rich) create();
          else { const box = ed(); if (box && box.focus) box.focus(); } // something in the box: Create (or Ctrl/⌘+Enter there) makes it
        },
      }),
      extra),
    ...richArea(ctx, d, {
      key: richKey, placeholder: 'Notes for its first update (optional) — paste a screenshot, a table or words',
      onKey: (e) => { if (esc(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); create(); } },
    }),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary small', type: 'submit' }, 'Create'),
      h('button', { class: 'btn small', type: 'button', onClick: () => onCancel() }, 'Cancel'),
      HAS_KEYBOARD ? h('span', { class: 'muted small' }, `Enter = Create · ${'Ctrl/⌘'}+Enter in the notes · Esc = Cancel`) : null));
}
