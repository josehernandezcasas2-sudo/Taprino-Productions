import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../lib/theme';

// Backing's icon (2026-11-14; Jose picked it from six coins: "a coin going
// into a box"): a coin dropping into an open box — the website's
// BackItIcon in components/PlayerIcons.js. Back it on a title and the
// buttons on a pitch; never the Tip coin (TipGlyph in TipSheet.js) and no
// longer the diamond.
export default function BackItGlyph({ size = 16, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="4.9" r="3.3" />
      <Path d="M12 3.7v2.4" />
      <Path d="M4 15l2.8-3h10.4l2.8 3" />
      <Path d="M4 15h16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </Svg>
  );
}
