import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../../lib/theme';

// Crew Call's glyphs (Crew Call, simpler, 2026-11-18): the same path data
// as the signed-off boards (the canvas
// https://claude.ai/artifact/NAcrMSstXHTCP2HuysLCjp), drawn in a 24-unit
// box and stroked, like MessageIcons.js. Grip & support and Monitors had
// no drawing on the boards; theirs follow the same hand.
const SHAPES = {
  card: [
    <Rect key="a" x="3" y="5" width="18" height="14" rx="2" />,
    <Circle key="b" cx="9" cy="11" r="2.2" />,
    <Path key="c" d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4" />,
    <Path key="d" d="M14.5 10h4M14.5 13.5h3" />
  ],
  plus: [<Path key="a" d="M12 5v14M5 12h14" />],
  pin: [
    <Path key="a" d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />,
    <Circle key="b" cx="12" cy="10" r="2.4" />
  ],
  locate: [
    <Circle key="a" cx="12" cy="12" r="4" />,
    <Path key="b" d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  ],
  message: [<Path key="a" d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H10.5l-4 3.5V16a2 2 0 0 1-2-2z" />],
  close: [<Path key="a" d="M6 6l12 12M18 6L6 18" />],
  // The empty lists.
  calls: [
    <Path key="a" d="M4 10v4h3l6 4V6L7 10z" />,
    <Path key="b" d="M16.5 9.5a3.5 3.5 0 0 1 0 5" />
  ],
  people: [
    <Circle key="a" cx="9" cy="8.5" r="3.2" />,
    <Path key="b" d="M3 19.5c.9-3.2 3.3-5 6-5s5.1 1.8 6 5" />,
    <Path key="c" d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.7.6 3 2.2 3.5 4.7" />
  ],
  cast: [<Path key="a" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />],
  // A piece of gear's category (lib/crewOptions.js GEAR_CATEGORIES).
  Camera: [
    <Rect key="a" x="3.5" y="7" width="17" height="12" rx="2" />,
    <Circle key="b" cx="12" cy="13" r="3.2" />,
    <Path key="c" d="M8.5 7l1.5-2.5h4L15.5 7" />
  ],
  Lenses: [
    <Circle key="a" cx="12" cy="12" r="8" />,
    <Circle key="b" cx="12" cy="12" r="4" />
  ],
  Lighting: [
    <Path key="a" d="M9 3h6l-1 6h-4z" />,
    <Path key="b" d="M12 9v12M8 21h8" />,
    <Path key="c" d="M5 5l2 2M19 5l-2 2" />
  ],
  Audio: [
    <Rect key="a" x="9" y="3" width="6" height="11" rx="3" />,
    <Path key="b" d="M6 11a6 6 0 0 0 12 0M12 17v4" />
  ],
  'Grip & support': [
    <Rect key="a" x="8" y="3" width="8" height="3.5" rx="1" />,
    <Path key="b" d="M12 6.5v4M12 10.5L6 20.5M12 10.5l6 10M12 10.5v10" />
  ],
  Drone: [
    <Rect key="a" x="9" y="10" width="6" height="4" rx="1" />,
    <Path key="b" d="M4 7h5M15 7h5M6.5 7v3M17.5 7v3M9 12H6.5M15 12h2.5" />
  ],
  Monitors: [
    <Rect key="a" x="3" y="4.5" width="18" height="12" rx="1.5" />,
    <Path key="b" d="M12 16.5V20M8 20h8" />
  ],
  'Space & vehicles': [
    <Rect key="a" x="2.5" y="8" width="13" height="9" rx="1.5" />,
    <Path key="b" d="M15.5 11h3l3 3v3h-6z" />,
    <Circle key="c" cx="7" cy="18.5" r="1.6" />,
    <Circle key="d" cx="18" cy="18.5" r="1.6" />
  ]
};

export function CrewGlyph({ name, size = 20, color = colors.ink, strokeWidth = 2 }) {
  const shapes = SHAPES[name] || SHAPES.Camera;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {shapes}
    </Svg>
  );
}
