import { getSupabase } from './supabase';
import { isPrivateRef, uploadPrivate } from './privateStorage';
import { storagePathFromUrl } from './orphanedMedia';
import { lockUniversityBucket } from './universityDocs';
import { capImage } from './imageCap';

// SERVER-ONLY. The one-off moves behind the Protection card on
// /admin/settings (pages/api/admin/protect-media.js; Jose, 2026-10-25):
// what new uploads do by themselves, applied to what was uploaded before.

const ART_BUCKET = 'episode-art';

// Every caption track still at a public URL in the artwork bucket is
// copied into the private bucket under the same path, the row is pointed
// at the `private:` reference, and the public object is removed. Safe to
// run again: a row already private is counted and left alone.
export async function moveCaptionsToPrivate() {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase.from('episodes').select('id, title, captions_url').not('captions_url', 'is', null);
  if (error) throw new Error(error.message);
  const result = { moved: 0, alreadyPrivate: 0, skipped: [], failures: [] };
  for (const row of rows || []) {
    if (!row.captions_url) continue;
    if (isPrivateRef(row.captions_url)) {
      result.alreadyPrivate += 1;
      continue;
    }
    const path = storagePathFromUrl(row.captions_url);
    if (!path) {
      // A link to a track hosted somewhere else; nothing of ours to move.
      result.skipped.push({ id: row.id, title: row.title, reason: 'not in our storage' });
      continue;
    }
    try {
      const { data: blob, error: downloadError } = await supabase.storage.from(ART_BUCKET).download(path);
      if (downloadError || !blob) throw new Error(downloadError ? downloadError.message : 'could not read the file');
      const buffer = Buffer.from(await blob.arrayBuffer());
      const ref = await uploadPrivate({ path, buffer, contentType: 'text/vtt; charset=utf-8' });
      const { error: updateError } = await supabase.from('episodes').update({ captions_url: ref }).eq('id', row.id);
      if (updateError) throw new Error(updateError.message);
      // Only once the row points at the private copy is the public one
      // removed; a failure above leaves the track playable where it was.
      const { error: removeError } = await supabase.storage.from(ART_BUCKET).remove([path]);
      if (removeError) result.failures.push({ id: row.id, title: row.title, error: `moved, but the public copy stayed: ${removeError.message}` });
      result.moved += 1;
    } catch (err) {
      result.failures.push({ id: row.id, title: row.title, error: err.message });
    }
  }
  return result;
}

// Every Snippet photo and video cover still at a public URL in the
// artwork bucket (2026-10-29): the file is read, capped to 1600px with
// no EXIF (lib/imageCap.js), stored in the private bucket under posts/,
// the row pointed at the `private:` reference (so pages hand out
// /api/posts/<id>/media from then on), and the public object removed.
// Safe to run again: a reference already private is counted and left
// alone. `moved` counts images, not posts.
export async function movePostMediaToPrivate() {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase.from('posts').select('id, caption, image_url, thumbnail_url');
  if (error) throw new Error(error.message);
  const result = { moved: 0, resized: 0, alreadyPrivate: 0, skipped: [], failures: [] };
  for (const row of rows || []) {
    for (const column of ['image_url', 'thumbnail_url']) {
      const stored = row[column];
      if (!stored) continue;
      if (isPrivateRef(stored)) {
        result.alreadyPrivate += 1;
        continue;
      }
      const path = storagePathFromUrl(stored);
      if (!path) {
        result.skipped.push({ id: row.id, title: row.caption || row.id, reason: 'not in our storage' });
        continue;
      }
      try {
        const { data: blob, error: downloadError } = await supabase.storage.from(ART_BUCKET).download(path);
        if (downloadError || !blob) throw new Error(downloadError ? downloadError.message : 'could not read the file');
        const capped = await capImage(Buffer.from(await blob.arrayBuffer()));
        if (!capped.ext) throw new Error('not an image we can read');
        const base = path.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
        const ref = await uploadPrivate({ path: `posts/${base}.${capped.ext}`, buffer: capped.buffer, contentType: capped.type });
        const { error: updateError } = await supabase.from('posts').update({ [column]: ref }).eq('id', row.id);
        if (updateError) throw new Error(updateError.message);
        // Only once the row points at the private copy is the public one
        // removed; a failure above leaves the image showing where it was.
        const { error: removeError } = await supabase.storage.from(ART_BUCKET).remove([path]);
        if (removeError) result.failures.push({ id: row.id, title: row.caption || row.id, error: `moved, but the public copy stayed: ${removeError.message}` });
        result.moved += 1;
        if (capped.resized) result.resized += 1;
      } catch (err) {
        result.failures.push({ id: row.id, title: row.caption || row.id, error: err.message });
      }
    }
  }
  return result;
}

export { lockUniversityBucket };
