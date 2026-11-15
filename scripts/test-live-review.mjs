// node scripts/test-live-review.mjs — every change to a live title is
// reviewed (Jose, 2026-11-15; mockups/round3-build-contract.md section B):
// the shape of what waits in migration 124's pending_fields
// (lib/liveReviewRules.js) and the field policy that decides it
// (lib/showRules.js: FIELD_POLICY, the team's own work, the ads switch).
import assert from 'node:assert/strict';
import * as L from '../lib/liveReviewRules.js';
import * as R from '../lib/showRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('the fields that wait: an episode\'s details and captions, a show\'s year, link, season names, credits and kind', () => {
  assert.deepEqual(L.DETAIL_FIELDS.episode, ['mainGenre', 'genre', 'artist', 'releaseYear', 'runtime', 'fundingUrl', 'adBreakSeconds', 'adsEnabled', 'extraKind', 'credits', 'captions']);
  assert.deepEqual(L.DETAIL_FIELDS.series, ['releaseYear', 'fundingUrl', 'seasons', 'credits', 'kind']);
  // Each one waits on a live title in the field policy, and has a column,
  // a label and a word.
  for (const f of L.DETAIL_FIELDS.episode) {
    assert.equal(R.FIELD_POLICY.episode[f].live, 'staged', f);
    assert.ok(L.DETAIL_COLUMNS[f] && L.DETAIL_LABELS[f] && L.DETAIL_WORDS[f], f);
  }
  for (const f of L.DETAIL_FIELDS.series) {
    assert.equal(R.FIELD_POLICY.show[f].live, 'staged', f);
    assert.ok(L.DETAIL_COLUMNS[f] && L.DETAIL_LABELS[f] && L.DETAIL_WORDS[f], f);
  }
  // What stays direct (organises or takes away; nothing new is said).
  for (const f of ['season', 'seriesOrder', 'bonusParent', 'seriesId', 'hasPage', 'channelOptIn']) assert.equal(R.FIELD_POLICY.episode[f].live, 'direct', f);
  for (const f of ['channelOptIn', 'newestSeasonHero', 'defaults']) assert.equal(R.FIELD_POLICY.show[f].live, 'direct', f);
  assert.equal(L.isDetailField('episode', 'genre'), true);
  assert.equal(L.isDetailField('show', 'seasons'), true);
  assert.equal(L.isDetailField('series', 'genre'), false);
  assert.equal(L.isDetailField('episode', 'title'), false, 'the title waits in its own column');
});

t('pendingFieldsOf: only the target\'s fields, a JSON string read, captions cleaned', () => {
  assert.deepEqual(L.pendingFieldsOf({}, 'episode'), {});
  assert.deepEqual(L.pendingFieldsOf({ pending_fields: null }), {});
  assert.deepEqual(L.pendingFieldsOf({ pending_fields: { genre: 'Noir', seasons: [], junk: 1 } }, 'episode'), { genre: 'Noir' });
  assert.deepEqual(L.pendingFieldsOf({ pending_fields: '{"releaseYear":2024,"kind":"podcast"}' }, 'series'), { releaseYear: 2024, kind: 'podcast' });
  assert.deepEqual(L.pendingFieldsOf({ pending_fields: '{oops' }), {});
  assert.deepEqual(L.pendingFieldsOf({ pending_fields: [1, 2] }), {});
  // A null value is a value: "clear it" waits.
  assert.deepEqual(L.pendingFieldsOf({ pending_fields: { artist: null } }), { artist: null });
  // Captions: a track or '' (removal); anything else is nothing.
  assert.deepEqual(L.pendingFieldsOf({ pending_fields: { captions: { ref: 'private:captions/a.vtt' } } }), { captions: { ref: 'private:captions/a.vtt', label: 'English', language: 'en' } });
  assert.deepEqual(L.pendingFieldsOf({ pending_fields: { captions: '' } }), { captions: '' });
  assert.deepEqual(L.pendingFieldsOf({ pending_fields: { captions: { label: 'x' } } }), {});
  assert.equal(L.rowHas124({ pending_fields: null }), true);
  assert.equal(L.rowHas124({ id: 'x' }), false);
  assert.equal(L.isDetailWaiting({ pending_fields: { genre: 'Noir' } }, 'episode', 'genre'), true);
  assert.equal(L.isDetailWaiting({ pending_fields: { genre: 'Noir' } }, 'episode', 'artist'), false);
  assert.deepEqual(L.waitingDetails({ pending_fields: { credits: {}, genre: 'x' } }, 'episode'), ['genre', 'credits']);
});

t('nextPendingFields: set, take back, and null once nothing waits', () => {
  const row = { pending_fields: { genre: 'Noir', runtime: '12:00' } };
  assert.deepEqual(L.nextPendingFields(row, 'episode', { artist: 'Mara' }), { genre: 'Noir', runtime: '12:00', artist: 'Mara' });
  assert.deepEqual(L.nextPendingFields(row, 'episode', { genre: undefined }), { runtime: '12:00' });
  assert.equal(L.nextPendingFields(row, 'episode', { genre: undefined, runtime: undefined }), null);
  assert.deepEqual(L.nextPendingFields({}, 'episode', { genre: null }), { genre: null });
  assert.deepEqual(L.nextPendingFields({}, 'episode', { seasons: [] }), null, 'not an episode field');
});

t('detailSeenText: null, \'\' and a value tell apart', () => {
  const marks = new Set([L.detailSeenText(null), L.detailSeenText(''), L.detailSeenText('x'), L.detailSeenText({ ref: 'a' }), L.detailSeenText(false), L.detailSeenText(true)]);
  assert.equal(marks.size, 6);
  assert.equal(L.detailSeenText(undefined), L.detailSeenText(null));
});

t('detailWords: what "Live now → Proposed" says', () => {
  assert.equal(L.detailWords('genre', 'Noir'), 'Noir');
  assert.equal(L.detailWords('genre', null, { inShow: true }), 'The show’s');
  assert.equal(L.detailWords('artist', ''), 'None');
  assert.equal(L.detailWords('releaseYear', 2024), '2024');
  assert.equal(L.detailWords('fundingUrl', null), 'No link');
  assert.equal(L.detailWords('adBreakSeconds', [0, 600, 3725]), '0:00, 10:00, 1:02:05');
  assert.equal(L.detailWords('adBreakSeconds', []), '0:00');
  assert.equal(L.detailWords('adsEnabled', true), 'On');
  assert.equal(L.detailWords('adsEnabled', false), 'Off — no ads');
  assert.equal(L.detailWords('extraKind', 'making-of'), 'Making-of');
  assert.equal(L.detailWords('extraKind', null), 'Extra (no kind)');
  assert.equal(L.detailWords('credits', { studio: { name: 'Night Owl' }, producer: { userId: 'user_x' } }, { names: { user_x: 'Pia' } }), 'Studio: Night Owl · Producer: Pia');
  assert.equal(L.detailWords('credits', {}), 'No studio or producer');
  assert.equal(L.detailWords('seasons', [{ number: 2, name: 'Return' }, { number: 1, name: 'Pilot' }]), 'Season 1: Pilot · Season 2: Return');
  assert.equal(L.detailWords('seasons', []), 'No season names');
  assert.equal(L.detailWords('kind', 'podcast'), 'Podcast');
  assert.equal(L.detailWords('captions', ''), 'No captions');
  assert.equal(L.detailWords('captions', { ref: 'private:c.vtt', label: 'Español', language: 'es' }), 'Español (es) — a new file');
  assert.equal(L.detailWords('captions', { live: true, label: 'English', language: 'en' }), 'English (en)');
  // The stored address of a waiting track never reaches the words.
  assert.ok(!L.detailWords('captions', { ref: 'private:captions/secret.vtt', label: 'English', language: 'en' }).includes('private:'));
});

t('waitingDetailWords: live beside proposed, in DETAIL_FIELDS order', () => {
  const row = {
    genre: 'Comedy', release_year: 2020, ads_enabled: false, captions_url: 'private:captions/old.vtt', captions_label: 'English', captions_language: 'en', series_id: 'night-bus',
    pending_fields: { captions: { ref: 'private:captions/new.vtt', label: 'English', language: 'en' }, releaseYear: 2021, adsEnabled: true, genre: 'Drama' }
  };
  assert.deepEqual(L.waitingDetailWords(row, 'episode', { inShow: true }), [
    { field: 'genre', label: 'Specific genre', live: 'Comedy', proposed: 'Drama' },
    { field: 'releaseYear', label: 'Year', live: '2020', proposed: '2021' },
    { field: 'adsEnabled', label: 'Ads', live: 'Off — no ads', proposed: 'On' },
    { field: 'captions', label: 'Captions', live: 'English (en)', proposed: 'English (en) — a new file' }
  ]);
  assert.deepEqual(L.waitingDetailWords({ captions_url: null, pending_fields: { captions: '' } }, 'episode'), [{ field: 'captions', label: 'Captions', live: 'No captions', proposed: 'No captions' }]);
  assert.deepEqual(L.waitingDetailWords({ seasons: [], pending_fields: { seasons: [{ number: 1, name: 'Pilot' }] } }, 'series'), [{ field: 'seasons', label: 'Season names', live: 'No season names', proposed: 'Season 1: Pilot' }]);
});

t('sameDetail: what counts as "back to the live value"', () => {
  assert.equal(L.sameDetail('genre', null, ''), true);
  assert.equal(L.sameDetail('genre', 'Noir', 'Noir'), true);
  assert.equal(L.sameDetail('genre', 'Noir', 'noir'), false);
  assert.equal(L.sameDetail('releaseYear', '2024', 2024), true);
  assert.equal(L.sameDetail('adBreakSeconds', [], [0]), true);
  assert.equal(L.sameDetail('adBreakSeconds', [0, 600], [0]), false);
  assert.equal(L.sameDetail('adsEnabled', undefined, true), true);
  assert.equal(L.sameDetail('extraKind', 'Making-of', 'making-of'), true);
  assert.equal(L.sameDetail('credits', { studio: { name: 'A', userId: null } }, { studio: { name: 'A', userId: null } }), true);
  assert.equal(L.sameDetail('credits', {}, { studio: null }), false);
});

t('the policy on a live title: owners wait, a full admin applies, a reviewer applies to someone else\'s, the team\'s own title goes the owner\'s way', () => {
  const live = { status: 'approved' };
  const owner = { ...live, isUploader: true, isRunner: true };
  for (const f of L.DETAIL_FIELDS.episode) assert.equal(R.fieldPolicy(f, owner), 'staged', f);
  for (const status of ['pending', 'rejected', 'draft']) for (const f of L.DETAIL_FIELDS.episode) assert.equal(R.fieldPolicy(f, { ...owner, status }), 'direct', `${status} ${f}`);
  // Pulled: captions stay open, as before (amendment 22).
  assert.equal(R.fieldPolicy('captions', { ...owner, held: true }), 'direct');
  assert.equal(R.fieldPolicy('genre', { ...owner, held: true }), 'locked');
  const full = { isAdmin: true, fullAdmin: true, ...live };
  for (const f of L.DETAIL_FIELDS.episode) assert.equal(R.fieldPolicy(f, { ...full, isUploader: true }), 'direct', f);
  const reviewer = { isAdmin: true, reviews: true, ...live };
  assert.equal(R.fieldPolicy('genre', reviewer), 'direct');
  assert.equal(R.fieldPolicy('genre', { ...reviewer, isUploader: true }), 'staged');
  assert.equal(R.fieldPolicy('tier', { ...reviewer, isUploader: true }), 'locked', 'their own title: what an owner can\'t change');
  assert.equal(R.fieldPolicyLine('tier', { ...reviewer, isUploader: true }), R.OWN_TITLE_LINE);
  assert.equal(R.fieldPolicy('tier', reviewer), 'direct', 'someone else\'s: the team\'s');
  const editor = { isAdmin: true, reviews: false, ...live };
  assert.equal(R.fieldPolicy('genre', editor), 'locked');
  assert.equal(R.fieldPolicyLine('genre', editor), R.TEAM_REVIEW_LINE);
  // A show.
  const runner = { target: 'show', isRunner: true, status: 'approved' };
  for (const f of L.DETAIL_FIELDS.series) assert.equal(R.fieldPolicy(f, { ...runner, episodeCount: f === 'kind' ? 0 : 3 }), 'staged', f);
  assert.equal(R.fieldPolicy('kind', { ...runner, episodeCount: 3 }), 'locked', 'a kind is set once it has episodes');
});

t('the ads switch: off at once, on waits', () => {
  const owner = { status: 'approved', isUploader: true, isRunner: true };
  assert.deepEqual(R.adsEnabledChange(owner, true, false), { ok: true, mode: 'direct', value: false });
  assert.deepEqual(R.adsEnabledChange(owner, false, true), { ok: true, mode: 'staged', value: true });
  assert.equal(R.adsEnabledPolicy(owner, false).line, R.ADS_ON_WAITS_LINE);
});

console.log(`${n} live-review checks passed`);
