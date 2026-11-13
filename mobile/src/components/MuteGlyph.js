import Svg, { Path } from 'react-native-svg';
import { colors } from '../lib/theme';

// The players' speaker: the live player's mute button (ChannelPlayer.js),
// the episode player's (EpisodePlayer.js) and the one on an ad
// (AdBreakLayer.js) — the website's VolumeIcon, struck through when silent.
export default function MuteGlyph({ muted, size = 22, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M11 5L6 9H3v6h3l5 4z" />
      {muted ? <Path d="M22 9l-6 6M16 9l6 6" /> : <Path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
    </Svg>
  );
}
