import { useState } from 'react';
import CloudflareHouseAdImport from './CloudflareHouseAdImport';
import { SITE } from '../lib/siteConfig';

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

const EMPTY = { title: '', advertiser: '', clickUrl: '', durationSeconds: '', width: '1280', height: '720' };

export default function HouseAdForm({ onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [source, setSource] = useState('quick'); // 'quick' | 'cloudflare'
  const [file, setFile] = useState(null);
  const [cloudflareReady, setCloudflareReady] = useState(null); // { cloudflareUid, duration } | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Reads the file's real duration the moment it's chosen, same as the
  // creator submission form does for episodes — VAST's <Duration> has to
  // match the actual clip, so getting this right automatically instead of
  // asking the admin to time it by hand avoids the most likely way this
  // form gets filled in wrong.
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
      if (video.videoWidth && video.videoHeight) {
        update('width', String(video.videoWidth));
        update('height', String(video.videoHeight));
      }
    };
    video.src = URL.createObjectURL(selectedFile);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);

    if (source === 'quick' && !file) {
      setError('Choose a video file.');
      return;
    }
    if (source === 'cloudflare' && !cloudflareReady) {
      setError('Wait for the Cloudflare import to finish first.');
      return;
    }

    setBusy(true);
    try {
      const body = { ...form };
      if (source === 'cloudflare') {
        body.cloudflareUid = cloudflareReady.cloudflareUid;
        // The admin can still type a different value in the Duration
        // field — this only pre-fills it when Cloudflare could detect one
        // and the admin hasn't already entered something themselves.
        if (!body.durationSeconds && cloudflareReady.duration) {
          body.durationSeconds = String(Math.round(cloudflareReady.duration));
        }
      } else {
        body.videoBase64 = await readAsDataUrl(file);
        body.videoFileName = file.name;
      }

      const res = await fetch('/api/admin/house-ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the ad.');

      setForm(EMPTY);
      setFile(null);
      setCloudflareReady(null);
      e.target.reset();
      if (onCreated) onCreated(data.ad);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="house-ad-form">
      <label>Title</label>
      <input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder={`${SITE.studio} Shop — Fall Drop`} required />

      <label>Advertiser (just for your own records — never shown to viewers)</label>
      <input value={form.advertiser} onChange={(e) => update('advertiser', e.target.value)} placeholder={SITE.studio} />

      <label>Where a click sends people</label>
      <input
        type="url"
        value={form.clickUrl}
        onChange={(e) => update('clickUrl', e.target.value)}
        placeholder="https://shop.studiotaprino.com"
        required
      />

      <label>Video</label>
      <div className="video-source-toggle" role="group" aria-label="Video source">
        <button type="button" className={source === 'quick' ? 'on' : ''} onClick={() => setSource('quick')}>
          Quick upload
        </button>
        <button type="button" className={source === 'cloudflare' ? 'on' : ''} onClick={() => setSource('cloudflare')}>
          Import via Cloudflare
        </button>
      </div>

      {source === 'quick' ? (
        <>
          <input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => handleFile(e.target.files[0] || null)} required={source === 'quick'} />
          <small className="house-ad-hint">
            A direct MP4 works best. Under 8MB — a 10–20 second clip at 720p, reasonably compressed,
            fits comfortably. Duration and dimensions fill in automatically once you choose a file.
          </small>
        </>
      ) : (
        <CloudflareHouseAdImport onReady={(result) => setCloudflareReady(result)} />
      )}

      <div className="house-ad-row">
        <div>
          <label>Duration (seconds)</label>
          <input
            type="number"
            min="1"
            value={form.durationSeconds}
            onChange={(e) => update('durationSeconds', e.target.value)}
            required
          />
        </div>
        <div>
          <label>Width</label>
          <input type="number" min="1" value={form.width} onChange={(e) => update('width', e.target.value)} />
        </div>
        <div>
          <label>Height</label>
          <input type="number" min="1" value={form.height} onChange={(e) => update('height', e.target.value)} />
        </div>
      </div>

      {error && <div className="house-ad-error">{error}</div>}

      <button className="unlock-btn" type="submit" disabled={busy}>
        {busy ? 'Uploading…' : 'Add house ad'}
      </button>
    </form>
  );
}
