import { useCallback, useRef, useState } from 'react';
import * as tus from 'tus-js-client';

// Self-contained on purpose — this doesn't hook into contexts/UploadContext
// the way creator submissions do. That context exists specifically so an
// upload survives the creator navigating away mid-upload; an admin adding
// to the house-ad catalogue is expected to stay on this page for the
// (usually short) duration of one clip uploading, so the extra machinery
// isn't worth the complexity here.
const STAGE_LABEL = {
  uploading: 'Uploading to Cloudflare…',
  transcoding: 'Cloudflare is processing the video…',
  preparing_download: 'Preparing the file this ad needs…',
  ready: 'Ready.',
  error: 'Something went wrong.'
};

export default function CloudflareHouseAdImport({ onReady }) {
  const [stage, setStage] = useState('idle'); // idle | uploading | transcoding | preparing_download | ready | error
  const [pct, setPct] = useState(0);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const pollTimer = useRef(null);
  // Hard ceiling on polling. A Cloudflare job that never reaches a terminal
  // state would otherwise poll every 3s for as long as the tab stays open.
  // 200 × 3s ≈ 10 minutes, comfortably longer than any real encode.
  const pollCount = useRef(0);
  const MAX_POLLS = 200;

  const poll = useCallback(
    (uid) => {
      const tick = async () => {
        if (typeof document !== 'undefined' && document.hidden) {
          pollTimer.current = setTimeout(tick, 3000);
          return;
        }
        if (pollCount.current++ > MAX_POLLS) {
          setStage('error');
          setError('Gave up waiting for Cloudflare — check the video in your Cloudflare dashboard.');
          return;
        }
        try {
          const res = await fetch(`/api/admin/house-ads-cloudflare-status?uid=${encodeURIComponent(uid)}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Lost track of the upload.');

          if (data.stage === 'error') {
            setStage('error');
            setError(data.error);
            return;
          }
          if (data.stage === 'ready') {
            setStage('ready');
            onReady({ cloudflareUid: uid, duration: data.duration });
            return;
          }
          setStage(data.stage);
          if (typeof data.pctComplete === 'number') setPct(data.pctComplete);
          if (typeof data.percentComplete === 'number') setPct(data.percentComplete);
          pollTimer.current = setTimeout(tick, 3000);
        } catch (err) {
          setStage('error');
          setError(err.message);
        }
      };
      tick();
    },
    [onReady]
  );

  async function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setStage('uploading');
    setPct(0);

    try {
      const urlRes = await fetch('/api/admin/house-ads-cloudflare-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileSize: file.size, fileName: file.name, method: 'tus' })
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Could not start the upload.');

      await new Promise((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: urlData.uploadUrl,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          metadata: { filename: file.name, filetype: file.type },
          onError: (err) => reject(err),
          onProgress: (uploaded, total) => setPct(Math.round((uploaded / total) * 100)),
          onSuccess: () => resolve()
        });
        upload.start();
      });

      setStage('transcoding');
      setPct(0);
      poll(urlData.uid);
    } catch (err) {
      setStage('error');
      setError(err.message || 'The upload failed.');
    }
  }

  function reset() {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setStage('idle');
    setError(null);
    setFileName(null);
    setPct(0);
  }

  if (stage === 'idle') {
    return (
      <div>
        <input type="file" accept="video/*" onChange={(e) => handleFile(e.target.files[0])} />
        <small className="house-ad-hint">
          No size limit, and it resumes automatically if your connection drops — the same upload
          Cloudflare uses for episodes. Better than the quick-upload option for building out a real
          catalogue of higher-quality house ads over time.
        </small>
      </div>
    );
  }

  return (
    <div className="cf-import-status">
      <div className="cf-import-file">{fileName}</div>
      <div className="cf-import-stage">{STAGE_LABEL[stage] || stage}</div>
      {(stage === 'uploading' || stage === 'transcoding' || stage === 'preparing_download') && (
        <div className="upload-widget-bar">
          <div className="upload-widget-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      {stage === 'error' && (
        <>
          <div className="house-ad-error">{error}</div>
          <button type="button" onClick={reset} style={{ marginTop: '0.6rem' }}>
            Try again
          </button>
        </>
      )}
      {stage === 'ready' && <div className="cf-import-done">✓ Ready — fill in the details below.</div>}
    </div>
  );
}
