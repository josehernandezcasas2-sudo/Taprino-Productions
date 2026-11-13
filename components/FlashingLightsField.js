import { FLASHING_LIGHTS_HINT, FLASHING_LIGHTS_LABEL } from '../lib/showRules';

// "Contains flashing lights" (Jose, 2026-11-13: "add the flashing lights
// mark"): the uploader's own checkbox; the photosensitivity warning then
// shows before the title plays (lib/contentAdvisory.js flashingLightsFor).
// `locked` is the line when the box can't be changed — ticked on a live
// title, only the team takes it off (lib/showRules.js
// flashingLightsPolicy) — and the box stays as it is, greyed, with the line
// under it. Drawn on the three-step submit (pages/creator/submit.js), the
// episode and draft editors (components/show/EpisodeFields.js) and Your
// work's edit sheets (components/EditSubmissionModal.js,
// components/RequestEditModal.js).
export default function FlashingLightsField({ id, checked, onChange, locked = null, className = '' }) {
  const hintId = `${id}-hint`;
  return (
    <div className={`flash-field${locked ? ' locked' : ''}${className ? ` ${className}` : ''}`}>
      <label className="flash-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(checked)}
          disabled={Boolean(locked)}
          onChange={(e) => { if (!locked && onChange) onChange(e.target.checked); }}
          aria-describedby={hintId}
        />
        <span className="flash-check-text">
          <span className="flash-check-label">{FLASHING_LIGHTS_LABEL}</span>
          <span className="flash-check-hint" id={hintId}>
            {FLASHING_LIGHTS_HINT}
            {locked ? <span className="flash-check-lock"> {locked}</span> : null}
          </span>
        </span>
      </label>
    </div>
  );
}
