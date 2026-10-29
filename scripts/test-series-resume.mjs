// node scripts/test-series-resume.mjs — where a series' Play picks up (lib/seriesResume.js).
import assert from 'node:assert/strict';
import { seriesResumePoint, seriesPlayLabel, seriesPlayEpisodeId, withSeriesResume, episodeCode, sortEpisodes } from '../lib/seriesResume.js';

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

console.log(`\n${n} series-resume checks passed`);
