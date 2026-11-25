// iPhone photos (.heic / .heif): Chrome cannot show them, so they are turned into JPEG pictures here.
// Safari can read them itself; elsewhere the decoder (vendor/libheif.js, libheif 1.19.8, LGPL-3.0) is loaded
// the first time one is needed (it is big, so never before), from this site only.

/** Is this an iPhone photo (by its type, or its name when the browser gives no type)? */
export const isHeic = (name = '', type = '') => /^image\/hei[cf]/i.test(type) || /\.hei[cf]$/i.test(String(name));

let loading = null;
/** The decoder, loaded once: a <script> from this site (the page's rules allow only that). */
function decoder() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const done = () => { const f = globalThis.libheif; if (!f) { reject(new Error('The photo reader did not load')); return; } Promise.resolve(typeof f === 'function' ? f() : f).then(resolve, reject); };
      if (globalThis.libheif) { done(); return; }
      const s = document.createElement('script');
      s.src = new URL('../vendor/libheif.js', import.meta.url).href;
      s.onload = done;
      s.onerror = () => { loading = null; reject(new Error('The photo reader did not load')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** The first picture of a HEIC file as pixels { data, width, height }, with the decoder. */
async function decodePixels(bytes) {
  const lib = await decoder();
  const images = new lib.HeifDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (!images || !images.length) throw new Error('No picture in this file');
  const im = images[0];
  const width = im.get_width(), height = im.get_height();
  return new Promise((resolve, reject) => im.display({ data: new Uint8ClampedArray(width * height * 4), width, height },
    (out) => (out ? resolve(out) : reject(new Error('Could not read this photo')))));
}

/**
 * A HEIC photo as a JPEG Blob, at most maxSide pixels on its longest side (0 = as it is).
 * Safari reads it itself (createImageBitmap); other browsers use the decoder.
 */
export async function heicToJpeg(blobOrBytes, maxSide = 0) {
  const blob = blobOrBytes instanceof Blob ? blobOrBytes : new Blob([blobOrBytes]);
  let src = null, w = 0, hgt = 0;
  try { src = await createImageBitmap(blob); w = src.width; hgt = src.height; } catch { src = null; }
  if (!src) {
    const px = await decodePixels(new Uint8Array(await blob.arrayBuffer()));
    const c = document.createElement('canvas');
    c.width = px.width; c.height = px.height;
    c.getContext('2d').putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
    src = c; w = px.width; hgt = px.height;
  }
  const s = maxSide ? Math.min(1, maxSide / Math.max(w, hgt)) : 1;
  const out = document.createElement('canvas');
  out.width = Math.round(w * s); out.height = Math.round(hgt * s);
  const g = out.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
  g.drawImage(src, 0, 0, out.width, out.height);
  if (src.close) src.close();
  const jpeg = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.85));
  if (!jpeg) throw new Error('Could not make the picture');
  return jpeg;
}

/** "IMG_0878.HEIC" → "IMG_0878.jpg". */
export const jpegName = (name) => String(name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';

/** A photo (any image type, or an iPhone photo the browser gave no type to): it goes in as a picture, not a file. */
export const isPhoto = (f) => !!f && (String(f.type || '').startsWith('image/') || isHeic(f.name));
