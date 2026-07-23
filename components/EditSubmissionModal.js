import { useState } from 'react';

const MAIN_GENRES = ['Comedy', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];
const CONTENT_TYPES = [
  { value: 'short', label: 'Short' },
  { value: 'movie', label: 'Movie' },
  { value: 'series', label: 'Series episode' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'podcast', label: 'Podcast' }
];

// Only rendered for a submission whose status is still 'pending' — the API
// enforces that too, but the UI shouldn't even offer the option once
// there's nothing left to edit.
export default function EditSubmissionModal({ submission, allSeries, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: submission.title || '',
    description: submission.description || '',
    artist: submission.artist || '',
    runtime: submission.runtime || '',
    contentType: submission.contentType || 'short',
    genre: submission.genre || '',
    mainGenre: submission.mainGenre || MAIN_GENRES[0],
    tier: submission.tier || 'free',
    seriesId: submission.seriesId || '',
    season: submission.season ? String(submission.season) : '1',
    seriesOrder: submission.seriesOrder ? String(submission.seriesOrder) : ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

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

          <label>Your name / artist credit</label>
          <input type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} required />

          <label>Runtime (e.g. 05:30)</label>
          <input type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} required placeholder="mm:ss" />

          <label>Content type</label>
          <select value={form.contentType} onChange={(e) => update('contentType', e.target.value)} required>
            {CONTENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          {form.contentType === 'series' && (
            <>
              <label>Series</label>
              <select value={form.seriesId} onChange={(e) => update('seriesId', e.target.value)} required>
                <option value="">Choose a series…</option>
                {allSeries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__new__">A new series not listed here</option>
              </select>
              <label>Season</label>
              <input type="number" min="1" value={form.season} onChange={(e) => update('season', e.target.value)} required />
              <label>Episode number within season</label>
              <input type="number" min="1" value={form.seriesOrder} onChange={(e) => update('seriesOrder', e.target.value)} required />
            </>
          )}

          <label>Main genre</label>
          <select value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)} required>
            {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>

          <label>Specific genre</label>
          <input type="text" value={form.genre} onChange={(e) => update('genre', e.target.value)} required />

          <label>Suggested tier — the admin has final say</label>
          <select value={form.tier} onChange={(e) => update('tier', e.target.value)} required>
            <option value="free">Free</option>
            <option value="premium">Cipher Circle (premium)</option>
          </select>

          {error && <p style={{ color: '#e08a6f', fontSize: '0.85rem' }}>{error}</p>}

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
