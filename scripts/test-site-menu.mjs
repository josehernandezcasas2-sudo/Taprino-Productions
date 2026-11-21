// node scripts/test-site-menu.mjs — the ☰ menu's rules (lib/siteMenuRules.js,
// 2026-11-18): the tiles on each side and what their lines say, the admin
// switches, the sections for each kind of account, you at the top, the
// "Make films?" card and the sections kept open. The app's copy is checked
// word for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/siteMenuRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const ALL_ON = { liveTvEnabled: true, podcastsEnabled: true, verticalEnabled: true, elevatorPitchEnabled: true, downloadsEnabled: true, shopEnabled: true, shopUrl: 'https://shop.example' };
const ids = (list) => list.map((x) => x.id);

t('the app copy is the website file word for word, with no imports', () => {
  const web = readFileSync(new URL('../lib/siteMenuRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/siteMenuRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
  assert.equal(web.split('\n').filter((l) => /^import\s/.test(l)).length, 0);
});

t('Connect: six tiles, the rest under See more, in order', () => {
  const m = R.siteMenu({ side: 'connect', signedIn: true, settings: ALL_ON });
  assert.deepEqual(ids(m.tiles), ['crew', 'pitch-room', 'locations', 'productions', 'university', 'resources']);
  assert.deepEqual(ids(m.more), ['swipe', 'vertical-discover', 'live', 'my-list', 'shop']);
  assert.equal(m.genres, false);
  assert.deepEqual(m.home, { href: '/', label: 'Go to the Notice Board' });
});

t('Stream: the watch places, genres, and the signed-in rows', () => {
  const m = R.siteMenu({ side: 'stream', signedIn: true, settings: ALL_ON });
  assert.deepEqual(ids(m.tiles), ['series', 'films', 'podcasts', 'live', 'my-list', 'my-recs']);
  assert.deepEqual(ids(m.more), ['continue', 'vertical', 'downloads', 'shop']);
  assert.equal(m.genres, true);
  const out = R.siteMenu({ side: 'stream', signedIn: false, settings: ALL_ON });
  assert.ok(!ids([...out.tiles, ...out.more]).includes('my-recs'));
  assert.ok(!ids([...out.tiles, ...out.more]).includes('continue'));
});

t('switched-off features leave, and nothing switched shows while settings load', () => {
  const off = { liveTvEnabled: false, podcastsEnabled: false, verticalEnabled: false, elevatorPitchEnabled: false, downloadsEnabled: false, shopEnabled: false };
  const c = R.menuTiles('connect', { settings: off });
  assert.deepEqual(ids(c), ['crew', 'locations', 'productions', 'university', 'resources', 'swipe', 'my-list']);
  const s = R.menuTiles('stream', { settings: off, signedIn: true });
  assert.deepEqual(ids(s), ['series', 'films', 'my-list', 'my-recs', 'continue']);
  const loading = R.menuTiles('connect', { settings: null });
  assert.ok(!ids(loading).includes('live') && !ids(loading).includes('pitch-room') && !ids(loading).includes('shop'));
  const shop = R.menuTiles('connect', { settings: { shopEnabled: true, shopUrl: '' } });
  assert.ok(!ids(shop).includes('shop'));
});

t('live lines from the counts, plain lines without them', () => {
  const counts = { openCalls: 12, urgent: 3, raising: 4, newPlaces: 2, places: 31, shooting: 1, liveNow: { title: 'Night Bus' } };
  const c = Object.fromEntries(R.menuTiles('connect', { settings: ALL_ON, counts }).map((x) => [x.id, x]));
  assert.equal(c.crew.line, '3 urgent · 12 open');
  assert.equal(c.crew.dot, true);
  assert.equal(c.crew.live, true);
  assert.equal(c['pitch-room'].line, '4 raising now');
  assert.equal(c.locations.line, '2 new this week');
  assert.equal(c.productions.line, '1 shooting now');
  assert.equal(c.live.line, 'On now: Night Bus');
  assert.equal(c.live.dot, true);
  assert.equal(c.university.live, false);
  const few = Object.fromEntries(R.menuTiles('connect', { settings: ALL_ON, counts: { openCalls: 1, places: 1 } }).map((x) => [x.id, x]));
  assert.equal(few.crew.line, '1 open call');
  assert.equal(few.crew.dot, false);
  assert.equal(few.locations.line, '1 place to shoot');
  const none = Object.fromEntries(R.menuTiles('connect', { settings: ALL_ON, counts: { openCalls: 0, urgent: 5, places: -2, liveNow: { title: '  ' } } }).map((x) => [x.id, x]));
  assert.equal(none.crew.line, 'Find crew, post calls');
  assert.equal(none.locations.line, 'Places to shoot');
  assert.equal(none.live.line, 'Channels, all day');
  assert.equal(none.live.dot, false);
  const plain = Object.fromEntries(R.menuTiles('connect', { settings: ALL_ON, counts, liveLines: false }).map((x) => [x.id, x]));
  assert.equal(plain.crew.line, 'Find crew, post calls');
  assert.equal(plain.crew.dot, false);
  assert.equal(plain.live.line, 'Channels, all day');
});

t('the shop tile leaves the site', () => {
  const shop = R.menuTiles('connect', { settings: ALL_ON }).find((x) => x.id === 'shop');
  assert.equal(shop.external, true);
  assert.equal(shop.href, 'https://shop.example');
});

t('sections: signed out has only Help & legal', () => {
  const s = R.menuSections({ signedIn: false });
  assert.deepEqual(ids(s), ['help']);
  assert.equal(s[0].summary, 'About, Contact, Terms, Privacy, Cookies, AI policy');
});

t('sections: a viewer gets settings, no team; their things are the Production side', () => {
  const s = R.menuSections({ signedIn: true, roles: {} });
  assert.deepEqual(ids(s), ['account', 'help']);
  const account = s.find((x) => x.id === 'account');
  assert.ok(account.rows.some((r) => r.label === 'Join Tapa +' && r.href === '/account/membership'));
  const member = R.menuSections({ signedIn: true, isSubscriber: true }).find((x) => x.id === 'account');
  assert.ok(member.rows.some((r) => r.label === 'Membership'));
});

t('sections: Team only for a content scheduler who isn\'t on the admin team', () => {
  assert.deepEqual(ids(R.menuSections({ signedIn: true, roles: { isCreator: true } })), ['account', 'help']);
  assert.deepEqual(ids(R.menuSections({ signedIn: true, roles: { isAdmin: true, canAccessAdmin: true } })), ['account', 'help']);
  assert.deepEqual(ids(R.menuSections({ signedIn: true, roles: { canAccessAdmin: true } })), ['account', 'help']);
  const sched = R.menuSections({ signedIn: true, roles: { isCreator: true, isContentScheduler: true } });
  assert.deepEqual(sched.find((x) => x.id === 'team').rows.map((r) => [r.label, r.href]), [['Channel scheduler', '/schedule']]);
  assert.equal(sched.find((x) => x.id === 'team').summary, 'Channel scheduler');
});

t('Admin: a fourth side for admins and sub-admins only', () => {
  assert.deepEqual(R.siteMenu({ signedIn: true, roles: { isAdmin: true } }).sides.map((x) => x.label), ['Connect', 'Production', 'Stream', 'Admin']);
  assert.deepEqual(R.siteMenu({ signedIn: true, roles: { canAccessAdmin: true } }).sides.map((x) => x.id), ['connect', 'production', 'stream', 'admin']);
  assert.deepEqual(R.siteMenu({ signedIn: true, roles: { isCreator: true, isContentScheduler: true } }).sides.map((x) => x.id), ['connect', 'production', 'stream']);
  assert.deepEqual(R.siteMenu({ signedIn: false, roles: { isAdmin: true } }).sides.map((x) => x.id), ['connect', 'stream']);
  assert.equal(R.siteMenu({ side: 'admin', signedIn: true, roles: { isCreator: true } }).side, 'connect');
  const m = R.siteMenu({ side: 'admin', signedIn: true, roles: { isAdmin: true } });
  assert.deepEqual(m.home, { href: '/admin', label: 'Go to the Admin home' });
  assert.deepEqual(m.tiles.map((t) => t.id), ['admin-home', 'admin-review', 'admin-shows', 'admin-library', 'admin-flags', 'admin-applications']);
  assert.deepEqual(m.more.map((t) => t.id), ['admin-accounts', 'admin-money', 'admin-payouts', 'admin-scheduler', 'admin-crew', 'admin-locations', 'admin-security', 'admin-settings']);
});

t('Admin: a sub-admin sees only the pages their capabilities open', () => {
  const tiles = (permissions, extra = {}) => R.menuTiles('admin', { signedIn: true, roles: { canAccessAdmin: true, permissions, ...extra } }).map((t) => t.id);
  assert.deepEqual(tiles(['review_submissions']), ['admin-home', 'admin-review', 'admin-shows']);
  assert.deepEqual(tiles(['handle_flags']), ['admin-home', 'admin-shows', 'admin-flags', 'admin-crew', 'admin-locations']);
  assert.deepEqual(tiles([]), []);
  assert.deepEqual(tiles(['manage_schedule']), ['admin-home', 'admin-scheduler']);
  assert.ok(tiles([], { isContentScheduler: true }).includes('admin-scheduler'));
  // Nothing full-admin-only reaches a sub-admin, whatever they hold.
  const all = tiles(['review_submissions', 'manage_artwork', 'manage_deletions', 'handle_flags', 'view_all_content', 'manage_applications', 'manage_schedule', 'manage_episodes']);
  for (const id of ['admin-accounts', 'admin-money', 'admin-payouts', 'admin-security', 'admin-settings']) assert.ok(!all.includes(id), id);
});

t('Admin: live lines from the queue counts', () => {
  const m = R.menuTiles('admin', { signedIn: true, roles: { isAdmin: true }, adminCounts: { review: 4, shows: 2, library: 0, flags: 1 } });
  const line = (id) => m.find((t) => t.id === id);
  assert.equal(line('admin-home').line, '4 to review');
  assert.equal(line('admin-review').line, '4 waiting');
  assert.equal(line('admin-shows').line, '2 waiting');
  assert.equal(line('admin-library').line, 'Titles, changes, removals');
  assert.equal(line('admin-flags').line, '1 flagged');
  assert.equal(line('admin-flags').dot, true);
  const off = R.menuTiles('admin', { signedIn: true, roles: { isAdmin: true }, adminCounts: { review: 4 }, liveLines: false });
  assert.equal(off[0].line, 'Queue, flags and numbers');
});

t('Admin: each tile\'s capabilities are the admin nav\'s for that page', () => {
  const nav = readFileSync(new URL('../lib/adminNav.js', import.meta.url), 'utf8');
  const showCaps = readFileSync(new URL('../lib/showAdminRules.js', import.meta.url), 'utf8').match(/SHOW_ADMIN_CAPS = \[([^\]]*)\]/)[1];
  const list = (text) => (text || '').split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  for (const t of R.ADMIN_TILES) {
    const line = nav.split('\n').find((l) => l.includes(`href: '${t.href}'`));
    assert.ok(line, `${t.href} is in lib/adminNav.js`);
    const m = line.match(/caps: (\[[^\]]*\]|SHOW_ADMIN_CAPS)/);
    const navCaps = !m ? null : m[1] === 'SHOW_ADMIN_CAPS' ? list(showCaps) : list(m[1].slice(1, -1));
    assert.deepEqual(t.caps || null, navCaps, t.href);
  }
});

t('Production: a third side signed in only; signed out it opens on Connect', () => {
  assert.deepEqual(R.siteMenu({ signedIn: true }).sides.map((x) => x.label), ['Connect', 'Production', 'Stream']);
  assert.deepEqual(R.siteMenu({ signedIn: false }).sides.map((x) => x.id), ['connect', 'stream']);
  const out = R.siteMenu({ side: 'production', signedIn: false });
  assert.equal(out.side, 'connect');
  const m = R.siteMenu({ side: 'production', signedIn: true });
  assert.deepEqual(m.home, { href: '/productions/mine', label: 'Go to Your productions' });
  assert.equal(m.genres, false);
});

t('Production: a viewer has their productions, working card and places, never a directory', () => {
  const m = R.siteMenu({ side: 'production', signedIn: true, roles: {} });
  assert.deepEqual(m.tiles.map((t) => [t.id, t.href]), [
    ['my-productions', '/productions/mine'],
    ['working-card', '/crew/card'],
    ['my-places', '/locations/mine'],
    ['place-requests', '/locations/requests']
  ]);
  assert.deepEqual(m.more, []);
});

t('Production: a creator with no types — productions first, then the creator pages', () => {
  const m = R.siteMenu({ side: 'production', signedIn: true, roles: { isCreator: true } });
  assert.deepEqual([...m.tiles, ...m.more].map((t) => t.id), ['my-productions', 'dashboard', 'my-work', 'working-card', 'my-pitches', 'submit', 'money', 'numbers', 'my-places', 'place-requests']);
  assert.equal(m.tiles.length, 6);
});

t('Production: the main type leads — creator, crew, cast, studio', () => {
  const ord = (types, roles = { isCreator: true }) => [...R.menuTiles('production', { signedIn: true, roles, types })].map((t) => t.id);
  assert.deepEqual(ord({ types: ['creator'], main: 'creator' }).slice(0, 6), ['dashboard', 'my-work', 'my-productions', 'my-pitches', 'submit', 'money']);
  assert.deepEqual(ord({ types: ['crew', 'creator'], main: 'crew' }).slice(0, 3), ['working-card', 'my-productions', 'dashboard']);
  assert.deepEqual(ord({ types: ['studio'], main: 'studio' }, {}), ['my-productions', 'my-places', 'place-requests', 'working-card']);
  const cast = R.menuTiles('production', { signedIn: true, roles: {}, types: { types: ['cast'], main: 'cast' } });
  assert.equal(cast[0].id, 'working-card');
  assert.equal(cast[0].line, 'Headshots and reel');
  // A main that isn't ticked, or junk, is ignored.
  assert.deepEqual(ord({ types: ['nope'], main: 'nope' }, {}), ['my-productions', 'working-card', 'my-places', 'place-requests']);
});

t('Production: who gets the creator pages; the live line on Your productions', () => {
  const ids2 = (roles) => R.menuTiles('production', { signedIn: true, roles }).map((t) => t.id);
  assert.ok(ids2({ canAccessAdmin: true }).includes('dashboard') && !ids2({ canAccessAdmin: true }).includes('my-work'));
  assert.ok(ids2({ isAdmin: true }).includes('submit') && !ids2({ isAdmin: true }).includes('numbers'));
  const t = R.menuTiles('production', { signedIn: true, running: { items: [{ id: 'a' }], total: 3 } })[0];
  assert.equal(t.line, '3 running now');
  assert.equal(t.live, true);
  const off = R.menuTiles('production', { signedIn: true, running: { items: [], total: 0 } })[0];
  assert.equal(off.line, 'Shoots you run or work on');
  assert.deepEqual(R.menuTiles('production', { signedIn: false }), []);
});

t('you at the top: name, profile link and plan', () => {
  assert.equal(R.menuProfile({ signedIn: false }), null);
  const p = R.menuProfile({ signedIn: true, displayName: '  Mara  ', profileHref: '/profile/mara', isSubscriber: false });
  assert.deepEqual(p, { name: 'Mara', href: '/profile/mara', sub: 'See your profile', plan: 'Free account', join: { href: '/account/membership', label: 'Join Tapa +' } });
  const q = R.menuProfile({ signedIn: true, displayName: '', profileHref: null, isSubscriber: true });
  assert.deepEqual(q, { name: 'Your account', href: '/account/profile', sub: 'Set up your profile', plan: 'Tapa + member', join: null });
});

t('Make films? for everyone but creators and admins; Log out only signed in', () => {
  assert.equal(R.menuApply({ roles: { isCreator: true } }), null);
  assert.equal(R.menuApply({ roles: { isAdmin: true } }), null);
  assert.equal(R.menuApply({ roles: {} }).href, '/apply');
  assert.equal(R.siteMenu({ signedIn: false }).logout, false);
  assert.equal(R.siteMenu({ signedIn: true }).logout, true);
});

t('sections kept open: only ids the menu has', () => {
  const sections = R.menuSections({ signedIn: true, roles: { isContentScheduler: true } });
  assert.deepEqual(R.keptOpen(['yours', 'team', 7, 'account'], sections), ['team', 'account']);
  assert.deepEqual(R.keptOpen('team', sections), []);
});

t('counts are read again after two minutes', () => {
  const now = 1_000_000;
  assert.equal(R.countsFresh(now - 60_000, now), true);
  assert.equal(R.countsFresh(now - 3 * 60_000, now), false);
  assert.equal(R.countsFresh(undefined, now), false);
});

t('Running now: two productions, their lines and what needs you; only signed in, only with one', () => {
  const A = '11111111-2222-4333-8444-555555555555';
  const B = '22222222-2222-4333-8444-555555555555';
  const C = '33333333-2222-4333-8444-555555555555';
  const running = { items: [
    { id: A, title: 'Night Bus', line: 'Prep · shooting Dec 6', needsYou: 4 },
    { id: B, title: 'Paper Moons', line: 'Post', needsYou: 1 },
    { id: C, title: 'Third', line: 'Prep', needsYou: 0 },
    { id: '../evil', title: 'Bad id', line: '', needsYou: 0 }
  ], total: 3 };
  const card = R.menuRunning(running);
  assert.equal(card.title, 'Running now');
  assert.equal(card.count, '3 productions');
  assert.deepEqual(card.items.map((x) => [x.title, x.line, x.needs, x.href, x.primary]), [
    ['Night Bus', 'Prep · shooting Dec 6', '4 need you', `/productions/${A}/dashboard`, true],
    ['Paper Moons', 'Post', '1 needs you', `/productions/${B}/dashboard`, false]
  ]);
  assert.deepEqual(card.all, { href: '/productions/mine', label: 'All your productions' });
  assert.equal(R.menuRunning({ items: [], total: 0 }), null);
  assert.equal(R.menuRunning(null), null);
  assert.equal(R.menuRunning({ items: [{ id: A, title: 'One', line: 'Post', needsYou: 0 }] }).count, '1 production');
  assert.equal(R.menuRunning({ items: [{ id: A, title: 'One', line: 'Post', needsYou: 0 }] }).items[0].needs, null);
  assert.ok(R.siteMenu({ side: 'stream', signedIn: true, running }).running);
  assert.ok(R.siteMenu({ side: 'connect', signedIn: true, running }).running);
  assert.equal(R.siteMenu({ signedIn: false, running }).running, null);
  assert.equal(R.siteMenu({ signedIn: true }).running, null);
});

t('the side follows the page', () => {
  assert.equal(R.menuSide(true), 'stream');
  assert.equal(R.menuSide(false), 'connect');
  // Your own work pages open on Production (signed in), the website's paths and the app's.
  for (const p of ['/productions/mine', '/productions/abc/dashboard?tab=crew', '/creator/dashboard', '/creator/my-work', '/account/my-work', '/crew/card', '/locations/mine', '/locations/requests/123']) {
    assert.equal(R.menuSideFor({ pathname: p, signedIn: true }), 'production', p);
  }
  assert.equal(R.menuSideFor({ pathname: '/creator/dashboard', signedIn: false }), 'connect');
  for (const p of ['/productions', '/productions/abc', '/crew', '/locations', '/creatorx']) assert.equal(R.menuSideFor({ pathname: p, signedIn: true }), 'connect', p);
  assert.equal(R.menuSideFor({ pathname: '/stream', inStream: true, signedIn: true }), 'stream');
  // An admin page opens on Admin for the admin team; for anyone else it stays Connect.
  for (const p of ['/admin', '/admin/shows/abc', '/schedule', '/ad-plan/x']) assert.equal(R.menuSideFor({ pathname: p, signedIn: true, roles: { canAccessAdmin: true } }), 'admin', p);
  assert.equal(R.menuSideFor({ pathname: '/admin', signedIn: true, roles: {} }), 'connect');
  assert.equal(R.menuSideFor({ pathname: '/adminx', signedIn: true, roles: { isAdmin: true } }), 'connect');
});

console.log(`\n${n} checks passed`);
