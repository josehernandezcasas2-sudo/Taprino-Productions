import { useState } from 'react';

function readAsDataUrl(f) {
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${f.name}.`));
    reader.readAsDataURL(f);
  });
}

// Works regardless of the submission's status — pending or already
// approved and live — since adding artwork doesn't touch anything an
// admin already signed off on.
export default function ArtworkModal({ submission, onClose, onSaved }) {
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    if (!posterFile && !thumbnailFile) {
      setError('Choose at least one image.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const [posterBase64, thumbnailBase64] = await Promise.all([readAsDataUrl(posterFile), readAsDataUrl(thumbnailFile)]);
      const res = await fetch('/api/creator/add-artwork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: submission.id,
          ...(posterBase64 ? { posterBase64, posterFileName: posterFile.name } : {}),
          ...(thumbnailBase64 ? { thumbnailBase64, thumbnailFileName: thumbnailFile.name } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the artwork.');
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
          <h3>{submission.poster || submission.thumbnail ? 'Replace artwork' : 'Add artwork'}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.4rem' }}>
          For &ldquo;{submission.title}&rdquo; — works whether this is still pending or already live.
        </p>

        <form onSubmit={handleSave}>
          <label>Poster image — 2:3 portrait, optional</label>
          <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

          <label>Thumbnail image — 16:9 landscape, optional</label>
          <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem' }}>
            <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
              {saving ? 'Uploading…' : 'Save artwork'}
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
