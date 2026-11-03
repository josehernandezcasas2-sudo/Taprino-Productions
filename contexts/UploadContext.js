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
  // Whether a transfer is running right now, kept by hand at every start
  // and end: the show page's queue (below) starts the next file the moment
  // the last one is in, before React has re-rendered with the new state, so
  // "is something uploading?" can't be read from `activeUpload` there.
  const runningRef = useRef(false);

  useEffect(() => {
    uploadStatusRef.current = activeUpload;
  }, [activeUpload]);

  async function startUpload(file, formData, trailerFile, uploadMethod = 'tus', submitEndpoint = '/api/creator/submit-episode', doneMessages) {
    if (runningRef.current) {
      throw new Error('An upload is already in progress — wait for it to finish before starting another.');
    }
    runningRef.current = true;

    lastAttemptRef.current = { file, formData, trailerFile, submitEndpoint, doneMessages };

    setActiveUpload({
      phase: 'main',
      fileName: file.name,
      fileSize: file.size,
      bytesUploaded: 0,
      startedAt: Date.now(),
      status: 'requesting-url',
      uploadMethod,
      doneMessages,
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
    async function runOneUpload(targetFile, useMethod, kind = 'main') {
      const urlRes = await fetch('/api/creator/get-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileSize: targetFile.size, fileName: targetFile.name, method: useMethod, kind })
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
            // Cloudflare Stream's own docs require a minimum 5MB chunk
            // size for resumable TUS uploads and explicitly recommend
            // 50MB for reliable connections — without this, tus-js-client
            // defaults to Infinity (the whole file as one PATCH request).
            // For a large file that takes 30+ minutes, sending it as one
            // giant unchunked request means any brief interruption near
            // the end has no smaller boundary to resume from, so the
            // whole thing has to restart from scratch — this is almost
            // certainly what "restarts shortly after completing" actually
            // is. Must be a multiple of 256KiB per Cloudflare's
            // requirement; 52428800 (50MB) divides evenly.
            chunkSize: 52428800,
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
        trailerUid = await runOneUpload(trailerFile, uploadMethod, 'trailer');
      }

      setActiveUpload((u) => (u ? { ...u, phase: 'saving', status: 'saving' } : u));

      const submitRes = await fetch(submitEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, videoUid, ...(trailerUid ? { trailerUid } : {}) })
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error || 'Could not save the submission.');

      // A route may say what it did with the save (replace-video gives a
      // declined episode the next free number when its own was taken
      // meanwhile): its line replaces the widget's usual second line.
      const note = typeof submitData.message === 'string' && submitData.message.trim() ? submitData.message.trim() : null;
      setActiveUpload((u) => (u ? { ...u, status: 'done', ...(note ? { doneMessages: { ...(u.doneMessages || {}), meta: note } } : {}) } : u));
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
    } finally {
      runningRef.current = false;
    }
  }

  // Re-runs the exact same attempt that just failed — same file(s), same
  // form fields — without the creator re-selecting anything. Passing
  // `useMethod: 'basic'` is what the widget's "try the fallback method"
  // button does; otherwise it's a plain retry of whatever method was
  // already being used.
  // Companion to startUpload for the "paste a link" path. Deliberately a
  // separate function rather than a branch inside startUpload/runOneUpload:
  // the progress model is fundamentally different (Cloudflare's own
  // pctComplete, polled, instead of upload byte counts we control directly),
  // and keeping them apart means this can't accidentally destabilize the
  // TUS/basic-upload state machine above, which already has to handle a lot
  // of real-world flakiness on its own.
  async function startUrlImport(videoUrl, fileName, formData, submitEndpoint = '/api/creator/submit-episode', doneMessages) {
    if (runningRef.current) {
      throw new Error('An upload is already in progress — wait for it to finish before starting another.');
    }
    runningRef.current = true;

    lastAttemptRef.current = { videoUrl, fileName, formData, submitEndpoint, doneMessages, isUrlImport: true };

    setActiveUpload({
      phase: 'main',
      fileName: fileName || videoUrl,
      fileSize: 0,
      bytesUploaded: 0,
      startedAt: Date.now(),
      status: 'requesting-url',
      uploadMethod: 'url-import',
      importPct: null,
      doneMessages,
      errorTitle: null,
      errorMessage: null,
      likelyBlocked: false
    });

    try {
      const startRes = await fetch('/api/creator/import-video-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl, fileName })
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || 'Could not start the import.');

      setActiveUpload((u) => (u ? { ...u, status: 'importing' } : u));

      // Cloudflare fetches and transcodes the source on its own schedule —
      // seconds for a small file, longer for a feature-length one — so this
      // polls rather than waiting on a single request that could otherwise
      // sit open for minutes.
      const videoUid = await new Promise((resolve, reject) => {
        const poll = async () => {
          try {
            const statusRes = await fetch(`/api/creator/video-status?uid=${encodeURIComponent(startData.uid)}`);
            const status = await statusRes.json();
            if (!statusRes.ok) throw new Error(status.error || 'Lost track of the import.');

            if (status.state === 'ready' || status.readyToStream) {
              resolve(startData.uid);
              return;
            }
            if (status.state === 'error') {
              reject(new Error(status.errorReasonText || 'Cloudflare could not process that video.'));
              return;
            }
            setActiveUpload((u) => (u ? { ...u, importPct: typeof status.pctComplete === 'number' ? status.pctComplete : u.importPct } : u));
            setTimeout(poll, 3000);
          } catch (err) {
            reject(err);
          }
        };
        poll();
      });

      setActiveUpload((u) => (u ? { ...u, phase: 'saving', status: 'saving' } : u));

      const submitRes = await fetch(submitEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, videoUid })
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
        likelyBlocked: false
      } : u));
    } finally {
      runningRef.current = false;
    }
  }

  // The upload alone, nothing saved afterwards: the creator path (2026-10-31).
  // /apply and /creator/submit start the master the moment it's dropped and
  // save the form separately (the uid is known from the first second, the
  // upload rides along in this provider while they type). Resolves as soon
  // as the upload address exists with { uid, done }: `done` settles when the
  // last byte is in. `resumeUrl` is tus's own address for an upload that
  // stopped earlier (the row keeps it); with the same file picked again the
  // transfer carries on from where it was. `onUrl` reports that address as
  // soon as it exists, so the caller can keep it.
  // `queue` (the show page's queue, below) rides on the widget's state: which
  // show, which file of how many.
  async function startVideoUpload(file, { urlEndpoint = '/api/apply/upload-url', resumeUrl = null, kind = 'main', onUrl = null, authHeaders = null, queue = null } = {}) {
    if (runningRef.current) {
      throw new Error('An upload is already in progress — wait for it to finish before starting another.');
    }
    runningRef.current = true;
    lastAttemptRef.current = { file, urlEndpoint, resumeUrl, kind, onUrl, authHeaders, isVideoOnly: true, queueKey: queue ? queue.key : null };

    setActiveUpload({
      phase: kind,
      fileName: file.name,
      fileSize: file.size,
      bytesUploaded: 0,
      startedAt: Date.now(),
      status: 'requesting-url',
      uploadMethod: 'tus',
      videoOnly: true,
      uid: null,
      queue,
      doneMessages: { label: kind === 'trailer' ? 'Trailer uploaded' : 'Upload finished', meta: 'It keeps processing on our side; nothing more to do here.' },
      errorTitle: null,
      errorMessage: null,
      likelyBlocked: false
    });

    let uploadUrl = resumeUrl;
    let uid = resumeUrl ? (resumeUrl.match(/\/tus\/([a-zA-Z0-9]+)/) || [])[1] || null : null;
    try {
      if (!uploadUrl || !uid) {
        const urlRes = await fetch(urlEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(authHeaders || {}) },
          body: JSON.stringify({ fileSize: file.size, fileName: file.name, kind })
        });
        const urlData = await urlRes.json();
        if (!urlRes.ok) throw new Error(urlData.error || 'Could not get an upload link.');
        uploadUrl = urlData.uploadUrl;
        uid = urlData.uid;
      }
    } catch (err) {
      runningRef.current = false;
      const described = describeUploadError(err);
      setActiveUpload((u) => (u ? { ...u, status: 'error', errorTitle: described.title, errorMessage: described.message, errorRaw: described.raw, likelyBlocked: described.likelyBlocked } : u));
      throw err;
    }

    setActiveUpload((u) => (u ? { ...u, status: 'uploading', uid } : u));

    const done = new Promise((resolve, reject) => {
      let reportedUrl = Boolean(resumeUrl);
      const upload = new tus.Upload(file, {
        // A fresh address is tus's creation endpoint (the POST answers with
        // the upload's own address); a kept one is resumed directly.
        ...(resumeUrl ? { uploadUrl: resumeUrl } : { endpoint: uploadUrl }),
        retryDelays: [0, 3000, 5000, 10000, 20000],
        metadata: { filename: file.name, filetype: file.type },
        chunkSize: 52428800,
        onError: (error) => reject(error),
        onProgress: (bytesUploaded, bytesTotal) => {
          if (!reportedUrl && upload.url) {
            reportedUrl = true;
            if (onUrl) onUrl(upload.url);
          }
          setActiveUpload((u) => (u ? { ...u, bytesUploaded, fileSize: bytesTotal } : u));
        },
        onSuccess: () => {
          // A small file can finish before a progress event fires.
          if (!reportedUrl && upload.url) {
            reportedUrl = true;
            if (onUrl) onUrl(upload.url);
          }
          resolve();
        }
      });
      tusInstanceRef.current = upload;
      upload.start();
    }).then(() => {
      runningRef.current = false;
      setActiveUpload((u) => (u ? { ...u, status: 'uploaded', bytesUploaded: u.fileSize } : u));
      lastAttemptRef.current = null;
      return { uid };
    }).catch((err) => {
      runningRef.current = false;
      const described = describeUploadError(err);
      setActiveUpload((u) => (u ? { ...u, status: 'error', errorTitle: described.title, errorMessage: described.message, errorRaw: described.raw, likelyBlocked: described.likelyBlocked } : u));
      throw err;
    });
    // Nobody listening is fine: the widget shows the error.
    done.catch(() => {});

    return { uid, uploadUrl, done };
  }

  // --- the show page's queue (the series revamp, slice 2) ---------------------
  // Files dropped on a show (amendment 10, decision 17) become drafts first
  // (POST /api/show/[id]/episodes, by the page) and then upload here, one
  // after another through startVideoUpload — still one transfer at a time —
  // so the queue keeps going while the creator moves around the site (this
  // provider wraps the whole app). Each upload is saved onto its draft as it
  // starts (the tus address, so a stopped one resumes) and again when the
  // last byte is in. A closed tab stops the queue; picking the same file
  // again resumes it from the draft's saved address.
  //   item: { key, draftId, showId, showName, label, file, endpoint,
  //           runtimeSeconds, status: 'queued' | 'starting' | 'uploading' |
  //           'uploaded' | 'stopped' | 'skipped' | 'cancelled', error, uid }
  const [queue, setQueue] = useState([]);
  const queueRef = useRef([]);
  const pumpingRef = useRef(false);
  const cancelRef = useRef(new Map()); // key → resolve(): stops waiting on a cancelled upload
  const [queuePaused, setQueuePaused] = useState(null); // the line why, when an upload link couldn't be had
  const pausedRef = useRef(null);
  // The show page that draws the queue itself (the corner widget stays out
  // of its way there).
  const [queueHost, setQueueHost] = useState(null);

  function updateQueue(fn) {
    queueRef.current = fn(queueRef.current);
    setQueue(queueRef.current);
  }
  function patchItem(key, fields) {
    updateQueue((q) => q.map((it) => (it.key === key ? { ...it, ...fields } : it)));
  }
  const LIVE_ITEM = ['queued', 'starting', 'uploading'];

  // The draft as it is now, so a save never puts back an older form or
  // trailer (the drafts route replaces form, video and trailer together).
  async function readDraft(draftId) {
    try {
      const res = await fetch(`/api/creator/drafts?id=${encodeURIComponent(draftId)}`, { credentials: 'same-origin' });
      if (res.status === 404) return { gone: true };
      const data = await res.json().catch(() => ({}));
      return res.ok && data.draft ? { draft: data.draft } : { failed: true };
    } catch {
      return { failed: true };
    }
  }
  async function saveDraftVideo(draftId, video) {
    const now = await readDraft(draftId);
    if (!now.draft) return false;
    try {
      const res = await fetch('/api/creator/drafts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draftId, form: now.draft.form || {}, video, trailer: now.draft.trailer || null })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function runQueueItem(item) {
    patchItem(item.key, { status: 'starting', error: null });
    // A stopped upload of this very file resumes from the draft's address; a
    // draft that has its file already (or is gone) is skipped.
    const now = await readDraft(item.draftId);
    if (now.gone) {
      patchItem(item.key, { status: 'cancelled', error: 'That draft isn’t there any more.', file: null });
      return;
    }
    const v = now.draft ? now.draft.video : null;
    let resumeUrl = null;
    if (v && v.uid) {
      const same = v.name === item.file.name && Number(v.bytes) === item.file.size;
      if (v.state === 'uploading' && same && v.uploadUrl && !item.freshStart) resumeUrl = v.uploadUrl;
      else if (v.state === 'processing' || v.state === 'ready') {
        patchItem(item.key, { status: 'skipped', error: null, file: null });
        return;
      }
    }
    const shows = queueRef.current.filter((it) => it.showId === item.showId && it.batch === item.batch);
    const meta = { key: item.key, showId: item.showId, showName: item.showName || null, draftId: item.draftId, label: item.label || null, index: shows.findIndex((it) => it.key === item.key) + 1, total: shows.length };
    let current = null;
    let urlSeen = null;
    let chain = Promise.resolve();
    const save = (video) => {
      chain = chain.then(() => saveDraftVideo(item.draftId, video)).catch(() => false);
      return chain;
    };
    let started;
    try {
      started = await startVideoUpload(item.file, {
        urlEndpoint: item.endpoint,
        resumeUrl,
        kind: 'main',
        queue: meta,
        onUrl: (url) => {
          urlSeen = url;
          if (current) {
            current = { ...current, uploadUrl: url };
            save(current);
          }
        }
      });
    } catch (err) {
      // No upload link (a limit, the connection): the queue waits for "Try again".
      const line = (err && err.message) || 'Could not get an upload link.';
      patchItem(item.key, { status: 'stopped', error: line });
      pausedRef.current = line;
      setQueuePaused(line);
      return;
    }
    current = {
      uid: started.uid,
      state: 'uploading',
      name: item.file.name,
      bytes: item.file.size,
      uploadUrl: resumeUrl || urlSeen || null,
      runtimeSeconds: item.runtimeSeconds || (v && v.runtimeSeconds) || null
    };
    patchItem(item.key, { status: 'uploading', uid: started.uid, startedAt: Date.now() });
    save(current);
    const cancelled = new Promise((resolve) => cancelRef.current.set(item.key, resolve));
    try {
      const outcome = await Promise.race([started.done.then(() => 'done'), cancelled.then(() => 'cancelled')]);
      if (outcome === 'cancelled') return;
      current = { ...current, state: 'processing' };
      await save(current);
      patchItem(item.key, { status: 'uploaded', file: null, error: null });
    } catch {
      patchItem(item.key, { status: 'stopped', error: 'The upload stopped — pick the same file to resume.', freshStart: Boolean(resumeUrl) });
    } finally {
      cancelRef.current.delete(item.key);
    }
  }

  async function pumpQueue() {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      for (;;) {
        if (pausedRef.current || runningRef.current) break;
        const next = queueRef.current.find((it) => it.status === 'queued');
        if (!next) break;
        await runQueueItem(next);
      }
    } finally {
      pumpingRef.current = false;
    }
  }

  // Another caller's upload (the editor's "Replace the file", the submit
  // page) holds the one transfer: the queue waits and carries on after it.
  useEffect(() => {
    if (!runningRef.current && !pausedRef.current && queueRef.current.some((it) => it.status === 'queued')) pumpQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUpload && activeUpload.status, queue]);

  // items: [{ draftId, file, showId, showName, label, endpoint, runtimeSeconds }]
  function enqueueUploads(items) {
    const list = (items || []).filter((x) => x && x.draftId && x.file);
    if (!list.length) return;
    const batch = `b${Date.now().toString(36)}`;
    updateQueue((q) => {
      const busy = new Set(q.filter((it) => ['starting', 'uploading'].includes(it.status)).map((it) => it.draftId));
      const fresh = list.filter((x) => !busy.has(x.draftId));
      const replaced = new Set(fresh.map((x) => x.draftId));
      const kept = q.filter((it) => !replaced.has(it.draftId));
      return [...kept, ...fresh.map((x, i) => ({ ...x, key: `${x.draftId}:${batch}:${i}`, batch, status: 'queued', error: null, uid: null, freshStart: Boolean(x.freshStart) }))];
    });
    pausedRef.current = null;
    setQueuePaused(null);
    setTimeout(pumpQueue, 0);
  }

  // Takes a draft's file out of the queue: a waiting one goes, the one
  // uploading is stopped (its tus address stays on the draft).
  function cancelQueueItem(draftId) {
    const item = queueRef.current.find((it) => it.draftId === draftId && LIVE_ITEM.includes(it.status));
    if (!item) return;
    if (item.status === 'uploading' || item.status === 'starting') {
      const upload = tusInstanceRef.current;
      if (upload && typeof upload.abort === 'function') upload.abort().catch(() => {});
      runningRef.current = false;
      setActiveUpload(null);
      lastAttemptRef.current = null;
      const resolve = cancelRef.current.get(item.key);
      if (resolve) resolve();
    }
    patchItem(item.key, { status: 'cancelled', file: null });
    setTimeout(pumpQueue, 0);
  }

  // "Try again": the stopped files of a show (or these drafts) go back in
  // line; a resume that failed starts the file afresh.
  function retryQueueItems({ showId = null, draftIds = null } = {}) {
    const want = (it) => it.status === 'stopped' && it.file && (draftIds ? draftIds.includes(it.draftId) : !showId || it.showId === showId);
    updateQueue((q) => q.map((it) => (want(it) ? { ...it, status: 'queued', error: null } : it)));
    pausedRef.current = null;
    setQueuePaused(null);
    setTimeout(pumpQueue, 0);
  }

  // Finished files leave the list after a while (and their File with them).
  useEffect(() => {
    const done = queue.filter((it) => ['uploaded', 'skipped', 'cancelled'].includes(it.status));
    if (!done.length) return undefined;
    const t = setTimeout(() => updateQueue((q) => q.filter((it) => !done.some((d) => d.key === it.key))), 90 * 1000);
    return () => clearTimeout(t);
  }, [queue]);

  function retryUpload(useMethod) {
    const attempt = lastAttemptRef.current;
    if (!attempt) return;
    if (attempt.queueKey) {
      const item = queueRef.current.find((it) => it.key === attempt.queueKey);
      if (item) retryQueueItems({ draftIds: [item.draftId] });
      return;
    }
    if (attempt.isVideoOnly) {
      startVideoUpload(attempt.file, { urlEndpoint: attempt.urlEndpoint, resumeUrl: attempt.resumeUrl, kind: attempt.kind, onUrl: attempt.onUrl, authHeaders: attempt.authHeaders }).catch(() => {});
      return;
    }
    if (attempt.isUrlImport) {
      startUrlImport(attempt.videoUrl, attempt.fileName, attempt.formData, attempt.submitEndpoint, attempt.doneMessages);
      return;
    }
    startUpload(attempt.file, attempt.formData, attempt.trailerFile, useMethod || activeUpload?.uploadMethod || 'tus', attempt.submitEndpoint, attempt.doneMessages);
  }

  function dismissUpload() {
    tusInstanceRef.current = null;
    lastAttemptRef.current = null;
    setActiveUpload(null);
  }

  return (
    <UploadContext.Provider value={{ activeUpload, startUpload, startUrlImport, startVideoUpload, retryUpload, dismissUpload, queue, queuePaused, queueHost, setQueueHost, enqueueUploads, cancelQueueItem, retryQueueItems }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within UploadProvider');
  return ctx;
}
