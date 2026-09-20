import { getSupabase } from './supabase';

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
        from: process.env.RESEND_FROM_EMAIL || 'Studio Tapa TV <onboarding@resend.dev>',
        to,
        subject,
        html
      })
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('sendEmail error:', body);
      return { sent: false };
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
  const subject = approved ? `Your ad "${adTitle}" was approved` : `Your ad "${adTitle}" needs changes`;
  const html = approved
    ? `<p>Good news — <strong>${adTitle}</strong> has been approved and is now running.</p><p>Check your Ad Manager dashboard to see performance as it comes in.</p>`
    : `<p><strong>${adTitle}</strong> wasn't approved this time.</p><p><strong>Reason:</strong> ${rejectionReason}</p><p>You're welcome to make changes and submit a new one from your Ad Manager dashboard.</p>`;
  await sendEmail({ to, subject, html });
}

// Same best-effort pattern as lib/auditLog.js and lib/orphanedMedia.js.
// A failed notification insert is a missed heads-up, not a broken action —
// the admin's real approve/reject/etc. must still succeed either way.
export async function notifyCreator({ userId, type, message, episodeId, pitchId }) {
  if (!userId) return;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('notifications').insert({
      user_id: userId,
      type,
      message,
      episode_id: episodeId || null,
      pitch_id: pitchId || null
    });
    if (error) console.error('notifyCreator error:', error.message);
  } catch (err) {
    console.error('notifyCreator error:', err.message);
  }
}
