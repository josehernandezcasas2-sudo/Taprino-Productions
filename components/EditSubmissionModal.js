import { useState, useEffect, useRef } from 'react';
import { keepScrollInside } from '../lib/menuScroll';
import { SITE } from '../lib/siteConfig';
import { MAIN_GENRES, SUBMIT_TYPES } from '../lib/submitRules';
import RatingOptions from './RatingOptions';
import PageNotesField, { pageNotesBoxShows } from './PageNotesField';
import FlashingLightsField from './FlashingLightsField';
import DownloadsAllowedField from './DownloadsAllowedField';
import { savePageNotes } from '../lib/pageNotesSave';
import { saveDownloadsAllowed } from '../lib/downloadsAllowedSave';
import { downloadableKind } from '../lib/downloadRules';
import { MIGRATION_123_MSG } from '../lib/downloadSiteRules';

// A standalone title's own types: the ones that sit in no show.
const STANDALONE_TYPES = SUBMIT_TYPES.filter((t) => ['movie', 'short', 'vertical'].includes(t.value));

// Only rendered for a standalone title (a film, a short, a Snippet) whose
// status is still 'pending' — the API enforces that too, but the UI
// shouldn't even offer the option once there's nothing left to edit.
//
// A show's episode is edited in the episode editor on its show page since
// the series revamp (slice 2): its show, season and number — and the old
// '__new__' "a new series not listed here", which left an episode in no
// show at all — are gone from here. Nothing this modal sends touches a
// title's show or place (/api/creator/edit-submission leaves fields it
// isn't sent as they are). The genres are lib/submitRules.js's (this list
// had no Drama, the submit page's default, so a Drama title showed as
// Comedy here).
//
// A film's or a short's notes for its own page (2026-11-08) save at once,
// like the description here, through the show editor's own save
// (lib/pageNotesSave.js → PATCH /api/show/episode/<id>, which holds the
// rules for who may change them).
//
// "Allow downloads in the app" (2026-11-14) is here for every title that
// can be downloaded (not a podcast), saved the same way through
// lib/downloadsAllowedSave.js: it applies at once, and before migration
// 123 the box is greyed with the server's line.
export default function EditSubmissionModal({ submission, onClose, onSaved }) {
  // The box scrolls its own fields; a wheel or a finger that has nothing
  // left to scroll in it never moves the page behind (lib/menuScroll.js).
  const backdropRef = useRef(null);
  useEffect(() => keepScrollInside(backdropRef.current), []);
  const [form, setForm] = useState({
    title: submission.title || '',
    description: submission.description || '',
    artist: submission.artist || '',
    runtime: submission.runtime || '',
    releaseYear: submission.releaseYear || '',
    contentType: submission.contentType || 'short',
    rating: submission.rating || '',
    genre: submission.genre || '',
    mainGenre: submission.mainGenre || MAIN_GENRES[0],
    tier: submission.tier || 'free',
    // "Contains flashing lights" (Jose, 2026-11-13): still in review, so
    // the uploader ticks and unticks it freely (edit-submission checks).
    hasFlashingLights: submission.hasFlashingLights === true
  });
  const startNotes = submission.pageNotes || '';
  const [notes, setNotes] = useState(startNotes);
  const startDownloads = submission.downloadsAllowed !== false;
  const [downloads, setDownloads] = useState(startDownloads);
  const downloadsReady = submission.downloadsAllowedReady !== false;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const notesShown = pageNotesBoxShows(submission, { contentType: form.contentType });
  const downloadsShown = downloadableKind(form.contentType);
  // A title of another type (an older one, or an extra whose show isn't
  // one of this creator's) keeps its type; the list only adds it.
  const types = STANDALONE_TYPES.some((t) => t.value === form.contentType)
    ? STANDALONE_TYPES
    : [...STANDALONE_TYPES, SUBMIT_TYPES.find((t) => t.value === form.contentType) || { value: form.contentType, label: form.contentType }];
  const genres = MAIN_GENRES.includes(form.mainGenre) ? MAIN_GENRES : [form.mainGenre, ...MAIN_GENRES];

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/creator/edit-submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: submission.id, ...form })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save your changes.');
      if (notesShown && notes.trim() !== startNotes.trim()) {
        const saved = await savePageNotes(submission.id, notes);
        if (!saved.ok) throw new Error(`The other changes are saved, but not the notes: ${saved.error}`);
      }
      if (downloadsShown && downloadsReady && downloads !== startDownloads) {
        const saved = await saveDownloadsAllowed(submission.id, downloads);
        if (!saved.ok) throw new Error(`The other changes are saved, but not the downloads switch: ${saved.error}`);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // The box is drawn in the show editor's look (.ebx in globals.css;
  // Jose, 2026-11-14: "style those edit submissions and title and
  // description" — until then its labels and fields were the browser's
  // own). One column on a phone; the short fields pair up from 520px. The
  // box is never taller than the screen: the heading and the Save row stay
  // put and the fields scroll between them (.ebx-body).
  return (
    <div className="modal-backdrop" ref={backdropRef} onClick={onClose}>
      <div className="modal-card ebx" role="dialog" aria-modal="true" aria-labelledby="ebx-submission-title" onClick={(e) => e.stopPropagation()}>
        <div className="ebx-head">
          <div className="ebx-head-main">
            <span className="ebx-kicker">Your work · In review</span>
            <h3 className="ebx-title" id="ebx-submission-title">Edit submission</h3>
          </div>
          <button type="button" className="ebx-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSave} className="ebx-form">
          <div className="ebx-body">
          <p className="ebx-lede">
            You can change these while it&rsquo;s still in review. Once it has been reviewed, they lock.
          </p>

          <div className="ebx-field">
            <label htmlFor="ebx-sub-title">Title</label>
            <input id="ebx-sub-title" type="text" className="is-title" value={form.title} onChange={(e) => update('title', e.target.value)} required />
          </div>

          <div className="ebx-field">
            <label htmlFor="ebx-sub-description">Description</label>
            <textarea id="ebx-sub-description" value={form.description} onChange={(e) => update('description', e.target.value)} required rows={3} />
          </div>

          {notesShown && <PageNotesField id="edit-submission-notes" value={notes} onChange={setNotes} wrapClassName="ebx-field" />}

          <div className="ebx-field">
            <label htmlFor="ebx-sub-artist">Your name / artist credit</label>
            <input id="ebx-sub-artist" type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} required />
          </div>

          <div className="ebx-grid">
            <div className="ebx-field">
              <label htmlFor="ebx-sub-runtime">Runtime <em>e.g. 05:30</em></label>
              <input id="ebx-sub-runtime" type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} required placeholder="mm:ss" />
            </div>
            <div className="ebx-field">
              <label htmlFor="ebx-sub-year">Year created <em>optional</em></label>
              <input
                id="ebx-sub-year"
                type="number"
                value={form.releaseYear}
                onChange={(e) => update('releaseYear', e.target.value)}
                placeholder={String(new Date().getFullYear())}
                min="1900"
                max={new Date().getFullYear() + 1}
              />
            </div>
          </div>

          <div className="ebx-grid">
            <div className="ebx-field">
              <label htmlFor="ebx-sub-type">Content type</label>
              <select id="ebx-sub-type" value={form.contentType} onChange={(e) => update('contentType', e.target.value)} required>
                {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="ebx-field">
              <label htmlFor="ebx-sub-rating">Content rating <em>optional</em></label>
              <select id="ebx-sub-rating" value={form.rating} onChange={(e) => update('rating', e.target.value)}>
                <option value="">Not set</option>
                <RatingOptions />
              </select>
            </div>
          </div>

          <div className="ebx-grid">
            <div className="ebx-field">
              <label htmlFor="ebx-sub-main-genre">Main genre</label>
              <select id="ebx-sub-main-genre" value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)} required>
                {genres.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="ebx-field">
              <label htmlFor="ebx-sub-genre">Specific genre</label>
              <input id="ebx-sub-genre" type="text" value={form.genre} onChange={(e) => update('genre', e.target.value)} required />
            </div>
          </div>

          <div className="ebx-field">
            <label htmlFor="ebx-sub-tier">Suggested tier <em>the team has final say</em></label>
            <select id="ebx-sub-tier" value={form.tier} onChange={(e) => update('tier', e.target.value)} required>
              <option value="free">Free</option>
              <option value="premium">{SITE.premiumTier} (premium)</option>
            </select>
          </div>

          <div className="ebx-switches">
            <FlashingLightsField id="edit-submission-flashing" checked={form.hasFlashingLights} onChange={(v) => update('hasFlashingLights', v)} />
            {downloadsShown && (
              <DownloadsAllowedField
                id="edit-submission-downloads"
                checked={downloads}
                onChange={setDownloads}
                locked={downloadsReady ? null : MIGRATION_123_MSG}
              />
            )}
          </div>

          {error && <p className="ebx-error" role="alert">{error}</p>}
          </div>

          <div className="ebx-actions">
            <button className="account-btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button className="account-btn-secondary" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
