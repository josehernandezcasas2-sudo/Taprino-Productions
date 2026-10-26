import { getSupabase } from './supabase';
import { SITE } from './siteConfig';
import { sendPush, sendPushMany } from './push';

// Who emails come from. Resend's onboarding@resend.dev test sender only
// delivers to the Resend account's own address, so a RESEND_FROM_EMAIL
// left on it (the old .env example) silently dropped every email to
// anyone else. Anything on resend.dev falls back to the verified domain.
const DEFAULT_FROM = `${SITE.name} <hello@studiotapatv.site>`;
export function mailFrom() {
  const from = (process.env.RESEND_FROM_EMAIL || '').trim();
  return from && !/@resend\.dev\b/i.test(from) ? from : DEFAULT_FROM;
}

// Same Resend REST pattern already proven in pages/api/notify-series-drop.js
// — extracted here so it has one home instead of being duplicated per
// call site. Deliberately does not throw on a missing API key or a
// failed send; the caller decides whether that's worth logging, but an
// email notification going out is never something that should be able
// to break the actual action (approving/rejecting an ad, etc.) that
// triggered it.
export async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !to) {
    return { skipped: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: mailFrom(),
        // Replies reach a real inbox, not the sending address.
        reply_to: SITE.contactEmail,
        to,
        subject,
        html
      })
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('sendEmail error:', body);
      let reason = null;
      try { reason = JSON.parse(body).message || null; } catch { reason = body.slice(0, 200); }
      return { sent: false, reason };
    }
    return { sent: true };
  } catch (err) {
    console.error('sendEmail error:', err.message);
    return { sent: false };
  }
}

// Called from reviewAdvertiserAd() the moment admin approves or rejects
// an ad — this is the entire point of the request that led here: an
// advertiser shouldn't have to keep reloading their dashboard to find
// out what happened. A rejected ad's reason is included directly in the
// email, not just "log in to see why."
export async function notifyAdvertiserAdReviewed({ to, adTitle, decision, rejectionReason }) {
  if (!to) return;
  const approved = decision === 'approved';
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const subject = approved ? `Your ad "${adTitle}" was approved` : `Your ad "${adTitle}" needs changes`;
  const html = approved
    ? `<p>Good news — <strong>${esc(adTitle)}</strong> has been approved and is now running.</p><p>Check your Ad Manager dashboard to see performance as it comes in.</p>`
    : `<p><strong>${esc(adTitle)}</strong> wasn't approved this time.</p><p><strong>Reason:</strong> ${esc(rejectionReason)}</p><p>You're welcome to make changes and submit a new one from your Ad Manager dashboard.</p>`;
  await sendEmail({ to, subject, html });
}

// Same best-effort pattern as lib/auditLog.js and lib/orphanedMedia.js.
// A failed notification insert is a missed heads-up, not a broken action —
// the admin's real approve/reject/etc. must still succeed either way.
//
// Every row also goes out as a push to the person's phones (lib/push.js,
// migration 102; the app registers its token): same text, the href as
// the tap target. No tokens = nothing sent.
const pushHref = (href, episodeId, pitchId) => href || (episodeId ? `/episode/${episodeId}` : pitchId ? `/pitches/${pitchId}` : null);

// `push: false` writes the bell row without buzzing the phone (a busy
// conversation pushes once per few minutes, not once per message).
export async function notifyCreator({ userId, type, message, episodeId, pitchId, href, push = true }) {
  if (!userId) return;
  try {
    const supabase = getSupabase();
    const row = {
      user_id: userId,
      type,
      message,
      episode_id: episodeId || null,
      pitch_id: pitchId || null
    };
    // href (migration 082) is where the bell takes you — a call, a
    // conversation. Before that migration the column doesn't exist, so
    // retry without it rather than lose the notification.
    if (href) row.href = href;
    let { error } = await supabase.from('notifications').insert(row);
    if (error && href && /href/.test(error.message || '')) {
      delete row.href;
      ({ error } = await supabase.from('notifications').insert(row));
    }
    if (error) console.error('notifyCreator error:', error.message);
  } catch (err) {
    console.error('notifyCreator error:', err.message);
  }
  if (push) await sendPush({ userId, body: message, href: pushHref(href, episodeId, pitchId), data: { type } });
}

// Many at once (a crew call that matches hundreds of cards): a single
// insert instead of one round trip per person, with the same fallback as
// notifyCreator for a database that predates the href column.
export async function notifyMany(items) {
  const rows = (items || []).filter((r) => r && r.userId).map((r) => ({
    user_id: r.userId,
    type: r.type,
    message: r.message,
    episode_id: r.episodeId || null,
    pitch_id: r.pitchId || null,
    ...(r.href ? { href: r.href } : {})
  }));
  if (rows.length === 0) return;
  try {
    const supabase = getSupabase();
    let { error } = await supabase.from('notifications').insert(rows);
    if (error && /href/.test(error.message || '')) {
      ({ error } = await supabase.from('notifications').insert(rows.map(({ href, ...rest }) => rest)));
    }
    if (error) console.error('notifyMany error:', error.message);
  } catch (err) {
    console.error('notifyMany error:', err.message);
  }
  await sendPushMany((items || []).filter((r) => r && r.userId).map((r) => ({ userId: r.userId, body: r.message, href: pushHref(r.href, r.episodeId, r.pitchId), data: { type: r.type } })));
}
