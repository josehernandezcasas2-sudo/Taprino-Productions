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

// A CPM of 600 cents ($6.00 per 1,000 impressions) works out to
// $0.006 per single impression — this is the only place that
// conversion happens, since every other rate in this file is already a
// stored per-impression dollar figure.
function cpmCentsToPerImpressionDollars(cpmCents) {
  return (cpmCents / 100 / 1000).toFixed(4);
}

export default function AdminReviewAdModal({ ad, onClose, onResolved, defaultCpmCents }) {
  const [title, setTitle] = useState(ad.title);
  const [durationSeconds, setDurationSeconds] = useState(String(ad.durationSeconds));
  const [clickUrl, setClickUrl] = useState(ad.clickUrl || '');
  // Only fall back to the site-wide default when this particular ad has
  // never had a rate set — an ad already carrying its own
  // costPerImpressionCents (e.g. re-opening one already reviewed) keeps
  // showing exactly that, never silently swapped for today's default.
  const [costPerImpressionDollars, setCostPerImpressionDollars] = useState(
    ad.costPerImpressionCents != null
      ? centsToDollarsInput(ad.costPerImpressionCents)
      : cpmCentsToPerImpressionDollars(defaultCpmCents || 600)
  );
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [rejectionReason, setRejectionReason] = useState(ad.rejectionReason || '');
  const [busy, setBusy] = useState(null); // 'approved' | 'rejected' | null
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
    // Same auto-detection as the advertiser's own submission form — if
    // admin replaces the video with a different clip, the duration field
    // should reflect the new file, not silently keep the old one's value.
    // Reuses the same object URL just created for the preview above,
    // rather than minting a second one for the same file that would
    // never get revoked.
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      if (isFinite(video.duration) && video.duration > 0) {
        setDurationSeconds(Math.round(video.duration).toString());
      }
    };
    video.src = previewUrl;
  }

  async function decide(decision) {
    setError(null);
    if (decision === 'approved' && (!costPerImpressionDollars || Number(costPerImpressionDollars) < 0)) {
      setError('Set a billing rate before approving — this is what the advertiser\'s budget gets charged per impression.');
      return;
    }
    if (decision === 'rejected' && !rejectionReason.trim()) {
      setError('Enter a reason before rejecting — the advertiser sees this, so they know what to fix.');
      return;
    }
    setBusy(decision);
    try {
      const videoBase64 = await readAsDataUrl(videoFile);
      const res = await fetch('/api/admin/review-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: ad.id,
          decision,
          title,
          durationSeconds: Number(durationSeconds),
          clickUrl,
          costPerImpressionDollars: costPerImpressionDollars || null,
          rejectionReason: decision === 'rejected' ? rejectionReason.trim() : undefined,
          ...(videoBase64 ? { videoBase64, videoFileName: videoFile.name } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save this decision.');
      if (onResolved) onResolved(data.ad);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <h3>Review ad — {ad.accountCompanyName || 'Unknown advertiser'}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginBottom: '0.8rem' }}>
          Submitted by {ad.accountContactEmail || 'unknown'}
          {ad.budgetTotalCents != null
            ? ` · optional cap on this ad: $${(ad.budgetTotalCents / 100).toFixed(2)}`
            : ' · no per-ad cap set — draws from the advertiser\'s account credits until they run out'}
        </p>

        <video src={videoPreviewUrl || ad.videoUrl} controls style={{ width: '100%', borderRadius: '8px', marginBottom: '1rem', background: '#000' }} />

        <label>Replace video <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — leave blank to keep the submitted clip</span></label>
        <input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => handleVideoFile(e.target.files[0] || null)} />

        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />

        <label>Duration (seconds)</label>
        <input type="number" min="1" value={durationSeconds} onChange={(e) => setDurationSeconds(e.target.value)} />

        <label>Click-through URL <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional</span></label>
        <input type="url" value={clickUrl} onChange={(e) => setClickUrl(e.target.value)} />

        <label>Billing rate — cost per impression (dollars) <span style={{ fontWeight: 'normal', opacity: 0.65 }}>required before approving</span></label>
        <input type="number" min="0" step="0.0001" value={costPerImpressionDollars} onChange={(e) => setCostPerImpressionDollars(e.target.value)} placeholder="0.0060" />
        <small className="house-ad-hint">
          This is the rate the advertiser&rsquo;s credits get billed at per impression — they never
          see this number directly. Pre-filled from your site-wide CPM default
          {defaultCpmCents != null && ad.costPerImpressionCents == null && ` ($${(defaultCpmCents / 100).toFixed(2)} per 1,000 impressions)`};
          change it here to set a different rate just for this ad.
          {costPerImpressionDollars && !Number.isNaN(Number(costPerImpressionDollars)) && (
            <> That works out to ${(Number(costPerImpressionDollars) * 1000).toFixed(2)} per 1,000 impressions.</>
          )}
        </small>

        <label>Rejection reason <span style={{ fontWeight: 'normal', opacity: 0.65 }}>required only if you reject — the advertiser sees this</span></label>
        <textarea
          value={rejectionReason}
          onChange={(e) => setRejectionReason(e.target.value)}
          placeholder="e.g. Video quality too low, or click-through link doesn't work"
          rows={2}
        />

        {error && <div className="house-ad-error">{error}</div>}

        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.2rem' }}>
          <button type="button" className="account-btn-secondary" style={{ color: 'var(--danger)' }} onClick={() => decide('rejected')} disabled={!!busy}>
            {busy === 'rejected' ? 'Rejecting…' : 'Reject'}
          </button>
          <button type="button" className="unlock-btn" onClick={() => decide('approved')} disabled={!!busy}>
            {busy === 'approved' ? 'Approving…' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
