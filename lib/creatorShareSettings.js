import { getSupabase } from './supabase';
import { getShareSettings, listSupportableCreators } from './artistSupport';
import { notifyMany, sendEmail } from './notify';
import { getUserEmail } from './messages';
import { SITE } from './siteConfig';
import { earliestEffective, normalizeShareNumbers, shareChanges } from './creatorShareRules';

// Changing the Creator Share numbers from /admin/creator-money (migration
// 092). Whatever is saved is what the Terms page shows: the numbers in
// force, plus any scheduled change and its date. A change that pays
// creators less can't take effect sooner than 30 days out (Terms section
// 5); creators with released work get a notification, and an email when
// the change goes against them.

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

async function tellCreators({ changes, effectiveAt, now }) {
  const creators = await listSupportableCreators();
  if (!creators.length) return { notified: 0, emailed: 0 };
  const when = now ? 'from today' : `from ${fmtDay(effectiveAt)}`;
  const lines = [...changes.adverse, ...changes.favourable];
  await notifyMany(creators.map((c) => ({
    userId: c.userId,
    type: 'payout',
    message: `Creator Share is changing ${when}: ${lines.join('; ')}. The Terms (section 5) have the details.`,
    href: '/terms#submit-work'
  })));
  // An email only when the change goes against creators — that's the
  // notice the Terms promise.
  let emailed = 0;
  if (changes.adverse.length) {
    const html = `<p>Hi,</p><p>We're changing the Creator Share numbers on ${esc(SITE.name)} ${esc(when)}:</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p>Credits you've already earned don't change. The full terms are at <a href="${SITE.productionDomain}/terms#submit-work">${SITE.productionDomain}/terms</a> (section 5). Reply to this email with any questions.</p><p>${esc(SITE.studio)}</p>`;
    // A few at a time, so a long list doesn't run past the function's
    // time limit one email after another.
    for (let i = 0; i < creators.length; i += 8) {
      const sent = await Promise.all(creators.slice(i, i + 8).map(async (c) => {
        const to = await getUserEmail(c.userId);
        return to ? sendEmail({ to, subject: `Creator Share is changing ${when}`, html }) : null;
      }));
      emailed += sent.filter((r) => r && r.sent).length;
    }
  }
  return { notified: creators.length, emailed };
}

// Saves new numbers: in force now when nothing goes against creators and
// no later date was asked for, otherwise scheduled for `effectiveAt`
// (never sooner than the 30 days' notice allows).
export async function saveShareNumbers({ input, effectiveAt, adminId }) {
  const { numbers, errors } = normalizeShareNumbers(input);
  if (errors.length) fail(errors.join(' '));
  const current = await getShareSettings();
  if (!current.migrated) fail('Run migration 088 (Creator Share tables) first.', 409);
  const changes = shareChanges(current, numbers);
  if (!changes.changed) fail('Those are the numbers already in force.');

  const now = new Date();
  const earliest = new Date(earliestEffective(current, numbers, now));
  let when = effectiveAt ? new Date(effectiveAt) : earliest;
  if (Number.isNaN(when.getTime())) fail('Pick a valid date.');
  if (when.getTime() < earliest.getTime() - 60000) {
    fail(`This pays creators less (${changes.adverse.join('; ')}), so the Terms need 30 days' notice: ${fmtDay(earliest.toISOString())} at the earliest.`);
  }
  if (when.getTime() < now.getTime()) when = now;
  const applyNow = when.getTime() <= now.getTime() + 60000;

  const supabase = getSupabase();
  const patch = applyNow
    ? { creator_share_cents: numbers.shareCents, referral_bonus_cents: numbers.bonusCents, creator_payout_minimum_cents: numbers.payoutMinimumCents, referral_bonus_months: numbers.referralBonusMonths, creator_share_next: null, creator_share_changed_at: now.toISOString() }
    : { creator_share_next: { numbers, effectiveAt: when.toISOString(), setBy: adminId, setAt: now.toISOString(), adverse: changes.adverse, favourable: changes.favourable } };
  const { error } = await supabase.from('site_settings').update(patch).eq('id', 1);
  if (error) {
    if (isMissingColumn(error)) fail('Run migration 092 (Creator Share settings) in Supabase first.', 409);
    throw new Error(`site_settings update failed: ${error.message}`);
  }
  const told = await tellCreators({ changes, effectiveAt: when.toISOString(), now: applyNow }).catch((err) => {
    console.error('saveShareNumbers notify error:', err.message);
    return { notified: 0, emailed: 0 };
  });
  return { applied: applyNow, effectiveAt: when.toISOString(), changes, ...told };
}

export async function cancelScheduledNumbers() {
  const current = await getShareSettings();
  if (!current.scheduled) fail('No change is scheduled.');
  const { error } = await getSupabase().from('site_settings').update({ creator_share_next: null }).eq('id', 1);
  if (error) throw new Error(`site_settings update failed: ${error.message}`);
  const creators = await listSupportableCreators();
  await notifyMany(creators.map((c) => ({
    userId: c.userId,
    type: 'payout',
    message: `The Creator Share change announced for ${fmtDay(current.scheduled.effectiveAt)} is cancelled. Nothing changes.`,
    href: '/terms#submit-work'
  })));
  return { cancelled: true };
}
