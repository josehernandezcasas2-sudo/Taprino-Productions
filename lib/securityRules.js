// Admin → Security and AI security (Jose, 2026-11-05: "add a toggle to
// have the screen shots under admin … under security/ai security. Add
// whatever needs to be in those areas too, like protecting the site
// links"; signed off on the canvas
// https://claude.ai/artifact/QaHCfmHVD764ti3WNy7ajC). Pure and
// import-free: middleware.js (Edge), the API, the pages and the tests
// read the same rules. Tested by scripts/test-security.mjs.
//
// Five switches live on site_settings (migration 119, plus 115's
// screen_capture_block). Each Vercel variable that used to be the only
// switch still wins in its own direction, so nothing set there changes by
// itself:
//   PRIVATE_BETA=on          keeps the door shut whatever the switch says
//   ADMIN_REQUIRE_2FA=on     keeps two-step required
//   SCREEN_CAPTURE_BLOCK=off keeps the app's screenshot block off
// A database without 119 reads as: door open, kept out of search
// engines, AI answer engines blocked, two-step not required. "Kept out of
// search engines" is new behaviour from the moment this code deploys,
// before 119 runs (Jose, 2026-11-05: it starts on; the site isn't
// launched).

export function envOn(value) {
  return /^(on|true|1|yes)$/i.test(String(value == null ? '' : value).trim());
}

// The switches an admin flips, by the name the API and pages use, with
// their column and the migration that adds the column.
export const SWITCHES = {
  privateBeta: { column: 'private_beta', migration: 119, fallback: false },
  hideFromSearch: { column: 'hide_from_search', migration: 119, fallback: true },
  blockAiSearch: { column: 'block_ai_search', migration: 119, fallback: true },
  adminRequire2fa: { column: 'admin_require_2fa', migration: 119, fallback: false },
  screenCaptureBlock: { column: 'screen_capture_block', migration: 115, fallback: true }
};

export function isSwitchField(field) {
  return typeof field === 'string' && Object.prototype.hasOwnProperty.call(SWITCHES, field);
}

// One site_settings row (snake_case, as PostgREST answers it, or null)
// → each switch's own stored value, a missing column read as its
// fallback.
export function storedSwitches(row) {
  const out = {};
  for (const [field, spec] of Object.entries(SWITCHES)) {
    const v = row && Object.prototype.hasOwnProperty.call(row, spec.column) ? row[spec.column] : undefined;
    out[field] = typeof v === 'boolean' ? v : spec.fallback;
  }
  return out;
}

// Whether migration 119 has run, from the row PostgREST hands back.
export function hasSecurityColumns(row) {
  return Boolean(row) && Object.prototype.hasOwnProperty.call(row, 'private_beta');
}

// What is actually in force, with each Vercel override folded in.
// `readFailed`: the switches couldn't be read and no earlier copy exists;
// two-step then counts as required (fail closed), the rest as starting.
export function effectiveSwitches(row, env = {}, { readFailed = false } = {}) {
  const s = storedSwitches(row);
  const doorForced = envOn(env.PRIVATE_BETA);
  const twoStepForced = envOn(env.ADMIN_REQUIRE_2FA);
  const captureEnvOff = String(env.SCREEN_CAPTURE_BLOCK || '').trim().toLowerCase() === 'off';
  const doorShut = doorForced || s.privateBeta;
  return {
    stored: s,
    doorShut,
    doorForced,
    // Kept out of search engines: every page says noindex and the sitemap
    // is withdrawn. A shut door implies it.
    hidden: doorShut || s.hideFromSearch,
    aiSearchBlocked: s.blockAiSearch,
    twoStepRequired: twoStepForced || s.adminRequire2fa || Boolean(readFailed),
    twoStepForced,
    captureBlock: !captureEnvOff && s.screenCaptureBlock,
    captureEnvOff
  };
}

// Why a switch can't be set to `value` right now, or null. `you` is the
// admin flipping it: { twoFactorEnabled }.
export function switchRefusal(field, value, { you = {}, env = {} } = {}) {
  if (!isSwitchField(field)) return 'That isn’t one of the switches.';
  if (typeof value !== 'boolean') return 'Send on or off.';
  if (field === 'privateBeta' && value === false && envOn(env.PRIVATE_BETA)) {
    return 'PRIVATE_BETA=on is set in Vercel, which keeps the door shut whatever this says. Remove the variable there first.';
  }
  if (field === 'adminRequire2fa' && value === false && envOn(env.ADMIN_REQUIRE_2FA)) {
    return 'ADMIN_REQUIRE_2FA=on is set in Vercel, which keeps two-step required whatever this says. Remove the variable there first.';
  }
  if (field === 'adminRequire2fa' && value === true && !you.twoFactorEnabled) {
    return 'Turn two-step on for your own account first (Account → Security), so this can’t lock you out of the admin.';
  }
  if (field === 'screenCaptureBlock' && value === true && String(env.SCREEN_CAPTURE_BLOCK || '').trim().toLowerCase() === 'off') {
    return 'SCREEN_CAPTURE_BLOCK=off is set in Vercel, which keeps the block off whatever this says. Remove the variable there first.';
  }
  return null;
}

// What changed, in the audit log's words.
export function switchAuditLine(field, from, to) {
  const word = (v) => (v ? 'on' : 'off');
  return `${field}: ${word(from)} → ${word(to)}`;
}

// The things done in other dashboards. The page can't see them; the
// ticks are a note to self, kept in site_settings.security_checklist.
export const CHECKLIST_ITEMS = [
  { key: 'clerkRestricted', title: 'Clerk → Restrictions', text: 'Sign-up mode Restricted while the beta door is shut, so only invited emails can make an account.', href: 'https://dashboard.clerk.com' },
  { key: 'clerkMfa', title: 'Clerk → Multi-factor', text: 'An authenticator app enabled for the instance, so the team can turn two-step on.', href: 'https://dashboard.clerk.com' },
  { key: 'vercelFirewall', title: 'Vercel → Firewall', text: 'The AI Bots ruleset set to Deny; bot protection on, but not for /api/ (the app calls it without a browser); a rate limit on /api/. The site already refuses the AI crawlers that give their name; this reaches the files it can’t.', href: 'https://vercel.com/dashboard' },
  { key: 'github', title: 'GitHub', text: 'Repository private, main protected, Dependabot and secret scanning on.', href: 'https://github.com/josehernandezcasas2-sudo/Taprino-Productions/settings' },
  { key: 'vendorTwoStep', title: 'Two-step on every vendor account', text: 'GitHub, Vercel, Supabase, Stripe, Clerk, Cloudflare, Resend, Upstash, Expo, Google Play and the domain registrar.', href: null },
  { key: 'backups', title: 'Supabase backups', text: 'Daily backups or point-in-time recovery on.', href: 'https://supabase.com/dashboard' },
  { key: 'stripeRadar', title: 'Stripe Radar', text: 'Block high-risk payments; ask for 3-D Secure on elevated risk.', href: 'https://dashboard.stripe.com/radar/rules' },
  { key: 'emailDomain', title: 'Email domain', text: 'SPF, DKIM and DMARC records for the sending domain (Resend shows them).', href: 'https://resend.com/domains' }
];

export function isChecklistKey(key) {
  return CHECKLIST_ITEMS.some((i) => i.key === key);
}

// Only known keys, only true ticks.
export function normalizeChecklist(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const item of CHECKLIST_ITEMS) {
    if (Object.prototype.hasOwnProperty.call(raw, item.key) && raw[item.key] === true) out[item.key] = true;
  }
  return out;
}

// Keys and secrets in Vercel: set or not, never the value.
export const KEY_CHECKS = [
  { id: 'cron', names: ['CRON_SECRET'], label: 'CRON_SECRET', what: 'Payouts, reminders and sweeps run on schedule; without it the scheduled jobs refuse to run.' },
  { id: 'stripe', names: ['STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET'], label: 'STRIPE_WEBHOOK_SECRET · CONNECT', what: 'Proves a payment notice came from Stripe (one for the account, one for creators’ payout accounts).' },
  { id: 'adImpression', names: ['AD_IMPRESSION_SECRET'], label: 'AD_IMPRESSION_SECRET', what: 'Signs ad plays. Without it a key made from the database key is used, which works but ties the two together.' },
  { id: 'streamKey', names: ['CLOUDFLARE_STREAM_KEY_ID', 'CLOUDFLARE_STREAM_KEY_PEM'], label: 'CLOUDFLARE_STREAM_KEY_ID · PEM', what: 'Signs playback links here instead of asking Cloudflare for each one.' },
  { id: 'alertEmail', names: ['SECURITY_ALERT_EMAIL'], label: 'SECURITY_ALERT_EMAIL', what: 'Where security alerts go. Without it they go to the contact address.' },
  { id: 'contactEmail', names: ['SECURITY_CONTACT_EMAIL'], label: 'SECURITY_CONTACT_EMAIL', what: 'The address in /.well-known/security.txt. Without it the contact address is used.' },
  { id: 'podcastAudio', names: ['PODCAST_AUDIO_SECRET'], label: 'PODCAST_AUDIO_SECRET', what: 'Signs the podcast audio links pages and the app hand out. Without it a key made from the database key is used, which works but ties the two together.' },
  { id: 'webPush', names: ['WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY'], label: 'WEB_PUSH_PUBLIC_KEY · PRIVATE_KEY', what: 'Notifications on the website (web push). Without them the website can’t send any; the app’s notifications don’t need them.' },
  { id: 'webPushSubject', names: ['WEB_PUSH_SUBJECT'], label: 'WEB_PUSH_SUBJECT', what: 'The contact push services see with each website notification (a mailto: address). Without it the contact address is used.' },
  // Optional: nothing is missing without it (Admin → House ads says whether it's on).
  { id: 'googleVideoAds', names: ['GOOGLE_VIDEO_AD_TAG'], label: 'GOOGLE_VIDEO_AD_TAG', optional: true, what: 'Optional. Google’s Ad Manager video tag: when no house ad is running, Google fills the break in the website’s player. Without it, breaks with no house ad play nothing.' }
];

// `optional`: a key the site runs fully without; not set reads as plain,
// not as something missing.
export function keyStatus(env = {}) {
  return KEY_CHECKS.map((k) => {
    const set = k.names.filter((n) => String(env[n] || '').trim() !== '').length;
    return { id: k.id, label: k.label, what: k.what, optional: Boolean(k.optional), set: set === k.names.length, partly: set > 0 && set < k.names.length };
  });
}

// The audit actions that count as security events on the Alerts card.
export const SECURITY_EVENT_ACTIONS = [
  'security_switch',
  'grant_admin_access', 'grant_sub_admin_access', 'grant_content_scheduler_access', 'revoke_access',
  'set_sub_admin_permissions',
  'account_suspended', 'tips_blocked', 'suspension_lifted'
];

// The five "bring older uploads behind the locks" runs, by their audit
// action (podcast audio since 2026-11-12).
export const PROTECTION_RUNS = [
  { action: 'sync_stream_protection', key: 'videos' },
  { action: 'protect_captions', key: 'captions' },
  { action: 'protect_university_files', key: 'university' },
  { action: 'protect_post_media', key: 'posts' },
  { action: 'protect_podcast_audio', key: 'podcasts' }
];

// One audit row → the line the Alerts card prints.
export function securityEventLine(row) {
  if (!row) return '';
  const who = row.admin_email || 'Someone';
  const target = row.target_id ? ` ${row.target_id}` : '';
  switch (row.action) {
    case 'security_switch': return `${who} switched ${row.details || 'a security setting'}`;
    case 'grant_admin_access': return `${who} made${target} an admin`;
    case 'grant_sub_admin_access': return `${who} made${target} a sub-admin`;
    case 'grant_content_scheduler_access': return `${who} made${target} a content scheduler`;
    case 'revoke_access': return `${who} took a role away from${target}`;
    case 'set_sub_admin_permissions': return `${who} changed what${target} can do as a sub-admin`;
    case 'account_suspended': return `${who} suspended${target}`;
    case 'tips_blocked': return `${who} blocked${target} from tipping`;
    case 'suspension_lifted': return `${who} lifted a suspension on${target}`;
    default: return `${who}: ${row.action}`;
  }
}
