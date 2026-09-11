import { useState } from 'react';

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

const EMPTY = { title: '', clickUrl: '', durationSeconds: '', budgetDollars: '' };

export default function AdvertiserAdForm({ onSubmitted }) {
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Same client-side detection as admin's own house ad form — reads the
  // real file's duration the moment it's chosen, rather than asking the
  // advertiser to time their own clip by hand. VAST's <Duration> tag has
  // to exactly match the real file, so getting this right automatically
  // avoids the single most likely way this form gets filled in wrong.
  // Still editable afterward, same as the admin form, in case detection
  // ever comes back slightly off for an unusual file.
  function handleFile(selectedFile) {
    setFile(selectedFile);
    if (!selectedFile) return;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      if (isFinite(video.duration) && video.duration > 0) {
        update('durationSeconds', Math.round(video.duration).toString());
      }
    };
    video.src = URL.createObjectURL(selectedFile);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError('Choose a video file.');
      return;
    }
    if (!form.durationSeconds || Number(form.durationSeconds) <= 0) {
      setError('Duration could not be detected — please enter it manually.');
      return;
    }

    setBusy(true);
    try {
      const videoBase64 = await readAsDataUrl(file);
      // Dollars in the form, cents on the wire — keeps the advertiser
      // typing a normal-looking amount ("50" or "50.00") while the API
      // and database stay in cents throughout, avoiding floating-point
      // money bugs anywhere real spend gets tracked.
      const budgetTotalCents = form.budgetDollars ? Math.round(Number(form.budgetDollars) * 100) : null;

      const res = await fetch('/api/ads/submit-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          videoBase64,
          videoFileName: file.name,
          durationSeconds: Number(form.durationSeconds),
          clickUrl: form.clickUrl || undefined,
          budgetTotalCents
        })
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(res.status === 413 ? 'That video is too large — please use a smaller file.' : `Something went wrong (status ${res.status}). Please try again.`);
      }
      if (!res.ok) throw new Error(data.error || 'Could not submit the ad.');

      setForm(EMPTY);
      setFile(null);
      e.target.reset();
      if (onSubmitted) onSubmitted(data.ad);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="house-ad-form">
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
        Submitted ads are reviewed before going live — you&rsquo;ll see the status change here once
        that happens. The rate your budget is billed at is set during review, so what you enter
        below is a spending cap, not a price.
      </p>

      <label>Ad title <span style={{ fontWeight: 'normal', opacity: 0.65 }}>— for your own reference, not shown to viewers</span></label>
      <input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="Fall promo" required />

      <label>Where a click sends people <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — leave blank for a pure awareness clip</span></label>
      <input type="url" value={form.clickUrl} onChange={(e) => update('clickUrl', e.target.value)} placeholder="https://example.com" />

      <label>Video</label>
      <input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => handleFile(e.target.files[0] || null)} required />
      <small className="house-ad-hint">
        A direct MP4 works best. Under 8MB — a 10–20 second clip at 720p, reasonably compressed,
        fits comfortably. Duration fills in automatically once you choose a file.
      </small>

      <label>Duration (seconds)</label>
      <input type="number" min="1" value={form.durationSeconds} onChange={(e) => update('durationSeconds', e.target.value)} required />

      <label>Budget <span style={{ fontWeight: 'normal', opacity: 0.65 }}>— your total spending cap for this ad, in dollars, optional</span></label>
      <input type="number" min="0" step="0.01" value={form.budgetDollars} onChange={(e) => update('budgetDollars', e.target.value)} placeholder="50.00" />

      {error && <div className="house-ad-error">{error}</div>}

      <button className="unlock-btn" type="submit" disabled={busy}>
        {busy ? 'Uploading…' : 'Submit for review'}
      </button>
    </form>
  );
}
