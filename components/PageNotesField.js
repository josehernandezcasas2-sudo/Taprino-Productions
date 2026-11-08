import { episodeHasPage } from '../lib/showRules';

// "Notes for the title's page" in the edit boxes outside the show page
// (Your work's two creator modals and the Library's admin modal): the
// creator's notes that a title's own page shows in place of the
// description ("Notes from Mara", board V2). Migration 118's
// episodes.page_notes, with the show editor's limits and words
// (components/show/EpisodeEditor.js: 4,000 characters, blank lines make
// paragraphs).
export const PAGE_NOTES_MAX = 4000;

// Whether the box belongs on the form: the database has the column (the
// row came with pageNotesReady) and the title, as typed now, has its own
// page (a film or a short by type; a show's episode only with its switch
// on, which only the show page's editor turns). A title without its page
// never shows notes (lib/episodes.js pageNotesOf), so the box would only
// confuse.
export function pageNotesBoxShows(row, { contentType, seriesId } = {}) {
  if (!row || row.pageNotesReady !== true) return false;
  return episodeHasPage({
    contentType: contentType !== undefined ? contentType : row.contentType ?? null,
    seriesId: seriesId !== undefined ? seriesId || null : row.seriesId ?? null,
    hasPage: typeof row.hasPageChoice === 'boolean' ? row.hasPageChoice : null
  });
}

export default function PageNotesField({ id = 'page-notes', value, onChange, disabled = false, note = null, wrapClassName = undefined }) {
  const text = typeof value === 'string' ? value : '';
  return (
    <div className={wrapClassName}>
      <label htmlFor={id}>
        Notes for the title&rsquo;s page <span className="admin-optional" style={{ fontWeight: 'normal' }}>optional · blank lines make paragraphs</span>
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        maxLength={PAGE_NOTES_MAX}
        disabled={disabled}
        placeholder="How it was made, who’s in it, the story behind a scene."
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      <p style={{ margin: '0.25rem 0 0', fontSize: '0.76rem', lineHeight: 1.5, color: 'var(--ink-dim)' }}>
        {text.length.toLocaleString('en-US')} / {PAGE_NOTES_MAX.toLocaleString('en-US')} · shown on the title&rsquo;s page in place of the description.{note ? ` ${note}` : ''}
      </p>
    </div>
  );
}
