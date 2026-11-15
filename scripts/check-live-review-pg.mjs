// Every change to a live title is reviewed (2026-11-15): the writes of
// lib/showPage.js updateEpisode / updateShow / setEpisodeCaptions / the
// cancel paths, lib/stagedChanges.js decideStaged and
// pages/api/admin/edit-episode.js, as the SQL PostgREST sends them, on a
// real Postgres built through migration 124 — pending_fields as one jsonb
// object guarded whole (a stale read matches nothing), each detail landing
// in its column with its type on approval, captions swapped, a show's
// season names (an array) and credits (an object), the admin route's
// waiting columns. Needs PGlite (see scripts/pg-chain.mjs):
//   node scripts/check-live-review-pg.mjs
import assert from 'node:assert/strict';
import { buildDb } from './pg-chain.mjs';
import * as L from '../lib/liveReviewRules.js';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };
const db = await buildDb(124);
const q = (sql, p = []) => db.query(sql, p);
const json = (v) => JSON.stringify(v);

await q(`insert into series (id, name, status, creator_id, kind, seasons, credits) values ('night-bus-show', 'Night Bus', 'approved', 'user_mara', 'series', '[{"number":1,"name":"Pilot"}]'::jsonb, '{}'::jsonb)`);
await q(`insert into episodes (id, title, content_type, series_id, season, series_order, status, submitted_by, genre, main_genre, release_year, runtime, ads_enabled, ad_break_seconds, credits, captions_url, captions_label, captions_language)
  values ('transfer-lx3k9a', 'Transfer', 'series', 'night-bus-show', 1, 1, 'approved', 'user_mara', 'Noir', 'Drama', 2024, '22:04', false, '[0]'::jsonb, '{}'::jsonb, 'private:captions/transfer-old.vtt', 'English', 'en')`);
ok('a live show and a live episode');

// updateEpisode: the first staged write (nothing waits: is null), guarded by status.
const ep0 = { pending_fields: null };
const pf1 = L.nextPendingFields(ep0, 'episode', { genre: 'Cosmic Horror', releaseYear: 2025, adBreakSeconds: [0, 600], adsEnabled: true, credits: { studio: { name: 'Night Owl', userId: null } }, extraKind: null });
let r = await q(`update episodes set pending_fields = $1::jsonb where id = 'transfer-lx3k9a' and status = 'approved' and pending_fields is null returning id`, [json(pf1)]);
assert.equal(r.rows.length, 1);
ok('a staged save writes pending_fields (an object)');

// A second save: guarded by the whole object (PostgREST eq on jsonb).
const ep1 = (await q(`select * from episodes where id = 'transfer-lx3k9a'`)).rows[0];
assert.deepEqual(L.pendingFieldsOf(ep1, 'episode'), pf1);
const pf2 = L.nextPendingFields(ep1, 'episode', { runtime: '23:10', genre: undefined });
r = await q(`update episodes set pending_fields = $1::jsonb where id = 'transfer-lx3k9a' and pending_fields = $2::jsonb returning id`, [json(pf2), json(ep1.pending_fields)]);
assert.equal(r.rows.length, 1);
// The same guard with the old value now matches nothing (a decision in between).
r = await q(`update episodes set pending_fields = $1::jsonb where id = 'transfer-lx3k9a' and pending_fields = $2::jsonb returning id`, [json(pf2), json(ep1.pending_fields)]);
assert.equal(r.rows.length, 0);
ok('the jsonb guard: the read value matches once; a stale one matches nothing (key order is irrelevant)');

// Key order: jsonb equality is semantic.
const ep2 = (await q(`select * from episodes where id = 'transfer-lx3k9a'`)).rows[0];
const reordered = Object.fromEntries(Object.entries(ep2.pending_fields).reverse());
r = await q(`select id from episodes where id = 'transfer-lx3k9a' and pending_fields = $1::jsonb`, [json(reordered)]);
assert.equal(r.rows.length, 1);
ok('a reordered object still matches');

// The object check: an array or a scalar is refused; null is fine.
for (const bad of ['[]', '"x"', '1']) {
  let err = null;
  try { await q(`update episodes set pending_fields = $1::jsonb where id = 'transfer-lx3k9a'`, [bad]); } catch (e) { err = e; }
  assert.ok(err && err.code === '23514', `refused ${bad}`);
}
ok('pending_fields must be an object (nextPendingFields answers null for nothing waiting)');

// setEpisodeCaptions: a new track waits.
const ep3 = (await q(`select * from episodes where id = 'transfer-lx3k9a'`)).rows[0];
const pf3 = L.nextPendingFields(ep3, 'episode', { captions: { ref: 'private:captions/transfer-new.vtt', label: 'Español', language: 'es' } });
r = await q(`update episodes set pending_fields = $1::jsonb where id = 'transfer-lx3k9a' and pending_fields = $2::jsonb returning id`, [json(pf3), json(ep3.pending_fields)]);
assert.equal(r.rows.length, 1);
ok('a captions track waits beside the details');

// decideStaged approve: every detail written to its column, the decided keys
// taken out of pending_fields, captions swapped, the stale flag cleared.
const ep4 = (await q(`select * from episodes where id = 'transfer-lx3k9a'`)).rows[0];
const pf = L.pendingFieldsOf(ep4, 'episode');
const decided = Object.keys(pf);
const next = L.nextPendingFields(ep4, 'episode', Object.fromEntries(decided.map((f) => [f, undefined])));
assert.equal(next, null);
const sets = [];
const vals = [];
for (const f of decided) {
  if (f === 'captions') continue;
  vals.push(['credits', 'adBreakSeconds'].includes(f) ? json(pf[f]) : pf[f]);
  sets.push(`${L.DETAIL_COLUMNS[f]} = $${vals.length}${['credits', 'adBreakSeconds'].includes(f) ? '::jsonb' : ''}`);
}
vals.push(pf.captions.ref); sets.push(`captions_url = $${vals.length}`);
vals.push(pf.captions.label); sets.push(`captions_label = $${vals.length}`);
vals.push(pf.captions.language); sets.push(`captions_language = $${vals.length}`);
sets.push('captions_stale_at = null');
sets.push('pending_fields = null');
vals.push(json(ep4.pending_fields));
r = await q(`update episodes set ${sets.join(', ')} where id = 'transfer-lx3k9a' and pending_fields = $${vals.length}::jsonb returning *`, vals);
assert.equal(r.rows.length, 1);
const after = r.rows[0];
assert.equal(after.runtime, '23:10');
assert.equal(after.release_year, 2025);
assert.deepEqual(after.ad_break_seconds, [0, 600]);
assert.equal(after.ads_enabled, true);
assert.deepEqual(after.credits, { studio: { name: 'Night Owl', userId: null } });
assert.equal(after.extra_kind, null);
assert.equal(after.captions_url, 'private:captions/transfer-new.vtt');
assert.equal(after.captions_language, 'es');
assert.equal(after.pending_fields, null);
ok('approve: each detail lands in its column with its type; captions swapped; nothing waits');

// Deny of one field out of two: the other stays waiting.
await q(`update episodes set pending_fields = $1::jsonb where id = 'transfer-lx3k9a'`, [json({ genre: 'Western', artist: null })]);
const ep5 = (await q(`select * from episodes where id = 'transfer-lx3k9a'`)).rows[0];
const left = L.nextPendingFields(ep5, 'episode', { genre: undefined });
r = await q(`update episodes set pending_fields = $1::jsonb where id = 'transfer-lx3k9a' and pending_fields = $2::jsonb returning pending_fields, genre`, [json(left), json(ep5.pending_fields)]);
assert.deepEqual(r.rows[0].pending_fields, { artist: null });
assert.equal(r.rows[0].genre, 'Noir', 'the live genre is untouched by a deny');
ok('deny one field: the rest still waits, the live value untouched; a null waits as a value');

// A waiting removal of the captions ('').
await q(`update episodes set pending_fields = $1::jsonb where id = 'transfer-lx3k9a'`, [json({ captions: '' })]);
const ep6 = (await q(`select * from episodes where id = 'transfer-lx3k9a'`)).rows[0];
assert.deepEqual(L.pendingFieldsOf(ep6, 'episode'), { captions: '' });
r = await q(`update episodes set captions_url = null, captions_stale_at = null, pending_fields = null where id = 'transfer-lx3k9a' and pending_fields = $1::jsonb returning captions_url`, [json(ep6.pending_fields)]);
assert.equal(r.rows[0].captions_url, null);
ok('a waiting removal of the captions approves to none');

// The extra kind: '' is refused by the column, which is why normalizeExtraKind answers null.
{
  let err = null;
  try { await q(`update episodes set extra_kind = '' where id = 'transfer-lx3k9a'`); } catch (e) { err = e; }
  assert.ok(err && err.code === '23514');
}
ok('extra_kind refuses \'\' (the waiting value is normalised to null)');

// The show: the year, the funding link, the season names (an array), the credits (an object), the kind.
const s0 = (await q(`select * from series where id = 'night-bus-show'`)).rows[0];
const spf = L.nextPendingFields(s0, 'series', { releaseYear: 2023, fundingUrl: 'https://example.com/back', seasons: [{ number: 1, name: 'Pilot' }, { number: 2, name: 'Return' }], credits: { producer: { name: 'Pia', userId: null } }, kind: 'podcast' });
r = await q(`update series set pending_fields = $1::jsonb where id = 'night-bus-show' and pending_fields is null returning id`, [json(spf)]);
assert.equal(r.rows.length, 1);
const s1 = (await q(`select * from series where id = 'night-bus-show'`)).rows[0];
const sp = L.pendingFieldsOf(s1, 'series');
r = await q(`update series set release_year = $1, funding_url = $2, seasons = $3::jsonb, credits = $4::jsonb, kind = $5, pending_fields = null where id = 'night-bus-show' and pending_fields = $6::jsonb returning *`, [sp.releaseYear, sp.fundingUrl, json(sp.seasons), json(sp.credits), sp.kind, json(s1.pending_fields)]);
assert.equal(r.rows.length, 1);
assert.deepEqual(r.rows[0].seasons, [{ number: 1, name: 'Pilot' }, { number: 2, name: 'Return' }]);
assert.equal(r.rows[0].kind, 'podcast');
ok('a show\'s details wait and approve into their columns (seasons an array, credits an object, the kind checked)');

// The admin route's own-title path: pending_title, pending_page_notes ('' = clear), pending_src, pending_title_image_removal.
r = await q(`update episodes set pending_title = 'Transfer (Director''s Cut)', pending_page_notes = '', pending_src = 'https://customer-x.cloudflarestream.com/abcdef0123456789abcdef0123456789/manifest/video.m3u8', pending_title_image_url = null, pending_title_image_removal = true, pending_fields = $1::jsonb where id = 'transfer-lx3k9a' and pending_fields is null returning id`, [json({ mainGenre: 'Horror' })]);
assert.equal(r.rows.length, 1);
ok('the admin edit route\'s waiting columns all exist and take what it writes');

console.log(`${n} live-review PGlite checks passed`);
