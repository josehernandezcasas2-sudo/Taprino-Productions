import { useState } from 'react';

function readAsDataUrl(file) {
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function centsToDollarsInput(cents) {
  return cents != null ? (cents / 100).toFixed(2) : '';
}

export default function AdvertiserEditAdModal({ ad, onClose, onSaved }) {
  const [title, setTitle] = useState(ad.title);
  const [durationSeconds, setDurationSeconds] = useState(String(ad.durationSeconds));
  const [clickUrl, setClickUrl] = useState(ad.clickUrl || '');
  const [budgetDollars, setBudgetDollars] = useState(centsToDollarsInput(ad.budgetTotalCents));
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function handleVideoFile(selectedFile) {
    setVideoFile(selectedFile);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    if (!selectedFile) {
      setVideoPreviewUrl(null);
      return;
    }
    const previewUrl = URL.createObjectURL(selectedFile);
    setVideoPreviewUrl(previewUrl);
    // Same auto-detection as the original submission form and admin's
    // own review modal — replacing the clip should update the duration
    // field to match, not silently keep the old file's length.
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      if (isFinite(video.duration) && video.duration > 0) {
        setDurationSeconds(Math.round(video.duration).toString());
      }
    };
    video.src = previewUrl;
  }

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const videoBase64 = await readAsDataUrl(videoFile);
      const res = await fetch('/api/ads/edit-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: ad.id,
          title,
          durationSeconds: Number(durationSeconds),
          clickUrl,
          budgetTotalCents: budgetDollars ? Math.round(Number(budgetDollars) * 100) : null,
          ...(videoBase64 ? { videoBase64, videoFileName: videoFile.name } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save changes.');
      if (onSaved) onSaved(data.ad);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <h3>Edit ad</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginBottom: '0.8rem' }}>
          Only available while this ad is still pending review — once admin makes a decision,
          these fields lock.
        </p>

        <video src={videoPreviewUrl || ad.videoUrl} controls style={{ width: '100%', borderRadius: '8px', marginBottom: '1rem', background: '#000' }} />

        <label>Replace video <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — leave blank to keep the current clip</span></label>
        <input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => handleVideoFile(e.target.files[0] || null)} />

        <label>Ad title <span style={{ fontWeight: 'normal', opacity: 0.65 }}>— for your own reference, not shown to viewers</span></label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />

        <label>Where a click sends people <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
        <input type="url" value={clickUrl} onChange={(e) => setClickUrl(e.target.value)} />

        <label>Duration (seconds)</label>
        <input type="number" min="1" value={durationSeconds} onChange={(e) => setDurationSeconds(e.target.value)} required />

        <label>Optional cap for this ad <span style={{ fontWeight: 'normal', opacity: 0.65 }}>— leave blank for no cap</span></label>
        <input type="number" min="0" step="0.01" value={budgetDollars} onChange={(e) => setBudgetDollars(e.target.value)} placeholder="Leave blank for no cap" />

        {error && <div className="house-ad-error">{error}</div>}

        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.2rem' }}>
          <button type="button" className="account-btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="unlock-btn" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
