import { useState } from 'react';

// Genuinely separate from CreatorSubmissionForm rather than a variant of
// it — this creates only a series shell (name, description, artwork), no
// episode at all. The episode-submission form's own "a new series not
// listed here" option and this share the same backing endpoint
// (api/creator/create-series.js), but the two forms themselves don't
// overlap enough to be worth merging into one component with a mode flag.
export default function AddSeriesForm({ onSubmitted }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [releaseYear, setReleaseYear] = useState('');
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('A series name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [posterBase64, thumbnailBase64] = await Promise.all([
        posterFile ? readAsDataUrl(posterFile) : null,
        thumbnailFile ? readAsDataUrl(thumbnailFile) : null
      ]);
      const res = await fetch('/api/creator/create-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          releaseYear: releaseYear || undefined,
          posterBase64,
          posterFileName: posterFile ? posterFile.name : undefined,
          thumbnailBase64,
          thumbnailFileName: thumbnailFile ? thumbnailFile.name : undefined
        })
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(res.status === 413 ? 'That image is too large — please use a smaller file.' : `Something went wrong (status ${res.status}). Please try again.`);
      }
      if (!res.ok) throw new Error(data.error || 'Could not create the series.');
      if (onSubmitted) onSubmitted(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
        This creates the series itself, pending admin review — no episode yet. Once it&rsquo;s created,
        you can add episodes to it any time through the normal submission form&rsquo;s series picker,
        without waiting for this review to finish.
      </p>

      <label>Series name</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />

      <label>Description</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ width: '100%', boxSizing: 'border-box' }} />

      <label>Release year — optional</label>
      <input type="number" value={releaseYear} onChange={(e) => setReleaseYear(e.target.value)} placeholder={String(new Date().getFullYear())} />

      <label>Poster — optional</label>
      <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} />

      <label>Thumbnail — optional</label>
      <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} />

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.6rem' }}>{error}</p>}

      <button type="submit" className="account-btn-primary" style={{ marginTop: '1.2rem' }} disabled={busy}>
        {busy ? 'Creating…' : 'Create series for review'}
      </button>
    </form>
  );
}
