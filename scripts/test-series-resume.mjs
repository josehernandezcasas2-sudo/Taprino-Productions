// node scripts/test-series-resume.mjs — where a series' Play picks up
// (lib/seriesResume.js) and the one sorter for a show's episodes
// (sortEpisodes), on the website's copy and the app's
// (mobile/src/lib/seriesResume.js): the play-order block is checked word
// for word between the two, then every sort case runs on both.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as web from '../lib/seriesResume.js';

const { seriesResumePoint, seriesPlayLabel, seriesPlayEpisodeId, withSeriesResume, episodeCode, sortEpisodes } = web;

const webSource = readFileSync(new URL('../lib/seriesResume.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../mobile/src/lib/seriesResume.js', import.meta.url), 'utf8');
// mobile/package.json has no "type": "module" (Metro doesn't need one), so
// the app's file is loaded from its source as an ES module, the way
// scripts/test-hosted-auth.mjs does; it imports nothing, so that works.
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const ep = (id, season, order, extra = {}) => ({ id, seriesId: 'show', contentType: 'series', season, seriesOrder: order, title: `Ep ${id}`, ...extra });
// Listed out of order on purpose: S2E1 first, as the catalogue might hand them over.
const show = [ep('s2e1', 2, 1), ep('e3', 1, 3), ep('e1', 1, 1), ep('e2', 1, 2)];

t('play order is season then number', () => {
  assert.deepEqual(sortEpisodes(show).map((e) => e.id), ['e1', 'e2', 'e3', 's2e1']);
  assert.equal(episodeCode(ep('x', 1, 4)), 'S1 E4');
  assert.equal(episodeCode(ep('x', null, 2)), 'S1 E2');
  assert.equal(episodeCode({ id: 'x' }), null);
});

t('not started (or signed out): the first episode', () => {
  const p = seriesResumePoint(show, null);
  assert.equal(p.episodeId, 'e1');
  assert.equal(p.state, 'first');
  assert.equal(p.resumeSeconds, 0);
  assert.equal(seriesResumePoint(show, { progress: {}, watched: new Set() }).state, 'first');
  assert.equal(seriesPlayLabel(p), 'Play first episode');
  assert.equal(seriesPlayLabel(p, 'Play S1 E1'), 'Play S1 E1');
  assert.equal(seriesPlayLabel(null), 'Play first episode');
});

t('an episode in progress: continue it, the most recent one when two are', () => {
  // Insertion order is recency (lib/watchProgress.js): e3 was touched last.
  const p = seriesResumePoint(show, { progress: { other: 50, e2: 300, e3: 90 }, watched: new Set() });
  assert.equal(p.episodeId, 'e3');
  assert.equal(p.state, 'resume');
  assert.equal(p.resumeSeconds, 90);
  assert.equal(seriesPlayLabel(p), 'Continue S1 E3');
});

t('progress in another show never counts', () => {
  const p = seriesResumePoint(show, { progress: { other: 50 }, watched: new Set(['other']) });
  assert.equal(p.state, 'first');
});

t('finished some, nothing in progress: the episode after the furthest one finished', () => {
  const p = seriesResumePoint(show, { progress: {}, watched: new Set(['e2', 'e1']) });
  assert.equal(p.episodeId, 'e3');
  assert.equal(p.state, 'next');
  assert.equal(seriesPlayLabel(p), 'Play S1 E3');
  // Finished the last episode: back to the start.
  assert.equal(seriesResumePoint(show, { progress: {}, watched: new Set(['s2e1']) }).state, 'first');
  // Watched ids as a plain array work too (a JSON payload).
  assert.equal(seriesResumePoint(show, { progress: {}, watched: ['e3'] }).episodeId, 's2e1');
});

t('in progress beats finished', () => {
  const p = seriesResumePoint(show, { progress: { e1: 200 }, watched: new Set(['e3']) });
  assert.equal(p.episodeId, 'e1');
  assert.equal(p.state, 'resume');
});

t('labels without an episode number', () => {
  const loose = [{ id: 'a', seriesId: 'show', contentType: 'series' }, { id: 'b', seriesId: 'show', contentType: 'series' }];
  assert.equal(seriesPlayLabel(seriesResumePoint(loose, { progress: { a: 30 } })), 'Continue watching');
  assert.equal(seriesPlayLabel(seriesResumePoint(loose, { progress: {}, watched: new Set(['a']) })), 'Play next episode');
  assert.equal(seriesResumePoint([], { progress: {} }), null);
});

t('the hero pool: series candidates get the viewer\'s point, films are left alone', () => {
  const pool = [
    { id: 'film', isSeries: false, firstEpisodeId: null },
    { id: 'show', isSeries: true, firstEpisodeId: 'e1' }
  ];
  const episodes = [...show, { id: 'bonus', seriesId: 'show', contentType: 'bonus' }, { id: 'film', contentType: 'movie' }];
  const stamped = withSeriesResume(pool, episodes, { progress: { e2: 400 }, watched: new Set() });
  assert.equal(stamped[0].resume, undefined);
  assert.equal(stamped[1].resume.episodeId, 'e2');
  assert.equal(seriesPlayEpisodeId(stamped[1]), 'e2');
  assert.equal(seriesPlayEpisodeId(pool[1]), 'e1');
  assert.equal(seriesPlayEpisodeId({ isSeries: true }), null);
  // Signed out: the pool goes through untouched.
  assert.equal(withSeriesResume(pool, episodes, null), pool);
});

// --- the one sorter, on both copies ------------------------------------------

const block = (src) => {
  const start = src.indexOf('// --- play order: the one sorter');
  const end = src.indexOf('// --- end of play order');
  assert.ok(start >= 0 && end > start, 'the play-order markers are in the file');
  return src.slice(start, end);
};

t('the app\'s play-order block is the website\'s word for word', () => {
  assert.equal(block(appSource), block(webSource));
  assert.ok(!/^\s*import\s/m.test(appSource), 'mobile/src/lib/seriesResume.js imports nothing');
  assert.ok(!/^\s*import\s/m.test(webSource), 'lib/seriesResume.js imports nothing');
  for (const name of ['compareEpisodes', 'sortEpisodes', 'episodeCode', 'seriesPlayLabel', 'seriesPlayEpisodeId']) {
    assert.equal(typeof app[name], 'function', `the app exports ${name}`);
    assert.equal(app[name].toString(), web[name].toString(), `${name} is the same function in both copies`);
  }
});

const ids = (rows) => rows.map((r) => (r && r.id !== undefined ? r.id : r));

function sortSuite(R, who) {
  const tt = (name, fn) => t(`[${who}] ${name}`, fn);

  tt('an episode without a number goes after the numbered ones of its season', () => {
    const rows = [ep('s2e1', 2, 1), ep('loose', 1, null), ep('e2', 1, 2), ep('e1', 1, 1), ep('s2loose', 2, undefined)];
    assert.deepEqual(ids(R.sortEpisodes(rows)), ['e1', 'e2', 'loose', 's2e1', 's2loose']);
    // 0 and negative numbers are no number (migration 118 clears them).
    assert.deepEqual(ids(R.sortEpisodes([ep('zero', 1, 0), ep('neg', 1, -3), ep('e1', 1, 1)])), ['e1', 'neg', 'zero']);
    // A show where nothing has a number yet: oldest first, then the id.
    const unnumbered = [
      ep('c', 1, null, { createdAt: '2026-10-03T00:00:00Z' }),
      ep('a', 1, null, { createdAt: '2026-10-01T00:00:00Z' }),
      ep('b', 1, null)
    ];
    assert.deepEqual(ids(R.sortEpisodes(unnumbered)), ['a', 'c', 'b']);
  });

  tt('a missing, 0 or junk season is season 1; numbers may come as strings', () => {
    const rows = [
      ep('s2', '2', '1'),
      ep('none', null, 2),
      ep('zero', 0, 1),
      ep('junk', 'x', 3),
      ep('half', 1.5, 4),
      ep('undef', undefined, '5')
    ];
    assert.deepEqual(ids(R.sortEpisodes(rows)), ['zero', 'none', 'junk', 'half', 'undef', 's2']);
    assert.equal(R.compareEpisodes(ep('a', null, 1), ep('b', 1, 1, { id: 'a' })), 0);
  });

  tt('a tie on season and number: the oldest first, then the id', () => {
    const rows = [
      ep('new', 1, 3, { createdAt: '2026-10-05T09:00:00.654321+00:00' }),
      ep('old', 1, 3, { createdAt: '2026-10-02T09:00:00+02:00' }),
      ep('nodate', 1, 3),
      ep('zz', 1, 4, { createdAt: '2026-10-01T00:00:00Z' }),
      ep('aa', 1, 4, { createdAt: '2026-10-01T00:00:00Z' }),
      ep('blank', 1, 4, { createdAt: '' }),
      ep('bad', 1, 4, { createdAt: 'not a date' })
    ];
    assert.deepEqual(ids(R.sortEpisodes(rows)), ['old', 'new', 'nodate', 'aa', 'zz', 'bad', 'blank']);
    // A Date, a timestamp and an ISO string are the same moment.
    const at = Date.parse('2026-10-02T00:00:00Z');
    const same = [ep('c', 1, 1, { createdAt: '2026-10-02T00:00:00.000Z' }), ep('b', 1, 1, { createdAt: at }), ep('a', 1, 1, { createdAt: new Date(at) })];
    assert.deepEqual(ids(R.sortEpisodes(same)), ['a', 'b', 'c']);
    assert.deepEqual(ids(R.sortEpisodes([ep('later', 1, 1, { createdAt: new Date(at + 1) }), ep('earlier', 1, 1, { createdAt: at })])), ['earlier', 'later']);
  });

  tt('duplicates come out in one order, whatever order they arrived in', () => {
    const rows = [
      ep('dupB', 1, 2, { createdAt: '2026-10-04T00:00:00Z' }),
      ep('dupA', 1, 2, { createdAt: '2026-10-04T00:00:00Z' }),
      ep('dupOld', 1, 2, { createdAt: '2026-09-30T00:00:00Z' }),
      ep('e1', 1, 1),
      ep('e3', 1, 3)
    ];
    const expected = ['e1', 'dupOld', 'dupA', 'dupB', 'e3'];
    const permute = (list) => (list.length <= 1 ? [list] : list.flatMap((x, i) => permute([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p])));
    const all = permute(rows);
    assert.equal(all.length, 120);
    for (const order of all) assert.deepEqual(ids(R.sortEpisodes(order)), expected);
    // The same episode listed twice stays twice, side by side.
    const twice = R.sortEpisodes([ep('e2', 1, 2), ep('e1', 1, 1), ep('e2', 1, 2)]);
    assert.deepEqual(ids(twice), ['e1', 'e2', 'e2']);
  });

  tt('the list it is given is left alone; nothing given is an empty list', () => {
    const rows = [ep('b', 1, 2), ep('a', 1, 1)];
    const copy = [...rows];
    const sorted = R.sortEpisodes(rows);
    assert.deepEqual(ids(rows), ids(copy));
    assert.notEqual(sorted, rows);
    assert.deepEqual(R.sortEpisodes(null), []);
    assert.deepEqual(R.sortEpisodes(undefined), []);
    assert.deepEqual(R.sortEpisodes([]), []);
    // A Set works too (anything iterable).
    assert.deepEqual(ids(R.sortEpisodes(new Set(rows))), ['a', 'b']);
  });

  tt('database rows and drafts sort the same as the pages\' rows', () => {
    const db = [
      { id: 's2', season: 2, series_order: 1, created_at: '2026-10-01T00:00:00Z' },
      { id: 'dupNew', season: 1, series_order: 2, created_at: '2026-10-09T00:00:00.123456+00:00' },
      { id: 'dupOld', season: 1, series_order: 2, created_at: '2026-10-08T00:00:00+00:00' },
      { id: 'loose', season: null, series_order: null, created_at: '2026-10-01T00:00:00Z' },
      { id: 'e1', season: 1, series_order: 1, created_at: '2026-10-10T00:00:00Z' }
    ];
    const camel = db.map((r) => ({ id: r.id, season: r.season, seriesOrder: r.series_order, createdAt: r.created_at }));
    assert.deepEqual(ids(R.sortEpisodes(db)), ['e1', 'dupOld', 'dupNew', 'loose', 's2']);
    assert.deepEqual(ids(R.sortEpisodes(camel)), ids(R.sortEpisodes(db)));
    // The camelCase field wins when a row carries both.
    assert.deepEqual(ids(R.sortEpisodes([{ id: 'x', seriesOrder: 2, series_order: 1 }, { id: 'y', seriesOrder: 1, series_order: 2 }])), ['y', 'x']);
    assert.deepEqual(ids(R.sortEpisodes([{ id: 'x', seriesOrder: 1, createdAt: '2026-10-09T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }, { id: 'y', seriesOrder: 1, createdAt: '2026-10-05T00:00:00Z', created_at: '2026-10-07T00:00:00Z' }])), ['y', 'x']);
    // A draft (creator_drafts) keeps its place in its form, as strings.
    const drafts = [
      { id: 'd2', kind: 'draft', form: { season: '1', seriesOrder: '4' } },
      { id: 'd1', kind: 'draft', form: { season: '2', seriesOrder: '1' } },
      { id: 'e3', season: 1, seriesOrder: 3 }
    ];
    assert.deepEqual(ids(R.sortEpisodes(drafts)), ['e3', 'd2', 'd1']);
  });

  tt('odd rows never throw', () => {
    const rows = [null, { id: 'a', seriesOrder: 1 }, {}, { id: 7, season: 1, seriesOrder: 1 }, { form: null, id: 'f' }];
    const out = R.sortEpisodes(rows);
    assert.equal(out.length, rows.length);
    assert.deepEqual(ids(out.slice(0, 2)), [7, 'a']);
  });
}

sortSuite(web, 'website');
sortSuite(app, 'app');

t('the resume point reads the same order: duplicates and an unnumbered episode', () => {
  const rows = [
    ep('e1', 1, 1),
    ep('dupNew', 1, 2, { createdAt: '2026-10-05T00:00:00Z' }),
    ep('dupOld', 1, 2, { createdAt: '2026-10-01T00:00:00Z' }),
    ep('loose', 1, null),
    ep('s2e1', 2, 1)
  ];
  // Signed out: S1 E1, wherever it sits in the list.
  assert.equal(seriesResumePoint([...rows].reverse(), null).episodeId, 'e1');
  // Finished the older of the two E2s: the newer one is next, then the
  // unnumbered one, then season 2.
  assert.equal(seriesResumePoint(rows, { progress: {}, watched: ['dupOld'] }).episodeId, 'dupNew');
  assert.equal(seriesResumePoint(rows, { progress: {}, watched: ['dupNew'] }).episodeId, 'loose');
  const afterLoose = seriesResumePoint(rows, { progress: {}, watched: ['loose'] });
  assert.equal(afterLoose.episodeId, 's2e1');
  assert.equal(seriesPlayLabel(afterLoose), 'Play S2 E1');
  // The unnumbered one is next: the label has no code to give.
  assert.equal(seriesPlayLabel(seriesResumePoint(rows, { progress: {}, watched: ['dupOld', 'dupNew'] })), 'Play next episode');
  // An unnumbered episode no longer jumps ahead of E1 (it used to sort as E0).
  assert.equal(seriesResumePoint([ep('loose', 1, null), ep('e1', 1, 1)], null).episodeId, 'e1');
});

// A seeded walk through odd rows: the two copies, and the show page's own
// copy of the comparison when it is in the tree, put them in one order.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const SEASONS = [undefined, null, 0, 1, 1, 2, 2, '2', 3, -1, 1.5, 'x', ''];
const NUMBERS = [undefined, null, 0, 1, 2, 2, 3, 3, '3', 4, 10, -2, 2.5, '', ' '];
const DAY = Date.parse('2026-10-01T00:00:00Z');
const TIMES = [undefined, null, '', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00.123456+00:00', '2026-10-02T03:00:00+02:00', DAY, DAY + 1, new Date(DAY), 'garbage'];
const IDS = ['a', 'b', 'c', 'd', 'e', 'night-bus-e1', 'night-bus-e2', 'A', '10', '9', 7, null];
function randomRows(rand, count) {
  const pickOne = (list) => list[Math.floor(rand() * list.length)];
  return Array.from({ length: count }, () => {
    const shape = rand();
    const season = pickOne(SEASONS);
    const number = pickOne(NUMBERS);
    const time = pickOne(TIMES);
    const id = pickOne(IDS);
    if (shape < 0.6) return { id, season, seriesOrder: number, createdAt: time };
    if (shape < 0.9) return { id, season, series_order: number, created_at: time };
    return { id, kind: 'draft', form: { season, seriesOrder: number }, created_at: time };
  });
}
const key = (r) => JSON.stringify([r.id, r.season, r.seriesOrder, r.series_order, r.created_at instanceof Date ? r.created_at.getTime() : r.created_at, r.createdAt instanceof Date ? r.createdAt.getTime() : r.createdAt, r.form || null]);

const showRulesUrl = new URL('../lib/showRules.js', import.meta.url);
const showRules = existsSync(showRulesUrl) ? await import(showRulesUrl.href) : null;

t('the copies agree on a thousand odd shows, and the order never depends on the order rows arrive in', () => {
  const rand = seeded(20261102);
  for (let i = 0; i < 1000; i += 1) {
    const rows = randomRows(rand, 2 + Math.floor(rand() * 9));
    const w = web.sortEpisodes(rows);
    assert.deepEqual(app.sortEpisodes(rows).map(key), w.map(key));
    if (showRules && typeof showRules.compareEpisodes === 'function') {
      assert.deepEqual([...rows].sort(showRules.compareEpisodes).map(key), w.map(key), 'lib/showRules.js compareEpisodes agrees');
    }
    // Shuffled, every place holds a row the sorter can't tell apart from
    // the one it held before (two rows can only swap when they are the
    // same episode on the same date, written two ways).
    const again = web.sortEpisodes([...rows].sort(() => rand() - 0.5));
    again.forEach((r, j) => assert.equal(web.compareEpisodes(r, w[j]), 0, `place ${j}: ${key(r)} vs ${key(w[j])}`));
    // A total order: never both before and after, and in step with the sort.
    for (let j = 1; j < w.length; j += 1) {
      assert.ok(web.compareEpisodes(w[j - 1], w[j]) <= 0);
      assert.equal(Math.sign(web.compareEpisodes(w[j], w[j - 1])), -Math.sign(web.compareEpisodes(w[j - 1], w[j])) || 0);
    }
  }
});

t('the words agree between the copies', () => {
  const resumes = [null, { state: 'first' }, { state: 'resume', season: 1, seriesOrder: 3 }, { state: 'resume' }, { state: 'next', season: null, seriesOrder: 2 }, { state: 'next' }];
  for (const r of resumes) {
    assert.equal(app.seriesPlayLabel(r), web.seriesPlayLabel(r));
    assert.equal(app.seriesPlayLabel(r, 'Play S1 E1'), web.seriesPlayLabel(r, 'Play S1 E1'));
    assert.equal(app.seriesPlayLabel(r, 'Play S1 E1', { free: true }), web.seriesPlayLabel(r, 'Play S1 E1', { free: true }));
    assert.equal(app.episodeCode(r), web.episodeCode(r));
  }
  const heroes = [null, {}, { firstEpisodeId: 'e1' }, { resume: { episodeId: 'e3' }, firstEpisodeId: 'e1' }, { resume: {} }];
  for (const h of heroes) assert.equal(app.seriesPlayEpisodeId(h), web.seriesPlayEpisodeId(h));
});

t('every resume point says whether the episode it opens is free', () => {
  const mixed = [ep('e1', 1, 1, { tier: 'free' }), ep('e2', 1, 2, { tier: 'premium' }), ep('e3', 1, 3, { tier: 'free' })];
  assert.equal(seriesResumePoint(mixed, null).tier, 'free');
  assert.equal(seriesResumePoint(mixed, { progress: { e2: 40 }, watched: new Set() }).tier, 'premium');
  assert.equal(seriesResumePoint(mixed, { progress: {}, watched: new Set(['e2']) }).tier, 'free');
  assert.equal(seriesResumePoint([ep('x', 1, 1)], null).tier, 'free', 'no tier reads as free');
});

t('the " · free" on a non-member\'s Play (decision 10)', () => {
  const mixed = { tier: 'mixed', firstFree: true };
  const first = { state: 'first', season: 1, seriesOrder: 1, tier: 'free' };
  const nextFree = { state: 'next', season: 1, seriesOrder: 2, tier: 'free' };
  const nextPaid = { state: 'next', season: 1, seriesOrder: 2, tier: 'premium' };
  const resumeFree = { state: 'resume', season: 1, seriesOrder: 2, tier: 'free' };
  for (const R of [web, app]) {
    // first
    assert.equal(R.freePlayNote({ resume: first, rollup: mixed }), true);
    assert.equal(R.seriesPlayLabel(first, 'Play S1 E1', { free: true }), 'Play S1 E1 · free');
    // next on a free S1 E2
    assert.equal(R.freePlayNote({ resume: nextFree, rollup: mixed }), true);
    assert.equal(R.seriesPlayLabel(nextFree, 'Play S1 E1', { free: true }), 'Play S1 E2 · free');
    assert.equal(R.freePlayNote({ resume: nextPaid, rollup: mixed }), false);
    assert.equal(R.seriesPlayLabel(nextPaid, 'Play S1 E1', { free: false }), 'Play S1 E2');
    // resume: never
    assert.equal(R.freePlayNote({ resume: resumeFree, rollup: mixed }), false);
    assert.equal(R.seriesPlayLabel(resumeFree, 'Play S1 E1', { free: true }), 'Continue S1 E2', 'already watching');
    // all-free and all-Tapa + shows: no note
    assert.equal(R.freePlayNote({ resume: first, rollup: { tier: 'free', firstFree: true } }), false);
    assert.equal(R.freePlayNote({ resume: first, rollup: { tier: 'premium', firstFree: false } }), false);
    assert.equal(R.freePlayNote({ resume: first, rollup: null }), false);
    // a member, a bundle owner
    assert.equal(R.freePlayNote({ resume: first, rollup: mixed, isMember: true }), false);
    assert.equal(R.freePlayNote({ resume: first, rollup: mixed, ownsSeries: true }), false);
    // a signed-out hero with no resume
    assert.equal(R.freePlayNote({ resume: null, rollup: mixed }), true);
    assert.equal(R.freePlayNote({ resume: null, rollup: { tier: 'mixed', firstFree: false } }), false);
    assert.equal(R.seriesPlayLabel(null, 'Play first episode', { free: true }), 'Play first episode · free');
    assert.equal(R.seriesPlayLabel(null, undefined, { free: true }), 'Play first episode · free');
    assert.equal(R.seriesPlayLabel(null), 'Play first episode');
    assert.equal(R.freePlayNote(), false);
  }
});

console.log(`\n${n} series-resume checks passed${showRules ? ' (lib/showRules.js compareEpisodes checked too)' : ''}`);
