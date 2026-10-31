import { getSupabase } from './supabase';
import { SITE } from './siteConfig';
import {
  ONBOARDING, rightsVerdict, isOpenApplicationStatus, APPLICATION_TYPE_TO_CONTENT, APPLICATION_RATING_CODES, runtimeClock
} from './creatorRights';
import {
  getCloudflareVideoStatus, deleteCloudflareVideo, cloudflarePlaybackUrl, signedSrcForStoredUrl,
  createCloudflareStreamToken, cloudflareSignedIframeUrl
} from './cloudflareUpload';
import { syncStreamProtection } from './streamProtection';
import { cutArtworkFromVideo } from './artworkFromFilm';
import { getUserRole, setUserRole } from './roles';
import { sendEmail, notifyCreator } from './notify';
import { recordAudit } from './auditLog';
import { invalidateCache } from './redis';
import { updateCompat } from './dbCompat';

// Creator onboarding, the server half: the applicant's own application,
// what they're allowed to see of it, the three decisions (Accept = live,
// Hold, Decline) and the emails. The questions and verdict logic live in
// lib/creatorRights.js (client-safe) and are re-exported here so API
// routes import from one place.
//
// Since 2026-10-31 the master is uploaded with the application (Cloudflare
// Stream, tagged with the applicant, signed URLs from the first byte;
// migration 116), so Accept creates the title itself, approved and
// released, grants Creator Studio and says "it's live" — one decision
// instead of accept → upload → second review.
export {
  RIGHTS_QUESTIONS, ONBOARDING, APPLICATION_TYPES, APPLICATION_RATINGS, APPLICATION_STATUSES, APPLICATION_GENRES, ATTESTATION,
  APPLICATION_STATUS_LABEL, normalizeRightsAnswers, rightsVerdict, rightsVerdictCopy, isOpenApplicationStatus
} from './creatorRights';

export const isOpenStatus = isOpenApplicationStatus;

// Columns migration 116 added. Writes retry without them on a database
// that hasn't run it (lib/dbCompat.js), reads treat them as absent.
const VIDEO_COLUMNS = ['video_uid', 'video_state', 'video_name', 'video_bytes', 'upload_url', 'runtime_seconds', 'poster', 'thumbnail', 'episode_id', 'held_at'];

const SELECT = 'id, user_id, name, email, title, logline, status, content_type, main_genre, rating, media_link, created_at, reviewed_at, decision_note, rights_answers, rights_result, role_granted_at, video_uid, video_state, video_name, video_bytes, upload_url, runtime_seconds, poster, thumbnail, episode_id, held_at';
const SELECT_LEGACY = 'id, user_id, name, email, title, logline, status, content_type, main_genre, rating, media_link, created_at, reviewed_at, decision_note, rights_answers, rights_result, role_granted_at';

function missingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column|schema cache/i.test(error.message || ''));
}

async function selectOne(where) {
  const supabase = getSupabase();
  let res = await where(supabase.from('creator_applications').select(SELECT)).maybeSingle();
  if (res.error && missingColumn(res.error)) res = await where(supabase.from('creator_applications').select(SELECT_LEGACY)).maybeSingle();
  return res;
}

// The applicant's most recent application, if any. `refresh` asks
// Cloudflare where the upload stands when the row doesn't know yet.
export async function getOwnApplication(userId, { refresh = true } = {}) {
  if (!userId) return null;
  const { data, error } = await selectOne((q) => q.eq('user_id', userId).order('created_at', { ascending: false }).limit(1));
  if (error) {
    console.error('getOwnApplication error:', error.message);
    return null;
  }
  if (!data) return null;
  const row = refresh ? await refreshVideoState(data) : data;
  return toApplicantView(row);
}

export async function getApplication(id) {
  const { data, error } = await selectOne((q) => q.eq('id', id));
  if (error) {
    console.error('getApplication error:', error.message);
    return null;
  }
  return data || null;
}

// Cloudflare's state → ours. `pendingupload` is the browser still sending.
function stateFromCloudflare(video) {
  if (!video || !video.state) return null;
  if (video.state === 'pendingupload') return 'uploading';
  if (video.state === 'ready' || video.readyToStream) return 'ready';
  if (video.state === 'error') return 'error';
  return 'processing';
}

// Asks Cloudflare where the master stands while the row says it isn't
// final, writes the answer (and the runtime, once known) back, and returns
// the row as it now is. Best effort: a Cloudflare hiccup leaves the row.
export async function refreshVideoState(row) {
  if (!row || !row.video_uid) return row;
  if (['ready', 'error', 'deleted'].includes(row.video_state)) return row;
  const video = await getCloudflareVideoStatus(row.video_uid);
  const state = stateFromCloudflare(video);
  if (!state) return row;
  const patch = {};
  if (state !== row.video_state) patch.video_state = state;
  if (!row.runtime_seconds && video.duration) patch.runtime_seconds = Math.round(video.duration);
  if (Object.keys(patch).length === 0) return row;
  const { error } = await getSupabase().from('creator_applications').update(patch).eq('id', row.id);
  if (error) {
    console.error('refreshVideoState:', error.message);
    return row;
  }
  return { ...row, ...patch };
}

// What the applicant is allowed to see of their own row. Never the
// reviewer's internal admin_notes.
export function toApplicantView(row) {
  const verdict = rightsVerdict(row.rights_answers);
  const video = row.video_uid || row.video_state === 'deleted'
    ? { state: row.video_state || 'processing', name: row.video_name || null, bytes: row.video_bytes || null, runtimeSeconds: row.runtime_seconds || null, uid: row.video_uid || null, uploadUrl: row.upload_url || null }
    : null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    isOpen: isOpenApplicationStatus(row.status),
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
    heldAt: row.held_at || null,
    decisionNote: row.decision_note || null,
    rightsResult: row.rights_result || verdict.result,
    holds: verdict.holds,
    roleGrantedAt: row.role_granted_at || null,
    contentType: row.content_type || null,
    video,
    hasLink: Boolean(row.media_link),
    poster: row.poster || null,
    thumbnail: row.thumbnail || null,
    episodeId: row.episode_id || null,
    episodeHref: row.episode_id ? `/episode/${row.episode_id}` : null
  };
}

/* ---------------- the reviewer's side ---------------- */

const CONTENT_TYPE_LABEL = { short: 'Short', film: 'Film', series: 'Series', podcast: 'Podcast', vertical: 'Snippet', other: 'Other' };

// Applications waiting on a decision, for the merged review queue: the
// signed master (manifest + Cloudflare's player page) so the reviewer can
// watch it in place. `held` ones wait on the applicant, so they're left
// to /admin/applications.
export async function listApplicationsForQueue() {
  const supabase = getSupabase();
  let { data, error } = await supabase.from('creator_applications').select(SELECT).in('status', ['new', 'reviewing']).order('created_at', { ascending: true }).limit(100);
  if (error && missingColumn(error)) ({ data, error } = await supabase.from('creator_applications').select(SELECT_LEGACY).in('status', ['new', 'reviewing']).order('created_at', { ascending: true }).limit(100));
  if (error) {
    console.error('listApplicationsForQueue:', error.message);
    return [];
  }
  const items = [];
  for (const raw of data || []) {
    const row = await refreshVideoState(raw);
    const verdict = rightsVerdict(row.rights_answers);
    const media = await signedMediaFor(row);
    items.push({
      id: row.id,
      title: row.title,
      name: row.name,
      email: row.email,
      logline: row.logline,
      contentType: row.content_type,
      typeLabel: CONTENT_TYPE_LABEL[row.content_type] || row.content_type || 'Untyped',
      genre: row.main_genre,
      rating: row.rating,
      createdAt: row.created_at,
      rightsResult: row.rights_result || verdict.result,
      holds: verdict.holds,
      video: row.video_uid ? { state: row.video_state, runtime: runtimeClock(row.runtime_seconds), bytes: row.video_bytes } : null,
      mediaLink: row.media_link || null,
      poster: row.poster || row.thumbnail || null,
      media
    });
  }
  return items;
}

// { src, iframe } for a ready master, else null.
export async function signedMediaFor(row) {
  if (!row || !row.video_uid || row.video_state !== 'ready') return null;
  const stored = cloudflarePlaybackUrl(row.video_uid);
  if (!stored) return null;
  const signed = await signedSrcForStoredUrl(stored, { expiresInSeconds: 2 * 60 * 60 });
  if (!signed) return null;
  let iframe = null;
  try {
    const { token } = await createCloudflareStreamToken(row.video_uid, { expiresInSeconds: 2 * 60 * 60 });
    iframe = cloudflareSignedIframeUrl(token);
  } catch {
    // The manifest alone still plays in Safari.
  }
  return { src: signed.src, iframe };
}

function slugId(title) {
  return `${String(title || 'title').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'title'}-${Date.now().toString(36)}`;
}

// The poster and the still for the new title: the applicant's own if they
// sent them, else both cut from the film (lib/artworkFromFilm.js).
function artworkFor(row, episodeId) {
  return cutArtworkFromVideo(row.video_uid, episodeId, { poster: row.poster || null, thumbnail: row.thumbnail || null });
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function grantRole(row) {
  if (!row.user_id) return { roleGranted: false, needsManualGrant: true };
  const current = await getUserRole(row.user_id);
  if (current) return { roleGranted: false, needsManualGrant: false };
  await setUserRole(row.user_id, 'creator');
  return { roleGranted: true, needsManualGrant: false };
}

// Accept. With a ready master: the title goes live now (a series or
// podcast gets its show created too), Creator Studio is granted, the
// applicant is emailed "it's live". Without one (the applicant linked to
// their files): Creator Studio is granted and they upload there, the way
// it worked before 2026-10-31. `tier` is the reviewer's call (free unless
// they say premium).
export async function acceptApplication(rc, { id, tier = 'free', note = '' }) {
  if (!rc || !rc.isAdmin) throw httpError('Only a full admin can accept an application, since that grants Creator Studio.', 403);
  const before = await getApplication(id);
  if (!before) throw httpError('No such application.', 404);
  if (before.status === 'accepted') throw httpError('This application was already accepted.', 409);
  const chosenTier = tier === 'premium' ? 'premium' : 'free';
  const decisionNote = note ? String(note).trim().slice(0, 2000) || null : null;
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const row = await refreshVideoState(before);
  if (row.video_uid && row.video_state !== 'ready') {
    const why = row.video_state === 'uploading' ? 'the master is still uploading from the applicant’s side' : row.video_state === 'error' ? 'Cloudflare could not process the master — ask them to replace the file (Hold)' : 'Cloudflare is still processing the master';
    throw httpError(`Not yet: ${why}. Try again in a few minutes.`, 409);
  }

  const { roleGranted, needsManualGrant } = await grantRole(row);

  let episode = null;
  let cut = false;
  if (row.video_uid && row.user_id) {
    const contentType = APPLICATION_TYPE_TO_CONTENT[row.content_type] || 'short';
    const episodeId = slugId(row.title);
    const art = await artworkFor(row, episodeId);
    cut = art.cut;
    let seriesId = null;
    if (contentType === 'series' || contentType === 'podcast') {
      seriesId = slugId(row.title);
      const { error: seriesError } = await supabase.from('series').insert({
        id: seriesId,
        name: row.title,
        description: row.logline || null,
        poster: art.poster,
        thumbnail: art.thumbnail,
        creator_id: row.user_id,
        channel_opt_in: false,
        submitted_by: row.email || null,
        status: 'approved',
        deletion_requested: false,
        moderation_hold: false,
        reviewed_by: rc.email || null,
        reviewed_at: now
      });
      if (seriesError) throw httpError('Could not create the show. Nothing was changed.', 500);
    }
    const src = cloudflarePlaybackUrl(row.video_uid);
    const insert = {
      id: episodeId,
      title: row.title,
      description: row.logline || row.title,
      tier: chosenTier,
      genre: row.main_genre || 'Other',
      main_genre: row.main_genre || 'Other',
      content_type: contentType,
      series_id: seriesId,
      season: seriesId ? 1 : null,
      series_order: seriesId ? 1 : null,
      artist: row.name,
      runtime: runtimeClock(row.runtime_seconds) || '00:00',
      rating: APPLICATION_RATING_CODES[row.rating] || null,
      video_type: 'html5',
      src,
      poster: art.poster,
      thumbnail: art.thumbnail,
      featured: false,
      ads_enabled: true,
      ad_break_seconds: [0],
      is_original: false,
      channel_opt_in: false,
      status: 'approved',
      // Explicit so a title created here never waits on a column default.
      deletion_requested: false,
      moderation_hold: false,
      submitted_by: row.user_id,
      reviewed_by: rc.userId,
      reviewed_at: now,
      released_at: now
    };
    let { error: epError } = await supabase.from('episodes').insert(insert);
    if (epError && /released_at/i.test(epError.message || '')) {
      delete insert.released_at;
      ({ error: epError } = await supabase.from('episodes').insert(insert));
    }
    if (epError) {
      console.error('acceptApplication episode insert:', epError.message);
      throw httpError('Could not create the title. Nothing was changed.', 500);
    }
    episode = { id: episodeId, href: `/episode/${episodeId}`, seriesId };
    await syncStreamProtection({ src });
    await invalidateCache('public_episodes_v1');
    if (seriesId) await invalidateCache('all_series_approved_v1');
  }

  const patch = {
    status: 'accepted',
    reviewed_by: rc.userId,
    reviewed_at: now,
    decision_note: decisionNote,
    role_granted_at: row.user_id ? now : null,
    episode_id: episode ? episode.id : null,
    held_at: null
  };
  const { data, error } = await updateCompat(supabase, 'creator_applications', patch, VIDEO_COLUMNS, (q) => q.eq('id', id).select().single());
  if (error) {
    console.error('acceptApplication update:', error.message);
    throw httpError('The title was created but the application could not be marked accepted. Reload and check.', 500);
  }

  await recordAudit({
    adminId: rc.userId,
    adminEmail: rc.email,
    action: 'application_accepted',
    targetType: 'creator_application',
    targetId: id,
    details: episode ? `${row.title} → live as ${episode.id} (${chosenTier})${roleGranted ? `, creator role granted to ${row.email}` : ''}` : `${row.title}${roleGranted ? ` (creator role granted to ${row.email})` : ''}`
  });

  if (row.email) {
    const mail = episode
      ? applicationEmails.live({ name: row.name, title: row.title, note: decisionNote, href: episode.href, tier: chosenTier, cut })
      : applicationEmails.accepted({ name: row.name, title: row.title, note: decisionNote });
    await sendEmail({ to: row.email, ...mail });
  }
  if (row.user_id) {
    await notifyCreator({
      userId: row.user_id,
      type: episode ? 'application_live' : 'application_accepted',
      message: episode ? `"${row.title}" is live on ${SITE.name}. Creator Studio is on your account.` : `You're in: Creator Studio is on your account. Upload "${row.title}" there.`,
      href: episode ? episode.href : '/creator'
    });
  }

  return { application: { ...data, rights_holds: rightsVerdict(data.rights_answers).holds }, episode, roleGranted, needsManualGrant, mode: episode ? 'live' : 'role', cut };
}

// Hold: one thing to fix, in the note; the applicant replaces the file or
// sends what's missing, and the application comes back to Reviewing.
export async function holdApplication(rc, { id, note }) {
  const text = String(note || '').trim().slice(0, 2000);
  if (!text) throw httpError('Say what needs fixing: the note is what the applicant reads.', 400);
  const before = await getApplication(id);
  if (!before) throw httpError('No such application.', 404);
  if (!isOpenApplicationStatus(before.status)) throw httpError('Only an open application can be held.', 409);
  const now = new Date().toISOString();
  const { data, error } = await updateCompat(getSupabase(), 'creator_applications', { status: 'held', held_at: now, decision_note: text, reviewed_by: rc.userId, reviewed_at: now }, VIDEO_COLUMNS, (q) => q.eq('id', id).select().single());
  if (error) throw httpError('Could not hold the application.', 500);
  await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: 'application_held', targetType: 'creator_application', targetId: id, details: `${before.title}: ${text}` });
  if (before.email) await sendEmail({ to: before.email, ...applicationEmails.held({ name: before.name, title: before.title, note: text }) });
  if (before.user_id) await notifyCreator({ userId: before.user_id, type: 'application_held', message: `One thing to fix on "${before.title}": ${text}`, href: '/apply' });
  return { application: { ...data, rights_holds: rightsVerdict(data.rights_answers).holds } };
}

// Decline: the file is deleted from Cloudflare (nothing of theirs is kept
// that they didn't ask us to keep), the note goes out with the email.
export async function declineApplication(rc, { id, note = '' }) {
  const before = await getApplication(id);
  if (!before) throw httpError('No such application.', 404);
  if (before.status === 'accepted') throw httpError('An accepted application can’t be declined; take the title down from the Library instead.', 409);
  const decisionNote = note ? String(note).trim().slice(0, 2000) || null : null;
  const now = new Date().toISOString();
  const hadVideo = Boolean(before.video_uid);
  if (hadVideo) await deleteApplicationVideo(before.video_uid);
  const patch = { status: 'declined', decision_note: decisionNote, reviewed_by: rc.userId, reviewed_at: now, held_at: null };
  if (hadVideo) Object.assign(patch, { video_uid: null, video_state: 'deleted', upload_url: null });
  const { data, error } = await updateCompat(getSupabase(), 'creator_applications', patch, VIDEO_COLUMNS, (q) => q.eq('id', id).select().single());
  if (error) throw httpError('Could not decline the application.', 500);
  await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: 'application_declined', targetType: 'creator_application', targetId: id, details: `${before.title}${hadVideo ? ' (master deleted)' : ''}` });
  if (before.email) await sendEmail({ to: before.email, ...applicationEmails.declined({ name: before.name, title: before.title, note: decisionNote, fileDeleted: hadVideo }) });
  if (before.user_id) await notifyCreator({ userId: before.user_id, type: 'application_declined', message: `"${before.title}" isn't a fit for ${SITE.name} right now.${decisionNote ? ` ${decisionNote}` : ''}`, href: '/apply' });
  return { application: { ...data, rights_holds: rightsVerdict(data.rights_answers).holds } };
}

// Best effort: Cloudflare down is logged, never a failed decision.
export async function deleteApplicationVideo(uid) {
  if (!uid) return false;
  try {
    await deleteCloudflareVideo(uid);
    return true;
  } catch (err) {
    console.error('deleteApplicationVideo:', uid, err.message);
    return false;
  }
}

/* ---------------- emails ---------------- */

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wrap(body) {
  return `<div style="font-family: Georgia, serif; font-size: 16px; line-height: 1.6; color: #241a05; max-width: 560px;">${body}<p style="margin-top: 28px; font-size: 13px; color: #6b6248;">${escapeHtml(SITE.name)} · <a href="${SITE.productionDomain}/apply" style="color: #9a7b1f;">${SITE.productionDomain}/apply</a></p></div>`;
}

export const applicationEmails = {
  received({ name, title, holds, uploaded }) {
    const holdsHtml = holds && holds.length
      ? `<p>Your rights check flagged a few things we'll need before it can go live. Send them whenever you have them, replying to this email is fine:</p><ul>${holds.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
      : '';
    const fileLine = uploaded
      ? `<p>The master is uploading to us (if you closed the page before it finished, open <a href="${SITE.productionDomain}/apply">${SITE.productionDomain}/apply</a> and pick the same file again; it carries on where it stopped).</p>`
      : '';
    return {
      subject: `We got your application: ${title}`,
      html: wrap(`<p>Hi ${escapeHtml(name)},</p><p>Thanks for sending <strong>${escapeHtml(title)}</strong> to ${escapeHtml(SITE.name)}. We watch everything and aim to reply within ${ONBOARDING.replyWindow}. If it's a fit it goes live the moment we say yes, and you can see where it stands any time at <a href="${SITE.productionDomain}/apply">${SITE.productionDomain}/apply</a>.</p>${fileLine}${holdsHtml}<p>Jose<br>${escapeHtml(SITE.studio)}</p>`)
    };
  },
  // Accept with the master in hand: the title is live.
  live({ name, title, note, href, tier, cut }) {
    const url = `${SITE.productionDomain}${href}`;
    return {
      subject: `${title} is live on ${SITE.name}`,
      html: wrap(`<p>Hi ${escapeHtml(name)},</p><p>Good news. <strong>${escapeHtml(title)}</strong> is on ${escapeHtml(SITE.name)} as of now, ${tier === 'premium' ? 'for Tapa + members' : 'free with ads'}: <a href="${url}">${url}</a>.</p><p>Creator Studio is on your account: your numbers, your money, the next title. Sign in and open <a href="${SITE.productionDomain}/creator">${SITE.productionDomain}/creator</a>.</p>${cut ? '<p>We cut a poster and a still from the film; swap them any time from Your work.</p>' : ''}${note ? `<p><strong>A note from us:</strong> ${escapeHtml(note)}</p>` : ''}<p>Jose<br>${escapeHtml(SITE.studio)}</p>`)
    };
  },
  // Accept without a master (the applicant linked to the files).
  accepted({ name, title, note }) {
    return {
      subject: `You're in: ${title} on ${SITE.name}`,
      html: wrap(`<p>Hi ${escapeHtml(name)},</p><p>Good news. <strong>${escapeHtml(title)}</strong> is a fit, and Creator Studio is now on your account. Sign in and head to <a href="${SITE.productionDomain}/creator">${SITE.productionDomain}/creator</a> to upload the master; we'll tell you when it's live.</p>${note ? `<p><strong>A note from us:</strong> ${escapeHtml(note)}</p>` : ''}<p>Jose<br>${escapeHtml(SITE.studio)}</p>`)
    };
  },
  held({ name, title, note }) {
    return {
      subject: `One thing to fix: ${title}`,
      html: wrap(`<p>Hi ${escapeHtml(name)},</p><p>We watched <strong>${escapeHtml(title)}</strong> and there's one thing in the way of it going live:</p><p><strong>${escapeHtml(note)}</strong></p><p>Replace the file or send what's missing at <a href="${SITE.productionDomain}/apply">${SITE.productionDomain}/apply</a> (replying to this email works too), and it comes straight back to us.</p><p>Jose<br>${escapeHtml(SITE.studio)}</p>`)
    };
  },
  // An admin asking someone to apply (/admin/applications → Invite to apply).
  invite({ name, note }) {
    return {
      subject: `An invitation to bring your work to ${SITE.name}`,
      html: wrap(`<p>Hi${name ? ` ${escapeHtml(name)}` : ''},</p><p>We’d love to see your work on <strong>${escapeHtml(SITE.name)}</strong>, an independent screening room where creators are backed by their audience. Sending a film takes a few minutes: the master uploads while you fill in a short page, we watch it, and if it's a fit it goes live with you keeping every right. We reply within ${ONBOARDING.replyWindow}.</p>${note ? `<p>${escapeHtml(note)}</p>` : ''}<p><a href="${SITE.productionDomain}/apply">Send us your film</a></p><p>Jose<br>${escapeHtml(SITE.studio)}</p>`)
    };
  },
  declined({ name, title, note, fileDeleted }) {
    return {
      subject: `About your application: ${title}`,
      html: wrap(`<p>Hi ${escapeHtml(name)},</p><p>Thanks for sending <strong>${escapeHtml(title)}</strong>. It's not a fit for ${escapeHtml(SITE.name)} right now.${fileDeleted ? ' The file is deleted from our side.' : ''}</p>${note ? `<p><strong>A note from us:</strong> ${escapeHtml(note)}</p>` : ''}<p>You're welcome to send new work any time at <a href="${SITE.productionDomain}/apply">${SITE.productionDomain}/apply</a>.</p><p>Jose<br>${escapeHtml(SITE.studio)}</p>`)
    };
  }
};
