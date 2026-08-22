// The canonical list of real (non-alias) color variables from
// styles/globals.css :root. Aliases like --void or --signal-amber are
// deliberately excluded — they're just var() references to entries on
// this list, so overriding the real variable already re-themes every
// alias that points to it. Grouped for the admin UI; the group key isn't
// used anywhere functionally.
export const THEME_COLOR_GROUPS = [
  {
    label: 'Surfaces',
    vars: [
      { key: '--surface-0', label: 'Page background', default: '#1e1c10' },
      { key: '--surface-1', label: 'Raised (header, footer, panels)', default: '#292719' },
      { key: '--surface-2', label: 'Cards, inputs, wells', default: '#343322' },
      { key: '--surface-3', label: 'Hover state on cards', default: '#42402e' }
    ]
  },
  {
    label: 'Primary accent (olive)',
    vars: [
      { key: '--olive', label: 'Olive', default: '#c2c775' },
      { key: '--olive-bright', label: 'Olive — hover/emphasis', default: '#dcdfa4' },
      { key: '--olive-deep', label: 'Olive — borders, disabled', default: '#616336' },
      { key: '--olive-shadow', label: 'Olive — tinted fills', default: '#2b2c1a' }
    ]
  },
  {
    label: 'Premium accent (brass)',
    vars: [
      { key: '--brass', label: 'Brass', default: '#d98f3e' },
      { key: '--brass-deep', label: 'Brass — deep', default: '#6b5219' }
    ]
  },
  {
    label: 'Text',
    vars: [
      { key: '--ink', label: 'Primary text', default: '#f4ecda' },
      { key: '--ink-dim', label: 'Secondary text', default: '#b5b3a3' },
      { key: '--ink-faint', label: 'Faint text', default: '#9b9c90' }
    ]
  },
  {
    label: 'Status',
    vars: [
      { key: '--ok', label: 'Success', default: '#84cd98' },
      { key: '--warn', label: 'Warning', default: '#e0863c' },
      { key: '--danger', label: 'Danger', default: '#d67c51' },
      { key: '--danger-deep', label: 'Danger — deep', default: '#5c2c22' }
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
