// node scripts/test-sec-titles.mjs — the titles-and-shows security fixes
// (2026-11-15): who the title team is, withdrawn titles staying withdrawn,
// a new file on a live title needing a reviewer, podcast audio addresses,
// what a screener may play and approving your own work
// (lib/titleSecurityRules.js), plus a few source checks that the readers
// and the routes use them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TITLE_TEAM_CAPS, holdsAnyCap, titleTeamWith,
  WITHDRAWN_LINE, NO_REMOVAL_LINE, removalRefusal,
  FILE_REVIEW_LINE, fileChangeView,
  AUDIO_NOT_OURS_LINE, AUDIO_OTHERS_LINE, audioFileName, audioPathOwner, audioAddressCheck, audioRowsConflict,
  SCREENER_GONE_LINE, screenerTitleProblem,
  OWN_WORK_LINE, approvesOwnWork
} from '../lib/titleSecurityRules.js';
import { seriesHidden } from '../lib/seriesVisibility.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// lib/capabilities.js hasCapability's rule, copied (that file imports
// lib/siteConfig without an extension, which plain Node can't load); the
// source check below makes sure lib/titleTeam.js hands the real one in.
const can = (rc, key) => {
  if (rc.isAdmin) return true;
  if (rc.role === 'sub_admin' || rc.isSubAdmin) return Array.isArray(rc.permissions) && rc.permissions.includes(key);
  return false;
};
const sub = (permissions, extra = {}) => ({ userId: 'user_sub', role: 'sub_admin', isSubAdmin: true, canAccessAdmin: true, isAdmin: false, permissions, ...extra });

t('the title team: a full admin, or a sub-admin with review_submissions or manage_episodes', () => {
  assert.deepEqual(TITLE_TEAM_CAPS, ['review_submissions', 'manage_episodes']);
  assert.equal(titleTeamWith({ userId: 'user_a', isAdmin: true, canAccessAdmin: true }, can), true);
  assert.equal(titleTeamWith(sub(['review_submissions']), can), true);
  assert.equal(titleTeamWith(sub(['manage_episodes']), can), true);
  assert.equal(titleTeamWith(sub([]), can), false, 'a sub-admin with no permission at all');
  assert.equal(titleTeamWith(sub(['manage_artwork', 'handle_flags', 'manage_deletions', 'manage_schedule']), can), false);
  assert.equal(titleTeamWith({ userId: 'user_c', role: 'creator', isCreator: true }, can), false);
  assert.equal(titleTeamWith(null, can), false);
  assert.equal(titleTeamWith(sub(['review_submissions']), null), false, 'no capability rule, no team');
});

t('two-step: a sub-admin kept out of the admin area holds no capability here', () => {
  const blocked = sub(['review_submissions', 'manage_episodes'], { canAccessAdmin: false, isSubAdmin: false, adminNeedsTwoFactor: true });
  assert.equal(titleTeamWith(blocked, can), false);
  assert.equal(holdsAnyCap(blocked, ['manage_artwork'], can), false);
  assert.equal(holdsAnyCap(sub(['manage_artwork']), ['manage_episodes', 'manage_artwork'], can), true);
});

t('a withdrawn title keeps its removal', () => {
  assert.deepEqual(removalRefusal({ withdrawn_at: '2026-11-01T00:00:00Z', deletion_requested: true }), { status: 409, code: 'withdrawn', error: WITHDRAWN_LINE });
  assert.equal(removalRefusal({ withdrawn_at: null, deletion_requested: true }), null);
  assert.equal(removalRefusal(null), null);
  assert.equal(WITHDRAWN_LINE, 'It’s withdrawn and kept for the people who bought it, so it can’t be changed here.');
  assert.equal(NO_REMOVAL_LINE, 'No removal is requested for this.');
});

t('a withdrawn show hides its episodes like a pulled one', () => {
  assert.equal(seriesHidden({ status: 'approved', withdrawn_at: '2026-11-01T00:00:00Z' }), true);
  assert.equal(seriesHidden({ status: 'approved', moderation_hold: false, deletion_requested: false, withdrawn_at: null }), false);
  assert.equal(seriesHidden({ status: 'pending' }), true);
});

t('a new file: the team decides it in review; on a live title only a reviewer or a full admin', () => {
  assert.equal(fileChangeView({ status: 'approved', fullAdmin: true }), 'team');
  assert.equal(fileChangeView({ status: 'approved', reviewer: true, team: true }), 'team');
  assert.equal(fileChangeView({ status: 'approved', team: true }), 'owner', 'manage_episodes alone on a live title');
  assert.equal(fileChangeView({ status: 'rejected', team: true }), 'owner');
  assert.equal(fileChangeView({ status: null, team: true }), 'owner', 'a row from before the status column is live');
  assert.equal(fileChangeView({ status: 'pending', team: true }), 'team', 'in review the team fixes the file and a reviewer looks at it');
  assert.equal(fileChangeView({ status: 'approved' }), 'owner', 'not on the team: the uploader’s own rule');
  assert.equal(FILE_REVIEW_LINE, 'A reviewer approves a new file on a live title.');
});

const BASE = 'https://abc.supabase.co';
const stored = (path) => `${BASE}/storage/v1/object/public/episode-audio/${path}`;

t('an imported audio file is named for its uploader', () => {
  const name = audioFileName('user_mara123', 'm4a', 'lx3k9a', 'q8w2e1');
  assert.equal(name, 'podcast-user_mara123-lx3k9a-q8w2e1.m4a');
  assert.equal(audioPathOwner(name), 'user_mara123');
  assert.equal(audioPathOwner('podcast-lx3k9a-q8w2e1.mp3'), null, 'an older name carries no owner');
  assert.equal(audioFileName(null, 'mp3', 'lx3k9a', 'q8w2e1'), 'podcast-lx3k9a-q8w2e1.mp3');
  assert.equal(audioFileName('../../x', 'mp3', 'a', 'b'), 'podcast-a-b.mp3', 'an id that isn’t a Clerk id is left out');
  assert.equal(audioFileName('user_x', 'exe/../', 'a', 'b'), 'podcast-user_x-a-b.mp3');
});

t('audio addresses: our own stored file, never an outside one, never someone else’s', () => {
  const opts = { supabaseUrl: BASE, owners: ['user_mara'] };
  assert.deepEqual(audioAddressCheck('', opts), { ok: true, path: null });
  assert.deepEqual(audioAddressCheck(stored('podcast-user_mara-lx3k9a-q8w2e1.mp3'), opts), { ok: true, path: 'podcast-user_mara-lx3k9a-q8w2e1.mp3' });
  assert.deepEqual(audioAddressCheck(stored('podcast-lx3k9a-q8w2e1.mp3'), opts), { ok: true, path: 'podcast-lx3k9a-q8w2e1.mp3' }, 'an older file without an owner');
  assert.deepEqual(audioAddressCheck('https://evil.example/listen.mp3', opts), { ok: false, status: 400, error: AUDIO_NOT_OURS_LINE });
  assert.deepEqual(audioAddressCheck(stored('podcast-user_dee-lx3k9a-q8w2e1.mp3'), opts), { ok: false, status: 403, error: AUDIO_OTHERS_LINE });
  assert.equal(audioAddressCheck(stored('folder/podcast-user_mara-a-b.mp3'), opts).ok, false, 'only files at the top of the bucket');
  assert.equal(audioAddressCheck(stored('../episode-art/x.mp3'), opts).ok, false);
  assert.equal(audioAddressCheck(stored('other-file.mp3'), opts).ok, false, 'only what the import names');
  assert.equal(audioAddressCheck(`https://other.supabase.co/storage/v1/object/public/episode-audio/podcast-user_mara-a-b.mp3`, opts).ok, false, 'another project');
  assert.equal(audioAddressCheck(stored('podcast-user_dee-a-b.mp3'), { supabaseUrl: BASE, owners: ['user_admin', 'user_dee'] }).ok, true, 'the title’s own uploader’s file on an admin edit');
  assert.deepEqual(audioAddressCheck('https://cdn.example.com/x.mp3', { supabaseUrl: BASE, fullAdmin: true }), { ok: true, path: null }, 'a full admin may link audio hosted elsewhere');
});

t('audio addresses: another uploader’s title already using the file', () => {
  const path = 'podcast-lx3k9a-q8w2e1.mp3';
  const opts = { supabaseUrl: BASE, owners: ['user_mara'] };
  assert.equal(audioRowsConflict([{ id: 'e1', submitted_by: 'user_mara', audio_url: stored(path) }], path, opts), null, 'their own');
  assert.equal(audioRowsConflict([{ id: 'e2', submitted_by: 'user_dee', audio_url: stored(path) }], path, opts).id, 'e2');
  assert.equal(audioRowsConflict([{ id: 'e3', submitted_by: null, audio_url: stored(path) }], path, opts).id, 'e3', 'no uploader counts as someone else');
  assert.equal(audioRowsConflict([{ id: 'e4', submitted_by: 'user_dee', audio_url: stored(path) }], path, { ...opts, selfId: 'e4' }), null, 'the title being saved');
  assert.equal(audioRowsConflict([{ id: 'e5', submitted_by: 'user_dee', audio_url: stored('podcast-lx3k9aXq8w2e1.mp3') }], path, opts), null, 'a LIKE look-alike is not the file');
  assert.equal(audioRowsConflict([], path, opts), null);
});

t('screeners: only a title the owner’s preview would play', () => {
  const ep = { status: 'approved', src: 'https://videodelivery.net/abc/manifest/video.m3u8' };
  assert.equal(screenerTitleProblem(ep), null);
  assert.equal(screenerTitleProblem({ ...ep, status: 'pending' }), null, 'a title still in review');
  for (const bad of [{ status: 'rejected' }, { withdrawn_at: '2026-11-01' }, { deletion_requested: true }, { moderation_hold: true }, { src: null }]) {
    assert.equal(screenerTitleProblem({ ...ep, ...bad }), SCREENER_GONE_LINE, JSON.stringify(bad));
  }
  assert.equal(screenerTitleProblem(ep, { show: { status: 'pending' } }), null, 'a private show is the point of a screener');
  for (const show of [{ moderation_hold: true }, { status: 'rejected' }, { withdrawn_at: '2026-11-01' }, { deletion_requested: true }]) {
    assert.equal(screenerTitleProblem(ep, { show }), SCREENER_GONE_LINE, JSON.stringify(show));
    assert.equal(screenerTitleProblem(ep, { parentShow: show }), SCREENER_GONE_LINE, `an extra's show ${JSON.stringify(show)}`);
    assert.equal(screenerTitleProblem(ep, { parentEpisode: show }), SCREENER_GONE_LINE, `an extra's episode ${JSON.stringify(show)}`);
  }
  assert.equal(screenerTitleProblem(ep, { unreadable: true }), SCREENER_GONE_LINE, 'a read that failed');
  assert.equal(screenerTitleProblem(null), SCREENER_GONE_LINE);
});

t('approving your own work: only a full admin', () => {
  assert.equal(approvesOwnWork({ userId: 'user_sub', isAdmin: false }, ['user_sub']), true);
  assert.equal(approvesOwnWork({ userId: 'user_sub', isAdmin: false }, ['user_mara', 'user_sub']), true, 'the show they run');
  assert.equal(approvesOwnWork({ userId: 'user_sub', isAdmin: false }, ['user_mara', null]), false);
  assert.equal(approvesOwnWork({ userId: 'user_admin', isAdmin: true }, ['user_admin']), false);
  assert.equal(approvesOwnWork({ userId: null }, [null]), false);
  assert.equal(approvesOwnWork({ userId: 'user_sub' }, 'user_sub'), true, 'a single id');
  assert.equal(OWN_WORK_LINE, 'Someone else on the team approves your own work.');
});

t('the readers and routes use the rules (source checks)', () => {
  const episodes = src('lib/episodes.js');
  const findEpisode = episodes.slice(episodes.indexOf('export async function findEpisode('), episodes.indexOf('export async function findEpisodeForOwner('));
  assert.match(findEpisode, /\.is\('withdrawn_at', null\)/, 'findEpisode skips withdrawn rows');
  assert.match(episodes, /viewer\.isAdmin === true \|\| viewer\.titleTeam === true/, 'the preview team is the title team');
  assert.doesNotMatch(episodes, /viewer\.canAccessAdmin/, 'no team account counts as the team any more');
  assert.match(src('lib/publicEpisodes.js'), /\.is\('withdrawn_at', null\)\),\n\s+readSeriesForEpisodes/, 'the catalogue skips withdrawn rows');
  const series = src('lib/series.js');
  assert.match(series, /\.eq\('id', id\)\.eq\('deletion_requested', false\)\.eq\('moderation_hold', false\)\.is\('withdrawn_at', null\)/, 'findSeries skips withdrawn shows');
  assert.doesNotMatch(series, /viewer\.canAccessAdmin/);
  assert.match(src('lib/titleTeam.js'), /titleTeamWith\(rc, hasCapability\)/);
  const showPage = src('lib/showPage.js');
  assert.doesNotMatch(showPage, /checkVideoOwnership\([^)]*isAdmin: v\.team/, 'only a full admin attaches anyone’s video');
  assert.doesNotMatch(showPage, /strict && ep\.withdrawn_at/, 'the withdrawn refusal no longer depends on strict');
  assert.match(showPage, /checkAudioAddress\(String\(body\.audioUrl\)/, 'submitDraft checks the audio address');
  assert.doesNotMatch(src('pages/api/creator/list-series.js'), /isAdmin: canAccessAdmin/);
  assert.match(src('lib/showRoute.js'), /const canAccessAdmin = isTitleTeam\(rc\)/);
  const resolve = src('pages/api/admin/resolve-deletion.js');
  assert.ok(resolve.indexOf("asked.deletion_requested !== true") < resolve.indexOf('hasBuyersIncludingSeries(type, id)'), 'the request is checked before any side effect');
  assert.match(src('lib/audioUpload.js'), /audioFileName\(userId,/);
  assert.match(src('lib/videoOwnership.js'), /\.is\(check\.owner, null\)/, 'ownerless rows count as someone else’s');
});

console.log(`\n${n} checks passed`);
