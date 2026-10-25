// Partners & resources (migration 108): vocabularies the browser and the
// app share. lib/partners.js pulls in server-only modules.

export const PARTNER_KINDS = {
  rental: 'Camera & gear rental',
  lighting: 'Lighting & grip',
  post: 'Post & color',
  sound: 'Sound & mix',
  lab: 'Film lab & scanning',
  studio: 'Studios & stages',
  insurance: 'Insurance',
  permits: 'Permits & locations',
  catering: 'Catering & craft',
  props: 'Props, wardrobe & art',
  transport: 'Trucks & transport',
  festival: 'Festivals & markets',
  distribution: 'Distribution & sales',
  software: 'Software & tools',
  paperwork: 'Paperwork & legal',
  education: 'Workshops & schools',
  other: 'Other'
};

// Who can see the code. Each gate includes the ones before it.
export const CODE_GATES = {
  public: { label: 'Anyone', hint: 'Shown to everyone who opens the page.' },
  account: { label: 'Signed in', hint: 'Sign in to see the code.' },
  card: { label: 'Has a working card', hint: 'Set up your Crew Call working card to see the code.' },
  production: { label: 'On a production', hint: 'Own or be on the crew of a live production to see the code.' },
  veteran: { label: 'Veteran', hint: 'For Veterans — three or more confirmed jobs or released titles.' }
};
export const GATE_RANK = { public: 0, account: 1, card: 2, production: 3, veteran: 4 };

export const MAX_BLURB_CHARS = 400;
export const MAX_DEAL_CHARS = 160;
export const MAX_NOTE_CHARS = 300;
export const WITHIN_CHOICES = [25, 50, 100, 250, 0];

export function partnerRules() {
  return { kinds: PARTNER_KINDS, gates: CODE_GATES, gateRank: GATE_RANK, withinChoices: WITHIN_CHOICES, maxBlurbChars: MAX_BLURB_CHARS, maxDealChars: MAX_DEAL_CHARS, maxNoteChars: MAX_NOTE_CHARS };
}
