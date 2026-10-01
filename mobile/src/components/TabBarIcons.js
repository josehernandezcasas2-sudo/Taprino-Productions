import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

// Same path data as components/PlayerIcons.js on the website, ported to
// react-native-svg — kept in sync by hand for the same reason theme.js is.
export function HouseIcon({ size = 20, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 11L12 4l9 7" />
      <Path d="M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9" />
    </Svg>
  );
}

export function CompassIcon({ size = 20, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 6.5l1.9 4.1L18 12.5l-4.1 1.9L12 18.5l-1.9-4.1L6 12.5l4.1-1.9z" fill={color} stroke="none" />
    </Svg>
  );
}

export function WatchTabIcon({ size = 20, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="2.5" y="4" width="19" height="13" rx="1.5" />
      <Path d="M9 20h6M12 17v3" />
      <Path d="M10 8.3v6.4l5.5-3.2z" fill={color} stroke="none" />
    </Svg>
  );
}

export function AccountIcon({ size = 20, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="8" r="3.5" />
      <Path d="M4.5 20c1.4-3.5 4.2-5.5 7.5-5.5s6.1 2 7.5 5.5" />
    </Svg>
  );
}

export function SearchIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="11" cy="11" r="7" />
      <Line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Svg>
  );
}

export function CaretUpIcon({ size = 8, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 6l9 12H3z" />
    </Svg>
  );
}
