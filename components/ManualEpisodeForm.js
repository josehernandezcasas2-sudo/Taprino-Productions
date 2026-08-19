import { useState } from 'react';
import { SITE } from '../lib/siteConfig';

const MAIN_GENRES = ['Comedy', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];
const CONTENT_TYPES = [
  { value: 'short', label: 'Short' },
  { value: 'movie', label: 'Movie' },
  { value: 'series', label: 'Series episode' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'podcast', label: 'Podcast' }
];

const EMPTY_FORM = {
  creatorEmail: '', title: '', description: '', contentType: 'short',
  seriesId: '', newSeriesName: '', season: '1', seriesOrder: '',
  genre: '', mainGenre: MAIN_GENRES[0], artist: '', runtime: '',
  tier: 'free', status: 'pending', featured: false, adsEnabled: true
};

function readAsDataUrl(f) {
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    reader.readAsDataURL(f);
  });
}

// The manual fallback for when a creator's in-app upload keeps failing
// entirely (before submit-episode.js ever runs) — meaning there's no
// episode row anywhere to attach a fixed video to. The real workaround:
// upload the file directly through Cloudflare's own Stream dashboard
// (bypasses this app's upload pipeline completely, since it's a
// different domain/flow than what a firewall might be blocking), then
// build the episode here from the resulting video ID.
export default function ManualEpisodeForm({ allSeries, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [videoUid, setVideoUid] = useState('');
  const [videoCheck, setVideoCheck] = useState(null);
  const [trailerUid, setTrailerUid] = useState('');
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successId, setSuccessId] = useState(null);

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

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!videoUid.trim()) {
      setError('Paste the Cloudflare video ID first.');
      return;
    }
    setSaving(true);
    try {
      const [posterBase64, thumbnailBase64] = await Promise.all([readAsDataUrl(posterFile), readAsDataUrl(thumbnailFile)]);
      const res = await fetch('/api/admin/manual-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          cloudflareVideoUid: videoUid.trim(),
          ...(trailerUid.trim() ? { trailerCloudflareUid: trailerUid.trim() } : {}),
          ...(posterBase64 ? { posterBase64, posterFileName: posterFile.name } : {}),
          ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: thumbnailFile.name } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the episode.');

      setSuccessId(data.episodeId);
      setForm(EMPTY_FORM);
      setVideoUid('');
      setVideoCheck(null);
      setTrailerUid('');
      setPosterFile(null);
      setThumbnailFile(null);
      onCreated();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  return (
    <div className="account-card" style={{ maxWidth: 'none' }}>
      <div className="account-eyebrow">Manual episode entry</div>
      <h3>Create an episode from a manually-uploaded video</h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
        For when in-app upload keeps failing (ad blocker, firewall, flaky network) and no submission ever made it in.
        Upload the file directly at <a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer" style={{ color: 'var(--signal-amber)' }}>Cloudflare&rsquo;s Stream dashboard</a>,
        copy the resulting video ID, and fill in the rest here.
      </p>

      {successId && (
        <p style={{ color: 'var(--ok)', fontSize: '0.85rem' }}>✓ Created — episode ID: {successId}</p>
      )}

      <form onSubmit={handleSubmit}>
        <label>Attribute to creator — email, optional (defaults to you)</label>
        <input type="email" value={form.creatorEmail} onChange={(e) => update('creatorEmail', e.target.value)} placeholder="creator@example.com" />

        <label>Cloudflare video ID — required</label>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' }}>
          <input type="text" value={videoUid} onChange={(e) => { setVideoUid(e.target.value); setVideoCheck(null); }} placeholder="e.g. c792e0c49f72f77e00693d10c0ef02cd" style={{ flex: 1 }} required />
          <button type="button" className="account-btn-secondary" onClick={checkVideo} disabled={!videoUid.trim() || videoCheck === 'checking'} style={{ width: 'auto' }}>
            {videoCheck === 'checking' ? 'Checking…' : 'Check'}
          </button>
        </div>
        {videoCheck && videoCheck !== 'checking' && (
          videoCheck.error ? (
            <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '-0.2rem' }}>{videoCheck.error}</p>
          ) : videoCheck.state === 'error' ? (
            <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '-0.2rem' }}>
              Cloudflare could not process this file: {videoCheck.errorReasonText || videoCheck.errorReasonCode}. Re-export and re-upload before linking.
            </p>
          ) : videoCheck.state === 'ready' ? (
            <p style={{ color: 'var(--ok)', fontSize: '0.8rem', marginTop: '-0.2rem' }}>✓ Ready to stream.</p>
          ) : (
            <p style={{ color: 'var(--signal-amber)', fontSize: '0.8rem', marginTop: '-0.2rem' }}>
              Still processing ({videoCheck.state}{videoCheck.pctComplete ? `, ${videoCheck.pctComplete}%` : ''}) — you can still create the episode, it just won&rsquo;t be watchable until this finishes.
            </p>
          )
        )}

        <label>Trailer — Cloudflare video ID, optional</label>
        <input type="text" value={trailerUid} onChange={(e) => setTrailerUid(e.target.value)} placeholder="Only if a trailer was also manually uploaded" style={{ marginBottom: '0.8rem' }} />

        <label>Title</label>
        <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />

        <label>Description</label>
        <textarea value={form.description} onChange={(e) => update('description', e.target.value)} required rows={3} style={{ width: '100%', boxSizing: 'border-box' }} />

        <label>Content type</label>
        <select value={form.contentType} onChange={(e) => update('contentType', e.target.value)} required>
          {CONTENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        {form.contentType === 'series' && (
          <>
            <label>Series</label>
            <select value={form.seriesId} onChange={(e) => update('seriesId', e.target.value)}>
              <option value="">Choose a series…</option>
              {allSeries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label>Or create a new series</label>
            <input type="text" value={form.newSeriesName} onChange={(e) => update('newSeriesName', e.target.value)} placeholder="Leave blank if you picked one above" />
            <label>Season</label>
            <input type="number" min="1" value={form.season} onChange={(e) => update('season', e.target.value)} required />
            <label>Episode number within season</label>
            <input type="number" min="1" value={form.seriesOrder} onChange={(e) => update('seriesOrder', e.target.value)} />
          </>
        )}

        <label>Main genre</label>
        <select value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)} required>
          {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>

        <label>Specific genre</label>
        <input type="text" value={form.genre} onChange={(e) => update('genre', e.target.value)} required />

        <label>Artist credit</label>
        <input type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} required />

        <label>Runtime (e.g. 05:30)</label>
        <input type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} required placeholder="mm:ss" />

        <label>Tier</label>
        <select value={form.tier} onChange={(e) => update('tier', e.target.value)}>
          <option value="free">Free</option>
          <option value="premium">{SITE.premiumTier} (premium)</option>
        </select>

        <label>Status</label>
        <select value={form.status} onChange={(e) => update('status', e.target.value)}>
          <option value="pending">Pending — goes through normal review</option>
          <option value="approved">Approved — live immediately</option>
          <option value="rejected">Rejected</option>
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'normal', marginTop: '0.6rem' }}>
          <input type="checkbox" checked={form.featured} onChange={(e) => update('featured', e.target.checked)} />
          Eligible for the homepage hero rotation
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'normal' }}>
          <input type="checkbox" checked={form.adsEnabled} onChange={(e) => update('adsEnabled', e.target.checked)} />
          Show ads on this episode {form.tier === 'premium' && '(ignored — Cipher Circle members never see ads regardless)'}
        </label>

        <label>Poster — optional</label>
        <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} style={{ marginBottom: '0.6rem' }} />

        <label>Thumbnail — optional</label>
        <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} style={{ marginBottom: '0.6rem' }} />

        {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

        <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
          {saving ? 'Creating…' : 'Create episode'}
        </button>
      </form>
    </div>
  );
}
