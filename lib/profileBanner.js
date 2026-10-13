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

// The same focal point for an <img> / next/image that fills its circle
// with object-fit: cover (the header, crew cards, the home page).
export function avatarImgStyle(position) {
  return { objectPosition: position || 'center' };
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
