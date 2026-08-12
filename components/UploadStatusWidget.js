import { useEffect, useState } from 'react';
import { useUpload } from '../contexts/UploadContext';

function formatDuration(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

export default function UploadStatusWidget() {
  const { activeUpload, dismissUpload, retryUpload } = useUpload();
  const [, forceTick] = useState(0);

  // Re-renders once a second while uploading, purely so elapsed-time and
  // ETA keep counting up/down — the actual progress percentage updates
  // independently via onProgress, this is just for the time displays.
  useEffect(() => {
    if (!activeUpload || activeUpload.status !== 'uploading') return;
    const interval = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [activeUpload && activeUpload.status]);

  if (!activeUpload) return null;

  const pct = activeUpload.fileSize ? Math.min(100, Math.round((activeUpload.bytesUploaded / activeUpload.fileSize) * 100)) : 0;
  const elapsedSec = Math.floor((Date.now() - activeUpload.startedAt) / 1000);
  const uploadSpeed = elapsedSec > 0 ? activeUpload.bytesUploaded / elapsedSec : 0; // bytes/sec
  const remainingBytes = Math.max(0, activeUpload.fileSize - activeUpload.bytesUploaded);
  const etaSec = uploadSpeed > 0 ? Math.round(remainingBytes / uploadSpeed) : null;

  const isUrlImport = activeUpload.uploadMethod === 'url-import';

  const label = {
    'requesting-url': isUrlImport ? 'Asking Cloudflare to fetch your link…' : 'Preparing upload…',
    uploading: activeUpload.phase === 'trailer' ? 'Uploading trailer (2 of 2)…' : 'Uploading…',
    importing: 'Importing from your link…',
    saving: 'Saving submission…',
    done: '✓ Submitted for review',
    error: isUrlImport ? '✕ Import failed' : '✕ Upload failed'
  }[activeUpload.status];

  return (
    <div className="upload-widget">
      <div className="upload-widget-header">
        <span>{label}</span>
        {(activeUpload.status === 'done' || activeUpload.status === 'error') && (
          <button className="upload-widget-dismiss" onClick={dismissUpload} aria-label="Dismiss">✕</button>
        )}
      </div>
      <div className="upload-widget-filename">{activeUpload.fileName}</div>

      {activeUpload.status === 'uploading' && (
        <>
          <div className="upload-widget-bar">
            <div className="upload-widget-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="upload-widget-meta">
            <span>{pct}% · {formatBytes(activeUpload.bytesUploaded)} / {formatBytes(activeUpload.fileSize)}</span>
            <span>Elapsed {formatDuration(elapsedSec)} · ~{formatDuration(etaSec)} left</span>
          </div>
        </>
      )}
      {activeUpload.status === 'requesting-url' && (
        <div className="upload-widget-meta">Getting things ready…</div>
      )}
      {activeUpload.status === 'importing' && (
        <>
          {typeof activeUpload.importPct === 'number' ? (
            <div className="upload-widget-bar">
              <div className="upload-widget-bar-fill" style={{ width: `${activeUpload.importPct}%` }} />
            </div>
          ) : null}
          <div className="upload-widget-meta">
            {typeof activeUpload.importPct === 'number'
              ? `Cloudflare is fetching your file — ${activeUpload.importPct}% so far.`
              : 'Cloudflare is fetching your file — this can take a while for a large one.'}
            {' '}You can leave this page; it keeps going.
          </div>
        </>
      )}
      {activeUpload.status === 'saving' && (
        <div className="upload-widget-meta">Almost done — saving your submission details…</div>
      )}
      {activeUpload.status === 'done' && (
        <div className="upload-widget-meta">It now sits with the admin for review.</div>
      )}
      {activeUpload.status === 'error' && (
        <>
          <div className="upload-widget-error-title">{activeUpload.errorTitle}</div>
          <div className="upload-widget-meta upload-widget-error">{activeUpload.errorMessage}</div>
          <div className="upload-widget-actions">
            <button onClick={() => retryUpload()}>↻ Retry</button>
            {activeUpload.likelyBlocked && activeUpload.uploadMethod !== 'basic' && (
              <button onClick={() => retryUpload('basic')}>Try fallback upload method</button>
            )}
          </div>
          <details className="upload-widget-details">
            <summary>Technical details (for reporting a persistent problem)</summary>
            <code>{activeUpload.errorRaw}</code>
          </details>
        </>
      )}
    </div>
  );
}
