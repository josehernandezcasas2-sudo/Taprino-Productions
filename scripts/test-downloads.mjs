// node scripts/test-downloads.mjs — downloads in the app, the rules
// (lib/downloadRules.js, 2026-11-14) and the app's copy
// (mobile/src/lib/downloadRules.js): the copy is checked word for word,
// then every case runs on both.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as web from '../lib/downloadRules.js';

const webSource = readFileSync(new URL('../lib/downloadRules.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../mobile/src/lib/downloadRules.js', import.meta.url), 'utf8');
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('the app copy is the website file word for word', () => {
  assert.equal(appSource, webSource);
});

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 14, 18, 0, 0); // Nov 14, 2026
const at = (days) => NOW + days * DAY;

for (const [label, lib] of [['web', web], ['app', app]]) {
  t(`${label}: Premium, Sponsor and the team carry downloads; Standard and Basic don't`, () => {
    assert.equal(lib.planCarriesDownloads({ tier: 'premium' }), true);
    assert.equal(lib.planCarriesDownloads({ tier: 'sponsor' }), true);
    assert.equal(lib.planCarriesDownloads({ tier: 'standard' }), false);
    assert.equal(lib.planCarriesDownloads({ tier: 'basic' }), false);
    assert.equal(lib.planCarriesDownloads({}), false);
    assert.equal(lib.planCarriesDownloads({ tier: 'basic', isAdmin: true }), true);
  });

  t(`${label}: the Download button, by switch, title, sign-in, purchase and plan`, () => {
    const base = { enabled: true, downloadable: true, allowed: true, signedIn: true, tier: 'premium' };
    assert.deepEqual(lib.downloadOffer(base), { state: 'ok', basis: 'member' });
    assert.deepEqual(lib.downloadOffer({ ...base, tier: 'sponsor' }), { state: 'ok', basis: 'member' });
    assert.deepEqual(lib.downloadOffer({ ...base, tier: 'standard' }), { state: 'plan' });
    assert.deepEqual(lib.downloadOffer({ ...base, tier: 'basic' }), { state: 'plan' });
    assert.deepEqual(lib.downloadOffer({ ...base, tier: 'basic', owned: true }), { state: 'ok', basis: 'owned' });
    // A member who also bought it: the purchase wins (it never needs a plan).
    assert.deepEqual(lib.downloadOffer({ ...base, owned: true }), { state: 'ok', basis: 'owned' });
    assert.deepEqual(lib.downloadOffer({ ...base, tier: 'basic', isAdmin: true }), { state: 'ok', basis: 'member' });
    assert.deepEqual(lib.downloadOffer({ ...base, signedIn: false }), { state: 'signin' });
    assert.deepEqual(lib.downloadOffer({ ...base, enabled: false }), { state: 'hidden', reason: 'off' });
    assert.deepEqual(lib.downloadOffer({ ...base, enabled: false, owned: true }), { state: 'hidden', reason: 'off' });
    assert.deepEqual(lib.downloadOffer({ ...base, downloadable: false }), { state: 'hidden', reason: 'kind' });
    assert.deepEqual(lib.downloadOffer({ ...base, allowed: false }), { state: 'hidden', reason: 'title' });
    assert.deepEqual(lib.downloadOffer({ ...base, allowed: false, owned: true }), { state: 'hidden', reason: 'title' });
    // Nothing given: nothing shown.
    assert.deepEqual(lib.downloadOffer(), { state: 'hidden', reason: 'off' });
    // A missing creator switch reads as allowed (a title from before the column).
    assert.deepEqual(lib.downloadOffer({ ...base, allowed: undefined }), { state: 'ok', basis: 'member' });
    assert.equal(lib.downloadableKind('podcast'), false);
    assert.equal(lib.downloadableKind('movie'), true);
    assert.equal(lib.downloadableKind(undefined), true);
  });

  t(`${label}: a member's copy runs to the end of the paid month plus two days`, () => {
    assert.equal(lib.licensedUntil({ basis: 'member', now: NOW, paidThrough: at(10) }), at(12));
    assert.equal(lib.licensedUntil({ basis: 'member', now: NOW, paidThrough: new Date(at(10)).toISOString() }), at(12));
    // The month ends in an hour: two days from then.
    assert.equal(lib.licensedUntil({ basis: 'member', now: NOW, paidThrough: NOW + 3600000 }), NOW + 3600000 + 2 * DAY);
  });
  t(`${label}: never longer than a month without connecting, whatever the billing period`, () => {
    // A yearly plan: still 31 days + the grace.
    assert.equal(lib.licensedUntil({ basis: 'member', now: NOW, paidThrough: at(300) }), at(33));
    assert.equal(lib.licensedUntil({ basis: 'member', now: NOW, paidThrough: at(31) }), at(33));
    assert.equal(lib.licensedUntil({ basis: 'member', now: NOW, paidThrough: at(32) }), at(33));
  });
  t(`${label}: a paid-through date already past (a renewal in flight) gives the grace from now`, () => {
    assert.equal(lib.licensedUntil({ basis: 'member', now: NOW, paidThrough: at(-1) }), at(2));
  });
  t(`${label}: no paid-through date (the team, comped, promo) and bought titles check in every 30 days`, () => {
    assert.equal(lib.licensedUntil({ basis: 'member', now: NOW, paidThrough: null }), at(30));
    assert.equal(lib.licensedUntil({ basis: 'member', now: NOW, paidThrough: 'not a date' }), at(30));
    assert.equal(lib.licensedUntil({ basis: 'owned', now: NOW, paidThrough: at(5) }), at(30));
  });

  t(`${label}: the check-in verdict`, () => {
    const on = { enabled: true, titleOk: true };
    assert.deepEqual(lib.syncVerdict({ ...on, planOk: true, basis: 'member' }), { state: 'ok', basis: 'member' });
    assert.deepEqual(lib.syncVerdict({ ...on, planOk: false, basis: 'member' }), { state: 'ended' });
    assert.deepEqual(lib.syncVerdict({ ...on, owned: true, planOk: false, basis: 'owned' }), { state: 'ok', basis: 'owned' });
    // A member copy of a title they have since bought: it's theirs now.
    assert.deepEqual(lib.syncVerdict({ ...on, owned: true, planOk: false, basis: 'member' }), { state: 'ok', basis: 'owned' });
    // A bought copy refunded: gone for someone with no plan, a member copy for a member.
    assert.deepEqual(lib.syncVerdict({ ...on, owned: false, planOk: false, basis: 'owned' }), { state: 'revoked', reason: 'refund' });
    assert.deepEqual(lib.syncVerdict({ ...on, owned: false, planOk: true, basis: 'owned' }), { state: 'ok', basis: 'member' });
    // The title went away, or its creator switched downloads off: before anything else.
    assert.deepEqual(lib.syncVerdict({ ...on, titleOk: false, owned: true, planOk: true }), { state: 'revoked', reason: 'title' });
    assert.deepEqual(lib.syncVerdict({ enabled: false, titleOk: false, planOk: true }), { state: 'revoked', reason: 'title' });
    // The admin switch off: nothing is renewed, nothing is taken away.
    assert.deepEqual(lib.syncVerdict({ enabled: false, titleOk: true, planOk: true }), { state: 'paused' });
    assert.deepEqual(lib.syncVerdict({ enabled: false, titleOk: true, owned: true }), { state: 'paused' });
  });

  t(`${label}: limits`, () => {
    assert.equal(lib.titleLimitReached(24), false);
    assert.equal(lib.titleLimitReached(25), true);
    assert.equal(lib.deviceLimitReached(1), false);
    assert.equal(lib.deviceLimitReached(2), true);
    assert.equal(lib.keepUntil(NOW), at(30));
    assert.equal(lib.keepUntil(null), null);
  });

  t(`${label}: on the phone — plays until the date, locks after it`, () => {
    const until = at(12);
    assert.deepEqual(lib.playState({ now: NOW, licensedUntil: until, lastSeenAt: NOW }), { ok: true });
    assert.deepEqual(lib.playState({ now: until, licensedUntil: until, lastSeenAt: NOW }), { ok: true });
    assert.deepEqual(lib.playState({ now: until + 1, licensedUntil: until, lastSeenAt: NOW }), { ok: false, reason: 'expired' });
    assert.deepEqual(lib.playState({ now: NOW, licensedUntil: null }), { ok: false, reason: 'expired' });
    assert.deepEqual(lib.playState({ now: NOW, licensedUntil: new Date(until).toISOString(), lastSeenAt: new Date(NOW).toISOString() }), { ok: true });
  });
  t(`${label}: on the phone — a clock set back doesn't buy more time`, () => {
    const until = at(12);
    // Seen on day 20 (already expired), clock put back to day 5.
    assert.deepEqual(lib.playState({ now: at(5), licensedUntil: until, lastSeenAt: at(20) }), { ok: false, reason: 'clock' });
    // A few minutes of drift is fine.
    assert.deepEqual(lib.playState({ now: NOW - 5 * 60000, licensedUntil: until, lastSeenAt: NOW }), { ok: true });
    assert.deepEqual(lib.playState({ now: NOW - 11 * 60000, licensedUntil: until, lastSeenAt: NOW }), { ok: false, reason: 'clock' });
    assert.equal(lib.highWater(at(20), at(5)), at(20));
    assert.equal(lib.highWater(at(5), at(20)), at(20));
    assert.equal(lib.highWater(null, NOW), NOW);
  });
  t(`${label}: on the phone — taken back, cleared, ended, in that order`, () => {
    const live = { now: NOW, licensedUntil: at(12), lastSeenAt: NOW };
    assert.deepEqual(lib.playState({ ...live, revoked: true, ended: true, missing: true }), { ok: false, reason: 'revoked' });
    assert.deepEqual(lib.playState({ ...live, missing: true, ended: true }), { ok: false, reason: 'missing' });
    assert.deepEqual(lib.playState({ ...live, ended: true }), { ok: false, reason: 'ended' });
    assert.equal(lib.removeDue({ now: at(31), keepUntil: at(30) }), true);
    assert.equal(lib.removeDue({ now: at(30), keepUntil: at(30) }), false);
    assert.equal(lib.removeDue({ now: at(99), keepUntil: null }), false);
  });

  t(`${label}: words`, () => {
    const dec14 = new Date(2026, 11, 14, 12).getTime();
    const jan3 = new Date(2027, 0, 3, 12).getTime();
    assert.equal(lib.untilLabel(dec14, NOW), 'Dec 14');
    assert.equal(lib.untilLabel(jan3, NOW), 'Jan 3, 2027');
    assert.equal(lib.untilLabel(null), '');
    assert.equal(lib.untilChip(dec14, NOW), 'Plays offline until Dec 14');
    assert.equal(lib.untilChip(null), '');
    assert.equal(lib.bytesLabel(310 * 1024 * 1024), '310 MB');
    assert.equal(lib.bytesLabel(1.1 * 1024 * 1024 * 1024), '1.1 GB');
    assert.equal(lib.bytesLabel(2 * 1024 * 1024 * 1024), '2 GB');
    assert.equal(lib.bytesLabel(12.4 * 1024 * 1024 * 1024), '12 GB');
    assert.equal(lib.bytesLabel(1000), '1 MB');
    assert.equal(lib.bytesLabel(0), '');
    assert.equal(lib.bytesLabel(undefined), '');
    const expired = lib.lockCard('expired', { paidThrough: dec14, now: NOW });
    assert.equal(expired.title, 'Connect to keep watching');
    assert.match(expired.body, /Your month ended on Dec 14 and this phone hasn’t been online since/);
    assert.equal(expired.action, 'retry');
    assert.match(lib.lockCard('expired', {}).body, /hasn’t been online for 30 days/);
    assert.equal(lib.lockCard('clock').action, 'retry');
    const ended = lib.lockCard('ended', { endedAt: dec14, now: NOW });
    assert.equal(ended.title, 'Your membership ended on Dec 14');
    assert.equal(ended.action, 'plans');
    assert.equal(lib.lockCard('ended', {}).title, 'Your plan doesn’t include downloads');
    assert.equal(lib.lockCard('missing').action, 'download');
    assert.equal(lib.lockCard('revoked').action, null);
    assert.equal(lib.lockCard('anything else').title, lib.DOWNLOAD_WORDS.off);
    assert.match(lib.DOWNLOAD_WORDS.titleLimit, /25 downloads/);
    assert.match(lib.DOWNLOAD_WORDS.deviceLimit, /2 phones/);
  });
}

console.log(`\n${n} checks passed`);
