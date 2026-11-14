// How the bottom bar's labels fit (2026-11-14: the Dashboard tab makes five
// tabs for a creator and six for an admin, and "DASHBOARD" is the longest
// word on the bar). Every label sits on one line, inside the lit pill of
// its own tab, on any phone: never cut, never wrapped. Pure, no imports.
//
// The labels are set in IBM Plex Mono, where every glyph is 0.6 em wide, so
// a label's width is known without measuring it:
//
//   letters × (0.6 × size + spacing)  (+ the caret and its gap)
//
// A lit tab is a pill, and a pill's round ends eat into the room at the
// height where the label sits (about 5.5pt a side on the 44pt pill), so a
// label can be narrower than its tab and still poke out of the colour.
// The bar gives way a step at a time, and stops at the first that fits:
//
//   1. as it always was: the round pill, the carets, wide letter spacing;
//   2. the letter spacing closes up;
//   3. the lit pill gets squarer corners (14pt, like the website's rail),
//      which hands the label the room the round ends took;
//   4. the carets go and the long tab (Dashboard) takes a wider share, as
//      the website's bar does with six tabs on a phone;
//   5. only then does the size come down, one size for the whole bar.
//
// The answer is in real points: BottomNav draws the labels with
// allowFontScaling off and hands the phone's text-size setting in here, so
// larger text makes the labels larger only as far as they still fit.
export const LABEL_SIZE = 8.3;
export const LABEL_SPACING = 0.8;
export const TIGHT_SPACING = 0.2;
export const LEAST_SIZE = 5;
// The share of the bar the long tab takes when the bar is tight.
export const LONG_SHARE = 1.35;
// The lit pill's corners: fully round, or squarer when the bar is tight.
export const SQUARE_RADIUS = 14;
// How far the phone's text-size setting moves the labels.
const LEAST_SCALE = 0.85;
const MOST_SCALE = 1.3;
const GLYPH = 0.6;
// The bar's own border and side padding (BottomNav's styles.bar).
const BAR_INSET = 2 + 16;
// The 7pt caret and the 3pt gap before it.
const CARET_ROOM = 10;
// What a label must leave free in its tab: the pill's ends at the label's
// height, both sides, and a little air.
const ROUND_AIR = 13;
const SQUARE_AIR = 5.5;

export function labelWidth(tab, size, spacing, carets = true) {
  const letters = String((tab && tab.text) || '').length;
  return letters * (GLYPH * size + spacing) + (carets && tab && tab.caret ? CARET_ROOM : 0);
}

// Each tab's width: equal shares, or the long tab's wider one.
export function tabWidths(barWidth, tabs, share = 1) {
  const inner = Math.max(0, (Number(barWidth) || 0) - BAR_INSET);
  const parts = tabs.map((t) => (t.long ? share : 1));
  const total = parts.reduce((a, b) => a + b, 0) || 1;
  return parts.map((p) => (inner * p) / total);
}

// tabs: [{ text, caret, long }] →
//   { size, spacing, carets, round, share } for the whole bar.
export function tabBarFit({ barWidth, tabs, fontScale = 1 }) {
  const list = Array.isArray(tabs) ? tabs.filter((t) => t && t.text) : [];
  const scale = Math.min(MOST_SCALE, Math.max(LEAST_SCALE, Number(fontScale) || 1));
  const want = Math.round(LABEL_SIZE * scale * 10) / 10;
  const wide = Math.round(LABEL_SPACING * scale * 10) / 10;
  const asEver = { size: want, spacing: wide, carets: true, round: true, share: 1 };
  if (!list.length || !(barWidth > 0)) return asEver;

  const fits = ({ size, spacing, carets, round, share }) => {
    const widths = tabWidths(barWidth, list, share);
    const air = round ? ROUND_AIR : SQUARE_AIR;
    return list.every((t, i) => labelWidth(t, size, spacing, carets) <= widths[i] - air);
  };
  const steps = [
    asEver,
    { ...asEver, spacing: TIGHT_SPACING },
    { ...asEver, spacing: TIGHT_SPACING, round: false },
    { size: want, spacing: TIGHT_SPACING, carets: false, round: false, share: LONG_SHARE }
  ];
  for (const step of steps) if (fits(step)) return step;

  // The last step's shape, at the largest size every label fits at.
  const widths = tabWidths(barWidth, list, LONG_SHARE);
  let size = want;
  list.forEach((t, i) => {
    const most = ((widths[i] - SQUARE_AIR) / t.text.length - TIGHT_SPACING) / GLYPH;
    if (most < size) size = most;
  });
  return { size: Math.max(LEAST_SIZE, Math.floor(size * 10) / 10), spacing: TIGHT_SPACING, carets: false, round: false, share: LONG_SHARE };
}
