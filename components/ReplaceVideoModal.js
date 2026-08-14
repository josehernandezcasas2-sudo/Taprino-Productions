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
    if (activeUpload && activeUpload.status !== 'done' && activeUpload.status !== 'error') {
      setError('An upload is already in progress — wait for it to finish (or fail) before starting another.');
      return;
    }
    // Fire-and-forget, same pattern as the main submission form — this
    // upload now lives in the shared context and survives navigating away
    // from this modal (or this page) entirely. Track it via the corner
    // widget, not this modal.
    startUpload(file, { episodeId: submission.id }, undefined, 'tus', '/api/creator/replace-video');
    setStarted(true);
  }

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
            ? 'This episode is currently live — replacing the video sends it back into the review queue, since an admin only approved the previous file, not this new one.'
            : 'The old video file will no longer be used once this finishes.'}
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
