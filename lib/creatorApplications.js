import { getSupabase } from './supabase';
import { SITE } from './siteConfig';
import { ONBOARDING, rightsVerdict } from './creatorRights';

// Creator onboarding, the server half: the applicant's own application,
// what they're allowed to see of it, and the emails. The questions and
// verdict logic live in lib/creatorRights.js (client-safe) and are
// re-exported here so API routes import from one place.
export {
  RIGHTS_QUESTIONS, ONBOARDING, APPLICATION_TYPES, APPLICATION_RATINGS, APPLICATION_STATUSES, APPLICATION_GENRES,
  normalizeRightsAnswers, rightsVerdict, rightsVerdictCopy
} from './creatorRights';

const OPEN_STATUSES = ['new', 'reviewing'];

export function isOpenStatus(status) {
  return OPEN_STATUSES.includes(status);
}

// The applicant's most recent application, if any.
export async function getOwnApplication(userId) {
  if (!userId) return null;
  const { data, error } = await getSupabase()
    .from('creator_applications')
    .select('id, title, status, created_at, reviewed_at, decision_note, rights_answers, rights_result, role_granted_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('getOwnApplication error:', error.message);
    return null;
  }
  return data ? toApplicantView(data) : null;
}

// What the applicant is allowed to see of their own row. Never the
// reviewer's internal admin_notes.
export function toApplicantView(row) {
  const verdict = rightsVerdict(row.rights_answers);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    isOpen: isOpenStatus(row.status),
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
    decisionNote: row.decision_note || null,
    rightsResult: row.rights_result || verdict.result,
    holds: verdict.holds,
    roleGrantedAt: row.role_granted_at || null
  };
}

/* ---------------- emails ---------------- */

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wrap(body) {
  return `<div style="font-family: Georgia, serif; font-size: 16px; line-height: 1.6; color: #241a05; max-width: 560px;">${body}<p style="margin-top: 28px; font-size: 13px; color: #6b6248;">${escapeHtml(SITE.name)} · <a href="${SITE.productionDomain}/apply" style="color: #96642c;">${SITE.productionDomain}/apply</a></p></div>`;
}

export const applicationEmails = {
  received({ name, title, holds }) {
    const holdsHtml = holds && holds.length
      ? `<p>Your rights check flagged a few things we'll need before it can go live. Send them whenever you have them, replying to this email is fine:</p><ul>${holds.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
      : '';
    return {
      subject: `We got your application: ${title}`,
      html: wrap(`<p>Hi ${escapeHtml(name)},</p><p>Thanks for sending <strong>${escapeHtml(title)}</strong> to ${escapeHtml(SITE.name)}. We read every application and aim to reply within ${ONBOARDING.replyWindow}. You can see where it stands any time at <a href="${SITE.productionDomain}/apply">${SITE.productionDomain}/apply</a>.</p>${holdsHtml}<p>Jose<br>${escapeHtml(SITE.studio)}</p>`)
    };
  },
  accepted({ name, title, note }) {
    return {
      subject: `You're in: ${title} on ${SITE.name}`,
      html: wrap(`<p>Hi ${escapeHtml(name)},</p><p>Good news. <strong>${escapeHtml(title)}</strong> is a fit, and Creator Studio is now on your account. Sign in and head to <a href="${SITE.productionDomain}/creator">${SITE.productionDomain}/creator</a> to upload the master, artwork, rating and captions. It goes into our review queue from there, and we'll tell you when it's live.</p>${note ? `<p><strong>A note from us:</strong> ${escapeHtml(note)}</p>` : ''}<p>Jose<br>${escapeHtml(SITE.studio)}</p>`)
    };
  },
  declined({ name, title, note }) {
    return {
      subject: `About your application: ${title}`,
      html: wrap(`<p>Hi ${escapeHtml(name)},</p><p>Thanks for sending <strong>${escapeHtml(title)}</strong>. It's not a fit for ${escapeHtml(SITE.name)} right now.</p>${note ? `<p><strong>A note from us:</strong> ${escapeHtml(note)}</p>` : ''}<p>You're welcome to apply again with new work at <a href="${SITE.productionDomain}/apply">${SITE.productionDomain}/apply</a>.</p><p>Jose<br>${escapeHtml(SITE.studio)}</p>`)
    };
  }
};
