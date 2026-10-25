import { getSupabase } from './supabase';
import { isPrivateRef, uploadPrivate } from './privateStorage';
import { storagePathFromUrl } from './orphanedMedia';
import { lockUniversityBucket } from './universityDocs';

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

export { lockUniversityBucket };
