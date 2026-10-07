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
  if (profile.bannerUrl) return { backgroundImage: `url(${profile.bannerUrl})` };
  if (profile.bannerColor) return { background: profile.bannerColor };
  return undefined;
}
