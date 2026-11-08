#!/usr/bin/env node
// The cleanup round's moderation and review-queue changes:
//   /admin/content's "Gone" rows and "The item is gone — close its reports"
//   the nav's flags badge (/api/admin/queue-counts): one per item, tip notes
//     and gone items left out
//   Restore's words to the owner ("Nothing needs to change" when never pulled)
//   the review queue's Approve with `seen` (409 `changed` when the file moved)
//   node dev/test-rig/checks/moderation-cleanup.mjs
import crypto from 'node:crypto';
import { IDS, USERS, RUN, ok, section, runCheck, call, sql, rows, q, insert, session, browser, goto, ago, uidFor, clerk, FAKES } from './lib.mjs';

const ADMIN = session(USERS.admin);
const SUB = session(USERS.sub);
const ID = {
  ep: `ck-mod-ep-${RUN}`,
  held: `ck-mod-held-${RUN}`,
  gone: `ck-mod-gone-${RUN}`,
  show: `ck-mod-show-${RUN}`,
  showEp: `ck-mod-sep-${RUN}`,
  film: `ck-mod-film-${RUN}`
};
const GONE_PLACE = crypto.randomUUID();
// An account reported from Messages that never saved a profile (no
// user_profiles row) is still there; one Clerk no longer has is gone.
const LIVE_ACCOUNT = `user_rigckdm${RUN}`;
const GONE_ACCOUNT = `user_rigckgone${RUN}`;
const TIP = crypto.randomUUID();
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const title = (id, extra) => ({
  id, title: `Check moderation ${id.slice(7, 11)} ${RUN}`, description: 'Moderation check.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'short', artist: 'Dee Park',
  runtime: '9:00', rating: 'TV-PG', release_year: 2026, src: src(IDS.short), video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, deletion_requested: false,
  moderation_hold: false, submitted_by: USERS.dee, status: 'approved', reviewed_at: ago(4), released_at: ago(4), created_at: ago(5), ...extra
});
const report = (type, id, who, reason = 'spam') => insert('content_reports', { target_type: type, target_id: id, reporter_id: who, reason, status: 'open' });
const flag = (type, id, reason = 'copyright') => insert('content_flags', { target_type: type, target_id: id, reason, flagged_by: USERS.admin, email_owner: false });

async function seed() {
  await clerk('/__users', { method: 'POST', body: { id: LIVE_ACCOUNT, email: `dm-${RUN}@rig.example.com`, firstName: 'Dm', createdDaysAgo: 40 } });
  report('profile', LIVE_ACCOUNT, USERS.viewer, 'hate');
  report('profile', GONE_ACCOUNT, USERS.viewer, 'hate');
  // Flagged, so pulled (flagContent sets moderation_hold the same way).
  insert('episodes', title(ID.ep, { moderation_hold: true }));
  insert('episodes', title(ID.held, {}));
  insert('series', { id: ID.show, name: `Check Mod Show ${RUN}`, description: 'A private show.', creator_id: USERS.dee, status: 'pending', kind: 'series', submitted_by_user_id: USERS.dee, created_at: ago(6), deletion_requested: false, moderation_hold: false });
  insert('episodes', title(ID.showEp, { content_type: 'series', series_id: ID.show, season: 1, series_order: 1, status: 'pending', reviewed_at: null, released_at: null, src: src(IDS.lineCooksE1) }));
  insert('episodes', title(ID.film, { content_type: 'movie', status: 'pending', reviewed_at: null, released_at: null, src: src(IDS.film), submitted_by: USERS.mara, artist: 'Mara Reyes' }));
  // One item with a flag and two reports; a gone title and a gone place; a tip note.
  report('episode', ID.ep, USERS.viewer);
  report('episode', ID.ep, USERS.mara, 'copyright');
  flag('episode', ID.ep);
  report('episode', ID.gone, USERS.viewer);
  report('episode', ID.gone, USERS.mara);
  flag('episode', ID.gone);
  report('location', GONE_PLACE, USERS.viewer);
  report('tip', TIP, USERS.viewer);
}
function cleanup() {
  const ids = [...Object.values(ID), GONE_PLACE, TIP, LIVE_ACCOUNT, GONE_ACCOUNT].map(q).join(', ');
  sql(`delete from public.content_reports where target_id in (${ids})`);
  sql(`delete from public.content_flags where target_id in (${ids})`);
  sql(`delete from public.content_moderation where target_id in (${ids})`);
  sql(`delete from public.notifications where episode_id in (${ids}) or message like '%Check moderation%' or message like '%Check Mod Show%'`);
  sql(`delete from public.audit_log where target_id in (${ids})`);
  sql(`delete from public.episodes where id in (${ids})`);
  sql(`delete from public.series where id = ${q(ID.show)}`);
}
const flagsBadge = async () => {
  const r = await call('/api/admin/queue-counts', { who: ADMIN });
  return r.status === 200 && r.json ? r.json.flags : null;
};

async function badge(baseline) {
  section('The flags badge (/api/admin/queue-counts)');
  const n = await flagsBadge();
  ok('an item with a flag and two reports counts once, a reported account without a profile row once; gone items and the tip note not at all', n === baseline + 2, `baseline ${baseline}, now ${n}`);
  const c = await call('/api/admin/content', { who: ADMIN });
  const mod = c.json && c.json.moderation;
  const missing = mod && Array.isArray(mod.missing) ? mod.missing.map((m) => m.key) : [];
  ok('/api/admin/content lists the gone title apart', missing.includes(`episode:${ID.gone}`), missing);
  ok('…and the gone place', missing.includes(`location:${GONE_PLACE}`), missing);
  ok('…never the tip note, never a title that exists', !missing.includes(`tip:${TIP}`) && !missing.includes(`episode:${ID.ep}`), missing);
  ok('…never an account that is still there (reported from Messages, no profile row)', !missing.includes(`profile:${LIVE_ACCOUNT}`), missing);
  ok('…but an account Clerk no longer has is gone', missing.includes(`profile:${GONE_ACCOUNT}`), missing);
  const gone = mod && mod.missing ? mod.missing.find((m) => m.key === `episode:${ID.gone}`) : null;
  ok('the gone title’s row counts 2 reports and 1 flag', gone && gone.reports === 2 && gone.flags === 1, gone);
}

async function closeMissing(b) {
  section('/admin/content: a gone item’s reports closed');
  let r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'episode', targetId: ID.ep, action: 'close_missing' } });
  ok('close_missing on an item that exists → 409', r.status === 409, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/admin/content', { who: SUB, method: 'POST', body: { op: 'decide', targetType: 'episode', targetId: ID.gone, action: 'close_missing' } });
  ok('a sub-admin without handle_flags can’t close them → 403', r.status === 403, r.status);
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'tip', targetId: TIP, action: 'close_missing' } });
  ok('a tip note’s reports are left to Admin → Tips (400)', r.status === 400, `${r.status} ${r.text.slice(0, 160)}`);
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'nonsense', targetId: 'x', action: 'close_missing' } });
  ok('an unknown type → 400', r.status === 400, r.status);

  const { ctx, page: pg, errors } = await b.open(ADMIN, 1280);
  await goto(pg, '/admin/content');
  const row = pg.locator(`.ac-qitem[data-target="episode:${ID.gone}"]`);
  await row.waitFor({ timeout: 60000 }).catch(() => {});
  ok('the queue shows the gone title as a Gone row', (await row.count()) === 1 && /\bgone\b/i.test(await row.innerText()));
  ok('…with "2 open reports" and "1 open flag"', /2 open reports/.test(await row.innerText().catch(() => '')) && /1 open flag/.test(await row.innerText().catch(() => '')));
  const btn = row.locator('button', { hasText: 'The item is gone — close its reports' });
  ok('…and the button', (await btn.count()) === 1);
  await btn.click();
  await pg.waitForTimeout(2500);
  ok('the row is gone from the page after closing', (await pg.locator(`.ac-qitem[data-target="episode:${ID.gone}"]`).count()) === 0);
  ok('no page errors on /admin/content', errors.length === 0, errors);
  await ctx.close();

  const reps = rows(`select status, resolved_at from public.content_reports where target_type = 'episode' and target_id = ${q(ID.gone)}`);
  ok('its reports are closed as upheld', reps.length === 2 && reps.every((x) => x.status === 'upheld' && x.resolved_at), reps);
  const fl = rows(`select resolved_at, resolution, resolved_by from public.content_flags where target_type = 'episode' and target_id = ${q(ID.gone)}`);
  ok('its flag is resolved as removed, by the admin', fl.length === 1 && fl[0].resolved_at && fl[0].resolution === 'removed' && fl[0].resolved_by === USERS.admin, fl);
  const audit = rows(`select action, details from public.audit_log where target_id = ${q(ID.gone)}`);
  ok('one audit line says what was closed', audit.length === 1 && audit[0].action === 'content_close_missing' && /closed 2 reports and 1 flag/.test(audit[0].details || ''), audit);
  const told = rows(`select id from public.notifications where message like '%${ID.gone}%'`);
  ok('nobody is told', told.length === 0);
  const c = await call('/api/admin/content', { who: ADMIN });
  ok('it is no longer listed as gone', !(c.json.moderation.missing || []).some((m) => m.key === `episode:${ID.gone}`));
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'location', targetId: GONE_PLACE, action: 'close_missing' } });
  ok('the gone place: closed through the route too', r.status === 200 && rows(`select status from public.content_reports where target_id = ${q(GONE_PLACE)}`).every((x) => x.status === 'upheld'), r.status);
}

async function restoreWords() {
  section('Restore: what the owner reads');
  sql(`delete from public.notifications where user_id = ${q(USERS.dee)} and type = 'moderation'`);
  let r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'episode', targetId: ID.ep, action: 'restore' } });
  ok('"Looks fine, clear" on a title that was flagged (held) → 200', r.status === 200, r.text.slice(0, 200));
  let n = rows(`select message from public.notifications where user_id = ${q(USERS.dee)} and type = 'moderation' and episode_id = ${q(ID.ep)} order by created_at desc limit 1`)[0];
  // ID.ep was flagged in the seed, so it was pulled (moderation_hold): it is back up.
  ok('a flagged title restored → "was reviewed and is back up"', n && /was reviewed and is back up/.test(n.message), n);
  // A title that only had reports (never pulled).
  report('episode', ID.held, USERS.viewer);
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'episode', targetId: ID.held, action: 'restore' } });
  n = rows(`select message from public.notifications where user_id = ${q(USERS.dee)} and type = 'moderation' and episode_id = ${q(ID.held)} order by created_at desc limit 1`)[0];
  ok('a never-pulled title → "Reports on … were reviewed. Nothing needs to change."', r.status === 200 && n && /^Reports on “Check moderation .*” were reviewed\. Nothing needs to change\.$/.test(n.message), n);
  ok('…its reports are closed', rows(`select status from public.content_reports where target_id = ${q(ID.held)} and status = 'open'`).length === 0);
  // Flag it (pulled), then restore: back up.
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'flag', targetType: 'episode', targetId: ID.held, reason: 'copyright', note: 'check', emailOwner: false } });
  ok('flagging pulls it (moderation_hold)', r.status === 200 && rows(`select moderation_hold from public.episodes where id = ${q(ID.held)}`)[0].moderation_hold === true, r.status);
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'episode', targetId: ID.held, action: 'restore' } });
  n = rows(`select message from public.notifications where user_id = ${q(USERS.dee)} and type = 'moderation' and episode_id = ${q(ID.held)} order by created_at desc limit 1`)[0];
  ok('a pulled title restored → "was reviewed and is back up"', r.status === 200 && n && /was reviewed and is back up/.test(n.message), n);
  ok('…and it is live again', rows(`select moderation_hold from public.episodes where id = ${q(ID.held)}`)[0].moderation_hold === false);
  // A title taken down (rejected), then cleared: never "back up".
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'flag', targetType: 'episode', targetId: ID.held, reason: 'copyright', note: 'again', emailOwner: false } });
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'episode', targetId: ID.held, action: 'take_down', note: 'Rights unclear.' } });
  ok('take down → 200', r.status === 200, r.text.slice(0, 200));
  report('episode', ID.held, USERS.mara);
  r = await call('/api/admin/content', { who: ADMIN, method: 'POST', body: { op: 'decide', targetType: 'episode', targetId: ID.held, action: 'restore' } });
  n = rows(`select message from public.notifications where user_id = ${q(USERS.dee)} and type = 'moderation' and episode_id = ${q(ID.held)} order by created_at desc limit 1`)[0];
  ok('a taken-down title cleared → never "back up"', r.status === 200 && n && !/back up/.test(n.message), n);
}

async function queueSeen() {
  section('The review queue’s Approve with `seen`');
  let r = await call('/api/admin/review-queue', { who: ADMIN });
  const item = (id) => (r.json && r.json.items ? r.json.items.find((i) => i.id === id) : null);
  const showItem = item(ID.showEp);
  const filmItem = item(ID.film);
  ok('the show episode is in the queue with meta.seen', showItem && typeof showItem.meta.seen === 'string' && showItem.meta.seen.length === 16, showItem && showItem.meta);
  ok('the standalone film is in the queue with meta.seen', filmItem && typeof filmItem.meta.seen === 'string', filmItem && filmItem.meta);
  const decide = (id, seen) => call('/api/admin/review-queue', { who: ADMIN, method: 'POST', body: { kind: 'submission', id, decision: 'approve', tierOverride: 'free', ...(seen !== undefined ? { seen } : {}) } });
  r = await decide(ID.showEp, '0123456789abcdef');
  ok('show episode, a stale seen → 409 changed', r.status === 409 && r.json && r.json.code === 'changed', `${r.status} ${r.text.slice(0, 200)}`);
  ok('…nothing approved', rows(`select status from public.episodes where id = ${q(ID.showEp)}`)[0].status === 'pending');
  r = await decide(ID.film, '0123456789abcdef');
  ok('standalone film, a stale seen → 409 changed', r.status === 409 && r.json && r.json.code === 'changed', `${r.status} ${r.text.slice(0, 200)}`);
  ok('…nothing approved', rows(`select status from public.episodes where id = ${q(ID.film)}`)[0].status === 'pending');
  r = await decide(ID.showEp, showItem.meta.seen);
  ok('show episode, the current seen → approved', r.status === 200 && rows(`select status from public.episodes where id = ${q(ID.showEp)}`)[0].status === 'approved', `${r.status} ${r.text.slice(0, 200)}`);
  r = await decide(ID.film, filmItem.meta.seen);
  ok('standalone film, the current seen → approved', r.status === 200 && rows(`select status from public.episodes where id = ${q(ID.film)}`)[0].status === 'approved', `${r.status} ${r.text.slice(0, 200)}`);
  // An older page or app sends no seen: approves as before.
  sql(`update public.episodes set status = 'pending', reviewed_at = null, reviewed_by = null, released_at = null where id = ${q(ID.film)}`);
  r = await decide(ID.film, undefined);
  ok('no seen (an older client) → approved as before', r.status === 200 && rows(`select status from public.episodes where id = ${q(ID.film)}`)[0].status === 'approved', `${r.status} ${r.text.slice(0, 200)}`);
  // A file replaced after the card loaded.
  sql(`update public.episodes set status = 'pending', reviewed_at = null, reviewed_by = null, released_at = null where id = ${q(ID.film)}`);
  r = await call('/api/admin/review-queue', { who: ADMIN });
  const seenBefore = item(ID.film) && item(ID.film).meta.seen;
  sql(`update public.episodes set src = ${q(src(IDS.short))} where id = ${q(ID.film)}`);
  r = await decide(ID.film, seenBefore);
  ok('a file replaced since the card loaded → 409 changed', r.status === 409 && r.json && r.json.code === 'changed', `${r.status} ${r.text.slice(0, 200)}`);
}

await runCheck('moderation-cleanup', async () => {
  cleanup();
  const baseline = await flagsBadge();
  ok('queue-counts answers for the admin', typeof baseline === 'number', baseline);
  await seed();
  const b = await browser();
  try {
    await badge(baseline);
    await closeMissing(b);
    await restoreWords();
    await queueSeen();
  } finally {
    await b.close();
    cleanup();
    await fetch(`${FAKES.clerk}/v1/users/${LIVE_ACCOUNT}`, { method: 'DELETE', headers: { Authorization: 'Bearer sk_test_rig' } }).catch(() => {});
  }
});
