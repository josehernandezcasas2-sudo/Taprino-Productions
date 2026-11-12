// node scripts/test-season-art.mjs — season art and the newest season as
// the hero (lib/seasonArt.js, migration 122) and the app's copy
// (mobile/src/lib/seasonArt.js): the copy is checked word for word, then
// every case runs on both.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as web from '../lib/seasonArt.js';

const webSource = readFileSync(new URL('../lib/seasonArt.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../mobile/src/lib/seasonArt.js', import.meta.url), 'utf8');
// mobile/package.json has no "type": "module", so the app's file is loaded
// from its source as an ES module; it imports nothing, so that works.
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const body = (src) => src.replace(/^(?:\/\/[^\n]*\n|[ \t]*\n)*/, '');
t('the app copy is the website file word for word below its header', () => {
  assert.ok(body(webSource).startsWith('export const SEASON_ART_MAX_SEASON'));
  assert.equal(body(appSource), body(webSource));
  assert.deepEqual(Object.keys(app).sort(), Object.keys(web).sort());
  assert.ok(!/^\s*import\s/m.test(webSource), 'lib/seasonArt.js imports nothing');
  // Hermes (the app's engine): no \p{…} property escapes, no lookbehind.
  assert.doesNotMatch(webSource, /\\p\{|\(\?<[=!]/);
});

const NOW = Date.parse('2026-11-12T18:00:00Z');
const A = 'https://x.supabase.co/storage/v1/object/public/episode-art/series-nb-season-1-aa.jpg';
const B = 'https://x.supabase.co/storage/v1/object/public/episode-art/series-nb-season-2-bb.jpg';
const C = 'https://x.supabase.co/storage/v1/object/public/episode-art/series-nb-season-2-cc.jpg';
const H = 'https://x.supabase.co/storage/v1/object/public/episode-art/series-nb-hero-hh.jpg';
const ep = (id, season, extra = {}) => ({ id, season, seriesOrder: 1, contentType: 'series', ...extra });

for (const [label, m] of [['web', web], ['app', app]]) {
  t(`${label}: the live list is cleaned, one per season, sorted`, () => {
    assert.deepEqual(m.normalizeSeasonArt([{ number: 2, image: B }, { number: 1, image: A }, { number: 2, image: C }]), [{ number: 1, image: A }, { number: 2, image: B }]);
    assert.deepEqual(m.normalizeSeasonArt(JSON.stringify([{ number: '3', image: ` ${A} ` }])), [{ number: 3, image: A }]);
    assert.deepEqual(m.normalizeSeasonArt([{ number: 0, image: A }, { number: 1.5, image: A }, { number: 10000, image: A }, { number: 2, image: 'javascript:alert(1)' }, { number: 3, image: null }, null, 'x']), []);
    assert.deepEqual(m.normalizeSeasonArt('not json'), []);
    assert.deepEqual(m.normalizeSeasonArt(null), []);
    assert.deepEqual(m.normalizeSeasonArt({ number: 1, image: A }), [], 'an object is not a list');
  });

  t(`${label}: what waits keeps removals (null) and drops junk`, () => {
    assert.deepEqual(m.normalizePendingSeasonArt([{ number: 2, image: null }, { number: 1, image: A }, { number: 3 }, { number: 4, image: 'ftp://x' }]), [{ number: 1, image: A }, { number: 2, image: null }]);
    assert.equal(m.pendingColumnValue([]), null, 'nothing waits = null in the column');
    assert.equal(m.pendingColumnValue(null), null);
    assert.deepEqual(m.pendingColumnValue([{ number: 2, image: null }]), [{ number: 2, image: null }]);
  });

  t(`${label}: the switch reads as on unless it says off`, () => {
    assert.equal(m.newestSeasonHeroOn({}), true, 'before 122');
    assert.equal(m.newestSeasonHeroOn({ newest_season_hero: true }), true);
    assert.equal(m.newestSeasonHeroOn({ newest_season_hero: false }), false);
    assert.equal(m.newestSeasonHeroOn({ newestSeasonHero: false }), false);
    assert.equal(m.newestSeasonHeroOn(null), true);
    assert.equal(m.hasSeasonArtColumns({ season_art: [] }), true);
    assert.equal(m.hasSeasonArtColumns({ seasonArt: [] }), true);
    assert.equal(m.hasSeasonArtColumns({ id: 'x' }), false);
  });

  t(`${label}: the newest released season`, () => {
    assert.equal(m.newestReleasedSeason([ep('a', 1), ep('b', 2), ep('c', 1)], NOW), 2);
    assert.equal(m.newestReleasedSeason([ep('a', null), ep('b', undefined)], NOW), 1, 'no season = Season 1');
    assert.equal(m.newestReleasedSeason([], NOW), null);
    assert.equal(m.newestReleasedSeason(null, NOW), null);
    // What doesn't count as out.
    assert.equal(m.newestReleasedSeason([ep('a', 1), ep('b', 2, { status: 'pending' })], NOW), 1, 'in review');
    assert.equal(m.newestReleasedSeason([ep('a', 1), ep('b', 2, { held: true })], NOW), 1, 'pulled');
    assert.equal(m.newestReleasedSeason([ep('a', 1), ep('b', 2, { moderation_hold: true })], NOW), 1, 'pulled (a row)');
    assert.equal(m.newestReleasedSeason([ep('a', 1), ep('b', 2, { deletionRequested: true })], NOW), 1, 'removal asked for');
    assert.equal(m.newestReleasedSeason([ep('a', 1), ep('b', 2, { withdrawn_at: '2026-11-01T00:00:00Z' })], NOW), 1, 'withdrawn');
    assert.equal(m.newestReleasedSeason([ep('a', 1), ep('b', 3, { contentType: 'bonus' })], NOW), 1, 'an extra');
    assert.equal(m.newestReleasedSeason([ep('a', 1), ep('b', 2, { availableFrom: '2026-12-01T00:00:00Z' })], NOW), 1, 'not out yet');
    assert.equal(m.newestReleasedSeason([ep('a', 1), ep('b', 2, { availableFrom: '2026-11-01T00:00:00Z' })], NOW), 2, 'out since');
    assert.equal(m.newestReleasedSeason([ep('a', 1), ep('b', 2, { status: 'approved' })], NOW), 2, 'approved counts');
  });

  t(`${label}: the hero is the newest released season's art`, () => {
    const show = { id: 'nb', heroImage: H, seasonArt: [{ number: 1, image: A }, { number: 2, image: B }] };
    const s1 = [ep('a', 1), ep('b', 1)];
    const s2 = [...s1, ep('c', 2)];
    assert.deepEqual(m.seasonHero(show, s1, NOW), { season: 1, image: A }, 'only Season 1 is out');
    assert.deepEqual(m.seasonHero(show, s2, NOW), { season: 2, image: B }, 'Season 2 comes out: the hero switches by itself');
    assert.equal(m.showHeroImage(show, s2, NOW), B);
    assert.equal(m.showHeroImage(show, s1, NOW), A);
  });

  t(`${label}: a season with art but no public episode yet doesn't count`, () => {
    const show = { id: 'nb', hero_image: H, season_art: [{ number: 1, image: A }, { number: 2, image: B }] };
    const eps = [ep('a', 1), ep('b', 2, { status: 'pending' })];
    assert.deepEqual(m.seasonHero(show, eps, NOW), { season: 1, image: A });
    const onlyS2Art = { id: 'nb', hero_image: H, season_art: [{ number: 2, image: B }] };
    assert.equal(m.seasonHero(onlyS2Art, [ep('a', 1)], NOW), null, 'Season 2 has art but isn’t out: the show’s own hero');
    assert.equal(m.showHeroImage(onlyS2Art, [ep('a', 1)], NOW), H);
  });

  t(`${label}: the switch off, or no art for the newest season → the show's own art`, () => {
    const eps = [ep('a', 1), ep('b', 2)];
    assert.equal(m.seasonHero({ heroImage: H, seasonArt: [{ number: 2, image: B }], newestSeasonHero: false }, eps, NOW), null);
    assert.equal(m.showHeroImage({ heroImage: H, seasonArt: [{ number: 2, image: B }], newestSeasonHero: false }, eps, NOW), H);
    assert.equal(m.seasonHero({ heroImage: H, seasonArt: [{ number: 1, image: A }] }, eps, NOW), null, 'Season 2 is out and has no art: no stepping back to Season 1');
    assert.equal(m.showHeroImage({ heroImage: H, seasonArt: [{ number: 1, image: A }] }, eps, NOW), H);
    assert.equal(m.showHeroImage({ heroImage: H }, eps, NOW), H, 'before 122');
    assert.equal(m.showHeroImage({}, eps, NOW), null);
    assert.equal(m.seasonHero({ seasonArt: [{ number: 1, image: A }] }, [], NOW), null, 'nothing out');
  });

  t(`${label}: the waiting art never shows`, () => {
    const show = { heroImage: H, seasonArt: [], pendingSeasonArt: [{ number: 2, image: B }], pending_season_art: [{ number: 2, image: B }] };
    assert.equal(m.seasonHero(show, [ep('a', 2)], NOW), null);
    assert.equal(m.showHeroImage(show, [ep('a', 2)], NOW), H);
    const removalWaiting = { heroImage: H, seasonArt: [{ number: 2, image: B }], pendingSeasonArt: [{ number: 2, image: null }] };
    assert.equal(m.showHeroImage(removalWaiting, [ep('a', 2)], NOW), B, 'a removal waiting leaves the live art up');
  });

  t(`${label}: the editors' rows`, () => {
    const rows = m.seasonArtRows({
      seasons: [{ number: 1, label: 'Season 1' }, { number: 2, label: 'Season 2 · The Return' }],
      live: [{ number: 1, image: A }, { number: 4, image: C }],
      pending: [{ number: 2, image: B }, { number: 1, image: null }]
    });
    assert.deepEqual(rows, [
      { number: 1, label: 'Season 1', live: A, staged: null, removal: true },
      { number: 2, label: 'Season 2 · The Return', live: null, staged: B, removal: false },
      { number: 4, label: 'Season 4', live: C, staged: null, removal: false }
    ]);
    assert.deepEqual(m.seasonArtRows({}), []);
  });

  t(`${label}: the waiting field's name`, () => {
    assert.equal(m.seasonArtField(2), 'seasonArt:2');
    assert.equal(m.seasonArtField(0), null);
    assert.equal(m.seasonOfArtField('seasonArt:12'), 12);
    assert.equal(m.seasonOfArtField('seasonArt:0'), null);
    assert.equal(m.seasonOfArtField('seasonArt:2x'), null);
    assert.equal(m.seasonOfArtField('poster'), null);
    assert.equal(m.isSeasonArtField('seasonArt:3'), true);
    assert.equal(m.isSeasonArtField('seasonArt'), false);
    assert.equal(m.isSeasonArtField(null), false);
    assert.equal(m.seasonArtLabel(2), 'Season 2 art');
    assert.equal(m.seasonArtLabel(2, 'Season 2 · The Return'), 'Season 2 · The Return art');
  });

  t(`${label}: a save's changes are checked`, () => {
    assert.deepEqual(m.checkSeasonArtChanges([{ number: 2, imageBase64: 'data:image/png;base64,AA', fileName: 's2.png' }, { number: '1', remove: true }]), [
      { number: 2, imageBase64: 'data:image/png;base64,AA', fileName: 's2.png' },
      { number: 1, remove: true }
    ]);
    assert.deepEqual(m.checkSeasonArtChanges([]), []);
    assert.throws(() => m.checkSeasonArtChanges('x'), /a list of seasons/);
    assert.throws(() => m.checkSeasonArtChanges([{ number: 0, remove: true }]), /Which season/);
    assert.throws(() => m.checkSeasonArtChanges([{ number: 1, remove: true }, { number: 1, remove: true }]), /twice/);
    assert.throws(() => m.checkSeasonArtChanges([{ number: 1 }]), /one or the other/);
    assert.throws(() => m.checkSeasonArtChanges([{ number: 1, remove: true, imageBase64: 'x' }]), /one or the other/);
    assert.throws(() => m.checkSeasonArtChanges([1, 2, 3, 4, 5].map((s) => ({ number: s, remove: true }))), /Up to 4/);
    assert.throws(() => m.checkSeasonArtChanges([{ number: 7, remove: true }], { allowed: [1, 2] }), /no Season 7/);
  });

  t(`${label}: direct changes go live and send the old pictures to Orphaned media`, () => {
    const r = m.applySeasonArtChanges({
      live: [{ number: 1, image: A }],
      pending: [{ number: 2, image: C }],
      changes: [{ number: 2, image: B }, { number: 1, remove: true }],
      mode: 'direct'
    });
    assert.deepEqual(r.live, [{ number: 2, image: B }]);
    assert.deepEqual(r.pending, [], 'what waited for Season 2 is replaced');
    assert.deepEqual(r.orphans.sort(), [A, C].sort());
    assert.deepEqual(r.applied, [2, 1]);
    assert.deepEqual(r.staged, []);
    assert.throws(() => m.applySeasonArtChanges({ live: [], pending: [], changes: [{ number: 3, remove: true }], mode: 'direct' }), /no art to remove/);
  });

  t(`${label}: staged changes wait; a newer one replaces the waiting one`, () => {
    const r = m.applySeasonArtChanges({
      live: [{ number: 1, image: A }],
      pending: [{ number: 2, image: C }],
      changes: [{ number: 2, image: B }, { number: 1, remove: true }],
      mode: 'staged'
    });
    assert.deepEqual(r.live, [{ number: 1, image: A }], 'live stays');
    assert.deepEqual(r.pending, [{ number: 1, image: null }, { number: 2, image: B }]);
    assert.deepEqual(r.orphans, [C]);
    assert.deepEqual(r.staged, [2, 1]);
    assert.equal(r.notices.length, 1);
    // Removing a season that only has a waiting picture takes it back.
    const back = m.applySeasonArtChanges({ live: [], pending: [{ number: 3, image: B }], changes: [{ number: 3, remove: true }], mode: 'staged' });
    assert.deepEqual(back.pending, []);
    assert.deepEqual(back.orphans, [B]);
    assert.deepEqual(back.staged, []);
    assert.throws(() => m.applySeasonArtChanges({ live: [], pending: [], changes: [{ number: 3, remove: true }], mode: 'staged' }), /no art to remove/);
  });

  t(`${label}: the team's decision, per season`, () => {
    const ok = m.decideSeasonArtEntries({ live: [{ number: 1, image: A }, { number: 2, image: C }], pending: [{ number: 2, image: B }, { number: 1, image: null }], seasons: [2], approve: true });
    assert.deepEqual(ok.live, [{ number: 1, image: A }, { number: 2, image: B }]);
    assert.deepEqual(ok.pending, [{ number: 1, image: null }], 'Season 1’s removal still waits');
    assert.deepEqual(ok.orphans.map((o) => o.image), [C]);
    const removal = m.decideSeasonArtEntries({ live: [{ number: 1, image: A }], pending: [{ number: 1, image: null }], seasons: [1], approve: true });
    assert.deepEqual(removal.live, []);
    assert.deepEqual(removal.pending, []);
    assert.deepEqual(removal.orphans.map((o) => o.image), [A]);
    const no = m.decideSeasonArtEntries({ live: [{ number: 2, image: C }], pending: [{ number: 2, image: B }], seasons: [2], approve: false });
    assert.deepEqual(no.live, [{ number: 2, image: C }], 'denied: what’s live stays');
    assert.deepEqual(no.pending, []);
    assert.deepEqual(no.orphans.map((o) => o.image), [B], 'the denied picture goes to Orphaned media');
    const noRemoval = m.decideSeasonArtEntries({ live: [{ number: 2, image: C }], pending: [{ number: 2, image: null }], seasons: [2], approve: false });
    assert.deepEqual(noRemoval.orphans, [], 'a denied removal drops no file');
    assert.throws(() => m.decideSeasonArtEntries({ live: [], pending: [], seasons: [2], approve: true }), /Nothing is waiting/);
  });

  t(`${label}: the owner takes a waiting one back`, () => {
    assert.deepEqual(m.cancelSeasonArtEntry([{ number: 2, image: B }, { number: 3, image: null }], 2), { pending: [{ number: 3, image: null }], orphan: B });
    assert.deepEqual(m.cancelSeasonArtEntry([{ number: 3, image: null }], '3'), { pending: [], orphan: null });
    assert.throws(() => m.cancelSeasonArtEntry([], 2), /Nothing is waiting/);
  });

  t(`${label}: every picture a show holds for its seasons`, () => {
    assert.deepEqual(m.seasonArtImages({ season_art: [{ number: 1, image: A }], pending_season_art: [{ number: 1, image: null }, { number: 2, image: B }] }).sort(), [A, B].sort());
    assert.deepEqual(m.seasonArtImages({}), []);
  });
}

console.log(`\n${n} passed`);
