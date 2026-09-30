// Mirrors styles/globals.css's :root custom properties (the "Tropical
// System" palette: Tropical Pink / Butter Linen / Ocean Ink) so the app
// uses the website's actual colors instead of a separately invented set.
// Keep this in sync by hand if that palette changes — there's no shared
// build step between the two codebases to do it automatically.
export const colors = {
  surface0: '#0c131f', // page background
  surface1: '#121c2d', // raised: header, footer, panels
  surface2: '#18243c', // cards, inputs, wells
  surface3: '#202f4e', // hover states on cards
  oceanInk: '#283c63', // borders, elevated accents

  olive: '#e7a255',
  oliveBright: '#f2bf88',
  oliveDeep: '#96642c',
  oliveShadow: '#342514',

  brass: '#f85f73', // premium-tier accent (Tropical Pink)
  brassDeep: '#811826',
  onBrass: '#241a05', // text/icon color sitting on top of brass fills

  mint: '#93d0a4',
  sky: '#8499dc',
  rust: '#c85924',

  ink: '#fbe8d3',
  inkDim: '#cab59e',
  inkFaint: '#b3a18c',

  ok: '#84cd98',
  warn: '#e0b34d',
  danger: '#e2745a',

  // Approximations of the website's translucent bar/dropup fills
  // (rgba(41,39,25,x) — a warm near-black, distinct from the navy
  // surface colors above). React Native has no backdrop-filter blur
  // without an extra native dependency, so these are solid-enough
  // stand-ins rather than a blurred glass effect.
  barBackground: 'rgba(41, 39, 25, 0.96)',
  dropupBackground: 'rgba(30, 28, 18, 0.98)',
  hairline: 'rgba(251, 232, 211, 0.12)'
};
