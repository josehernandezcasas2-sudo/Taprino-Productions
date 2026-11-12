// The app's copy of lib/extraKinds.js on the website: what kind of extra a
// title is (migration 121) — the preset list, the cleaning every write goes
// through, and the word a card and the extra's page print ("Making-of",
// the uploader's own words, or "Extra"). Word for word below this comment:
// scripts/test-extra-kinds.mjs checks that and runs every case on both
// copies. It imports nothing, so it can stay a plain copy. Change both
// together.

export const EXTRA_KINDS = [
  { id: 'making-of', label: 'Making-of' },
  { id: 'behind-the-scenes', label: 'Behind the scenes' },
  { id: 'deleted-scene', label: 'Deleted scene' },
  { id: 'interview', label: 'Interview' },
  { id: 'bloopers', label: 'Bloopers' },
  { id: 'commentary', label: 'Commentary' },
  { id: 'teaser', label: 'Teaser' }
];

// The chip that opens the "Your category" box. Never stored.
export const EXTRA_KIND_OTHER = 'other';
export const EXTRA_KIND_OTHER_LABEL = 'Other';

// What a card says when an extra has no kind.
export const EXTRA_WORD = 'Extra';

// The longest custom category, in characters (code points, as Postgres's
// char_length counts them).
export const EXTRA_KIND_MAX = 40;

// The editor's words, web and app.
export const EXTRA_KIND_WORDS = {
  label: 'What kind of extra?',
  otherLabel: 'Your category',
  otherPlaceholder: 'Table read, music video…',
  help: 'Shown on its card and its page. Leave it empty and it says Extra.'
};

const PRESET_IDS = new Set(EXTRA_KINDS.map((k) => k.id));

// Control characters (C0, DEL, C1), zero-width and direction marks, line
// and paragraph separators, the byte-order mark, the blank-looking
// fillers (Hangul fillers, the braille blank, the Mongolian vowel
// separator) that would print as an empty label, and angle brackets.
const STRIP = /[\u0000-\u001f\u007f-\u009f\u00ad\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u2800\u3164\ufeff\uffa0<>]/g;
// Combining marks (the common blocks): two in a row are kept, a third and
// more (stacked "zalgo" text) are dropped.
const COMBINING_RUN = /([\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]{2})[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]+/g;
// Words that mean "no kind": they read "Extra" anyway.
const NO_KIND = new Set(['other', 'extra']);

// "Making of", "making-of", "MAKING_OF" and "Making-ofs" all compare alike.
function matchKey(text) {
  return String(text).toLowerCase().replace(/[\s_-]+/g, ' ').trim().replace(/s$/, '');
}

const PRESET_BY_KEY = new Map(EXTRA_KINDS.flatMap((k) => [[matchKey(k.id), k.id], [matchKey(k.label), k.id]]));

// A lone surrogate (half of a pair, "\ud800" sent as JSON) is not text
// Postgres can store: a save with one answered 500. Dropped, like the
// other characters that can't print.
export function dropLoneSurrogates(input) {
  const text = String(input);
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i += 1;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += text[i];
  }
  return out;
}

// The custom words, cleaned: what a card may print.
export function cleanExtraKindText(input) {
  if (typeof input !== 'string') return '';
  // Line breaks and tabs become spaces first, then the rest is stripped.
  const text = dropLoneSurrogates(input).replace(/\s+/g, ' ').replace(STRIP, '').replace(COMBINING_RUN, '$1').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, EXTRA_KIND_MAX).join('').trim();
}

// What is stored: a preset's id (matched however it was typed), the
// custom words, or null (nothing, Other left empty, or only characters
// that were stripped).
export function normalizeExtraKind(input) {
  const text = cleanExtraKindText(input);
  if (!text) return null;
  const key = matchKey(text);
  if (!key || NO_KIND.has(key)) return null;
  return PRESET_BY_KEY.get(key) || text;
}

export function isPresetExtraKind(kind) {
  return typeof kind === 'string' && PRESET_IDS.has(kind);
}

// What a card and the extra's page say: the preset's word, the custom words
// as typed, or "Extra". A stored value is cleaned again on the way out (a
// row written by hand or by an older build).
export function extraKindLabel(kind) {
  const value = normalizeExtraKind(kind);
  if (!value) return EXTRA_WORD;
  return isPresetExtraKind(value) ? EXTRA_KINDS.find((k) => k.id === value).label : value;
}

// A stored kind as a field: which chip is on ('' none, a preset's id, or
// 'other') and the words in the "Your category" box.
export function extraKindChoice(kind) {
  const value = normalizeExtraKind(kind);
  if (!value) return { choice: '', other: '' };
  if (isPresetExtraKind(value)) return { choice: value, other: '' };
  return { choice: EXTRA_KIND_OTHER, other: value };
}

// The field back to what is saved.
export function extraKindFromChoice(choice, other) {
  if (choice === EXTRA_KIND_OTHER) return normalizeExtraKind(other);
  if (isPresetExtraKind(choice)) return choice;
  return null;
}

// A card's meta line: "Making-of · 6 min", "Extra · 6 min", or the word
// alone when the runtime isn't known.
export function extraMetaLine(kind, minutes) {
  return [extraKindLabel(kind), minutes || null].filter(Boolean).join(' · ');
}
