import { VolumeIcon } from './PlayerIcons';
import { muteLabel } from '../lib/adBreakRules';

// The mute button on an ad (Jose, 2026-11-13: "Allow tv ads to be muted"):
// the player's own speaker icon at the start of the ad bar (.tp-adbar),
// where the player's controls sit when no ad is on. It is the player's
// mute (lib/adBreakRules.js "the sound"): `silent` is what the viewer hears
// now, `onToggle` the player's own mute, `icons` the player's icon
// overrides (usePlayerIconOverrides, already read by the player). Mute
// only — an ad has no skip or seek. Drawn by components/VideoPlayer.js,
// ChannelPlayer.js and LiveVideoPlayer.js.
export default function AdMuteButton({ silent, onToggle, icons = {} }) {
  return (
    <button
      type="button"
      className="tp-btn tp-ad-mute"
      onClick={(e) => {
        e.stopPropagation();
        if (onToggle) onToggle();
      }}
      aria-label={muteLabel(silent)}
      title={muteLabel(silent)}
    >
      <VolumeIcon muted={silent} size={16} src={silent ? icons.volume_muted : icons.volume_on} />
    </button>
  );
}
