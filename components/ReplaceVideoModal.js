import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useUpload } from '../contexts/UploadContext';

// Same SSR consideration as the main submission form — Uppy isn't safe to
// render during server-side rendering.
const UppyFilePicker = dynamic(() => import('./UppyFilePicker'), { ssr: false });

export default function ReplaceVideoModal({ submission, onClose }) {
  const { activeUpload, startUpload } = useUpload();
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [started, setStarted] = useState(false);

  function handleStart() {
    if (!file) {
      setError('Choose a video file first.');
      return;
    }
    if (activeUpload && !['done', 'uploaded', 'error'].includes(activeUpload.status)) {
      setError('An upload is already in progress — wait for it to finish (or fail) before starting another.');
      return;
    }
    // Fire-and-forget, same pattern as the main submission form — this
    // upload now lives in the shared context and survives navigating away
    // from this modal (or this page) entirely. Track it via the corner
    // widget, not this modal. Saved the way the show editor's "Replace the
    // file" is (lib/showPage.js replaceEpisodeVideo): on a live title the
    // new file waits for an admin while the current one keeps playing; the
    // route's own line says what happened.
    startUpload(file, {}, undefined, 'tus', `/api/show/episode/${encodeURIComponent(submission.id)}/video`, {
      label: 'New file uploaded',
      meta: wasLive ? 'It waits for an admin; the current one keeps playing until then.' : 'Saved.'
    }).catch((err) => { setStarted(false); setError((err && err.message) || 'Could not start the upload.'); });
    setStarted(true);
  }

  // Live, or pulled while an admin looks (a new file waits for review then
  // too): the title stays as it is until an admin approves the new file.
  const wasLive = submission.status === 'approved';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Replace video</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '-0.4rem' }}>
          For &ldquo;{submission.title}&rdquo;.{' '}
          {wasLive
            ? 'It’s live, and it stays live: the new file goes to an admin first, and the current one keeps playing (for its buyers too) until it’s approved.'
            : submission.status === 'rejected'
              ? 'It comes back into review with the new file.'
              : 'The new file replaces the old one; it stays in review.'}
        </p>

        {!started ? (
          <>
            <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--ink-dim)', margin: '0.6rem 0 0.3rem' }}>New video file</label>
            <UppyFilePicker accept="video/*" note="Any video file, no size limit" onFileSelected={setFile} />

            {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
              <button className="account-btn-primary" onClick={handleStart} style={{ width: 'auto' }}>
                Start upload
              </button>
              <button className="account-btn-secondary" onClick={onClose} style={{ width: 'auto' }}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.85rem' }}>Upload started — track its progress in the corner of the screen. Safe to close this.</p>
            <button className="account-btn-primary" onClick={onClose} style={{ width: 'auto' }}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
