// Run: node scripts/test-ad-plan.mjs
// Exercises lib/adPlanRules.js — the Episode Ad Curator's rules.
import assert from 'node:assert/strict';
import {
  bookedSeconds, airBreaks, airSeconds, adsSeconds, adsPerHour, airToEpisode, episodeToAir, normalizePlan, defaultPlanFor,
  fillBreak, fillBumpers, selfAdConflicts, fitsFor, parseClock, fmtClock, eligibleCount
} from '../lib/adPlanRules.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok -', name);
}
// A tiny deterministic generator so the weighted draws are repeatable.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const RUNTIME = 1660; // 27:40, the mockup's episode
const plan = {
  roundTo: 15,
  breaks: [
    { at: 0, pieces: [{ kind: 'exact', seconds: 15 }] },
    { at: 480, pieces: [{ kind: 'flex', seconds: 30 }] },
    { at: 1110, pieces: [{ kind: 'exact', seconds: 15 }, { kind: 'pinned', adId: 'tapa20', seconds: 20 }] },
    { at: 1440, pieces: [{ kind: 'range', min: 15, max: 20 }, { kind: 'exact', seconds: 10 }] }
  ]
};

test('a break books its pieces rounded up to the plan rounding', () => {
  assert.equal(bookedSeconds({ pieces: [{ kind: 'exact', seconds: 15 }, { kind: 'pinned', adId: 'x', seconds: 20 }] }, 15), 45);
  assert.equal(bookedSeconds({ pieces: [{ kind: 'range', min: 10, max: 15 }] }, 15), 15);
  assert.equal(bookedSeconds({ pieces: [{ kind: 'range', min: 10, max: 15 }, { kind: 'exact', seconds: 10 }] }, 15), 30);
  assert.equal(bookedSeconds({ pieces: [] }, 15), 0);
  assert.equal(bookedSeconds({ pieces: [{ kind: 'exact', seconds: 20 }] }, 30), 30);
});

test('air positions and the air length', () => {
  const ab = airBreaks(plan);
  assert.deepEqual(ab.map((b) => [b.at, b.booked, b.airStart, b.airEnd]), [[0, 15, 0, 15], [480, 30, 495, 525], [1110, 45, 1155, 1200], [1440, 30, 1530, 1560]]);
  assert.equal(adsSeconds(plan), 120);
  assert.equal(airSeconds(RUNTIME, plan), 1780);
  assert.equal(adsPerHour(RUNTIME, plan), 243);
});

test('air offset → episode offset, in and out of breaks', () => {
  const ab = airBreaks(plan);
  assert.deepEqual(airToEpisode(10, ab), { episodeSeconds: 0, inBreak: { index: 0, at: 0, elapsed: 10, remaining: 5, booked: 15 } });
  assert.deepEqual(airToEpisode(100, ab), { episodeSeconds: 85, inBreak: null });
  assert.equal(airToEpisode(500, ab).inBreak.index, 1);
  assert.equal(airToEpisode(500, ab).inBreak.remaining, 25);
  assert.deepEqual(airToEpisode(600, ab), { episodeSeconds: 555, inBreak: null });
  assert.deepEqual(airToEpisode(1779, ab), { episodeSeconds: 1659, inBreak: null });
  assert.equal(episodeToAir(480, ab), 525);
  assert.equal(episodeToAir(479, ab), 494);
  assert.equal(episodeToAir(0, ab), 15);
  // round trip for every episode second
  for (let ep = 0; ep < RUNTIME; ep += 7) assert.equal(airToEpisode(episodeToAir(ep, ab), ab).episodeSeconds, ep);
});

test('normalizePlan sorts, dedupes, drops empties and breaks past the end', () => {
  const { plan: p, errors } = normalizePlan({
    status: 'ready', roundTo: 7,
    breaks: [
      { at: 600, pieces: [{ kind: 'exact', seconds: 15 }] },
      { at: 0, pieces: [] },
      { at: 600, pieces: [{ kind: 'exact', seconds: 10 }] },
      { at: 5000, pieces: [{ kind: 'exact', seconds: 10 }] },
      { at: 100, pieces: [{ kind: 'range', min: 20, max: 10 }, { kind: 'flex', seconds: 60 }, { kind: 'bogus' }] }
    ],
    selfAds: [{ inSeconds: 730, outSeconds: 753, sponsor: 'Acme', url: 'acme.example', card: true }, { inSeconds: 50, outSeconds: 40 }],
    autoBumper: 'nope'
  }, { runtimeSeconds: RUNTIME });
  assert.equal(p.status, 'ready');
  assert.equal(p.roundTo, 15);
  assert.deepEqual(p.breaks.map((b) => b.at), [100, 600]);
  assert.deepEqual(p.breaks[0].pieces, [{ kind: 'flex', seconds: 60 }]);
  assert.equal(p.breaks[1].pieces[0].seconds, 15);
  assert.equal(p.selfAds.length, 1);
  assert.equal(p.autoBumper, 'station_id');
  assert.ok(errors.length >= 4, errors.join(' | '));
});

test('the default plan puts one 30 s section at each creator break', () => {
  const d = defaultPlanFor({ adBreakSeconds: [1230, 0, 600, 9999], runtimeSeconds: RUNTIME });
  assert.deepEqual(d.breaks.map((b) => b.at), [0, 600, 1230]);
  assert.deepEqual(d.breaks[1].pieces, [{ kind: 'exact', seconds: 30 }]);
  assert.equal(d.status, 'none');
  assert.deepEqual(defaultPlanFor({ adBreakSeconds: null, runtimeSeconds: 100, sizes: [10, 20] }).breaks, [{ at: 0, pieces: [{ kind: 'exact', seconds: 20 }] }]);
});

const ads = [
  { id: 'acme20', title: 'Acme', durationSeconds: 20, weight: 1, house: false, brand: 'Acme Coffee' },
  { id: 'bake15', title: 'Bakery', durationSeconds: 15, weight: 1, house: false, brand: 'Highland Bakery' },
  { id: 'lab25', title: 'Lab', durationSeconds: 25, weight: 1, house: false, brand: 'EPFL' },
  { id: 'odd12', title: 'Odd', durationSeconds: 12, weight: 1, house: false, brand: 'Odd' },
  { id: 'tapa20', title: 'Stickers', durationSeconds: 20, weight: 1, house: true, brand: 'Studio Tapa' },
  { id: 'tapa15', title: 'Post Puppeteers', durationSeconds: 15, weight: 1, house: true, brand: 'Post Puppeteers' },
  { id: 'tapa10', title: 'Pitch Room', durationSeconds: 10, weight: 1, house: true, brand: 'Pitch Room' }
];
const bumpers = [
  { id: 'id5', title: 'Station ID', kind: 'station_id', durationSeconds: 5 },
  { id: 'sting4', title: 'Sting', kind: 'bumper', durationSeconds: 4 },
  { id: 'promo15', title: 'Promo', kind: 'promo', durationSeconds: 15 }
];
const total = (r) => r.items.reduce((s, i) => s + i.seconds, 0);

test('an exact section draws an ad of exactly that length', () => {
  const r = fillBreak({ at: 0, pieces: [{ kind: 'exact', seconds: 15 }] }, { ads, bumpers, rng: seeded(1) });
  assert.equal(r.booked, 15);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].type, 'ad');
  assert.equal(r.items[0].seconds, 15);
  assert.equal(total(r), 15);
});

test('nothing fits → a Studio Tapa ad that fits, then bumpers, then the hold card', () => {
  const r = fillBreak({ at: 0, pieces: [{ kind: 'exact', seconds: 30 }] }, { ads, bumpers, rng: seeded(2) });
  assert.equal(r.booked, 30);
  assert.equal(r.items[0].type, 'ad');
  assert.equal(r.items[0].ad.house, true);
  assert.equal(r.items[0].seconds, 20); // the longest house ad that fits
  assert.equal(r.items[1].type, 'bumper');
  assert.equal(r.items[1].seconds, 5);
  assert.equal(r.items[2].type, 'bumper');
  assert.equal(r.items[2].seconds, 4);
  assert.equal(r.items[3].type, 'hold');
  assert.equal(r.items[3].seconds, 1);
  assert.equal(total(r), 30);
});

test('a range section holds one ad inside the range and bumper time takes the rest', () => {
  const r = fillBreak({ at: 0, pieces: [{ kind: 'range', min: 10, max: 15 }] }, { ads: ads.filter((a) => a.id === 'odd12'), bumpers, rng: seeded(3) });
  assert.equal(r.booked, 15);
  assert.equal(r.items[0].id, 'odd12');
  assert.equal(r.items[1].type, 'hold');
  assert.equal(r.items[1].seconds, 3); // too short for any clip
  assert.equal(total(r), 15);
});

test('a flex block packs ads of any length and keeps the rest for bumpers', () => {
  const r = fillBreak({ at: 0, pieces: [{ kind: 'flex', seconds: 60 }] }, { ads, bumpers, rng: seeded(4) });
  assert.equal(r.booked, 60);
  const adItems = r.items.filter((i) => i.type === 'ad');
  assert.ok(adItems.length >= 2);
  assert.equal(new Set(adItems.map((i) => i.id)).size, adItems.length); // each ad once
  assert.ok(r.adsSeconds <= 60);
  assert.equal(total(r), 60);
});

test('adjacent sections merge into one block when the setting is on', () => {
  const pieces = [{ kind: 'exact', seconds: 15 }, { kind: 'exact', seconds: 10 }, { kind: 'range', min: 15, max: 20 }];
  const only25 = ads.filter((a) => a.id === 'lab25');
  const merged = fillBreak({ at: 0, pieces }, { ads: only25, bumpers, mergeAdjacent: true, rng: seeded(5) });
  assert.equal(merged.booked, 45);
  assert.equal(merged.items[0].id, 'lab25'); // 25 s fits the 45 s pool
  const apart = fillBreak({ at: 0, pieces }, { ads: only25, bumpers, mergeAdjacent: false, rng: seeded(5) });
  assert.equal(apart.booked, 45);
  assert.ok(!apart.items.some((i) => i.id === 'lab25')); // never fits 15, 10 or 15–20 on its own
  assert.equal(total(merged), 45);
  assert.equal(total(apart), 45);
});

test('a pinned Studio Tapa ad plays every time and names the "Presented by" card', () => {
  const r = fillBreak({ at: 1110, pieces: [{ kind: 'exact', seconds: 15 }, { kind: 'pinned', adId: 'tapa20', seconds: 20 }] }, { ads, bumpers, autoBumper: 'presented_by', rng: seeded(6) });
  assert.equal(r.booked, 45);
  assert.equal(r.items[1].id, 'tapa20');
  const card = r.items.find((i) => i.type === 'card');
  assert.ok(card);
  assert.equal(card.variant, 'presented_by');
  assert.equal(card.brand, 'Studio Tapa');
  assert.equal(card.seconds, 6);
  assert.equal(total(r), 45);
});

test('a pinned ad that disappeared becomes an exact section of its length', () => {
  const r = fillBreak({ at: 0, pieces: [{ kind: 'pinned', adId: 'gone', seconds: 20 }] }, { ads, bumpers, rng: seeded(7) });
  assert.equal(r.booked, 30);
  assert.equal(r.items[0].type, 'ad');
  assert.equal(r.items[0].seconds, 20);
  assert.equal(total(r), 30);
});

test('hold only, channel rotation, and no "Presented by" without a brand', () => {
  const hold = fillBumpers(12, { bumpers, autoBumper: 'hold' });
  assert.deepEqual(hold, [{ type: 'hold', seconds: 12 }]);
  const ch = fillBumpers(12, { bumpers, autoBumper: 'channel', rng: seeded(8) });
  assert.deepEqual(ch.map((i) => [i.type, i.seconds]), [['bumper', 5], ['bumper', 4], ['hold', 3]]);
  const noBrand = fillBumpers(12, { bumpers, autoBumper: 'presented_by', brand: null, rng: seeded(8) });
  assert.ok(!noBrand.some((i) => i.type === 'card'));
  assert.equal(noBrand[0].type, 'bumper');
});

test('every fill adds up to the booked seconds, whatever the plan', () => {
  const rng = seeded(99);
  for (let n = 0; n < 200; n++) {
    const pieces = [];
    const count = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const k = Math.floor(rng() * 4);
      if (k === 0) pieces.push({ kind: 'exact', seconds: [10, 15, 20, 30][Math.floor(rng() * 4)] });
      else if (k === 1) pieces.push({ kind: 'range', min: 10, max: 15 + Math.floor(rng() * 3) * 5 });
      else if (k === 2) pieces.push({ kind: 'flex', seconds: 30 + Math.floor(rng() * 4) * 15 });
      else pieces.push({ kind: 'pinned', adId: rng() < 0.5 ? 'tapa20' : 'missing', seconds: 20 });
    }
    const roundTo = [5, 10, 15, 30][Math.floor(rng() * 4)];
    const r = fillBreak({ at: 0, pieces }, { ads, bumpers, roundTo, mergeAdjacent: rng() < 0.5, autoBumper: ['presented_by', 'station_id', 'channel', 'hold'][Math.floor(rng() * 4)], rng });
    assert.equal(total(r), r.booked, JSON.stringify({ pieces, roundTo, items: r.items.map((i) => [i.type, i.seconds]) }));
    assert.equal(r.booked % roundTo, 0);
    const adIds = r.items.filter((i) => i.type === 'ad').map((i) => i.id);
    assert.equal(new Set(adIds).size, adIds.length);
  }
});

test('self-ad clearance warnings', () => {
  const p = { breaks: [{ at: 100, pieces: [] }, { at: 700, pieces: [] }, { at: 740, pieces: [] }], selfAds: [{ inSeconds: 730, outSeconds: 753 }] };
  const c = selfAdConflicts(p);
  assert.deepEqual(c.map((x) => [x.at, x.inside]), [[700, false], [740, true]]);
});

test('fits, counts and clock helpers', () => {
  assert.deepEqual(fitsFor(15), ['15', '10–15', '15–20', 'flex']);
  assert.deepEqual(fitsFor(25), ['20–30', 'flex']);
  assert.equal(eligibleCount({ kind: 'exact', seconds: 20 }, ads), 2);
  assert.equal(eligibleCount({ kind: 'range', min: 10, max: 15 }, ads), 4);
  assert.equal(parseClock('8:00'), 480);
  assert.equal(parseClock('1:02:30'), 3750);
  assert.equal(parseClock('480'), 480);
  assert.equal(parseClock('nope'), null);
  assert.equal(fmtClock(1780), '29:40');
  assert.equal(fmtClock(3750), '1:02:30');
});

console.log(`\n${passed} tests passed`);
