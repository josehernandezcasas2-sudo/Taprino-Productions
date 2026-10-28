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

// The header's bell (PlayerIcons.js BellIcon) — TopNav, signed in.
export function BellIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <Path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </Svg>
  );
}

// The header's hamburger (PlayerIcons.js HamburgerMenuIcon) — TopNav's
// browse menu, the website's .nav-hamburger.
export function MenuIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 7h16" />
      <Path d="M4 12h16" />
      <Path d="M4 17h16" />
    </Svg>
  );
}

// Admin tab (shield) — only shown to admins/sub-admins, see BottomNav.
export function ShieldIcon({ size = 20, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3l7 3v5c0 4.5-3 8.3-7 9.5C8 19.3 5 15.5 5 11V6l7-3z" />
      <Path d="M9.5 12l1.8 1.8L14.8 10" />
    </Svg>
  );
}

// The account dropdown's row icons (TopNav's account panel), the same
// paths as PlayerIcons.js on the website.
export function SettingsIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  );
}

export function LockIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="4" y="11" width="16" height="10" rx="2" />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  );
}

// The filled heart (the website's HeartIcon with active).
export function HeartIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  );
}

export function ChatIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 5.5h16v11H9l-4 3.5v-3.5H4z" />
    </Svg>
  );
}

export function SparkleIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 2l1.8 5.7L19.5 9.5 13.8 11.3 12 17l-1.8-5.7L4.5 9.5l5.7-1.8z" />
    </Svg>
  );
}

export function TargetIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="8.5" />
      <Circle cx="12" cy="12" r="4.5" />
      <Circle cx="12" cy="12" r="0.7" fill={color} />
    </Svg>
  );
}

export function CardIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <Path d="M2.5 10h19" />
    </Svg>
  );
}

export function BarChartIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 20V10" />
      <Path d="M12 20V4" />
      <Path d="M19 20v-7" />
    </Svg>
  );
}

export function ClapperboardIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 8.5l1.4-3.1a1.5 1.5 0 0 1 2-.7l13 5.9a1.5 1.5 0 0 1 .7 2l-.6 1.4H3z" />
      <Rect x="3" y="10.5" width="18" height="9" rx="1.5" />
      <Path d="M8 8l2-4.4M13 9.5l2-4.4" />
    </Svg>
  );
}

export function FolderIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h4.7l2 2.2H19.5A1.5 1.5 0 0 1 21 8.7v9.3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6.5z" />
    </Svg>
  );
}

export function LogoutIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M15 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H15" />
      <Path d="M10 12h11" />
      <Path d="M17 8l4 4-4 4" />
    </Svg>
  );
}

export function ArrowRightIcon({ size = 15, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 12h16" />
      <Path d="M13 5l7 7-7 7" />
    </Svg>
  );
}
