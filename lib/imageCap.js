// SERVER-ONLY. What an uploaded image's bytes are, and a copy capped to
// what a page draws.
//
// capImage (Jose, 2026-10-29, the safety features on posts): a Snippet's
// photo or cover is never kept or handed out near its original size. The
// longest side is brought down to MAX_SIDE, the EXIF block (camera, and
// a phone's GPS position) is dropped, a JPEG stays a JPEG, a PNG or WebP
// becomes WebP (alpha kept, far smaller), a GIF is left alone (an
// animation would be flattened). sharp is the resizer Next's image
// optimizer ships with, listed in package.json so it is always there.
// A buffer that can't be read comes back as it is; the caller's size
// ceiling still applies.
export const MAX_SIDE = 1600;

// JPEG, PNG, WebP or GIF by the magic bytes, whatever the file was
// called; null for anything else (SVG above all, which can carry script).
export function sniffImage(b) {
  if (!b || b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  if (b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8') return { ext: 'gif', type: 'image/gif' };
  return null;
}

export const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

// A 2:3 poster cut from the middle of a 16:9 frame (Accept on an
// application with no artwork, lib/creatorApplications.js): 600 × 900,
// JPEG. Falls back to the frame itself when sharp is unavailable.
export async function posterFromFrame(buffer, { width = 600, height = 900 } = {}) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch (err) {
    console.error('posterFromFrame: sharp unavailable:', err.message);
    return buffer;
  }
  try {
    return await sharp(buffer, { failOn: 'none' }).resize({ width, height, fit: 'cover', position: 'centre' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  } catch (err) {
    console.error('posterFromFrame:', err.message);
    return buffer;
  }
}

export async function capImage(buffer, { maxSide = MAX_SIDE, quality = 85 } = {}) {
  const kind = sniffImage(buffer);
  const asIs = { buffer, ext: kind ? kind.ext : null, type: kind ? kind.type : null, resized: false, width: null, height: null };
  if (!kind || kind.ext === 'gif') return asIs;
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch (err) {
    console.error('capImage: sharp unavailable:', err.message);
    return asIs;
  }
  try {
    // rotate() with no angle applies the EXIF orientation and, with no
    // withMetadata(), the output carries no EXIF at all.
    const image = sharp(buffer, { failOn: 'none' }).rotate();
    const meta = await image.metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    const oversize = width > maxSide || height > maxSide;
    // Already within the box, a JPEG, and not bloated: keep the bytes.
    if (!oversize && kind.ext === 'jpg' && buffer.length <= 1024 * 1024) return { ...asIs, width, height };
    let out = image.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
    if (kind.ext === 'jpg') out = out.jpeg({ quality, mozjpeg: true });
    else out = out.webp({ quality });
    const { data, info } = await out.toBuffer({ resolveWithObject: true });
    return { buffer: data, ext: kind.ext === 'jpg' ? 'jpg' : 'webp', type: kind.ext === 'jpg' ? 'image/jpeg' : 'image/webp', resized: true, width: info.width, height: info.height };
  } catch (err) {
    console.error('capImage:', err.message);
    return asIs;
  }
}
