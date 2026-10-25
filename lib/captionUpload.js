import { uploadPrivate } from './privateStorage';

// SERVER-ONLY.
//
// Caption tracks go to the private bucket (lib/privateStorage.js; Jose,
// 2026-10-25). A film's captions are its whole dialogue as text, the most
// useful thing a crawler could take from the site, and until today they
// sat at a permanent public URL in the `episode-art` bucket that was in
// the page even for a viewer on the lock screen. Now the row stores a
// `private:<path>` reference and the browser's <track> fetches
// /api/captions/<episodeId>, which checks the viewer the same way the
// video's signed URL is checked (lib/playbackGate.js). Tracks uploaded
// before this still carry their public URL until the Protection card on
// /admin/settings moves them (lib/protectMedia.js).
const PREFIX = 'captions';
const MAX_BYTES = 2 * 1024 * 1024; // 2MB — a feature-length VTT is tens of KB

// SRT is what most caption tools export by default, and browsers can't read
// it — <track> only understands WebVTT. Rather than rejecting the most
// common file a creator will have on hand, convert it.
//
// The differences are small: VTT needs a WEBVTT header, uses a dot rather
// than a comma for the milliseconds separator, and doesn't need SRT's
// numeric cue counters.
export function srtToVtt(text) {
  const body = text
    .replace(/\r\n/g, '\n')
    .replace(/^﻿/, '') // strip a BOM if the file has one
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) return null;
      // Drop the leading cue number if present — VTT doesn't need it.
      if (/^\d+$/.test(lines[0].trim())) lines.shift();
      if (!lines.length) return null;
      lines[0] = lines[0].replace(
        /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/,
        '$1.$2 --> $3.$4'
      );
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  return `WEBVTT\n\n${body}\n`;
}

// Checks the file is actually a caption track before it's stored. A file
// that uploads fine but produces no visible captions is a genuinely
// confusing failure — the creator has done everything right and sees
// nothing — so it's worth catching here and saying why.
export function validateVtt(text) {
  if (!text || !text.trim()) {
    return { ok: false, error: 'That file is empty.' };
  }
  if (!/^WEBVTT/.test(text.trim())) {
    return { ok: false, error: 'This does not look like a WebVTT file — it should start with "WEBVTT".' };
  }
  const cueCount = (text.match(/-->/g) || []).length;
  if (cueCount === 0) {
    return {
      ok: false,
      error: 'No caption cues found in that file. It has a WEBVTT header but no timed lines.'
    };
  }
  return { ok: true, cueCount };
}

// `base64` is a data URL from the browser's FileReader. Returns the
// `private:<path>` reference to store on the row (never a URL), plus the
// cue count so the UI can confirm what actually landed.
export async function uploadCaptionFile({ base64, fileName, pathPrefix }) {
  if (!base64) return null;

  const commaIndex = base64.indexOf(',');
  const raw = base64.startsWith('data:') && commaIndex !== -1 ? base64.slice(commaIndex + 1) : base64;
  const buffer = Buffer.from(raw, 'base64');

  if (buffer.length === 0) {
    throw new Error('That file is empty.');
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error(`"${fileName || 'file'}" is too large — caption files should be well under 2MB.`);
  }

  let text = buffer.toString('utf8');

  const isSrt = /\.srt$/i.test(fileName || '');
  if (isSrt || (!/^WEBVTT/.test(text.trim()) && /-->/.test(text))) {
    text = srtToVtt(text);
  }

  const check = validateVtt(text);
  if (!check.ok) {
    throw new Error(check.error);
  }

  const path = `${PREFIX}/${pathPrefix}-${Date.now().toString(36)}.vtt`;
  let ref;
  try {
    ref = await uploadPrivate({ path, buffer: Buffer.from(text, 'utf8'), contentType: 'text/vtt; charset=utf-8' });
  } catch (err) {
    throw new Error(`Could not upload captions: ${err.message}`);
  }
  return { url: ref, cueCount: check.cueCount, converted: isSrt };
}
