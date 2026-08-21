import { useState } from 'react';

const MAIN_GENRES = ['Comedy', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];

// Bulk-import an existing podcast's back-catalog from its RSS feed —
// deliberately a two-step flow (Preview, then Import) rather than one
// button, so a creator can actually see what's about to get created
// before dozens of episodes land as pending submissions. Each imported
// episode still goes through the normal 'pending' review queue, same as
// any other creator submission.
export default function RssImportPanel({ allSeries, onImported }) {
  const [feedUrl, setFeedUrl] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [seriesChoice, setSeriesChoice] = useState('__new__');
  const [showName, setShowName] = useState('');
  const [defaultTier, setDefaultTier] = useState('free');
  const [defaultMainGenre, setDefaultMainGenre] = useState(MAIN_GENRES[0]);
  const [defaultGenre, setDefaultGenre] = useState('');
  const [defaultArtist, setDefaultArtist] = useState('');
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  async function handlePreview(e) {
    e.preventDefault();
    setError(null);
    setPreview(null);
    setResult(null);
    setPreviewing(true);
    try {
      const res = await fetch('/api/creator/rss-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not read that feed.');
      setPreview(data);
      setShowName(data.showTitle || '');
      setSelected(new Set(data.episodes.map((ep) => ep.guid)));
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  function toggleEpisode(guid) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(guid) ? next.delete(guid) : next.add(guid);
      return next;
    });
  }

  async function handleImport() {
    if (selected.size === 0) {
      setError('Select at least one episode to import.');
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const episodesToImport = preview.episodes.filter((ep) => selected.has(ep.guid));
      const res = await fetch('/api/creator/rss-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showName: seriesChoice === '__new__' ? showName : undefined,
          seriesId: seriesChoice === '__new__' ? undefined : seriesChoice,
          episodes: episodesToImport,
          defaultTier,
          defaultMainGenre,
          defaultGenre,
          defaultArtist
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed.');
      setResult(data);
      if (data.imported > 0 && onImported) onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="account-card" style={{ maxWidth: 'none', marginBottom: '1.5rem' }}>
      <div className="account-eyebrow">Podcasts</div>
      <h3>Import an existing show from its RSS feed</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
        Already running a podcast somewhere else? Paste its RSS feed URL — most hosts (Spotify for
        Podcasters, Buzzsprout, Libsyn, and others) publish one. Every imported episode goes into
        pending review, same as anything else you submit.
      </p>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <form onSubmit={handlePreview} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="url"
          placeholder="https://feeds.example.com/your-show.xml"
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
          required
        />
        <button className="account-btn-secondary" type="submit" style={{ width: 'auto' }} disabled={previewing}>
          {previewing ? 'Reading feed…' : 'Preview'}
        </button>
      </form>

      {preview && (
        <>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
            {preview.showImage && <img src={preview.showImage} alt="" style={{ width: 64, height: 64, borderRadius: 8 }} />}
            <div>
              <strong>{preview.showTitle}</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>{preview.episodes.length} episodes found</div>
            </div>
          </div>

          <label>Import into</label>
          <select value={seriesChoice} onChange={(e) => setSeriesChoice(e.target.value)}>
            <option value="__new__">A new show</option>
            {(allSeries || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {seriesChoice === '__new__' && (
            <>
              <label>Show name</label>
              <input type="text" value={showName} onChange={(e) => setShowName(e.target.value)} required />
            </>
          )}

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Tier for these episodes</label>
              <select value={defaultTier} onChange={(e) => setDefaultTier(e.target.value)}>
                <option value="free">Free with ads</option>
                <option value="premium">Premium</option>
              </select>
            </div>
            <div className="admin-field">
              <label>Host / artist credit <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
              <input type="text" value={defaultArtist} onChange={(e) => setDefaultArtist(e.target.value)} />
            </div>
          </div>
          <div className="admin-field-row">
            <div className="admin-field">
              <label>Main genre</label>
              <select value={defaultMainGenre} onChange={(e) => setDefaultMainGenre(e.target.value)}>
                {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label>Genre tag <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
              <input type="text" value={defaultGenre} onChange={(e) => setDefaultGenre(e.target.value)} />
            </div>
          </div>

          <label style={{ marginTop: '0.8rem', display: 'block' }}>
            Episodes ({selected.size} of {preview.episodes.length} selected)
          </label>
          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid rgba(234,231,221,0.15)', borderRadius: 6, padding: '0.5rem', marginBottom: '1rem' }}>
            {preview.episodes.map((ep) => (
              <label key={ep.guid} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.4rem 0', fontWeight: 'normal', borderBottom: '1px solid rgba(234,231,221,0.06)' }}>
                <input type="checkbox" checked={selected.has(ep.guid)} onChange={() => toggleEpisode(ep.guid)} style={{ marginTop: '0.2rem' }} />
                <span>
                  <strong style={{ fontSize: '0.85rem' }}>{ep.title}</strong>
                  {!ep.audioUrl && <span style={{ color: 'var(--danger)', fontSize: '0.75rem' }}> — no audio file found, will be skipped</span>}
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-dim)' }}>
                    {ep.runtime && `${ep.runtime} · `}{ep.pubDate}
                  </div>
                </span>
              </label>
            ))}
          </div>

          <button className="account-btn-primary" onClick={handleImport} disabled={importing} style={{ width: 'auto' }}>
            {importing ? 'Importing…' : `Import ${selected.size} episode${selected.size === 1 ? '' : 's'}`}
          </button>
        </>
      )}

      {result && (
        <p style={{ marginTop: '1rem', color: result.failed.length > 0 ? 'var(--signal-amber)' : 'var(--ok)' }}>
          Imported {result.imported} episode{result.imported === 1 ? '' : 's'}.
          {result.failed.length > 0 && ` ${result.failed.length} failed: ${result.failed.map((f) => f.title).join(', ')}.`}
        </p>
      )}
    </div>
  );
}
