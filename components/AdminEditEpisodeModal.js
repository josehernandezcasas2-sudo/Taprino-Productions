import { useEffect, useState } from 'react';
import { SITE } from '../lib/siteConfig';

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

// Shows enough of a Cloudflare video ID to recognise WHICH video is
// attached, without splashing the full credential-ish string across the
// screen on every open. Four leading characters is comfortably enough to
// tell two videos apart at this library's scale, and the full value is one
// click away for anyone who needs to paste it into Cloudflare's dashboard.
function maskUid(uid) {
  if (!uid) return null;
  if (uid.length <= 4) return uid;
  return `${uid.slice(0, 4)}${'*'.repeat(Math.min(uid.length - 4, 24))}`;
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

// HTML date inputs require exactly YYYY-MM-DD — the server sends full ISO
// timestamps, so this trims one down to what the input actually accepts.
function toDateInputValue(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
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
    featured: !!episode.featured,
    availableFrom: toDateInputValue(episode.availableFrom),
    availableUntil: toDateInputValue(episode.availableUntil)
  });
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [videoUid, setVideoUid] = useState('');
  const [videoCheck, setVideoCheck] = useState(null); // null | 'checking' | { state, errorReasonText, readyToStream, ... } | { error }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmNoVideo, setConfirmNoVideo] = useState(false);
  const [revealUid, setRevealUid] = useState(false);

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
                <option value="premium">{SITE.premiumTier} (premium)</option>
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
              <label>Available from <span className="admin-optional">optional</span></label>
              <input type="date" value={form.availableFrom} onChange={(e) => update('availableFrom', e.target.value)} />
              <p className="admin-field-hint">Counts as a &ldquo;new release&rdquo; for a while after this date.</p>
            </div>
            <div className="admin-field">
              <label>Available until <span className="admin-optional">optional</span></label>
              <input type="date" value={form.availableUntil} onChange={(e) => update('availableUntil', e.target.value)} />
              <p className="admin-field-hint">
                Shows as &ldquo;leaving soon&rdquo; beforehand. Once this date passes, it&rsquo;s
                automatically flagged for deletion review — it won&rsquo;t vanish without you seeing
                it first.
              </p>
            </div>
          </div>

          <div className="eyebrow admin-media-heading">Current media</div>

          <div className="admin-media-grid">
            <div className={`admin-media-slot ${posterFile ? 'replacing' : episode.poster ? 'has' : 'empty'}`}>
              <div className="admin-media-preview">
                {episode.poster ? (
                  <img src={episode.poster} alt="" />
                ) : (
                  <span className="admin-media-none">None</span>
                )}
              </div>
              <div className="admin-media-body">
                <div className="admin-media-label">
                  <span className={`admin-connection-dot ${episode.poster ? 'connected' : 'disconnected'}`} aria-hidden="true" />
                  Poster
                </div>
                <div className="admin-media-state">
                  {posterFile ? `Replacing with ${posterFile.name}` : episode.poster ? 'In use' : 'Not set'}
                </div>
                <label className="admin-media-action">
                  {episode.poster ? 'Replace…' : 'Upload…'}
                  <input type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} />
                </label>
                {posterFile && (
                  <button type="button" className="admin-media-undo" onClick={() => setPosterFile(null)}>
                    Keep existing
                  </button>
                )}
              </div>
            </div>

            <div className={`admin-media-slot ${thumbnailFile ? 'replacing' : episode.thumbnail ? 'has' : 'empty'}`}>
              <div className="admin-media-preview">
                {episode.thumbnail ? (
                  <img src={episode.thumbnail} alt="" />
                ) : (
                  <span className="admin-media-none">None</span>
                )}
              </div>
              <div className="admin-media-body">
                <div className="admin-media-label">
                  <span className={`admin-connection-dot ${episode.thumbnail ? 'connected' : 'disconnected'}`} aria-hidden="true" />
                  Thumbnail
                </div>
                <div className="admin-media-state">
                  {thumbnailFile ? `Replacing with ${thumbnailFile.name}` : episode.thumbnail ? 'In use' : 'Not set'}
                </div>
                <label className="admin-media-action">
                  {episode.thumbnail ? 'Replace…' : 'Upload…'}
                  <input type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} />
                </label>
                {thumbnailFile && (
                  <button type="button" className="admin-media-undo" onClick={() => setThumbnailFile(null)}>
                    Keep existing
                  </button>
                )}
              </div>
            </div>
          </div>

          {(posterFile || thumbnailFile) && (
            <div className="admin-warning admin-warning-soft">
              <strong>Artwork will be replaced when you save.</strong> The current image is
              overwritten and isn&rsquo;t recoverable from here — make sure you still have the
              original somewhere before saving.
            </div>
          )}

          <div className="admin-field">
            <label>Video</label>

            {/* Showing WHICH video is attached, not just whether one is.
                Previously this field sat empty even when a video was
                perfectly well attached, which read as "nothing here" and is
                what made it feel like saved IDs weren't sticking. */}
            {existingUid ? (
              <div className="admin-uid-current">
                <div className="admin-uid-row">
                  <span
                    className={`admin-connection-dot ${videoCheck?.state === 'ready' ? 'connected' : videoCheck === 'checking' ? 'checking' : 'disconnected'}`}
                    aria-hidden="true"
                  />
                  <span className="admin-uid-label">Attached ID</span>
                  <code className="admin-uid-value">{revealUid ? existingUid : maskUid(existingUid)}</code>
                  <button
                    type="button"
                    className="admin-uid-toggle"
                    onClick={() => setRevealUid((r) => !r)}
                    aria-label={revealUid ? 'Hide full video ID' : 'Show full video ID'}
                  >
                    {revealUid ? 'Hide' : 'Show full'}
                  </button>
                </div>
                <p className="admin-uid-note">
                  Leave the field below empty to keep this video. Pasting a new ID
                  <strong> permanently swaps out what viewers watch</strong> — the current video is
                  detached from this episode and any watch progress people have on it stops lining up.
                </p>
              </div>
            ) : (
              <p className="admin-field-hint">
                No video is attached to this episode yet.
              </p>
            )}

            <label className="admin-sub-label">
              {existingUid ? 'Swap in a different video' : 'Attach a video'}{' '}
              <span className="admin-optional">Cloudflare video ID, not a URL</span>
            </label>
            <p className="admin-field-hint">
              For a file uploaded directly through Cloudflare&rsquo;s own dashboard (the fallback when
              in-app upload keeps failing) — paste its video ID.
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

          {existingUid && videoUid.trim() && videoUid.trim() !== existingUid && (
            <div className="admin-warning">
              <strong>You&rsquo;re replacing the video on a published episode.</strong> Once saved,
              anyone watching this episode gets the new file instead. Saved watch positions will
              point at the wrong moments, and if the new video is shorter, some people&rsquo;s
              progress will sit past its end.
            </div>
          )}

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
