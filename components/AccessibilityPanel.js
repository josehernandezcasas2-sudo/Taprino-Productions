import { SITE } from '../lib/siteConfig';

// Shown under the episode description. Two jobs:
//
//   1. Tell viewers what's available BEFORE they commit to watching — whether
//      there are captions, whether a described version exists, whether it will
//      flash. A photosensitive viewer finding out about strobing three minutes
//      in is the failure this prevents.
//   2. Give an honest answer when something isn't available, rather than
//      staying silent. "No captions yet" is more useful than an empty space,
//      because it tells the viewer the feature exists on the platform at all.
export default function AccessibilityPanel({ episode, onPlayDescribed, describedActive }) {
  const hasCaptions = !!episode.captionsUrl;
  const hasAD = !!episode.audioDescriptionSrc;
  const hasTranscript = !!episode.transcriptUrl;
  const notes = episode.accessibilityNotes;
  const flashing = episode.hasFlashingLights;

  return (
    <section className="a11y-panel" aria-labelledby="a11y-heading">
      <h2 id="a11y-heading" className="a11y-heading">
        Accessibility
      </h2>

      {flashing && (
        <p className="a11y-warning" role="note">
          <strong>Flashing lights.</strong> This episode contains flashing or strobing images that may
          affect viewers with photosensitive epilepsy.
        </p>
      )}

      <ul className="a11y-list">
        <li className={hasCaptions ? 'yes' : 'no'}>
          <span className="a11y-mark" aria-hidden="true">{hasCaptions ? '✓' : '—'}</span>
          <span>
            <strong>Captions</strong>
            {hasCaptions ? (
              <em>
                {episode.captionsLabel || 'English'} · turn on with the CC button, or press C
              </em>
            ) : (
              <em>Not available for this episode yet</em>
            )}
          </span>
        </li>

        <li className={hasAD ? 'yes' : 'no'}>
          <span className="a11y-mark" aria-hidden="true">{hasAD ? '✓' : '—'}</span>
          <span>
            <strong>Audio description</strong>
            {hasAD ? (
              <em>
                A described version narrates what happens on screen.{' '}
                <button className="a11y-link" onClick={onPlayDescribed}>
                  {describedActive ? 'Switch back to the standard version' : 'Play described version'}
                </button>
              </em>
            ) : (
              <em>Not available for this episode yet</em>
            )}
          </span>
        </li>

        <li className={hasTranscript ? 'yes' : 'no'}>
          <span className="a11y-mark" aria-hidden="true">{hasTranscript ? '✓' : '—'}</span>
          <span>
            <strong>Transcript</strong>
            {hasTranscript ? (
              <em>
                <a href={episode.transcriptUrl} target="_blank" rel="noopener noreferrer">
                  Read the full transcript
                </a>
              </em>
            ) : (
              <em>Not available for this episode yet</em>
            )}
          </span>
        </li>
      </ul>

      {notes && <p className="a11y-notes">{notes}</p>}

      <p className="a11y-foot">
        Something here not working for you? Tell us at{' '}
        <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> — we&rsquo;d rather know.
      </p>
    </section>
  );
}
