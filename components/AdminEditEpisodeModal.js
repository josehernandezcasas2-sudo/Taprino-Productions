import { useEffect, useState } from 'react';

const MAIN_GENRES = ['Comedy', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];

// Matches lib/cloudflareUpload.js's cloudflareUidFromUrl exactly, done
// client-side so the modal can show "what's currently attached" the
// instant it opens, without a round trip just to extract an ID from a URL
// the browser already has in `episode.src`.
function uidFromPlaybackUrl(url) {
  if (!url) return null;
  const match = url.match(/cloudflarestream\.com\/([a-zA-Z0-9]+)\//);
  return match ? match[1] : null;
}

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
  const [videoCheck, setVideoCheck] = useState(null); // null | 'checking' | { state, errorReasonText, readyToStream, ... } | { error }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmNoVideo, setConfirmNoVideo] = useState(false);

  const existingUid = uidFromPlaybackUrl(episode.src);

  // Runs the moment the modal opens — this is what makes "is a video
  // actually attached" something you SEE rather than something you have
  // to trust. Checking against Cloudflare directly (not just "is src
  // non-empty") is what catches a video that saved but never finished
  // processing, too.
  useEffect(() => {
    let cancelled = false;
    if (!existingUid) {
      setVideoCheck({ none: true });
      return;
    }
    setVideoCheck('checking');
    fetch(`/api/admin/check-cloudflare-video?uid=${encodeURIComponent(existingUid)}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!cancelled) setVideoCheck(ok ? data : { error: data.error });
      })
      .catch(() => {
        if (!cancelled) setVideoCheck({ error: 'Could not reach Cloudflare to check.' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setConfirmNoVideo(false);
  }

  async function checkNewVideo() {
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

  // The actual guard against what most likely happened here: approving an
  // episode that has no watchable video at all. Only blocks on the exact
  // dangerous combination — status is (or is becoming) approved, AND
  // there's neither an existing attached video nor a new one being linked
  // in this save. Everything else saves normally, no extra click.
  //
  // `dangerous` reflects the data and stays stable across both clicks of
  // the confirmation, so the warning and button label don't flicker or
  // change meaning between the first and second press — only the actual
  // submit behavior changes, gated separately by `confirmNoVideo`.
  const noVideoAtAll = !existingUid && !videoUid.trim();
  const dangerous = form.status === 'approved' && noVideoAtAll;

  async function handleSave(e) {
    e.preventDefault();
    if (dangerous && !confirmNoVideo) {
      setConfirmNoVideo(true);
      return;
    }
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
      <div className="modal-card admin-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit episode</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="admin-edit-sub">
          Admin edit — works on any episode regardless of status, including changing status itself.
        </p>

        {/* The self-verifying part: what's actually attached right now,
            checked live against Cloudflare rather than just "a src is set." */}
        <div className={`admin-video-status ${videoCheck === 'checking' ? 'checking' : videoCheck?.error ? 'bad' : videoCheck?.none ? 'none' : videoCheck?.state === 'ready' ? 'good' : videoCheck?.state === 'error' ? 'bad' : 'pending'}`}>
          {videoCheck === 'checking' && <span>Checking the currently attached video…</span>}
          {videoCheck?.none && <span><strong>No video attached.</strong> This episode has nothing to play — link one below before approving it.</span>}
          {videoCheck?.error && <span><strong>Couldn&rsquo;t verify the attached video.</strong> {videoCheck.error}</span>}
          {videoCheck?.state === 'ready' && <span><strong>✓ Video attached and ready to stream.</strong></span>}
          {videoCheck?.state === 'error' && <span><strong>Attached video failed on Cloudflare&rsquo;s side.</strong> {videoCheck.errorReasonText || videoCheck.errorReasonCode} — this episode won&rsquo;t play until it&rsquo;s replaced.</span>}
          {videoCheck && videoCheck !== 'checking' && !videoCheck.none && !videoCheck.error && videoCheck.state && videoCheck.state !== 'ready' && videoCheck.state !== 'error' && (
            <span><strong>Still processing on Cloudflare</strong> ({videoCheck.state}{videoCheck.pctComplete ? `, ${videoCheck.pctComplete}%` : ''}) — not watchable yet.</span>
          )}
        </div>

        <form onSubmit={handleSave} className="admin-edit-form">
          <div className="admin-field">
            <label>Title</label>
            <input type="text" value={form.title} onChange={(e) => update('title', e.target.value)} required />
          </div>

          <div className="admin-field">
            <label>Description</label>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} required rows={3} />
          </div>

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Artist credit</label>
              <input type="text" value={form.artist} onChange={(e) => update('artist', e.target.value)} required />
            </div>
            <div className="admin-field">
              <label>Runtime</label>
              <input type="text" value={form.runtime} onChange={(e) => update('runtime', e.target.value)} placeholder="mm:ss" required />
            </div>
          </div>

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Main genre</label>
              <select value={form.mainGenre} onChange={(e) => update('mainGenre', e.target.value)} required>
                {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label>Specific genre</label>
              <input type="text" value={form.genre} onChange={(e) => update('genre', e.target.value)} required />
            </div>
          </div>

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Tier</label>
              <select value={form.tier} onChange={(e) => update('tier', e.target.value)}>
                <option value="free">Free</option>
                <option value="premium">Cipher Circle (premium)</option>
              </select>
            </div>
            <div className="admin-field">
              <label>Status</label>
              <select value={form.status} onChange={(e) => update('status', e.target.value)}>
                <option value="pending">Pending</option>
                <option value="approved">Approved — live</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          <label className="admin-checkbox">
            <input type="checkbox" checked={form.featured} onChange={(e) => update('featured', e.target.checked)} />
            Eligible for the homepage hero rotation
          </label>

          <div className="admin-field-row">
            <div className="admin-field">
              <label>Replace poster <span className="admin-optional">optional</span></label>
              <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} />
            </div>
            <div className="admin-field">
              <label>Replace thumbnail <span className="admin-optional">optional</span></label>
              <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} />
            </div>
          </div>

          <div className="admin-field">
            <label>Replace video — Cloudflare video ID <span className="admin-optional">optional</span></label>
            <p className="admin-field-hint">
              For a file uploaded directly through Cloudflare&rsquo;s own dashboard (the fallback when
              in-app upload keeps failing) — paste its video ID, not a URL.
            </p>
            <div className="admin-video-input-row">
              <input
                type="text"
                value={videoUid}
                onChange={(e) => { setVideoUid(e.target.value); setConfirmNoVideo(false); }}
                placeholder="e.g. c792e0c49f72f77e00693d10c0ef02cd"
              />
              <button type="button" onClick={checkNewVideo} disabled={!videoUid.trim() || videoCheck === 'checking'}>
                {videoCheck === 'checking' ? 'Checking…' : 'Check'}
              </button>
            </div>
            {videoUid.trim() && videoCheck && videoCheck !== 'checking' && !videoCheck.none && (
              videoCheck.error ? (
                <p className="admin-video-note bad">{videoCheck.error}</p>
              ) : videoCheck.state === 'error' ? (
                <p className="admin-video-note bad">
                  Cloudflare could not process this file: {videoCheck.errorReasonText || videoCheck.errorReasonCode}. Re-export and re-upload before linking.
                </p>
              ) : videoCheck.state === 'ready' ? (
                <p className="admin-video-note good">✓ Ready to stream — safe to save.</p>
              ) : (
                <p className="admin-video-note pending">
                  Still processing on Cloudflare&rsquo;s side ({videoCheck.state}{videoCheck.pctComplete ? `, ${videoCheck.pctComplete}%` : ''}) — you can save now, but it won&rsquo;t be watchable until this finishes.
                </p>
              )
            )}
          </div>

          {dangerous && (
            <div className="admin-warning">
              <strong>This episode has no video attached at all.</strong> Setting it to Approved will
              make it appear on the site with nothing to play.{' '}
              {confirmNoVideo
                ? 'Click Save anyway once more to confirm.'
                : 'Click Save anyway below to confirm you want to do this — or paste a Cloudflare video ID above first.'}
            </div>
          )}

          {error && <p className="admin-error">{error}</p>}

          <div className="admin-actions">
            <button className="account-btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : dangerous ? 'Save anyway' : 'Save changes'}
            </button>
            <button className="account-btn-secondary" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
