import { getRoleContext } from '../../lib/roles';
import { getSupabase } from '../../lib/supabase';
import { checkRateLimit, rateLimitKeyForRequest } from '../../lib/rateLimit';
import { sendEmail } from '../../lib/notify';
import { isHttpUrl } from '../../lib/safeUrl';
import {
  RIGHTS_QUESTIONS, ONBOARDING, APPLICATION_TYPES, APPLICATION_RATINGS, APPLICATION_STATUSES, APPLICATION_GENRES, ATTESTATION,
  APPLICATION_STATUS_LABEL, normalizeRightsAnswers, rightsVerdict, getOwnApplication, toApplicantView, applicationEmails
} from '../../lib/creatorApplications';
import { checkVideoOwnership, VIDEO_UID_PATTERN } from '../../lib/videoOwnership';
import { insertCompat } from '../../lib/dbCompat';
import { applyCors } from '../../lib/cors';
import { sendError } from '../../lib/apiErrors';

// Creator applications. Signed-in only: the application is tied to the
// account so Accept can grant Creator Studio and the applicant can see
// its status.
//
//   GET  — the viewer's own latest application (null if none; the upload's
//          state refreshed from Cloudflare), plus the rights questions and
//          the page's words so the mobile app shows the same page.
//   POST — send one, with the master's uid from /api/apply/upload-url (or
//          a link to the files). Refused while another is still open, or
//          if the account already has Creator Studio.
const VIDEO_COLUMNS = ['video_uid', 'video_state', 'video_name', 'video_bytes', 'upload_url', 'runtime_seconds'];

export default async function handler(req, res) {
  // The mobile app calls this with a Bearer token; answer its pre-check.
  applyCors(req, res);
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
      email: role.email || null,
      application,
      questions: RIGHTS_QUESTIONS,
      onboarding: ONBOARDING,
      types: APPLICATION_TYPES,
      ratings: APPLICATION_RATINGS,
      statuses: APPLICATION_STATUSES,
      genres: APPLICATION_GENRES,
      attestation: ATTESTATION,
      statusLabels: APPLICATION_STATUS_LABEL
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

  const existing = await getOwnApplication(role.userId, { refresh: false });
  if (existing && existing.isOpen) {
    return res.status(409).json({ error: 'Your last application is still under review. We’ll email you when there’s news.', code: 'open_application', application: existing });
  }

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'creator-application'), 5, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'You’ve sent a few applications already. Give it an hour before sending another.' });
  }

  const raw = req.body || {};
  // Free-text fields must be strings: a number or an object here used to
  // throw on .trim() and 500 the whole application.
  const s = (v) => (typeof v === 'string' ? v : '');
  const name = s(raw.name), portfolioUrl = s(raw.portfolioUrl), title = s(raw.title), logline = s(raw.logline);
  const description = s(raw.description), mediaLink = s(raw.mediaLink), mediaNotes = s(raw.mediaNotes), videoName = s(raw.videoName), uploadUrl = s(raw.uploadUrl);
  const { contentType, mainGenre, rating, completionStatus, rightsAnswers, rightsAttested, videoUid } = raw;
  const videoBytes = Number(raw.videoBytes) > 0 ? Math.round(Number(raw.videoBytes)) : null;
  const runtimeSeconds = Number(raw.runtimeSeconds) > 0 ? Math.round(Number(raw.runtimeSeconds)) : null;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Please tell us your name.' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'What’s the work called?' });
  if (!logline || !logline.trim()) return res.status(400).json({ error: 'A one-line description is required.' });
  // Links are shown to the reviewer as links, so only web addresses.
  if (portfolioUrl.trim() && !isHttpUrl(portfolioUrl)) return res.status(400).json({ error: 'The portfolio link needs to be a web address starting with https://' });
  if (mediaLink.trim() && !isHttpUrl(mediaLink)) return res.status(400).json({ error: 'The files link needs to be a web address starting with https://' });
  // The film itself, or a link to it: one of the two.
  if (!videoUid && !mediaLink.trim()) return res.status(400).json({ error: 'Drop the master in, or paste a link to it.' });

  // The rights check is the point of the page: no sending around it.
  const answers = normalizeRightsAnswers(rightsAnswers);
  const verdict = rightsVerdict(answers);
  if (!verdict.complete) return res.status(400).json({ error: 'Answer all five rights questions first.' });
  if (verdict.result === 'blocked') return res.status(400).json({ error: 'Only the rights holder can submit a film. If that’s a collaborator, ask them to apply, or apply together.' });
  if (rightsAttested !== true) return res.status(400).json({ error: 'Please confirm the rights statement before sending.' });

  // The master has to be this account's own upload (tagged by
  // /api/apply/upload-url): a uid is not a secret, and anyone could
  // otherwise attach a stranger's film to their application.
  let videoState = null;
  if (videoUid) {
    if (!VIDEO_UID_PATTERN.test(String(videoUid))) return res.status(400).json({ error: 'That doesn’t look like a video id from this site.' });
    const owned = await checkVideoOwnership(String(videoUid), { userId: role.userId, allowUntagged: false });
    if (!owned.ok) return res.status(owned.status).json({ error: owned.error });
    const st = owned.video.state;
    videoState = st === 'pendingupload' ? 'uploading' : (st === 'ready' || owned.video.readyToStream) ? 'ready' : st === 'error' ? 'error' : 'processing';
  }

  const row = {
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
    runtime: runtimeSeconds ? `${Math.max(1, Math.round(runtimeSeconds / 60))} min` : null,
    rating: APPLICATION_RATINGS.includes(rating) ? rating : null,
    completion_status: APPLICATION_STATUSES.some((st) => st.value === completionStatus) ? completionStatus : 'finished',
    media_link: mediaLink ? mediaLink.trim().slice(0, 1000) : null,
    media_notes: mediaNotes ? mediaNotes.trim().slice(0, 2000) : null,
    rights_answers: answers,
    rights_result: verdict.result,
    rights_attested: true,
    status: 'new',
    video_uid: videoUid ? String(videoUid) : null,
    video_state: videoState,
    video_name: videoName ? videoName.trim().slice(0, 200) : null,
    video_bytes: videoBytes,
    // tus's own address for this upload, so it can be resumed later.
    upload_url: uploadUrl && /^https?:\/\//.test(uploadUrl) ? uploadUrl.slice(0, 1000) : null,
    runtime_seconds: runtimeSeconds
  };

  const { data, error } = await insertCompat(getSupabase(), 'creator_applications', row, VIDEO_COLUMNS);
  if (error) return sendError(res, error, 'apply', 'Something went wrong saving your application. Try again in a moment.');

  // Confirmation to the applicant. A failed email never fails the
  // application; sendEmail logs and moves on.
  if (role.email) {
    const mail = applicationEmails.received({ name: data.name, title: data.title, holds: verdict.holds, uploaded: Boolean(videoUid) });
    await sendEmail({ to: role.email, ...mail });
  }

  return res.status(200).json({ ok: true, application: toApplicantView(data) });
}
