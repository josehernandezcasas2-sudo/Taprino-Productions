import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { brassTint, colors, inkTint, mintTint, oliveTint, skyTint } from '../../lib/theme';
import { CONTEXT_LABELS } from '../../lib/messageRules';

// Messages' glyphs (2026-11-18): the same path data as the signed-off
// boards (the canvas https://claude.ai/artifact/SgXAPeJijp7A1EzSQckyhf),
// drawn in a 24-unit box and stroked, like TabBarIcons.js.
const SHAPES = {
  // What a conversation is about (lib/messageRules.js CONTEXT_KINDS, and
  // none = a direct message).
  call: [
    <Path key="a" d="M4 10v4h3l6 4V6L7 10z" />,
    <Path key="b" d="M16.5 9.5a3.5 3.5 0 0 1 0 5" />
  ],
  gear: [
    <Rect key="a" x="3.5" y="7" width="17" height="12" rx="2" />,
    <Circle key="b" cx="12" cy="13" r="3.2" />,
    <Path key="c" d="M8.5 7l1.5-2.5h4L15.5 7" />
  ],
  location: [
    <Path key="a" d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />,
    <Circle key="b" cx="12" cy="10" r="2.4" />
  ],
  production: [
    <Rect key="a" x="3.5" y="9" width="17" height="11" rx="1.5" />,
    <Path key="b" d="M3.5 9l2-5 15 3-1 2" />,
    <Path key="c" d="M8.5 5.2l2 3.3M13.5 6.2l2 3" />
  ],
  card: [
    <Rect key="a" x="3.5" y="5.5" width="17" height="13" rx="2" />,
    <Circle key="b" cx="9" cy="11" r="2" />,
    <Path key="c" d="M6.3 15.5c.6-1.4 1.5-2 2.7-2s2.1.6 2.7 2M14 10h4M14 13.5h3" />
  ],
  profile: [
    <Circle key="a" cx="12" cy="8.5" r="3.5" />,
    <Path key="b" d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" />
  ],
  direct: [<Path key="a" d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H10.5l-4 3.5V16a2 2 0 0 1-2-2z" />],
  // The screens' own controls.
  pencil: [
    <Path key="a" d="M12 5H6.5A2.5 2.5 0 0 0 4 7.5v10A2.5 2.5 0 0 0 6.5 20h10a2.5 2.5 0 0 0 2.5-2.5V12" />,
    <Path key="b" d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
  ],
  back: [<Path key="a" d="M15 5l-7 7 7 7" />],
  send: [<Path key="a" d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />],
  search: [
    <Circle key="a" cx="11" cy="11" r="6.5" />,
    <Path key="b" d="M20 20l-4.2-4.2" />
  ],
  close: [<Path key="a" d="M6 6l12 12M18 6L6 18" />],
  bellOff: [
    <Path key="a" d="M6 16v-5a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8" />,
    <Path key="b" d="M10 20a2 2 0 0 0 4 0" />,
    <Path key="c" d="M4 4l16 16" />
  ],
  bell: [
    <Path key="a" d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" />,
    <Path key="b" d="M10 20a2 2 0 0 0 4 0" />
  ],
  block: [
    <Circle key="a" cx="12" cy="12" r="8.5" />,
    <Path key="b" d="M6 6l12 12" />
  ],
  flag: [<Path key="a" d="M5 21V4h12l-2 4 2 4H5" />],
  link: [<Path key="a" d="M9 6l6 6-6 6" />]
};

export function MessageGlyph({ name, size = 20, color = colors.ink, strokeWidth = 2 }) {
  const shapes = SHAPES[name] || SHAPES.direct;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {shapes}
    </Svg>
  );
}

// The ⋯ button: three filled dots.
export function MoreGlyph({ size = 22, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Circle cx="5" cy="12" r="1.8" />
      <Circle cx="12" cy="12" r="1.8" />
      <Circle cx="19" cy="12" r="1.8" />
    </Svg>
  );
}

// The colour a subject is drawn in: a call brass, gear gold, a place
// mint, a production sky; a working card, a profile and a direct message
// dim (the boards, and the agreement's "Rows" line).
const TINTS = {
  call: { color: colors.brass, fill: brassTint(0.14) },
  gear: { color: colors.olive, fill: oliveTint(0.14) },
  location: { color: colors.mint, fill: mintTint(0.14) },
  production: { color: colors.sky, fill: skyTint(0.16) }
};
const DIM = { color: colors.inkDim, fill: inkTint(0.08) };

export function contextKind(context) {
  return context && Object.prototype.hasOwnProperty.call(CONTEXT_LABELS, context.kind) ? context.kind : 'direct';
}

export function contextTint(context) {
  return TINTS[contextKind(context)] || DIM;
}

// A subject's small icon in its colour.
export function ContextGlyph({ context, size = 13 }) {
  return <MessageGlyph name={contextKind(context)} size={size} color={contextTint(context).color} />;
}
