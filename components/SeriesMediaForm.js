import { useState } from 'react';
import * as tus from 'tus-js-client';

function readAsDataUrl(f) {
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    reader.readAsDataURL(f);
  });
}

// Deliberately a separate, local upload flow rather than reusing
// UploadContext — a series trailer is an occasional, one-off action (set
// it once, rarely touch it again), unlike episode video uploads which are
// the main day-to-day workflow that needs to survive page navigation.
// Simpler to keep this self-contained than to generalize the shared
// context for a case that doesn't need its persistence.
async function uploadTrailer(file, onProgress) {
  const urlRes = await fetch('/api/creator/get-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileSize: file.size, fileName: file.name })
  });
  const urlData = await urlRes.json();
  if (!urlRes.ok) throw new Error(urlData.error || 'Could not get an upload link.');

  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: urlData.uploadUrl,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      metadata: { filename: file.name, filetype: file.type },
      onError: (error) => reject(error),
      onProgress: (bytesUploaded, bytesTotal) => onProgress(Math.round((bytesUploaded / bytesTotal) * 100)),
      onSuccess: () => resolve()
    });
    upload.start();
  });

  return urlData.uid;
}

export default function SeriesMediaForm({ allSeries, onSaved }) {
  const [mode, setMode] = useState(allSeries.length > 0 ? 'existing' : 'new');
  const [seriesId, setSeriesId] = useState(allSeries[0] ? allSeries[0].id : '');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [trailerFile, setTrailerFile] = useState(null);
  const [status, setStatus] = useState(null); // null | 'uploading-trailer' | 'saving' | 'done' | 'error'
  const [trailerProgress, setTrailerProgress] = useState(0);
  const [error, setError] = useState(null);

  const selectedSeries = mode === 'existing' ? allSeries.find((s) => s.id === seriesId) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (mode === 'new' && !newName.trim()) {
      setError('Give the new series a name.');
      return;
    }
    if (mode === 'existing' && !seriesId) {
      setError('Choose a series.');
      return;
    }
    if (!posterFile && !thumbnailFile && !trailerFile) {
      setError('Add at least a poster, thumbnail, or trailer.');
      return;
    }

    try {
      let targetSeriesId = seriesId;
      if (mode === 'new') {
        setStatus('saving');
        const res = await fetch('/api/creator/create-series', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName, description: newDescription })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not create the series.');
        targetSeriesId = data.id;
      }

      let trailerUid;
      if (trailerFile) {
        setStatus('uploading-trailer');
        setTrailerProgress(0);
        trailerUid = await uploadTrailer(trailerFile, setTrailerProgress);
      }

      setStatus('saving');
      const [posterBase64, thumbnailBase64] = await Promise.all([readAsDataUrl(posterFile), readAsDataUrl(thumbnailFile)]);
      const res = await fetch('/api/creator/series-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seriesId: targetSeriesId,
          ...(posterBase64 ? { posterBase64, posterFileName: posterFile.name } : {}),
          ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: thumbnailFile.name } : {}),
          ...(trailerUid ? { trailerUid } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the series media.');

      setStatus('done');
      setPosterFile(null);
      setThumbnailFile(null);
      setTrailerFile(null);
      setNewName('');
      setNewDescription('');
      onSaved(targetSeriesId);
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  }

  const busy = status === 'uploading-trailer' || status === 'saving';

  return (
    <div className="account-card" style={{ marginTop: '1.5rem' }}>
      <div className="account-eyebrow">Series info</div>
      <h3>Set a trailer and artwork once per series</h3>
      <p>
        A series&rsquo; own trailer, poster, and thumbnail are used everywhere an episode of it appears — the homepage row,
        the genre grid, and the series page hero — so individual episodes in that series don&rsquo;t each need their own artwork.
        An episode&rsquo;s own artwork (if you add it) still takes priority for that one episode.
      </p>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.6rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 'normal' }}>
            <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} disabled={allSeries.length === 0} />
            Existing series
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 'normal' }}>
            <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
            New series
          </label>
        </div>

        {mode === 'existing' ? (
          <>
            <label>Series</label>
            <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
              {allSeries.length === 0 && <option value="">No series yet — create one instead</option>}
              {allSeries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {selectedSeries && (
              <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.4rem' }}>
                Currently has: {selectedSeries.poster ? 'poster ✓' : 'poster —'}, {selectedSeries.thumbnail ? 'thumbnail ✓' : 'thumbnail —'}, {selectedSeries.trailerSrc ? 'trailer ✓' : 'trailer —'}
              </p>
            )}
          </>
        ) : (
          <>
            <label>Series name</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="The Cipher Keeper" />
            <label>Description</label>
            <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={2} style={{ width: '100%', boxSizing: 'border-box' }} />
          </>
        )}

        <label>Series poster — 2:3 portrait, optional</label>
        <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

        <label>Series thumbnail — 16:9 landscape, optional</label>
        <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

        <label>Series trailer — plays in the homepage hero if a title from this series gets featured, optional</label>
        <input type="file" accept="video/*" onChange={(e) => setTrailerFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

        {status === 'uploading-trailer' && (
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>Uploading trailer… {trailerProgress}%</p>
        )}
        {status === 'saving' && <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>Saving…</p>}
        {status === 'done' && <p style={{ fontSize: '0.8rem', color: '#7fbf8f' }}>Saved.</p>}
        {error && <p style={{ color: '#e08a6f', fontSize: '0.85rem' }}>{error}</p>}

        <button className="account-btn-primary" type="submit" disabled={busy} style={{ width: 'auto' }}>
          {busy ? 'Working…' : 'Save series media'}
        </button>
      </form>
    </div>
  );
}
