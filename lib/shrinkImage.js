// Pictures made smaller in the browser before they ride in a request body
// (client-only: FileReader, Image and a canvas; nothing here runs on the
// server, so any page or component may import it).
//
// Artwork goes to the show and submit routes inside the JSON body as a data
// URL, a third bigger than the file. Next's own limit on those routes is
// 10 MB, but Vercel refuses any function request body over 4.5 MB first —
// with its own 413 page, not JSON — so a poster and a still straight off a
// camera came back as "Something went wrong (413)". Each picture is shrunk
// to what the site shows (2000 px on its long side is more than any card,
// row or hero draws), and a save whose pictures still add up to more than
// BODY_BUDGET_BYTES is stopped here with PICTURES_TOO_LARGE.

// What the pictures of one save may add up to, as data URLs: under
// Vercel's 4.5 MB with room for the rest of the body.
export const BODY_BUDGET_BYTES = 4 * 1024 * 1024;

export const PICTURES_TOO_LARGE = 'Those pictures are too large together — try smaller files.';

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file && file.name ? file.name : 'that file'}.`));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('That file isn’t an image.'));
    img.onload = () => resolve(img);
    img.src = src;
  });
}

// A photo as a JPEG data URL no longer than `max` px on its long side (the
// locations' photos, headshots, Snippet photos, partner logos). A file
// already that small (and under 1.2 MB) goes as it is.
export function shrinkImage(file, max = 1600, quality = 0.85) {
  return readDataUrl(file).then((dataUrl) => loadImage(dataUrl).then((img) => {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 1200000) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }));
}

// One piece of artwork as a data URL: a poster, still, hero or season
// picture becomes a JPEG at most `max` px on its long side; a title image
// (`keepAlpha`: the name set as a picture, drawn over the art) stays a PNG
// so its transparency survives. A GIF goes as it is (a canvas would stop
// it moving), and so does a file that is already small enough.
export async function artworkDataUrl(file, { max = 2000, quality = 0.86, keepAlpha = false, smallBytes = 700 * 1024 } = {}) {
  if (!file) return null;
  const original = await readDataUrl(file);
  if (file.type === 'image/gif') return original;
  const img = await loadImage(original);
  const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
  if (scale === 1 && file.size <= smallBytes) return original;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
  // A PNG redrawn at the same size can come out bigger than it went in.
  return scale === 1 && out.length >= original.length ? original : out;
}

// What a data URL (or any string) adds to a JSON body, near enough.
export function bodyBytes(value) {
  return typeof value === 'string' ? value.length : 0;
}

// Every picture of one save, shrunk: entries [{ key, file, keepAlpha?, max? }]
// (a missing file is skipped). When together they would still be more than
// the budget (less `room`, what the rest of the body needs), all of them go
// again smaller; when even that is too much, it throws PICTURES_TOO_LARGE.
//   → { [key]: dataUrl }
export async function shrinkArtwork(entries, { budget = BODY_BUDGET_BYTES, room = 64 * 1024 } = {}) {
  const list = (entries || []).filter((e) => e && e.file);
  const pass = async (factor, quality) => {
    const out = {};
    for (const e of list) {
      out[e.key] = await artworkDataUrl(e.file, { max: Math.round((e.max || 2000) * factor), quality, keepAlpha: Boolean(e.keepAlpha), smallBytes: factor < 1 ? 0 : undefined });
    }
    return out;
  };
  const total = (out) => Object.values(out).reduce((sum, v) => sum + bodyBytes(v), 0);
  let out = await pass(1, 0.86);
  if (total(out) + room <= budget) return out;
  out = await pass(0.7, 0.75);
  if (total(out) + room <= budget) return out;
  throw new Error(PICTURES_TOO_LARGE);
}
