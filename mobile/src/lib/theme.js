// Mirrors styles/globals.css's :root custom properties (the palette:
// Tangerine / gold / Butter Linen / Ocean Ink) so the app
// uses the website's actual colors instead of a separately invented set.
// Keep this in sync by hand if that palette changes — there's no shared
// build step between the two codebases to do it automatically.
// Same three families as styles/globals.css's --font-display / --font-body /
// --font-mono. RN custom fonts are one registered name per weight, so
// these are the exact names _layout.js loads — never combine with
// fontWeight (it would synthesize bold on top of an already-bold face).
export const fonts = {
  display: 'SpaceGrotesk_400Regular',
  displaySemi: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  body: 'Fraunces_400Regular',
  bodyBold: 'Fraunces_700Bold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoBold: 'IBMPlexMono_700Bold'
};

export const colors = {
  surface0: '#0c131f', // page background
  surface1: '#121c2d', // raised: header, footer, panels
  surface2: '#18243c', // cards, inputs, wells
  surface3: '#202f4e', // hover states on cards
  oceanInk: '#283c63', // borders, elevated accents

  olive: '#f2c14e',
  oliveBright: '#f8d98a',
  oliveDeep: '#9a7b1f',
  oliveShadow: '#352c0f',

  brass: '#ff8c42', // the accent (Tangerine; was Tropical Pink until 2026-10-18)
  brassDeep: '#8a3a0f',
  onBrass: '#241a05', // text/icon color sitting on top of brass fills

  mint: '#93d0a4',
  sky: '#8499dc',
  rust: '#c85924',

  ink: '#fbe8d3',
  inkDim: '#cab59e',
  inkFaint: '#b3a18c',

  ok: '#84cd98',
  warn: '#edb53f',
  danger: '#ef5b5b',

  // Approximations of the website's translucent bar/dropup fills
  // (rgba(41,39,25,x) — a warm near-black, distinct from the navy
  // surface colors above). React Native has no backdrop-filter blur
  // without an extra native dependency, so these are solid-enough
  // stand-ins rather than a blurred glass effect.
  barBackground: 'rgba(41, 39, 25, 0.96)',
  dropupBackground: 'rgba(30, 28, 18, 0.98)',
  hairline: 'rgba(251, 232, 211, 0.12)'
};

// Tints of the accents, the app's twin of the website's
// rgba(var(--brass-rgb), a). Use these for new work instead of literal
// numbers, so the next palette change is one file.
export const brassTint = (a) => `rgba(255,140,66,${a})`;
export const oliveTint = (a) => `rgba(242,193,78,${a})`;
export const dangerTint = (a) => `rgba(239,91,91,${a})`;
// The website's rgba(251, 232, 211, a): hairlines, pressed fills, the
// header's circle buttons.
export const inkTint = (a) => `rgba(251,232,211,${a})`;

// Use this instead of StyleSheet.absoluteFillObject — React Native 0.86
// removed that export (only StyleSheet.absoluteFill remains), so on a real
// device it's undefined: every image/overlay styled with it rendered at
// zero size or lost its positioning (blank avatars, posters, hero art),
// while the web preview still had it and hid the bug. A plain object is
// safe both as a style and spread into another style, on every platform.
export const absoluteFill = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 };

// Profile banner: the solid-color choices on the Account screen's banner
// editor, and the default gradient stops when no photo/color is set. Same
// list as lib/profileBanner.js on the website — keep them in sync.
export const bannerColors = [
  { value: '#283c63', label: 'Ocean ink' },
  { value: '#ff8c42', label: 'Tangerine' },
  { value: '#f2c14e', label: 'Gold' },
  { value: '#93d0a4', label: 'Mint' },
  { value: '#8499dc', label: 'Sky' },
  { value: '#c85924', label: 'Rust' },
  { value: '#202f4e', label: 'Deep navy' }
];
export const bannerGradient = [colors.surface2, colors.oceanInk, colors.brassDeep];
