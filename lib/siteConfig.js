// ============================================================================
// Site identity and contact details — single source of truth
// ============================================================================
// The site name was previously hardcoded in ~78 places across 28 files, and
// contact details were [PLACEHOLDER] strings in 17 more. Both live here now,
// so renaming the platform or changing the contact address is a one-file
// edit rather than a codebase-wide find-and-replace.
//
// None of this is secret — it's all published on the site — so it's a plain
// config file rather than environment variables. That keeps it
// version-controlled and visible in code review.

export const SITE = {
  name: 'Studio Tapa TV',
  nameUpper: 'STUDIO TAPA TV',
  nameShort: 'Tapa TV',

  // The parent studio, deliberately distinct from the platform name — the
  // studio makes other work; this is specifically the streaming arm.
  studio: 'Studio Tapa',

  // ---- Contact ----
  // A shared studio inbox, which is why the guidance below asks senders to
  // flag streaming queries. Without it, a viewer's billing question lands
  // in the same pile as unrelated studio mail.
  contactEmail: 'info@studiotapa.com',
  contactGuidance:
    'Put "Studio Tapa TV" in the subject line — this inbox covers all of Studio Tapa\u2019s work, so flagging it as a streaming query gets it to the right person faster.',

  // Required by AdSense and expected in a privacy policy. A PO box is fine.
  mailingAddress: '[MAILING ADDRESS]',

  jurisdiction: 'California, United States',

  // Set once the custom domain is live — used for canonical URLs. The
  // sitemap derives its origin from the incoming request instead, so it
  // stays correct on any host regardless of this value.
  productionDomain: 'https://studiotapatv.site',
};

export function siteConfigIncomplete() {
  return Object.values(SITE).some((v) => typeof v === 'string' && v.startsWith('['));
}

export function missingSiteConfigFields() {
  return Object.entries(SITE)
    .filter(([, v]) => typeof v === 'string' && v.startsWith('['))
    .map(([k]) => k);
}
