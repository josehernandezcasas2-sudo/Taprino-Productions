import { getRoleContext } from '../../lib/roles';
import { getSupabase } from '../../lib/supabase';
import { checkRateLimit, rateLimitKeyForRequest } from '../../lib/rateLimit';
import { sendEmail } from '../../lib/notify';
import {
  RIGHTS_QUESTIONS, ONBOARDING, APPLICATION_TYPES, APPLICATION_RATINGS, APPLICATION_STATUSES,
  normalizeRightsAnswers, rightsVerdict, getOwnApplication, toApplicantView, applicationEmails
} from '../../lib/creatorApplications';

// Creator applications. Signed-in only, since /apply's redesign: the
// application is tied to the account so accepting it grants Creator
// Studio and the applicant can see its status.
//
//   GET  — the viewer's own latest application (null if none), plus the
//          rights questions and page numbers so the mobile app shows the
//          same onboarding as the website.
//   POST — send one. Refused while another is still open, or if the
//          account already has Creator Studio.
export default async function handler(req, res) {
  // The mobile app calls this with a Bearer token; answer its pre-check.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const role = await getRoleContext(req);

  if (req.method === 'GET') {
    const application = role.userId ? await getOwnApplication(role.userId) : null;
    return res.status(200).json({
      isSignedIn: Boolean(role.userId),
      isCreator: role.isCreator,
      application,
      questions: RIGHTS_QUESTIONS,
      onboarding: ONBOARDING,
      types: APPLICATION_TYPES,
      ratings: APPLICATION_RATINGS
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!role.userId) {
    return res.status(401).json({ error: 'Sign in to apply, so we can attach the application to your account.' });
  }
  if (role.isCreator) {
    return res.status(409).json({ error: 'You already have Creator Studio. Submit your film there instead.', code: 'already_creator' });
  }

  const existing = await getOwnApplication(role.userId);
  if (existing && existing.isOpen) {
    return res.status(409).json({ error: 'Your last application is still under review. We’ll email you when there’s news.', code: 'open_application', application: existing });
  }

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'creator-application'), 5, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'You’ve sent a few applications already. Give it an hour before sending another.' });
  }

  const {
    name, portfolioUrl,
    title, logline, description, contentType, mainGenre, runtime, rating, completionStatus,
    mediaLink, mediaNotes,
    rightsAnswers, rightsAttested
  } = req.body || {};

  if (!name || !name.trim()) return res.status(400).json({ error: 'Please tell us your name.' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'What’s the work called?' });
  if (!logline || !logline.trim()) return res.status(400).json({ error: 'A one-line description is required.' });

  // The rights check is the point of the page: no sending around it.
  const answers = normalizeRightsAnswers(rightsAnswers);
  const verdict = rightsVerdict(answers);
  if (!verdict.complete) return res.status(400).json({ error: 'Answer all five rights questions first.' });
  if (verdict.result === 'blocked') return res.status(400).json({ error: 'Only the rights holder can submit a film. If that’s a collaborator, ask them to apply, or apply together.' });
  if (rightsAttested !== true) return res.status(400).json({ error: 'Please confirm the rights statements before sending.' });

  const supabase = getSupabase();
  const { data, error } = await supabase.from('creator_applications').insert({
    user_id: role.userId,
    name: name.trim().slice(0, 200),
    // From the signed-in account, never the form: it's where decisions go.
    email: (role.email || '').slice(0, 320),
    portfolio_url: portfolioUrl ? portfolioUrl.trim().slice(0, 500) : null,
    title: title.trim().slice(0, 300),
    logline: logline.trim().slice(0, 500),
    description: description ? description.trim().slice(0, 4000) : null,
    content_type: APPLICATION_TYPES.some((t) => t.value === contentType) ? contentType : null,
    main_genre: mainGenre ? String(mainGenre).slice(0, 60) : null,
    runtime: runtime ? runtime.trim().slice(0, 40) : null,
    rating: APPLICATION_RATINGS.includes(rating) ? rating : null,
    completion_status: APPLICATION_STATUSES.some((s) => s.value === completionStatus) ? completionStatus : null,
    media_link: mediaLink ? mediaLink.trim().slice(0, 1000) : null,
    media_notes: mediaNotes ? mediaNotes.trim().slice(0, 2000) : null,
    rights_answers: answers,
    rights_result: verdict.result,
    rights_attested: true
  }).select().single();

  if (error) {
    console.error('creator application error:', error.message);
    return res.status(500).json({ error: 'Something went wrong saving your application. Try again in a moment.' });
  }

  // Confirmation to the applicant. A failed email never fails the
  // application; sendEmail logs and moves on.
  if (role.email) {
    const mail = applicationEmails.received({ name: data.name, title: data.title, holds: verdict.holds });
    await sendEmail({ to: role.email, ...mail });
  }

  return res.status(200).json({ ok: true, application: toApplicantView(data) });
}
