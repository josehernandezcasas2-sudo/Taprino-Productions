import { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as tus from 'tus-js-client';

const UploadContext = createContext(null);

// A plain (non-React) reference to whether an upload is currently active —
// this exists so code outside the component tree (specifically the
// bfcache-reload guard in _app.js, which runs before this provider's
// children mount) can check "is something uploading right now?" without
// needing to be a context consumer itself.
export const uploadStatusRef = { current: null };

// Why this has to live here, not inside the /creator page component: Next.js
// swaps out page content on in-app navigation without reloading the tab —
// but only things scoped to the page itself get torn down when that
// happens. A component wrapping the whole app (see _app.js) keeps running
// in the background regardless of which page is currently showing, which
// is exactly what "upload keeps going if I browse elsewhere" requires.
//
// This does NOT survive an actual page reload or closing the tab — that's
// a real new page load, and everything in memory (including this) resets.
// TUS itself can still resume in that case if the creator re-selects the
// same file, but there's no "come back later" persistence beyond that here.
export function UploadProvider({ children }) {
  const [activeUpload, setActiveUpload] = useState(null);
  const tusInstanceRef = useRef(null);

  useEffect(() => {
    uploadStatusRef.current = activeUpload;
  }, [activeUpload]);

  async function startUpload(file, formData, trailerFile) {
    if (activeUpload && activeUpload.status === 'uploading') {
      throw new Error('An upload is already in progress — wait for it to finish before starting another.');
    }

    setActiveUpload({
      phase: 'main',
      fileName: file.name,
      fileSize: file.size,
      bytesUploaded: 0,
      startedAt: Date.now(),
      status: 'requesting-url',
      errorMessage: null
    });

    // Requests a fresh TUS upload URL and runs it against `targetFile`,
    // resolving with the resulting Cloudflare video uid. Shared between the
    // main video and the optional trailer — the only real difference
    // between the two is which `phase` label the widget shows.
    async function runOneUpload(targetFile) {
      const urlRes = await fetch('/api/creator/get-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileSize: targetFile.size, fileName: targetFile.name })
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Could not get an upload link.');

      setActiveUpload((u) => (u ? { ...u, status: 'uploading' } : u));

      await new Promise((resolve, reject) => {
        const upload = new tus.Upload(targetFile, {
          endpoint: urlData.uploadUrl,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          metadata: { filename: targetFile.name, filetype: targetFile.type },
          onError: (error) => reject(error),
          onProgress: (bytesUploaded, bytesTotal) => {
            setActiveUpload((u) => (u ? { ...u, bytesUploaded, fileSize: bytesTotal } : u));
          },
          onSuccess: () => resolve()
        });
        tusInstanceRef.current = upload;
        upload.start();
      });

      return urlData.uid;
    }

    try {
      const videoUid = await runOneUpload(file);

      // Trailer is optional — only kick off a second upload if a creator
      // actually chose one. Sequential on purpose: TUS + the widget both
      // assume one active transfer at a time, and a trailer clip is small
      // enough that doing it after the main video barely adds any wait.
      let trailerUid;
      if (trailerFile) {
        setActiveUpload((u) => (u ? {
          ...u,
          phase: 'trailer',
          fileName: trailerFile.name,
          fileSize: trailerFile.size,
          bytesUploaded: 0,
          startedAt: Date.now(),
          status: 'uploading'
        } : u));
        trailerUid = await runOneUpload(trailerFile);
      }

      setActiveUpload((u) => (u ? { ...u, phase: 'saving', status: 'saving' } : u));

      const submitRes = await fetch('/api/creator/submit-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, videoUid, ...(trailerUid ? { trailerUid } : {}) })
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error || 'Could not save the submission.');

      setActiveUpload((u) => (u ? { ...u, status: 'done' } : u));
    } catch (err) {
      setActiveUpload((u) => (u ? { ...u, status: 'error', errorMessage: err.message } : { status: 'error', errorMessage: err.message }));
    }
  }

  function dismissUpload() {
    tusInstanceRef.current = null;
    setActiveUpload(null);
  }

  return (
    <UploadContext.Provider value={{ activeUpload, startUpload, dismissUpload }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within UploadProvider');
  return ctx;
}
