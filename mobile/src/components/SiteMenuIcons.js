import Svg, { Circle, Path, Rect } from 'react-native-svg';

// The ☰ menu's glyphs (2026-11-18): the same path data as the website's
// components/SiteMenu.js and the signed-off canvas, one per tile id and
// section id of lib/siteMenuRules.js, plus the menu's own controls. Drawn
// in a 24-unit box, stroked, like TabBarIcons.js.
const SHAPES = {
  crew: [
    <Circle key="a" cx="9" cy="8" r="3" />,
    <Path key="b" d="M3.5 19c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5" />,
    <Circle key="c" cx="17" cy="9" r="2.5" />,
    <Path key="d" d="M15.5 14.6c2.3.2 4 1.6 4.8 4.4" />
  ],
  'pitch-room': [
    <Path key="a" d="M9 18h6M10 21h4" />,
    <Path key="b" d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
  ],
  locations: [
    <Path key="a" d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />,
    <Circle key="b" cx="12" cy="10" r="2.4" />
  ],
  productions: [
    <Rect key="a" x="3.5" y="9" width="17" height="11" rx="1.5" />,
    <Path key="b" d="M3.5 9l2-5 15 3-1 2" />,
    <Path key="c" d="M8.5 5.2l2 3.3M13.5 6.2l2 3" />
  ],
  university: [
    <Path key="a" d="M2.5 9.5L12 5l9.5 4.5L12 14z" />,
    <Path key="b" d="M6.5 11.5v4.5c1.5 1.3 3.4 2 5.5 2s4-.7 5.5-2v-4.5" />,
    <Path key="c" d="M21.5 9.5v5" />
  ],
  resources: [
    <Path key="a" d="M3.5 12.5V4.5h8l9 9-8 8z" />,
    <Circle key="b" cx="8" cy="8.5" r="1.4" />
  ],
  live: [
    <Rect key="a" x="3.5" y="7" width="17" height="12" rx="1.5" />,
    <Path key="b" d="M8.5 3.5L12 7l3.5-3.5" />,
    <Circle key="c" cx="12" cy="13" r="1.6" />
  ],
  swipe: [
    <Rect key="a" x="8" y="4.5" width="11" height="15" rx="2" />,
    <Path key="b" d="M5 7.5v11a2 2 0 0 0 2 2h8" />
  ],
  shop: [
    <Path key="a" d="M5 8h14l-1 12H6z" />,
    <Path key="b" d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  ],
  series: [
    <Rect key="a" x="3.5" y="6" width="17" height="12" rx="1.5" />,
    <Path key="b" d="M10.5 9.5v5l4-2.5z" />
  ],
  films: [
    <Rect key="a" x="4" y="3.5" width="16" height="17" rx="1.5" />,
    <Path key="b" d="M8 3.5v17M16 3.5v17M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" />
  ],
  podcasts: [
    <Rect key="a" x="9" y="3.5" width="6" height="11" rx="3" />,
    <Path key="b" d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  ],
  'my-list': [<Path key="a" d="M12 20s-7.5-4.6-7.5-10a4.2 4.2 0 0 1 7.5-2.6A4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />],
  'my-recs': [<Path key="a" d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z" />],
  continue: [
    <Circle key="a" cx="12" cy="12" r="8.5" />,
    <Path key="b" d="M10.5 9v6l4.5-3z" />
  ],
  vertical: [
    <Rect key="a" x="7" y="3" width="10" height="18" rx="2" />,
    <Path key="b" d="M10.5 9v5l4-2.5z" />
  ],
  downloads: [
    <Path key="a" d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />,
    <Path key="b" d="M5 19.5h14" />
  ],
  // The sections.
  yours: [
    <Path key="a" d="M4 8l8-4 8 4v8l-8 4-8-4z" />,
    <Path key="b" d="M4 8l8 4 8-4M12 12v8" />
  ],
  creator: [
    <Rect key="a" x="4" y="4" width="7" height="7" rx="1" />,
    <Rect key="b" x="13" y="4" width="7" height="5" rx="1" />,
    <Rect key="c" x="13" y="11" width="7" height="9" rx="1" />,
    <Rect key="d" x="4" y="13" width="7" height="7" rx="1" />
  ],
  team: [<Path key="a" d="M12 3.5l7 3v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9v-5z" />],
  account: [
    <Circle key="a" cx="12" cy="12" r="3" />,
    <Path key="b" d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2L18 18M18 6l-1.8 1.8M7.8 16.2L6 18" />
  ],
  help: [
    <Circle key="a" cx="12" cy="12" r="8.5" />,
    <Path key="b" d="M9.7 9.5a2.4 2.4 0 0 1 4.6.8c0 1.6-2.3 2-2.3 3.5M12 16.8v.2" />
  ],
  // The menu's own controls.
  search: [
    <Circle key="a" cx="11" cy="11" r="6.5" />,
    <Path key="b" d="M20 20l-4.2-4.2" />
  ],
  close: [<Path key="a" d="M6 6l12 12M18 6L6 18" />],
  chev: [<Path key="a" d="M9 6l6 6-6 6" />],
  down: [<Path key="a" d="M6 9l6 6 6-6" />],
  person: [
    <Circle key="a" cx="12" cy="8.5" r="3.5" />,
    <Path key="b" d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" />
  ],
  logout: [
    <Path key="a" d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4" />,
    <Path key="b" d="M10 8l-4 4 4 4M6 12h9" />
  ]
};
// Two tiles share a drawing.
SHAPES['vertical-discover'] = SHAPES.vertical;
SHAPES.apply = SHAPES.films;

export function MenuGlyph({ name, size = 20, color = '#fbe8d3' }) {
  const shapes = SHAPES[name] || SHAPES.series;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {shapes}
    </Svg>
  );
}
