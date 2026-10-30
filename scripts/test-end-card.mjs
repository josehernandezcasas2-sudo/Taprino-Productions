// node scripts/test-end-card.mjs — the end card's cases and words (lib/endCardRules.js).
import assert from 'node:assert/strict';
import { endCardFor, playingInLabel, END_CARD_SECONDS, PLAY_NOW_LABEL } from '../lib/endCardRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const ep = (over) => ({ id: 'e2', title: 'The Long Way', contentType: 'series', seriesId: 's1', season: 1, seriesOrder: 2, tier: 'free', adsEnabled: true, runtime: '22:00', genre: 'Drama', releaseYear: 2026, rating: 'PG', thumbnail: 'https://cdn/e2.jpg', ...over });
const next = ep({ id: 'e3', title: 'Back Roads', seriesOrder: 3, runtime: '24:00' });
const film = { id: 'f1', title: 'Paper Moons', contentType: 'movie', tier: 'premium', adsEnabled: true, runtime: '88:00', genre: 'Drama', releaseYear: 2026, rating: 'PG-13', poster: 'https://cdn/f1.jpg' };

t('a series episode with one after it: UP NEXT, the next episode, ten seconds', () => {
  const c = endCardFor({ episode: ep(), nextEpisode: next, seriesName: 'Night Bus' });
  assert.equal(c.kind, 'next');
  assert.equal(c.seconds, END_CARD_SECONDS);
  assert.deepEqual(c.headline, { kicker: 'That was · Night Bus · S1 E2', title: 'The Long Way' });
  assert.equal(c.target.kicker, 'Up next · Season 1 · Episode 3');
  assert.equal(c.target.title, 'Back Roads');
  assert.equal(c.target.href, '/episode/e3?autoplay=1');
  assert.equal(c.target.thumbnail, 'https://cdn/e2.jpg');
  assert.equal(c.target.runtime, '24:00');
  assert.equal(c.back, null);
});

t('the last episode of a season that has a season after it: SEASON 2 STARTS', () => {
  const c = endCardFor({ episode: ep({ seriesOrder: 8 }), nextEpisode: ep({ id: 'e9', title: 'New Town', season: 2, seriesOrder: 1 }), seriesName: 'Night Bus' });
  assert.equal(c.kind, 'season');
  assert.equal(c.headline.kicker, 'That was the last episode of Season 1');
  assert.equal(c.headline.title, 'Night Bus');
  assert.equal(c.target.kicker, 'Season 2 starts · Episode 1');
  assert.equal(c.target.id, 'e9');
  assert.equal(c.seconds, END_CARD_SECONDS);
});

t('the last episode of the show: THAT WAS THE LAST EPISODE, one pick, Back to the show', () => {
  const c = endCardFor({ episode: ep({ seriesOrder: 8 }), nextEpisode: null, pick: film, seriesName: 'Night Bus' });
  assert.equal(c.kind, 'show');
  assert.deepEqual(c.headline, { kicker: 'That was the last episode', title: 'Night Bus · Season 1' });
  assert.equal(c.target.kicker, 'Try this next · Film');
  assert.equal(c.target.title, 'Paper Moons');
  assert.equal(c.target.thumbnail, 'https://cdn/f1.jpg'); // the poster when there is no thumbnail
  assert.equal(c.target.tier, 'premium');
  assert.deepEqual(c.back, { label: 'Back to Night Bus', href: '/series/s1', seriesId: 's1' });
  assert.equal(c.seconds, END_CARD_SECONDS);
});

t('a film: THAT WAS, the pick, Browse Stream; a series pick is worded as a series', () => {
  const c = endCardFor({ episode: film, pick: { ...next, title: 'Night Bus', contentType: 'series' } });
  assert.equal(c.kind, 'film');
  assert.deepEqual(c.headline, { kicker: 'That was', title: 'Paper Moons' });
  assert.equal(c.target.kicker, 'Try this next · Series');
  assert.equal(c.target.title, 'Night Bus');
  assert.deepEqual(c.back, { label: 'Browse Stream', href: '/stream', seriesId: null });
});

t('nothing to pick: the card only says the show is over, no timer', () => {
  const c = endCardFor({ episode: ep({ seriesOrder: 8 }), nextEpisode: null, pick: null, seriesName: 'Night Bus' });
  assert.equal(c.kind, 'show');
  assert.equal(c.target, null);
  assert.equal(c.seconds, 0);
  assert.equal(c.back.label, 'Back to Night Bus');
  const f = endCardFor({ episode: film });
  assert.equal(f.kind, 'film');
  assert.equal(f.target, null);
  assert.equal(f.seconds, 0);
});

t('no card for a trailer or a podcast', () => {
  assert.equal(endCardFor({ episode: ep(), nextEpisode: next, trailer: true }), null);
  assert.equal(endCardFor({ episode: { ...film, contentType: 'podcast' }, pick: next }), null);
  assert.equal(endCardFor({ episode: null }), null);
});

t('the words', () => {
  assert.equal(playingInLabel(7), 'Playing in 7 s');
  assert.equal(playingInLabel(0), 'Playing in 0 s');
  assert.equal(PLAY_NOW_LABEL, 'Play now');
  const c = endCardFor({ episode: ep({ seriesOrder: null }), nextEpisode: ep({ id: 'e3', seriesOrder: null }) });
  assert.equal(c.headline.kicker, 'That was'); // no show name, no number
  assert.equal(c.target.kicker, 'Up next');
});

console.log(`\n${n} passed`);
