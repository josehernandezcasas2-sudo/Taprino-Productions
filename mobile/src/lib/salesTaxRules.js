// The app's copy of the words in lib/salesTaxRules.js (sales tax on
// memberships, backings and bookings, migration 122). The website decides
// when tax applies and says so in its answers (a plan's `taxNote`, a
// pitch's `backingTaxed`, a request's `taxNote` / `taxCents`); the app
// only prints the same line. node scripts/test-sales-tax.mjs checks the
// two copies say the same.
export const TAX_NOTE = '+ tax where it applies';
