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

// The show editor's title image types (components/show/EpisodeEditor.js):
// a PNG (or WebP) with a transparent background, stored as it is.
const TITLE_IMAGE_ACCEPT = 'image/png,image/webp';

// Works regardless of the submission's status — pending or already
// approved and live — since adding artwork doesn't touch anything an
// admin already signed off on (on a live title the new art waits for
// approval: /api/creator/add-artwork stages it).
//
// The title image (Jose, 2026-11-12: "the goal was that if someone wanted
// to add a custom title, they could"): the title set as a picture, which
// a title's own page draws in place of the text title. It goes through the
// show editor's own save (PATCH /api/show/episode/<id> with
// titleImageBase64 or removeTitleImage — lib/showPage.js updateEpisode,
// which works for a standalone title too): on a live title it waits for
// approval (migration 120's pending_title_image_url / _removal; before 120
// that answers 503 and the slot says so), otherwise it applies at once.
export default function ArtworkModal({ submission, onClose, onSaved }) {
  const [posterFile, setPosterFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [titleFile, setTitleFile] = useState(null);
  const [removeTitle, setRemoveTitle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const live = submission.status === 'approved';
  const titleSlot = !['podcast', 'vertical'].includes(submission.contentType);
  const titleWaiting = Boolean(submission.pendingTitleImageUrl) || submission.pendingTitleImageRemoval === true;
  // A live title's new title image needs migration 120 to wait in.
  const titleBlocked = live && submission.titleImageWaitReady === false;

  async function handleSave(e) {
    e.preventDefault();
    if (!posterFile && !thumbnailFile && !titleFile && !removeTitle) {
      setError('Choose at least one image.');
      return;
    }
    setSaving(true);
    setError(null);
    const words = [];
    try {
      if (posterFile || thumbnailFile) {
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
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not save the artwork.');
        words.push(data.staged ? 'The new art waits for approval.' : 'The new art is saved.');
      }
      if (titleFile || removeTitle) {
        const titleImageBase64 = titleFile ? await readAsDataUrl(titleFile) : null;
        const res = await fetch(`/api/show/episode/${encodeURIComponent(String(submission.id))}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(titleImageBase64 ? { titleImageBase64, titleImageFileName: titleFile.name } : { removeTitleImage: true })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(words.length ? `${words.join(' ')} But the title image didn’t save: ${data.error || 'try again.'}` : data.error || 'Could not save the title image.');
        const waits = Array.isArray(data.staged) && data.staged.some((f) => f === 'titleImage' || f === 'titleImageRemoval');
        words.push(removeTitle
          ? (waits ? 'Removing the title image waits for approval.' : 'The title image is removed: the title shows as text.')
          : (waits ? 'The new title image waits for approval; visitors see the live one until then.' : 'The title image is saved.'));
      }
      setDone(words.join(' '));
    } catch (err) {
      setError(err.message);
    } finally {
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
          For &ldquo;{submission.title}&rdquo; — works whether this is still pending or already live{live ? '; on a live title the new art waits for approval' : ''}.
        </p>

        {done ? (
          <>
            <p style={{ color: 'var(--ok)' }}>{done}</p>
            <button className="account-btn-primary" type="button" style={{ width: 'auto' }} onClick={onSaved}>Close</button>
          </>
        ) : (
          <form onSubmit={handleSave}>
            <label htmlFor="art-poster">Poster image — 2:3 portrait, optional</label>
            <input id="art-poster" type="file" accept="image/*" onChange={(e) => setPosterFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

            <label htmlFor="art-thumb">Thumbnail image — 16:9 landscape, optional</label>
            <input id="art-thumb" type="file" accept="image/*" onChange={(e) => setThumbnailFile(e.target.files[0] || null)} style={{ marginBottom: '0.8rem' }} />

            {titleSlot && (
              <div className="art-title-slot">
                <label htmlFor="art-title">Title image — the title set as a picture, a PNG with a transparent background, optional</label>
                <p className="req-edit-line">Shown in place of the text title on the title&rsquo;s own page.</p>
                {submission.titleImageUrl && !removeTitle && !titleFile && (
                  <div className="art-title-now">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={submission.titleImageUrl} alt="" />
                    <span>Live now</span>
                  </div>
                )}
                {titleWaiting && <p className="req-edit-line">{submission.pendingTitleImageUrl ? 'A new title image waits for approval' : 'Removing the title image waits for approval'} — a new pick replaces it.</p>}
                {titleBlocked ? (
                  <p className="req-edit-line">Changing a live title&rsquo;s title image needs a database update (migration 120).</p>
                ) : (
                  <>
                    <input id="art-title" type="file" accept={TITLE_IMAGE_ACCEPT} disabled={removeTitle} onChange={(e) => { setTitleFile(e.target.files[0] || null); setRemoveTitle(false); }} style={{ marginBottom: '0.5rem' }} />
                    {submission.titleImageUrl && !titleFile && (
                      <label className="art-title-remove">
                        <input type="checkbox" checked={removeTitle} onChange={(e) => setRemoveTitle(e.target.checked)} /> Remove the title image (show the title as text)
                      </label>
                    )}
                  </>
                )}
              </div>
            )}

            {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem' }}>
              <button className="account-btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>
                {saving ? 'Uploading…' : live ? 'Send for approval' : 'Save artwork'}
              </button>
              <button className="account-btn-secondary" type="button" onClick={onClose} disabled={saving} style={{ width: 'auto' }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
