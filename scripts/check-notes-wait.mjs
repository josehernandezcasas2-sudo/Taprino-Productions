// Descriptions and notes wait for review (Jose, 2026-11-12) on a real
// Postgres: the writes lib/showPage.js (updateEpisode, cancelEpisodeStaged,
// updateShow, submitDraft) and lib/stagedChanges.js (decideStaged) send
// through PostgREST, as the SQL they become. Builds the database through
// migration 121 (a read naming pending_page_notes fails with 42703, which
// lib/showPage.js selectEpisodes and the admin reads fall back on), then
// 122, and walks a live film through: new notes wait, a replacement, the
// guard that refuses a write over notes changed meanwhile, "clear the
// notes" waiting as '' (counted, cancelled, approved as null), a waiting
// description approved, a show's description waiting, and a submission
// with its title image.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-notes-wait.mjs
import assert from 'node:assert/strict';
import { buildDb, runMigration } from './pg-chain.mjs';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILM = 'night-film-notes-ab12cd';
const SHOW = 'night-bus-notes-ef34gh-show';
const db = await buildDb(121);
await db.query("insert into series (id, name, status, creator_id, description) values ($1, 'Night Bus', 'approved', 'user_mara', 'A bus at night.')", [SHOW]);
await db.query(`insert into episodes (id, title, description, content_type, status, submitted_by, page_notes)
  values ($1, 'Night Film', 'Live words.', 'movie', 'approved', 'user_mara', 'Live notes.')`, [FILM]);

try {
  await db.query('select pending_page_notes from episodes limit 1');
  throw new Error('pending_page_notes was there before 122');
} catch (err) {
  assert.equal(err.code, '42703');
}
ok('before 122 a read naming pending_page_notes fails with 42703 (the tiered reads fall back)');

await runMigration(db, 122);
const row = async () => (await db.query('select description, pending_description, page_notes, pending_page_notes from episodes where id = $1', [FILM])).rows[0];
assert.deepEqual(await row(), { description: 'Live words.', pending_description: null, page_notes: 'Live notes.', pending_page_notes: null });
ok('after 122 nothing waits on an existing title');

// updateEpisode on a live title: the guard is the status read and the
// waiting column as read (sameAsRead: nothing waiting = is null).
let r = await db.query("update episodes set pending_page_notes = $2, pending_description = $3 where id = $1 and status = 'approved' and pending_page_notes is null and pending_description is null returning id", [FILM, 'New notes.', 'New words.']);
assert.equal(r.rows.length, 1);
assert.deepEqual(await row(), { description: 'Live words.', pending_description: 'New words.', page_notes: 'Live notes.', pending_page_notes: 'New notes.' });
ok('new notes and a new description wait; the live ones stay');

// A replacement: notes already waiting are checked for being there (not
// compared: they are long).
r = await db.query("update episodes set pending_page_notes = $2 where id = $1 and status = 'approved' and pending_page_notes is not null returning id", [FILM, 'Newer notes.']);
assert.equal(r.rows.length, 1);
// The editor read "nothing waits" but notes arrived meanwhile: no row.
r = await db.query("update episodes set pending_page_notes = $2 where id = $1 and status = 'approved' and pending_page_notes is null returning id", [FILM, 'Stale.']);
assert.equal(r.rows.length, 0);
assert.equal((await row()).pending_page_notes, 'Newer notes.');
ok('a replacement goes in; a write over notes changed meanwhile matches nothing (409 stale)');

// "Clear the notes" waits as an empty string, and counts as waiting.
r = await db.query("update episodes set pending_page_notes = '' where id = $1 and pending_page_notes is not null returning id", [FILM]);
assert.equal(r.rows.length, 1);
let count = await db.query("select count(*)::int as c from episodes where pending_title is not null or pending_description is not null or pending_page_notes is not null");
assert.equal(count.rows[0].c, 1);
// The Library's read: pending_page_notes.not.is.null finds '' too.
const listed = await db.query("select id, pending_page_notes from episodes where pending_page_notes is not null");
assert.deepEqual(listed.rows, [{ id: FILM, pending_page_notes: '' }]);
ok('clearing the notes waits as an empty string, which the queues count and list');

// Cancel (cancelEpisodeStaged): '' compared as one.
r = await db.query("update episodes set pending_page_notes = null where id = $1 and pending_page_notes = '' returning id", [FILM]);
assert.equal(r.rows.length, 1);
assert.equal((await row()).pending_page_notes, null);
ok('taking back "clear the notes" (pending_page_notes = \'\') leaves nothing waiting');

// Approve '' (decideStaged): the notes are cleared.
await db.query("update episodes set pending_page_notes = '' where id = $1", [FILM]);
r = await db.query("update episodes set page_notes = null, pending_page_notes = null where id = $1 and pending_page_notes = '' returning id", [FILM]);
assert.equal(r.rows.length, 1);
assert.deepEqual(await row(), { description: 'Live words.', pending_description: 'New words.', page_notes: null, pending_page_notes: null });
ok('approving "clear the notes" clears them');

// Approve text notes and the description in one write (the text group).
await db.query("update episodes set pending_page_notes = 'Approved notes.' where id = $1", [FILM]);
r = await db.query(`update episodes set page_notes = pending_page_notes, pending_page_notes = null, description = pending_description, pending_description = null
  where id = $1 and pending_page_notes is not null and pending_description is not null returning id`, [FILM]);
assert.equal(r.rows.length, 1);
assert.deepEqual(await row(), { description: 'New words.', pending_description: null, page_notes: 'Approved notes.', pending_page_notes: null });
ok('approving puts the waiting notes and description live and clears what waited');

// A show's description waits on the series row (migration 030's column).
r = await db.query("update series set pending_description = 'A new line.' where id = $1 returning id", [SHOW]);
assert.equal(r.rows.length, 1);
const show = (await db.query('select description, pending_description from series where id = $1', [SHOW])).rows[0];
assert.deepEqual(show, { description: 'A bus at night.', pending_description: 'A new line.' });
ok('a live show\'s new description waits; the live one stays');

// A submission with its title image (submitDraft's row: a pending title).
await db.query(`insert into episodes (id, title, description, content_type, status, submitted_by, poster, thumbnail, title_image_url)
  values ('second-film-ij56kl', 'Second Film', 'Words.', 'short', 'pending', 'user_mara', null, null, 'https://x.supabase.co/storage/v1/object/public/episode-art/second-film-title-image-abc.png')`);
const sub = (await db.query("select title_image_url, pending_page_notes from episodes where id = 'second-film-ij56kl'")).rows[0];
assert.match(sub.title_image_url, /title-image/);
assert.equal(sub.pending_page_notes, null);
ok('a submission stores its title image; nothing waits on a title in review');

console.log(`\n${n} notes-wait checks passed`);
