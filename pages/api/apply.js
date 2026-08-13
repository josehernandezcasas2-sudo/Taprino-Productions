import { getSupabase } from '../../lib/supabase';
import { checkRateLimit, rateLimitKeyForRequest } from '../../lib/rateLimit';

// Public — no auth. Anyone can apply, which is the point: this replaces the
// old creators-only upload flow. Rate limited per IP since an open,
// unauthenticated write endpoint is exactly the kind of thing that attracts
// junk submissions.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'creator-application'), 5, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'You\u2019ve submitted a few applications already — give it an hour before sending another.' });
  }

  const {
    name, email, portfolioUrl,
    title, logline, description, contentType, mainGenre, runtime, completionStatus,
    mediaLink, mediaNotes
  } = req.body || {};

  if (!name || !name.trim()) return res.status(400).json({ error: 'Please tell us your name.' });
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A working email address is required — it\u2019s how we\u2019d get back to you.' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'What\u2019s the work called?' });
  if (!logline || !logline.trim()) return res.status(400).json({ error: 'A one-line description is required.' });

  const supabase = getSupabase();
  const { error } = await supabase.from('creator_applications').insert({
    name: name.trim().slice(0, 200),
    email: email.trim().slice(0, 320),
    portfolio_url: portfolioUrl ? portfolioUrl.trim().slice(0, 500) : null,
    title: title.trim().slice(0, 300),
    logline: logline.trim().slice(0, 500),
    description: description ? description.trim().slice(0, 4000) : null,
    content_type: contentType || null,
    main_genre: mainGenre || null,
    runtime: runtime ? runtime.trim().slice(0, 40) : null,
    completion_status: completionStatus || null,
    media_link: mediaLink ? mediaLink.trim().slice(0, 1000) : null,
    media_notes: mediaNotes ? mediaNotes.trim().slice(0, 2000) : null
  });

  if (error) {
    console.error('creator application error:', error.message);
    return res.status(500).json({ error: 'Something went wrong saving your application. Try again in a moment.' });
  }

  return res.status(200).json({ ok: true });
}
