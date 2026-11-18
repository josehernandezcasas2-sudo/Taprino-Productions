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

t('sections: a viewer gets their things and settings, no creator or team', () => {
  const s = R.menuSections({ signedIn: true, roles: {} });
  assert.deepEqual(ids(s), ['yours', 'account', 'help']);
  const account = s.find((x) => x.id === 'account');
  assert.ok(account.rows.some((r) => r.label === 'Join Tapa +' && r.href === '/account/membership'));
  const member = R.menuSections({ signedIn: true, isSubscriber: true }).find((x) => x.id === 'account');
  assert.ok(member.rows.some((r) => r.label === 'Membership'));
});

t('sections: a creator, an admin, a sub-admin and a scheduler', () => {
  const creator = R.menuSections({ signedIn: true, roles: { isCreator: true } });
  assert.deepEqual(ids(creator), ['yours', 'creator', 'account', 'help']);
  assert.deepEqual(creator[1].rows.map((r) => r.label), ['Dashboard', 'Your work', 'Submit your work', 'Your numbers', 'Money']);
  const admin = R.menuSections({ signedIn: true, roles: { isAdmin: true, canAccessAdmin: true } });
  assert.deepEqual(ids(admin), ['yours', 'creator', 'team', 'account', 'help']);
  assert.deepEqual(admin[1].rows.map((r) => r.label), ['Dashboard', 'Your work', 'Submit your work', 'Money']);
  assert.deepEqual(admin[2].rows.map((r) => r.label), ['Admin Portal', 'Channel scheduler']);
  const sub = R.menuSections({ signedIn: true, roles: { canAccessAdmin: true } });
  assert.deepEqual(sub.find((x) => x.id === 'creator').rows.map((r) => r.label), ['Dashboard']);
  assert.deepEqual(sub.find((x) => x.id === 'team').rows.map((r) => r.label), ['Admin Portal']);
  const sched = R.menuSections({ signedIn: true, roles: { isCreator: true, isContentScheduler: true } });
  assert.deepEqual(sched.find((x) => x.id === 'team').rows.map((r) => r.label), ['Channel scheduler']);
  assert.equal(admin[2].summary, 'Admin Portal, Channel scheduler');
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
  const sections = R.menuSections({ signedIn: true, roles: { isCreator: true } });
  assert.deepEqual(R.keptOpen(['yours', 'team', 7, 'creator'], sections), ['yours', 'creator']);
  assert.deepEqual(R.keptOpen('yours', sections), []);
});

t('counts are read again after two minutes', () => {
  const now = 1_000_000;
  assert.equal(R.countsFresh(now - 60_000, now), true);
  assert.equal(R.countsFresh(now - 3 * 60_000, now), false);
  assert.equal(R.countsFresh(undefined, now), false);
});

t('the side follows the page', () => {
  assert.equal(R.menuSide(true), 'stream');
  assert.equal(R.menuSide(false), 'connect');
});

console.log(`\n${n} checks passed`);
