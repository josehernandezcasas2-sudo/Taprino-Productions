import { DOWNLOADS_ALLOWED_HINT, DOWNLOADS_ALLOWED_LABEL } from '../lib/downloadSiteRules';

// "Allow downloads in the app" (Jose, 2026-11-14: a switch per title, on
// unless the creator turns it off; lib/downloadSiteRules.js
// downloadsAllowedPolicy): Premium and Sponsor members can keep the title
// in the app to watch offline, and switching it off removes the copies on
// phones the next time they connect. It applies at once in every state of
// the title. `locked` is the line when the box can't be changed (someone
// who neither uploaded the title nor owns its show, or a database before
// migration 123): the box stays as it is, greyed, with the line under it.
// Drawn in the episode editor's More info (components/show/EpisodeEditor.js);
// the Library's modal has its own row (components/AdminEditEpisodeModal.js).
// The look is the flashing-lights checkbox's (.flash-field).
export default function DownloadsAllowedField({ id, checked, onChange, locked = null, className = '' }) {
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
          <span className="flash-check-label">{DOWNLOADS_ALLOWED_LABEL}</span>
          <span className="flash-check-hint" id={hintId}>
            {DOWNLOADS_ALLOWED_HINT}
            {locked ? <span className="flash-check-lock"> {locked}</span> : null}
          </span>
        </span>
      </label>
    </div>
  );
}
