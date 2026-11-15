// node scripts/test-work-list.mjs — Your work's rules (lib/workListRules.js,
// 2026-11-15): the tabs and their counts, the sections that fold (Shows,
// Films, Shorts, then Extras / Podcast episodes / Other / Vertical when
// there are any), a show's seasons and their episodes, one row per title
// with its pill, meta, what needs the creator, what waits, its next step
// and its menu. The app's copy is checked word for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/workListRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const NOW = Date.parse('2026-11-15T18:00:00Z');

const base = {
  status: 'approved', contentType: 'movie', seriesId: null, seriesStatus: null, seriesHeld: false, season: null, seriesOrder: null,
  runtime: '22:40', viewCount: 0, captionsUrl: '/api/captions/x', captionsStale: false, poster: 'p.jpg', thumbnail: 't.jpg', missingArtwork: false,
  held: false, deletionRequested: false, withdrawnAt: null, cloudflareState: 'ready', canPrice: true, hasVideo: true, hasAudio: false, createdAt: '2026-11-01T00:00:00Z'
};
const nb = { seriesId: 'night-bus-lx3k9a', seriesName: 'Night Bus', seriesStatus: 'approved', contentType: 'series' };
const subs = [
  { ...base, ...nb, id: 'nb-e1-a1', title: 'First Stop', season: 1, seriesOrder: 1, viewCount: 1284 },
  { ...base, ...nb, id: 'nb-e2-a2', title: 'The Transfer', season: 1, seriesOrder: 2, captionsUrl: null },
  { ...base, ...nb, id: 'nb-e3-a3', title: '', season: 2, seriesOrder: 1, status: 'pending', createdAt: '2026-11-13T00:00:00Z' },
  { ...base, ...nb, id: 'nb-e4-a4', title: 'Terminus', season: 2, seriesOrder: 2, status: 'rejected', rejectionReason: 'The audio drops out.' },
  { ...base, id: 'nb-x-a5', title: 'Making of', contentType: 'bonus', bonusParentType: 'series', bonusParentId: 'night-bus-lx3k9a', extraKind: 'making-of' },
  { ...base, id: 'long-way-b1', title: 'The Long Way Home', runtime: '1:28:10', viewCount: 3410 },
  { ...base, id: 'salt-b2', title: 'Salt', status: 'pending' },
  { ...base, id: 'paper-b3', title: 'Paper Boats', contentType: 'short', poster: null, thumbnail: null, missingArtwork: true },
  { ...base, id: 'static-b4', title: 'Static', contentType: 'short', status: 'rejected', rejectionReason: 'Commercial track.' },
  { ...base, id: 'echo-b5', title: 'Echo Park', deletionRequested: true, deletionReason: 'Recut' },
  { ...base, id: 'roof-b6', title: 'Rooftop', contentType: 'vertical' }
];
const shows = [
  { id: 'night-bus-lx3k9a', name: 'Night Bus', kind: 'series', state: 'live', statusLabel: 'Live', isPublic: true, countLine: '2 seasons · 4 episodes', seasons: [{ number: 1, label: 'Season 1' }, { number: 2, label: 'Season 2 · Winter' }], makePublic: { ok: false } },
  { id: 'kitchen-table-c1', name: 'Kitchen Table', kind: 'podcast', state: 'ready', statusLabel: 'Ready to go public', isPublic: false, countLine: '1 episode', seasons: [], makePublic: { ok: true } }
];
const prices = { 'episode:long-way-b1': { status: 'on', price_cents: 499, pending_cents: null, sale_percent: 20, sale_ends_at: '2026-11-20T00:00:00Z' } };

t('the app copy is the website file word for word', () => {
  const web = readFileSync(new URL('../lib/workListRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/workListRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
});

t('the tabs count every title once and a show that needs you once more', () => {
  const m = R.buildWorkList({ submissions: subs, shows, prices, now: NOW });
  const c = Object.fromEntries(m.tabs.map((x) => [x.key, x.count]));
  assert.equal(c.all, 11);
  assert.equal(c.review, 2);
  assert.equal(c.declined, 2);
  // e2 (no captions), e4 (sent back), paper (art), static (sent back) + Kitchen Table (ready).
  assert.equal(c.needs, 5);
  assert.equal(c.live, 6);
  assert.deepEqual(m.tabs.map((x) => x.label), ['All', 'Needs you', 'In review', 'Live', 'Not this time']);
});

t('sections: Shows, Films, Shorts, then Vertical folded with its note; no Snippet in Films', () => {
  const m = R.buildWorkList({ submissions: subs, shows, prices, now: NOW });
  assert.deepEqual(m.sections.map((s) => s.key), ['shows', 'films', 'shorts', 'vertical']);
  const films = m.sections.find((s) => s.key === 'films');
  assert.deepEqual(films.rows.map((r) => r.title), ['The Long Way Home', 'Salt', 'Echo Park']);
  const vertical = m.sections.find((s) => s.key === 'vertical');
  assert.equal(vertical.openByDefault, false);
  assert.match(vertical.note, /profile/);
  assert.equal(m.sections.find((s) => s.key === 'shows').count, 2);
});

t('a show: seasons with their labels, counts and needs, extras last; episodes open the editor', () => {
  const m = R.buildWorkList({ submissions: subs, shows, prices, now: NOW });
  const nbCard = m.sections[0].shows.find((s) => s.id === 'night-bus-lx3k9a');
  assert.deepEqual(nbCard.seasons.map((s) => s.label), ['Season 1', 'Season 2 · Winter', 'Extras']);
  assert.equal(nbCard.seasons[0].summary, '2 episodes');
  assert.equal(nbCard.seasons[0].needs, '1 needs you');
  assert.equal(nbCard.seasons[1].summary, '2 episodes · 1 in review');
  assert.equal(nbCard.openLabel, 'Show 2 seasons and extras');
  assert.equal(nbCard.needLine, '2 need you');
  assert.equal(nbCard.restLine, '1 in review');
  const e1 = nbCard.seasons[0].rows[0];
  assert.equal(e1.code, 'S1 E1');
  assert.equal(e1.href, '/creator/show/night-bus-lx3k9a/episode/nb-e1-a1');
  assert.equal(e1.meta, '23 min · 1,284 views');
  const e3 = nbCard.seasons[1].rows[0];
  assert.equal(e3.title, 'Episode 1');
  assert.equal(e3.pill.label, 'In review');
  assert.equal(nbCard.seasons[2].rows[0].meta, 'Making-of · with the show · 23 min · 0 views');
});

t('a show ready to go public says so and offers Make it public', () => {
  const m = R.buildWorkList({ submissions: subs, shows, prices, now: NOW });
  const kt = m.sections[0].shows.find((s) => s.id === 'kitchen-table-c1');
  assert.ok(kt.makePublic);
  assert.match(kt.needLine, /make it public/);
  assert.equal(kt.hasSeasons, false);
});

t('a row of its own: pill, meta with the price, next step and the menu in words', () => {
  const m = R.buildWorkList({ submissions: subs, shows, prices, now: NOW });
  const films = m.sections.find((s) => s.key === 'films').rows;
  const lw = films[0];
  assert.equal(lw.href, '/creator/title/long-way-b1');
  assert.equal(lw.meta, '1 h 28 min · 3,410 views · on sale $3.99 · 20% off');
  assert.equal(lw.next, null);
  assert.deepEqual(lw.menu.map((x) => x.key), ['open', 'edit_words', 'view', 'copy', 'sell', 'payee', 'artwork', 'video', 'captions', 'channels', 'remove']);
  assert.equal(lw.menu.find((x) => x.key === 'channels').detail, 'Off');
  const echo = films[2];
  assert.equal(echo.pill.label, 'Removal requested');
  assert.equal(echo.waiting, 'You asked us to remove it: “Recut”');
  assert.deepEqual(echo.next, { key: 'cancel_removal', label: 'Cancel the request' });
  assert.ok(!echo.menu.some((x) => x.key === 'remove'));
  const shorts = m.sections.find((s) => s.key === 'shorts').rows;
  assert.deepEqual(shorts[0].next, { key: 'artwork', label: 'Add artwork' });
  assert.deepEqual(shorts[1].next, { key: 'replace_file', label: 'Replace the file' });
  assert.equal(shorts[1].need, 'Commercial track.');
  const salt = films[1];
  assert.equal(salt.menu[1].key, 'edit_submission');
  assert.ok(!salt.menu.some((x) => x.key === 'sell'));
  assert.equal(R.buildWorkList({ submissions: subs, shows, canEditAll: true, now: NOW }).sections.find((s) => s.key === 'films').rows[0].menu[1].key, 'edit_full');
});

t('a show episode that needs you opens its editor from the button', () => {
  const m = R.buildWorkList({ submissions: subs, shows, prices, now: NOW });
  const nbCard = m.sections[0].shows[1];
  assert.deepEqual(nbCard.seasons[0].rows[1].next, { key: 'open', label: 'Add captions' });
  assert.deepEqual(nbCard.seasons[1].rows[1].next, { key: 'open', label: 'Fix it' });
  assert.ok(!nbCard.seasons[0].rows[0].menu.some((x) => x.key === 'remove'));
});

t('a tab narrows the page and opens what matches; Needs you keeps the ready show', () => {
  const m = R.buildWorkList({ submissions: subs, shows, prices, tab: 'needs', now: NOW });
  const showsSec = m.sections.find((s) => s.key === 'shows');
  assert.deepEqual(showsSec.shows.map((s) => s.name), ['Kitchen Table', 'Night Bus']);
  const nbCard = showsSec.shows.find((s) => s.name === 'Night Bus');
  assert.equal(nbCard.openByFilter, true);
  assert.deepEqual(nbCard.seasons.map((s) => s.rows.map((r) => r.id)), [['nb-e2-a2'], ['nb-e4-a4']]);
  assert.deepEqual(m.sections.map((s) => s.key), ['shows', 'shorts']);
});

t('search matches a title or the show name', () => {
  const byShow = R.buildWorkList({ submissions: subs, shows, query: 'night', now: NOW });
  assert.deepEqual(byShow.sections.map((s) => s.key), ['shows']);
  assert.equal(byShow.sections[0].shows[0].seasons.reduce((a, s) => a + s.rows.length, 0), 5);
  const byTitle = R.buildWorkList({ submissions: subs, shows, query: 'salt', now: NOW });
  assert.deepEqual(byTitle.sections.map((s) => s.key), ['films']);
  const none = R.buildWorkList({ submissions: subs, shows, query: 'zzz', now: NOW });
  assert.equal(none.nothingMatches, true);
});

t('nothing yet, and missing answers draw nothing rather than breaking', () => {
  assert.equal(R.buildWorkList({ submissions: [], shows: [] }).empty, true);
  const m = R.buildWorkList({ submissions: subs, shows: null, prices: null, now: NOW });
  // Without the show summaries the episodes still sit under their show.
  assert.equal(m.sections[0].shows[0].name, 'Night Bus');
});

t('the edit box says notes only for a title with a page of its own', () => {
  assert.equal(R.notesBoxShows({ contentType: 'movie', pageNotesReady: true }), true);
  assert.equal(R.notesBoxShows({ contentType: 'movie', pageNotesReady: false }), false);
  assert.equal(R.notesBoxShows({ contentType: 'bonus', pageNotesReady: true }), false);
  assert.equal(R.notesBoxShows({ contentType: 'bonus', pageNotesReady: true, hasPageChoice: true }), true);
  const m = R.buildWorkList({ submissions: [{ ...base, id: 'notes-d1', title: 'Notes', pageNotesReady: true }], shows: [], now: NOW });
  assert.equal(m.sections[0].rows[0].menu[1].label, 'Edit title, description and notes');
});

t('the seasons button says what opens', () => {
  const one = R.buildWorkList({ submissions: [{ ...base, ...nb, id: 'one-e1', title: 'A', season: 1, seriesOrder: 1 }], shows: [shows[0]], now: NOW });
  assert.equal(one.sections[0].shows[0].openLabel, 'Show the season');
  const onlyExtras = R.buildWorkList({ submissions: [subs[4]], shows: [shows[0]], now: NOW });
  assert.equal(onlyExtras.sections[0].shows[0].openLabel, 'Show the extras');
});

t('the small helpers', () => {
  assert.equal(R.runtimeWords('1:05:00'), '1 h 5 min');
  assert.equal(R.runtimeWords('12:30'), '13 min');
  assert.equal(R.publicPath({ id: 'a-1', contentType: 'podcast', seriesId: 'show-1' }), '/podcasts/show-1');
  assert.equal(R.publicPath({ id: 'a-1', contentType: 'movie' }), '/episode/a-1');
  assert.equal(R.titleWaiting({ pendingTitle: 'New', pendingSrc: true, pendingVideoState: 'inprogress' }), 'Waiting for approval: the title “New” and a new video (still processing)');
  assert.equal(R.priceWords({ status: 'on', price_cents: 199, pending_cents: null }), 'on sale $1.99');
  assert.equal(R.priceWords({ status: 'off', price_cents: null, pending_cents: 99 }), 'price in review $0.99');
  assert.equal(R.copyLinkFor({ publicPath: '/episode/x' }, 'https://www.studiotapatv.site/'), 'https://www.studiotapatv.site/episode/x');
});

console.log(`\n${n} checks passed`);
