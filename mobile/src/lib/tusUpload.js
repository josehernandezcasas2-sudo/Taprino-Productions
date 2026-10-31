import * as tus from 'tus-js-client';
import { apiPost } from './api';

// The master from the phone (the creator path, 2026-10-31): a resumable
// tus upload straight to Cloudflare Stream, the way the website does it
// (contexts/UploadContext.js). The server mints the one-time address
// (/api/apply/upload-url before Creator Studio, /api/creator/get-upload-url
// after); tus-js-client's React Native build reads a `file://` picker
// asset as a native blob, so a long master never sits in JS memory.
//
// One upload at a time, kept here (not in a screen) so a screen that
// unmounts and comes back still sees its progress. `resumeUrl` is the
// address a stopped upload was given (the row keeps it): with the same
// file picked again the transfer carries on from where it was.
const CHUNK = 52428800; // 50 MB, Cloudflare's recommendation (a multiple of 256 KiB)
const listeners = new Set();
let current = null; // { uid, kind, name, bytes, sent, total, status, error, startedAt }

function emit() {
  for (const fn of listeners) fn(current);
}

export function subscribeUpload(fn) {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

export function currentUpload() {
  return current;
}

export function uidFromTusUrl(url) {
  const m = /\/tus\/([a-zA-Z0-9]+)/.exec(String(url || ''));
  return m ? m[1] : null;
}

// asset: an expo-image-picker video asset ({ uri, fileName, fileSize,
// mimeType, duration in ms, width, height }).
// Resolves as soon as the address exists: { uid, uploadUrl, done } where
// `done` settles when the last byte is in. `onUrl(url)` reports tus's own
// address for this upload as soon as it is known.
export async function startTusUpload({ asset, urlPath, token, resumeUrl = null, kind = 'main', onUrl = null }) {
  if (current && current.status === 'uploading') throw new Error('An upload is already running. Let it finish first.');
  const name = asset.fileName || asset.uri.split('/').pop() || 'video.mp4';
  const size = Number(asset.fileSize) || 0;
  current = { uid: null, kind, name, bytes: size, sent: 0, total: size, status: 'requesting-url', error: null, startedAt: Date.now() };
  emit();

  let uploadUrl = resumeUrl;
  let uid = resumeUrl ? uidFromTusUrl(resumeUrl) : null;
  try {
    if (!uploadUrl || !uid) {
      const data = await apiPost(urlPath, { fileSize: size, fileName: name, kind }, token);
      uploadUrl = data.uploadUrl;
      uid = data.uid;
    }
  } catch (err) {
    current = { ...current, status: 'error', error: err.message };
    emit();
    throw err;
  }
  current = { ...current, uid, status: 'uploading' };
  emit();

  const file = { uri: asset.uri, name, type: asset.mimeType || 'video/mp4' };
  const done = new Promise((resolve, reject) => {
    let reported = Boolean(resumeUrl);
    const upload = new tus.Upload(file, {
      ...(resumeUrl ? { uploadUrl: resumeUrl } : { endpoint: uploadUrl }),
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: CHUNK,
      ...(size ? { uploadSize: size } : {}),
      metadata: { filename: name, filetype: file.type },
      onError: (error) => reject(error),
      onProgress: (sent, total) => {
        if (!reported && upload.url) { reported = true; if (onUrl) onUrl(upload.url); }
        if (current && current.uid === uid) { current = { ...current, sent, total }; emit(); }
      },
      onSuccess: () => {
        if (!reported && upload.url) { reported = true; if (onUrl) onUrl(upload.url); }
        resolve();
      }
    });
    upload.start();
  }).then(() => {
    if (current && current.uid === uid) { current = { ...current, status: 'uploaded', sent: current.total }; emit(); }
    return { uid };
  }).catch((err) => {
    if (current && current.uid === uid) { current = { ...current, status: 'error', error: err.message || String(err) }; emit(); }
    throw err;
  });
  done.catch(() => {});
  return { uid, uploadUrl, done };
}

export function clearUpload() {
  if (current && current.status === 'uploading') return;
  current = null;
  emit();
}
