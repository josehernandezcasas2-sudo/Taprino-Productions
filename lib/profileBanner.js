// Solid-color banner choices for the profile backdrop (account page's
// editor), pulled from the site's own palette in styles/globals.css so a
// plain backdrop still looks like it belongs here. The mobile app keeps
// the same list in mobile/src/lib/theme.js (bannerColors).
export const BANNER_COLORS = [
  { value: '#283c63', label: 'Ocean ink' },
  { value: '#f85f73', label: 'Tropical pink' },
  { value: '#e7a255', label: 'Olive' },
  { value: '#93d0a4', label: 'Mint' },
  { value: '#8499dc', label: 'Sky' },
  { value: '#c85924', label: 'Rust' },
  { value: '#202f4e', label: 'Deep navy' }
];

// What the profile page paints behind the avatar: photo > color > the
// site's default gradient. Returns a React style object.
export function bannerStyle(profile) {
  if (profile.bannerUrl) return { backgroundImage: `url(${profile.bannerUrl})`, backgroundPosition: profile.bannerPosition || 'center' };
  if (profile.bannerColor) return { background: profile.bannerColor };
  return undefined;
}

// The avatar photo inside its circle, honouring the saved focal point
// (migration 084). Pass the url to show (a freshly picked preview on the
// account page, or the saved one).
export function avatarStyle(url, position) {
  if (!url) return undefined;
  return { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: position || 'center' };
}

// Zoom (migration 085): a multiplier on the cover fit, 1–3. 1 (or
// anything invalid) stores as null.
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export function normalizeZoom(raw) {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 1) return null;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 100) / 100;
}

// The slice of an image (in image pixels) that a frame shows: the cover
// fit, divided by the zoom, placed by the focal point. Shared by the web
// renderer (components/PositionedPhoto.js), the crop editor and — copied —
// the app's PositionedImage.
export function visibleSlice(img, frameAspect, position, zoom = 1) {
  const m = IMAGE_POSITION_PATTERN.exec(position || '');
  const x = m ? Number(m[1]) : 50;
  const y = m ? Number(m[2]) : 50;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom) || 1));
  let w = img.w;
  let h = img.w / frameAspect;
  if (h > img.h) { h = img.h; w = img.h * frameAspect; }
  w /= z;
  h /= z;
  return { w, h, left: (img.w - w) * (x / 100), top: (img.h - h) * (y / 100) };
}

// The same slice for an <img> that fills its circle with object-fit:
// cover, without measuring the image: cover at the focal point, then
// scaled about that same point. Used where PositionedPhoto's measuring
// isn't worth it (the header's next/image, crew cards, comments, reels).
export function avatarImgStyle(position, zoom) {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom) || 1));
  const pos = position || 'center';
  return { objectFit: 'cover', objectPosition: pos, transformOrigin: pos, transform: z > 1 ? `scale(${z})` : undefined };
}

// "x% y%", each 0–100. Anything else → null (centred).
export const IMAGE_POSITION_PATTERN = /^(\d{1,3})% (\d{1,3})%$/;
export function normalizeImagePosition(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const m = IMAGE_POSITION_PATTERN.exec(String(raw).trim());
  if (!m) return null;
  const x = Math.max(0, Math.min(100, Number(m[1])));
  const y = Math.max(0, Math.min(100, Number(m[2])));
  return `${x}% ${y}%`;
}
