import { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as tus from 'tus-js-client';
import { describeUploadError } from '../lib/uploadErrors';

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
  // Kept so "Retry" (and "try the fallback method") can re-run the exact
  // same attempt without the creator having to re-pick files or retype the
  // form — File objects stay valid in memory for as long as the tab is
  // open, they just can't survive an actual page reload.
  const lastAttemptRef = useRef(null);

  useEffect(() => {
    uploadStatusRef.current = activeUpload;
  }, [activeUpload]);

  async function startUpload(file, formData, trailerFile, uploadMethod = 'tus') {
    if (activeUpload && activeUpload.status === 'uploading') {
      throw new Error('An upload is already in progress — wait for it to finish before starting another.');
    }

    lastAttemptRef.current = { file, formData, trailerFile };

    setActiveUpload({
      phase: 'main',
      fileName: file.name,
      fileSize: file.size,
      bytesUploaded: 0,
      startedAt: Date.now(),
      status: 'requesting-url',
      uploadMethod,
      errorTitle: null,
      errorMessage: null,
      likelyBlocked: false
    });

    // Plain POST via XMLHttpRequest — the fallback for when TUS's chunked
    // PATCH protocol is specifically what's being blocked. No resume
    // capability and capped at 200MB by Cloudflare, but a completely
    // different request shape that routes around that failure mode.
    function runBasicUpload(targetFile, uploadUrl) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setActiveUpload((u) => (u ? { ...u, bytesUploaded: e.loaded, fileSize: e.total } : u));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Fallback upload failed (status ${xhr.status}).`));
        };
        xhr.onerror = () => reject(new Error('Failed to fetch'));
        const body = new FormData();
        body.append('file', targetFile);
        xhr.send(body);
      });
    }

    // Requests a fresh upload URL (TUS or basic-POST, per `useMethod`) and
    // runs it against `targetFile`, resolving with the resulting
    // Cloudflare video uid. Shared between the main video and the optional
    // trailer — the only real difference between the two is which `phase`
    // label the widget shows.
    async function runOneUpload(targetFile, useMethod) {
      const urlRes = await fetch('/api/creator/get-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileSize: targetFile.size, fileName: targetFile.name, method: useMethod })
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Could not get an upload link.');

      setActiveUpload((u) => (u ? { ...u, status: 'uploading' } : u));

      if (useMethod === 'basic') {
        await runBasicUpload(targetFile, urlData.uploadUrl);
      } else {
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
      }

      return urlData.uid;
    }

    try {
      const videoUid = await runOneUpload(file, uploadMethod);

      // Trailer is optional — only kick off a second upload if a creator
      // actually chose one. Sequential on purpose: the widget assumes one
      // active transfer at a time, and a trailer clip is small enough that
      // doing it after the main video barely adds any wait. Uses the same
      // method as the main video — if TUS was blocked for one, it'd be
      // blocked for the other too.
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
        trailerUid = await runOneUpload(trailerFile, uploadMethod);
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
      lastAttemptRef.current = null;
    } catch (err) {
      const described = describeUploadError(err);
      setActiveUpload((u) => (u ? {
        ...u,
        status: 'error',
        errorTitle: described.title,
        errorMessage: described.message,
        errorRaw: described.raw,
        likelyBlocked: described.likelyBlocked
      } : {
        status: 'error',
        errorTitle: described.title,
        errorMessage: described.message,
        errorRaw: described.raw,
        likelyBlocked: described.likelyBlocked
      }));
    }
  }

  // Re-runs the exact same attempt that just failed — same file(s), same
  // form fields — without the creator re-selecting anything. Passing
  // `useMethod: 'basic'` is what the widget's "try the fallback method"
  // button does; otherwise it's a plain retry of whatever method was
  // already being used.
  function retryUpload(useMethod) {
    const attempt = lastAttemptRef.current;
    if (!attempt) return;
    startUpload(attempt.file, attempt.formData, attempt.trailerFile, useMethod || activeUpload?.uploadMethod || 'tus');
  }

  function dismissUpload() {
    tusInstanceRef.current = null;
    lastAttemptRef.current = null;
    setActiveUpload(null);
  }

  return (
    <UploadContext.Provider value={{ activeUpload, startUpload, retryUpload, dismissUpload }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within UploadProvider');
  return ctx;
}
