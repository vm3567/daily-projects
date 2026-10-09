// File upload and the in-app viewer. See PLAN.md section 13 and section 25 "Files".

import { h, fmtSize } from './dom.js';
import { bytesToBase64 } from '../github.js';
import { newId } from '../ops.js';
import { MAX_FILE_BYTES, IMAGE_MAX_WIDTH } from '../config.js';

const VIEW_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
};

/** The type to show the file as, or null if it may only be downloaded. Never SVG or HTML. */
export function viewableType(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  return VIEW_TYPES[ext] || null;
}

async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|heic|heif|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width <= IMAGE_MAX_WIDTH) { bmp.close?.(); return file; }
    const scale = IMAGE_MAX_WIDTH / bmp.width;
    const canvas = document.createElement('canvas');
    canvas.width = IMAGE_MAX_WIDTH;
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/** Upload files to the data repository and add them to the project. */
export async function uploadFiles(ctx, projectId, fileList) {
  const { store, toast } = ctx;
  for (const original of fileList) {
    if (!store.canEdit()) { toast('No connection — file not added'); return; }
    const file = await shrinkImage(original);
    if (file.size > MAX_FILE_BYTES) {
      toast(`"${original.name}" is bigger than 25 MB, so it was not added.`);
      continue;
    }
    toast(`Uploading "${file.name}"…`, 60000);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sha = await store.repo.createBlobBase64(bytesToBase64(bytes));
      store.dispatch('addFile', {
        projectId, fileId: newId(), name: file.name || 'file', sha, size: file.size, type: file.type || '',
      });
      toast(`Added "${file.name}"`);
    } catch (e) {
      toast(`Could not upload "${file.name}": ${e.message}`);
    }
  }
}

let currentUrl = null;

export function closeViewer() {
  const v = document.getElementById('viewer');
  v.hidden = true;
  v.replaceChildren();
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
}

/** Open a file inside the app. Images and PDF are shown; everything else is download only. */
export async function openFile(ctx, file) {
  const v = document.getElementById('viewer');
  closeViewer();
  v.hidden = false;
  const close = h('button', { class: 'btn', onClick: closeViewer }, 'Close');
  v.replaceChildren(h('div', { class: 'viewer-bar' }, h('strong', { class: 'viewer-name' }, file.name), close),
    h('div', { class: 'viewer-body' }, h('p', { class: 'muted' }, 'Loading…')));
  try {
    const bytes = await ctx.store.repo.blobBytes(file.sha);
    const type = viewableType(file.name);
    const blob = new Blob([bytes], { type: type || 'application/octet-stream' });
    currentUrl = URL.createObjectURL(blob);
    const download = h('a', { class: 'btn', href: currentUrl, download: file.name }, 'Download');
    let body;
    if (type && type.startsWith('image/')) body = h('img', { src: currentUrl, alt: file.name });
    else if (type === 'application/pdf') body = h('iframe', { src: currentUrl, title: file.name });
    else {
      body = h('div', { class: 'viewer-download' },
        h('p', null, `${file.name} (${fmtSize(file.size)})`),
        h('p', { class: 'muted' }, 'This kind of file opens in its own app. Download it to open.'),
        h('a', { class: 'btn primary', href: currentUrl, download: file.name }, 'Download'));
    }
    v.replaceChildren(h('div', { class: 'viewer-bar' }, h('strong', { class: 'viewer-name' }, file.name), download, close),
      h('div', { class: 'viewer-body' }, body));
  } catch (e) {
    v.replaceChildren(h('div', { class: 'viewer-bar' }, h('strong', null, file.name), close),
      h('div', { class: 'viewer-body' }, h('p', null, `Could not open the file: ${e.message}`)));
  }
}
