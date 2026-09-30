import Svg, { Circle, Path, Rect } from 'react-native-svg';

// Ported from components/PlayerIcons.js's own path data — same subset
// used by pages/creator/my-work.js, kept in sync by hand for the same
// reason TabBarIcons.js is.
const common = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

export function ImageIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <Circle cx="8" cy="10" r="1.8" />
      <Path d="M4 17l5-5 4 4 3-3 4 4" />
    </Svg>
  );
}

export function ChatIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M4 5.5h16v11H9l-4 3.5v-3.5H4z" />
    </Svg>
  );
}

export function TrashIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M4 7h16" />
      <Path d="M9 7V4.5h6V7" />
      <Path d="M6 7l1 13h10l1-13" />
      <Path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function WarningIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M12 3.5l10 17.5H2z" />
      <Path d="M12 10v4.5" />
      <Circle cx="12" cy="17.5" r="0.8" fill={color} stroke="none" />
    </Svg>
  );
}

export function ClockIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3.5 2" />
    </Svg>
  );
}

export function ClapperboardIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M3 8.5l1.4-3.1a1.5 1.5 0 0 1 2-.7l13 5.9a1.5 1.5 0 0 1 .7 2l-.6 1.4H3z" />
      <Rect x="3" y="10.5" width="18" height="9" rx="1.5" />
      <Path d="M8 8l2-4.4M13 9.5l2-4.4" />
    </Svg>
  );
}

export function HeadphonesIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <Rect x="2.5" y="14" width="4" height="6" rx="1.5" />
      <Rect x="17.5" y="14" width="4" height="6" rx="1.5" />
    </Svg>
  );
}

export function SettingsIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  );
}

export function PencilIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M4 20l1-4.5L15.5 5l3.5 3.5L8.5 19z" />
      <Path d="M13.5 6.5l3.5 3.5" />
    </Svg>
  );
}

export function EyeIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M2 12c1.8-4 5.5-6.5 10-6.5s8.2 2.5 10 6.5c-1.8 4-5.5 6.5-10 6.5S3.8 16 2 12z" />
      <Circle cx="12" cy="12" r="2.8" />
    </Svg>
  );
}

export function UndoIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M4 10h9a5.5 5.5 0 0 1 0 11H8" />
      <Path d="M8 5L3 10l5 5" />
    </Svg>
  );
}

export function ExternalLinkIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M9 5H5.5A1.5 1.5 0 0 0 4 6.5v12A1.5 1.5 0 0 0 5.5 20h12a1.5 1.5 0 0 0 1.5-1.5V15" />
      <Path d="M14 4h6v6" />
      <Path d="M20 4l-9.5 9.5" />
    </Svg>
  );
}

export function LinkIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M9.5 14.5l5-5" />
      <Path d="M13 6l1.5-1.5a3.5 3.5 0 0 1 5 5L18 11" />
      <Path d="M11 18l-1.5 1.5a3.5 3.5 0 0 1-5-5L6 13" />
    </Svg>
  );
}

export function CloseIcon({ size = 18, color = '#fbe8d3' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...common}>
      <Path d="M5 5l14 14" />
      <Path d="M19 5L5 19" />
    </Svg>
  );
}
