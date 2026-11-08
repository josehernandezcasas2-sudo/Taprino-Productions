import { useState } from 'react';
import { SITE } from '../lib/siteConfig';
import { MAIN_GENRES, SUBMIT_TYPES } from '../lib/submitRules';
import RatingOptions from './RatingOptions';
import PageNotesField, { pageNotesBoxShows } from './PageNotesField';
import { savePageNotes } from '../lib/pageNotesSave';

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
export default function EditSubmissionModal({ submission, onClose, onSaved }) {
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
    tier: submission.tier || 'free'
  });
  const startNotes = submission.pageNotes || '';
  const [notes, setNotes] = useState(startNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const notesShown = pageNotesBoxShows(submission, { contentType: form.contentType });
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
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit submission</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.4rem' }}>
          Only available while this is still pending review — once an admin reviews it, these fields lock.
        </p>

        <form onSubmit={handleSave}>
          <label>Title</label>
          <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />

          <label>Description</label>
          <textarea value={form.description} onChange={(e) => update('description', e.target.value)} required rows={3} style={{ width: '100%', boxSizing: 'border-box' }} />

          {notesShown && <PageNotesField id="edit-submission-notes" value={notes} onChange={setNotes} />}

          <label>Your name / artist credit</label>
          <input type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} required />

          <label>Runtime (e.g. 05:30)</label>
          <input type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} required placeholder="mm:ss" />

          <label>Year created <span style={{ fontWeight: 'normal' }}>optional</span></label>
          <input
            type="number"
            value={form.releaseYear}
            onChange={(e) => update('releaseYear', e.target.value)}
            placeholder={String(new Date().getFullYear())}
            min="1900"
            max={new Date().getFullYear() + 1}
          />

          <label>Content type</label>
          <select value={form.contentType} onChange={(e) => update('contentType', e.target.value)} required>
            {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <label>Content rating <span style={{ fontWeight: 'normal' }}>optional</span></label>
          <select value={form.rating} onChange={(e) => update('rating', e.target.value)}>
            <option value="">Not set</option>
            <RatingOptions />
          </select>

          <label>Main genre</label>
          <select value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)} required>
            {genres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>

          <label>Specific genre</label>
          <input type="text" value={form.genre} onChange={(e) => update('genre', e.target.value)} required />

          <label>Suggested tier — the admin has final say</label>
          <select value={form.tier} onChange={(e) => update('tier', e.target.value)} required>
            <option value="free">Free</option>
            <option value="premium">{SITE.premiumTier} (premium)</option>
          </select>

          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
            <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button className="account-btn-secondary" type="button" onClick={onClose} disabled={saving} style={{ width: 'auto' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
