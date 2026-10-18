// The canonical list of real (non-alias) color variables from
// styles/globals.css :root. Aliases like --void or --signal-amber are
// deliberately excluded — they're just var() references to entries on
// this list, so overriding the real variable already re-themes every
// alias that points to it. Grouped for the admin UI; the group key isn't
// used anywhere functionally.
//
// Defaults below must match styles/globals.css exactly — this is what
// the admin theme page (pages/admin/theme.js) seeds its form with and
// compares against to decide whether a swatch counts as "changed" (and
// therefore gets sent as a saved override). If these drift from the
// stylesheet, the picker shows the wrong "current" color and Reset
// restores the wrong thing.
export const THEME_COLOR_GROUPS = [
  {
    label: 'Surfaces',
    vars: [
      { key: '--surface-0', label: 'Page background', default: '#0c131f' },
      { key: '--surface-1', label: 'Raised (header, footer, panels)', default: '#121c2d' },
      { key: '--surface-2', label: 'Cards, inputs, wells', default: '#18243c' },
      { key: '--surface-3', label: 'Hover state on cards', default: '#202f4e' }
    ]
  },
  {
    label: 'Secondary accent (gold; the variable is still called olive)',
    vars: [
      { key: '--olive', label: 'Olive', default: '#f2c14e' },
      { key: '--olive-bright', label: 'Olive — hover/emphasis', default: '#f8d98a' },
      { key: '--olive-deep', label: 'Olive — borders, disabled', default: '#9a7b1f' },
      { key: '--olive-shadow', label: 'Olive — tinted fills', default: '#352c0f' }
    ]
  },
  {
    label: 'Accent (brass / Tangerine)',
    vars: [
      { key: '--brass', label: 'Brass', default: '#ff8c42' },
      { key: '--brass-deep', label: 'Brass — deep', default: '#8a3a0f' }
    ]
  },
  {
    label: 'Text',
    vars: [
      { key: '--ink', label: 'Primary text', default: '#fbe8d3' },
      { key: '--ink-dim', label: 'Secondary text', default: '#cab59e' },
      { key: '--ink-faint', label: 'Faint text', default: '#b3a18c' }
    ]
  },
  {
    label: 'Status',
    vars: [
      { key: '--ok', label: 'Success', default: '#84cd98' },
      { key: '--warn', label: 'Warning', default: '#edb53f' },
      { key: '--danger', label: 'Danger', default: '#ef5b5b' },
      { key: '--danger-deep', label: 'Danger — deep', default: '#5c2222' }
    ]
  }
];

export const ALL_THEME_KEYS = THEME_COLOR_GROUPS.flatMap((g) => g.vars.map((v) => v.key));

// Builds the inline <style> override block for _document.js — only
// includes keys actually present in overrides, so an empty/default state
// injects nothing at all.
export function buildThemeStyleTag(overrides) {
  const entries = Object.entries(overrides || {}).filter(([k, v]) => ALL_THEME_KEYS.includes(k) && v);
  if (entries.length === 0) return '';
  const decls = entries.map(([k, v]) => `${k}: ${v};`).join(' ');
  return `:root { ${decls} }`;
}
