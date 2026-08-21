import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadCaptionFile } from '../../../lib/captionUpload';
import { recordOrphan, storagePathFromUrl } from '../../../lib/orphanedMedia';

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
};

// Captions apply immediately rather than going through review, unlike
// artwork. Artwork is staged because it changes what the public sees on the
// homepage — a caption track only becomes visible to someone who has already
// chosen to turn captions on, and a wrong or missing one is an accessibility
// problem worth fixing in seconds rather than in a review cycle.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { episodeId, captionsBase64, captionsFileName, language, label, remove } = req.body || {};
  if (!episodeId) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }

  const supabase = getSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from('episodes')
    .select('id, title, submitted_by, captions_url')
    .eq('id', episodeId)
    .maybeSingle();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Submission not found.' });
  }
  if (existing.submitted_by !== userId) {
    return res.status(403).json({ error: 'That submission does not belong to you.' });
  }

  // Removing captions.
  if (remove) {
    if (existing.captions_url) {
      const path = storagePathFromUrl(existing.captions_url);
      if (path) {
        await recordOrphan({
          kind: 'storage_image',
          reference: path,
          reason: `Caption track removed from "${existing.title}"`
        }).catch(() => {});
      }
    }
    const { error: updateError } = await supabase
      .from('episodes')
      .update({ captions_url: null })
      .eq('id', episodeId);
    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }
    return res.status(200).json({ ok: true, removed: true });
  }

  if (!captionsBase64) {
    return res.status(400).json({ error: 'No caption file was provided.' });
  }

  let uploaded;
  try {
    uploaded = await uploadCaptionFile({
      base64: captionsBase64,
      fileName: captionsFileName,
      pathPrefix: episodeId
    });
  } catch (err) {
    // These messages are written to be read by a creator, not an engineer —
    // pass them straight through rather than flattening to "upload failed".
    return res.status(400).json({ error: err.message });
  }

  // The previous file isn't deleted outright — it's recorded as orphaned so
  // it shows up in the admin cleanup queue, matching how replaced artwork
  // and video are already handled.
  if (existing.captions_url) {
    const path = storagePathFromUrl(existing.captions_url);
    if (path) {
      await recordOrphan({
        kind: 'storage_image',
        reference: path,
        reason: `Replaced caption track for "${existing.title}"`
      }).catch(() => {});
    }
  }

  const { error: updateError } = await supabase
    .from('episodes')
    .update({
      captions_url: uploaded.url,
      captions_language: (language || 'en').slice(0, 12),
      captions_label: (label || 'English').slice(0, 60)
    })
    .eq('id', episodeId);

  if (updateError) {
    return res.status(500).json({ error: updateError.message });
  }

  return res.status(200).json({
    ok: true,
    url: uploaded.url,
    cueCount: uploaded.cueCount,
    converted: uploaded.converted
  });
}
