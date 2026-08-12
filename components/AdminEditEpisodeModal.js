import { useState } from 'react';

const MAIN_GENRES = ['Comedy', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];

function readAsDataUrl(f) {
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    reader.readAsDataURL(f);
  });
}

export default function AdminEditEpisodeModal({ episode, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: episode.title || '',
    description: episode.description || '',
    artist: episode.artist || '',
    runtime: episode.runtime || '',
    genre: episode.genre || '',
    mainGenre: episode.mainGenre || MAIN_GENRES[0],
    tier: episode.tier || 'free',
    status: episode.status || 'pending',
    featured: !!episode.featured
  });
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [videoUid, setVideoUid] = useState('');
  const [videoCheck, setVideoCheck] = useState(null); // null | 'checking' | { state, errorReasonText, ... } | { error }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function checkVideo() {
    if (!videoUid.trim()) return;
    setVideoCheck('checking');
    try {
      const res = await fetch(`/api/admin/check-cloudflare-video?uid=${encodeURIComponent(videoUid.trim())}`);
      const data = await res.json();
      setVideoCheck(res.ok ? data : { error: data.error });
    } catch (err) {
      setVideoCheck({ error: 'Could not reach the check endpoint.' });
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const [posterBase64, thumbnailBase64] = await Promise.all([readAsDataUrl(posterFile), readAsDataUrl(thumbnailFile)]);
      const res = await fetch('/api/admin/edit-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: episode.id,
          ...form,
          ...(posterBase64 ? { posterBase64, posterFileName: posterFile.name } : {}),
          ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: thumbnailFile.name } : {}),
          ...(videoUid.trim() ? { cloudflareVideoUid: videoUid.trim() } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save changes.');
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
          <h3>Edit episode</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.4rem' }}>
          Admin edit — works on any episode regardless of status, including changing status itself.
        </p>

        <form onSubmit={handleSave}>
          <label>Title</label>
          <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />

          <label>Description</label>
          <textarea value={form.description} onChange={(e) => update('description', e.target.value)} required rows={3} style={{ width: '100%', boxSizing: 'border-box' }} />

          <label>Artist credit</label>
          <input type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} required />

          <label>Runtime</label>
          <input type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} required />

          <label>Main genre</label>
          <select value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)} required>
            {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>

          <label>Specific genre</label>
          <input type="text" value={form.genre} onChange={(e) => update('genre', e.target.value)} required />

          <label>Tier</label>
          <select value={form.tier} onChange={(e) => update('tier', e.target.value)}>
            <option value="free">Free</option>
            <option value="premium">Cipher Circle (premium)</option>
          </select>

          <label>Status</label>
          <select value={form.status} onChange={(e) => update('status', e.target.value)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved — live</option>
            <option value="rejected">Rejected</option>
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'normal' }}>
            <input type="checkbox" checked={form.featured} onChange={(e) => update('featured', e.target.checked)} />
            Eligible for the homepage hero rotation
          </label>

          <label>Replace poster — optional</label>
          <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} style={{ marginBottom: '0.6rem' }} />

          <label>Replace thumbnail — optional</label>
          <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} style={{ marginBottom: '0.6rem' }} />

          <label>Replace video — Cloudflare video ID, optional</label>
          <p style={{ fontSize: '0.75rem', color: 'var(--ink-dim)', marginTop: '-0.3rem' }}>
            For a file uploaded directly through Cloudflare&rsquo;s own dashboard (the fallback when in-app upload keeps failing) — paste its video ID, not a URL.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <input type="text" value={videoUid} onChange={(e) => { setVideoUid(e.target.value); setVideoCheck(null); }} placeholder="e.g. c792e0c49f72f77e00693d10c0ef02cd" style={{ flex: 1 }} />
            <button type="button" className="account-btn-secondary" onClick={checkVideo} disabled={!videoUid.trim() || videoCheck === 'checking'} style={{ width: 'auto' }}>
              {videoCheck === 'checking' ? 'Checking…' : 'Check'}
            </button>
          </div>
          {videoCheck && videoCheck !== 'checking' && (
            videoCheck.error ? (
              <p style={{ color: '#e08a6f', fontSize: '0.8rem', marginTop: '-0.2rem' }}>{videoCheck.error}</p>
            ) : videoCheck.state === 'error' ? (
              <p style={{ color: '#e08a6f', fontSize: '0.8rem', marginTop: '-0.2rem' }}>
                Cloudflare could not process this file: {videoCheck.errorReasonText || videoCheck.errorReasonCode}. Re-export and re-upload before linking.
              </p>
            ) : videoCheck.state === 'ready' ? (
              <p style={{ color: '#7fbf8f', fontSize: '0.8rem', marginTop: '-0.2rem' }}>✓ Ready to stream — safe to save.</p>
            ) : (
              <p style={{ color: 'var(--signal-amber)', fontSize: '0.8rem', marginTop: '-0.2rem' }}>
                Still processing on Cloudflare&rsquo;s side ({videoCheck.state}{videoCheck.pctComplete ? `, ${videoCheck.pctComplete}%` : ''}) — you can save now, but it won&rsquo;t be watchable until this finishes.
              </p>
            )
          )}

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
