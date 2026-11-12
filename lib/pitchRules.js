// The Pitch Room's client-safe vocabulary. lib/pitches.js is server code
// (it reaches lib/notify.js → push → web push), so a page or component that
// only needs the tag list imports it from here and keeps the notify chain
// out of the browser bundle.
export const PITCH_TAGS = [
  'Documentary', 'Narrative Film', 'Short Film', 'Series', 'Animation',
  'Vertical', 'Podcast', 'Music Video', 'Other'
];
