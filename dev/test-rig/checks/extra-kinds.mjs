#!/usr/bin/env node
// Kinds of extras (migration 121, episodes.extra_kind; lib/extraKinds.js).
// Runs the half that matches the database it finds:
//   after 121  (the rig's default): what is stored, who may set it, every
//              payload and page that prints it, submit and a sent draft,
//              the editor's chips in a browser, no overflow from 40 wide
//              characters;
//   before 121 (RIG_MIGRATE_TO=120 RIG_REBUILD=1 dev/test-rig/start.sh):
//              every page and route still answers, extras read "Extra",
//              the field is greyed with the migration line, a save says
//              notSaved, a submit with a kind saves without it.
//   node dev/test-rig/checks/extra-kinds.mjs
import crypto from 'node:crypto';
import { EMPTY_SUBMIT_FORM, toSubmitBody } from '../../../lib/submitRules.js';
import { IDS, USERS, RUN, ok, section, runCheck, call, page, sql, rows, q, insert, session, SIGNED_OUT, browser, goto, overflowPx, cloudflare, hasColumn, ago, uidFor } from './lib.mjs';

const MARA = session(USERS.mara);
const DEE = session(USERS.dee);
const ADMIN = session(USERS.admin);

const ID = {
  mara: `ck-xk-mara-${RUN}`,
  dee: `ck-xk-dee-${RUN}`,
  pending: `ck-xk-pending-${RUN}`
};
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const extra = (id, who, extraFields = {}) => ({
  id, title: `Check extra ${id.slice(6, 14)}`, description: 'A check extra.', tier: 'free', genre: 'Behind the Scenes', main_genre: 'Drama', content_type: 'bonus',
  bonus_parent_type: 'series', bonus_parent_id: IDS.nightBus, artist: 'Mara Reyes', runtime: '6:00', rating: 'TV-PG', release_year: 2026,
  src: src(IDS.nbExtraShow), video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, deletion_requested: false, moderation_hold: false,
  submitted_by: who, status: 'approved', reviewed_at: ago(2), released_at: ago(2), created_at: ago(3), ...extraFields
});
const created = [];
const kindOf = (id) => (rows(`select extra_kind from public.episodes where id = ${q(id)}`)[0] || {}).extra_kind;
const patch = (who, id, body) => call(`/api/show/episode/${encodeURIComponent(id)}`, { who, method: 'PATCH', body });

function seed(with121) {
  insert('episodes', extra(ID.mara, USERS.mara));
  insert('episodes', extra(ID.dee, USERS.dee, { title: 'Check extra by Dee', artist: 'Dee Park' }));
  insert('episodes', extra(ID.pending, USERS.mara, { status: 'pending', reviewed_at: null, released_at: null, title: 'Check pending extra', ...(with121 ? { extra_kind: 'interview' } : {}) }));
}
function cleanup() {
  const ids = [...Object.values(ID), ...created].map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids})`);
  sql(`delete from public.audit_log where target_id in (${ids})`);
  sql(`delete from public.creator_drafts where user_id = ${q(USERS.mara)} and form->>'title' like 'Check draft extra%'`);
  sql(`delete from public.episodes where id in (${ids}) or title like 'Check submitted extra ${RUN}%' or title like 'Check draft extra ${RUN}%'`);
}

// A ready video of Mara's in the fake Cloudflare (tagged with her account,
// as get-upload-url tags uploads).
async function maraVideo(tag) {
  const uid = crypto.createHash('md5').update(`ck-xk-${tag}-${RUN}`).digest('hex');
  const r = await cloudflare('/__video', { method: 'POST', body: { uid, name: `${tag}.mp4`, creator: USERS.mara, duration: 360, ready: true, requireSignedURLs: true } });
  if (r.status !== 200) throw new Error(`fake Cloudflare refused the video: ${r.status}`);
  return uid;
}
const submitBody = (title, extraFields) => ({ contentType: 'bonus', seriesId: IDS.nightBus, title, description: 'Submitted by the check.', genre: 'Interview', mainGenre: 'Drama', runtime: '6:00', artist: 'Mara Reyes', tier: 'free', rating: 'TV-PG', ...extraFields });

async function afterHttp() {
  section('After 121: what is stored, who may set it');
  let r = await patch(MARA, ID.mara, { extraKind: 'Making of' });
  ok('"Making of" → stored as making-of', r.status === 200 && kindOf(ID.mara) === 'making-of', `${r.status} ${kindOf(ID.mara)} ${r.text.slice(0, 200)}`);
  ok('the save says it applied at once', r.json && Array.isArray(r.json.applied) && r.json.applied.includes('extraKind'), r.json && r.json.applied);
  r = await patch(MARA, ID.mara, { extraKind: 'MAKING_OFS' });
  ok('"MAKING_OFS" matches the preset too (unchanged)', r.status === 200 && kindOf(ID.mara) === 'making-of', kindOf(ID.mara));
  const messy = `  <b>Table​ read</b>\u0007\n${'Z'.repeat(60)}`;
  r = await patch(MARA, ID.mara, { extraKind: messy });
  const k = kindOf(ID.mara) || '';
  ok('custom words: cleaned (no < > zero-width or control characters)', r.status === 200 && !/[<>​\u0007\n]/.test(k) && k.startsWith('bTable read/b'), JSON.stringify(k));
  ok('custom words: cut at 40 characters', Array.from(k).length <= 40 && Array.from(k).length >= 30, Array.from(k).length);
  for (const [label, value] of [['"Other"', 'Other'], ['""', ''], ['null', null], ['"Extra"', 'extra'], ['only invisible characters', '​‍⁠']]) {
    await patch(MARA, ID.mara, { extraKind: 'teaser' });
    r = await patch(MARA, ID.mara, { extraKind: value });
    ok(`${label} → no kind (null)`, r.status === 200 && kindOf(ID.mara) === null, `${r.status} ${kindOf(ID.mara)}`);
  }
  r = await patch(MARA, ID.mara, { extraKind: 42 });
  ok('a number is refused (400)', r.status === 400, r.status);
  r = await patch(MARA, IDS.nbS1E1, { extraKind: 'interview' });
  ok('an episode that isn’t an extra has no kind (400)', r.status === 400, `${r.status} ${r.text.slice(0, 120)}`);
  r = await patch(MARA, ID.dee, { extraKind: 'interview' });
  ok('the show’s owner who didn’t upload it → 403', r.status === 403, `${r.status} ${r.text.slice(0, 160)}`);
  ok('…and nothing was stored', kindOf(ID.dee) === null);
  r = await patch(DEE, ID.dee, { extraKind: 'Table read' });
  ok('its uploader sets their own words', r.status === 200 && kindOf(ID.dee) === 'Table read', `${r.status} ${kindOf(ID.dee)}`);
  r = await patch(ADMIN, ID.mara, { extraKind: 'commentary' });
  ok('the team’s change applies at once', r.status === 200 && kindOf(ID.mara) === 'commentary', `${r.status} ${kindOf(ID.mara)}`);
  r = await patch(MARA, ID.mara, { extraKind: 'making-of' });
  ok('back to Making-of for the payloads', r.status === 200 && kindOf(ID.mara) === 'making-of');

  section('After 121: what the pages and payloads say');
  r = await call(`/api/series-hub?id=${encodeURIComponent(IDS.nightBus)}`);
  const extrasOf = (j) => {
    const out = [];
    const walk = (v) => { if (!v || typeof v !== 'object') return; if (Array.isArray(v)) { v.forEach(walk); return; } if (typeof v.id === 'string' && 'extraKind' in v) out.push(v); Object.values(v).forEach(walk); };
    walk(j);
    return out;
  };
  const cards = extrasOf(r.json);
  const card = (id) => cards.find((c) => c.id === id);
  ok('/api/series-hub: Mara’s extra carries extraKind making-of', card(ID.mara) && card(ID.mara).extraKind === 'making-of', card(ID.mara));
  ok('/api/series-hub: Dee’s carries her words', card(ID.dee) && card(ID.dee).extraKind === 'Table read', card(ID.dee));
  ok('/api/series-hub: an extra without one carries null', card(IDS.nbExtraShow) && card(IDS.nbExtraShow).extraKind === null, card(IDS.nbExtraShow));
  r = await page(`/episode/${ID.mara}`);
  ok('the extra’s own page: the kicker says Making-of', r.status === 200 && /ep-kicker-type[^"]*"[^>]*>Making-of/.test(r.text), r.status);
  r = await call(`/api/episode-page?id=${encodeURIComponent(ID.mara)}`);
  ok('/api/episode-page: episode.extraKind making-of', r.status === 200 && r.json && r.json.episode && r.json.episode.extraKind === 'making-of', r.status);
  r = await page(`/episode/${IDS.nbS1E3}?autoplay=1`);
  ok('an episode’s Extras row: "Making-of · …" on the card', r.status === 200 && /class="ep-extra-kind"[^>]*>Making-of · /.test(r.text), r.status);
  r = await call(`/api/show/${encodeURIComponent(IDS.nightBus)}`, { who: MARA });
  const shelf = r.json && r.json.extras ? r.json.extras : (r.json && r.json.view && r.json.view.extras) || [];
  const shelfRow = (Array.isArray(shelf) ? shelf : []).find((x) => x.id === ID.mara);
  ok('the show room’s shelf: extraKind on the row', shelfRow && shelfRow.extraKind === 'making-of', shelfRow ? shelfRow.extraKind : Object.keys(r.json || {}));
  r = await call('/api/creator/my-submissions', { who: MARA });
  const yw = r.json && r.json.submissions ? r.json.submissions.find((s) => s.id === ID.mara) : null;
  ok('Your work: extraKind on the row', yw && yw.extraKind === 'making-of', yw && yw.extraKind);
  r = await call('/api/admin/review-queue', { who: ADMIN });
  const item = r.json && r.json.items ? r.json.items.find((i) => i.id === ID.pending) : null;
  ok('the review queue: the pending extra’s line starts with its kind', item && /^Interview/.test(item.subtitle || ''), item && item.subtitle);
  ok('the review queue: meta.extraKind', item && item.meta && item.meta.extraKind === 'interview', item && item.meta);
  r = await call('/api/show', { who: MARA });
  ok('GET /api/show → extraKind.ready true', r.status === 200 && r.json && r.json.extraKind && r.json.extraKind.ready === true, r.json && r.json.extraKind);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.mara)}`, { who: MARA });
  ok('the editor read: extraKind + policy direct', r.status === 200 && r.json && r.json.episode && r.json.episode.extraKind === 'making-of' && r.json.policy && r.json.policy.extraKind && r.json.policy.extraKind.mode === 'direct', r.json && r.json.policy && r.json.policy.extraKind);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.dee)}`, { who: MARA });
  ok('the editor read for the owner on Dee’s extra: the kind is locked', r.status === 200 && r.json && r.json.policy && r.json.policy.extraKind && r.json.policy.extraKind.mode === 'locked', r.json && r.json.policy && r.json.policy.extraKind);

  section('After 121: the kind through submit and a sent draft');
  const v1 = await maraVideo('submit');
  r = await call('/api/creator/submit-episode', { who: MARA, method: 'POST', body: submitBody(`Check submitted extra ${RUN}`, { videoUid: v1, extraKind: 'Interview' }) });
  const subId = r.json && (r.json.id || (r.json.episode && r.json.episode.id));
  if (subId) created.push(subId);
  ok('submit-episode with extraKind "Interview" → 200', r.status === 200 && subId, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…stored as interview', subId && kindOf(subId) === 'interview', subId && kindOf(subId));
  // A sent draft: the three-step submit page saves its form as a draft and
  // sends it with toSubmitBody (lib/submitRules.js) + draftId; the show
  // page's Send leaves extras to that page ("finish it on the submit page").
  const v2 = await maraVideo('draft');
  const form = { ...EMPTY_SUBMIT_FORM, ...submitBody(`Check draft extra ${RUN}`), extraKindChoice: 'other', extraKindOther: '  Table   read ' };
  r = await call('/api/creator/drafts', { who: MARA, method: 'POST', body: { form, video: { uid: v2, state: 'ready', name: 'draft.mp4', bytes: 1000 } } });
  const draftId = r.json && r.json.draft && r.json.draft.id;
  ok('a bonus draft with Other + "Table read" saved', r.status === 200 && draftId, `${r.status} ${r.text.slice(0, 200)}`);
  const body = toSubmitBody(form, { video: { uid: v2, runtimeSeconds: 360 } }, { draftId });
  ok('toSubmitBody carries extraKind for bonus content', body.extraKind === 'Table read', body.extraKind);
  r = await call('/api/creator/submit-episode', { who: MARA, method: 'POST', body });
  const sent = r.json && (r.json.id || (r.json.episode && r.json.episode.id));
  if (sent) created.push(sent);
  ok('the draft sent from the submit page', r.status === 200 && sent, `${r.status} ${r.text.slice(0, 300)}`);
  ok('…its kind arrived (Table read)', sent && kindOf(sent) === 'Table read', sent && kindOf(sent));
  ok('…and the draft is gone', rows(`select id from public.creator_drafts where id = ${q(draftId)}`).length === 0);
  r = await call(`/api/show/${encodeURIComponent(IDS.nightBus)}/send`, { who: MARA, method: 'POST', body: { draftIds: ['00000000-0000-4000-8000-000000000000'] } });
  ok('the show page’s Send still answers for a missing draft', r.status === 200 && r.json && r.json.skipped && r.json.skipped.length === 1, r.status);
}

async function afterBrowser(b) {
  section('After 121: the editor’s chips (390)');
  const { ctx, page: pg, errors } = await b.open(MARA, 390);
  const st = await goto(pg, `/creator/show/${IDS.nightBus}/episode/${ID.mara}`);
  ok('the extra’s editor page → 200', st === 200, st);
  const chip = (label) => pg.locator('.xk-chips button', { hasText: new RegExp(`^${label}$`) });
  await chip('Making-of').waitFor({ timeout: 30000 }).catch(() => {});
  ok('"What kind of extra?" with the chips', (await pg.locator('.xk-chips button').count()) === 8);
  ok('Making-of is on (aria-pressed)', (await chip('Making-of').getAttribute('aria-pressed')) === 'true');
  await chip('Interview').click();
  const pressed = await pg.locator('.xk-chips button[aria-pressed="true"]').allTextContents();
  ok('one at a time: Interview on, Making-of off', pressed.length === 1 && pressed[0] === 'Interview', pressed);
  await chip('Interview').click();
  ok('pressing it again takes it off', (await pg.locator('.xk-chips button[aria-pressed="true"]').count()) === 0);
  await chip('Other').click();
  const other = pg.locator(`#ep-kind-other`);
  ok('Other opens "Your category"', await other.isVisible().catch(() => false));
  ok('…and puts the cursor in it', await other.evaluate((el) => document.activeElement === el).catch(() => false));
  await other.type('Table read');
  ok('the counter says 10 / 40', (await pg.locator('.xk-other-row').innerText()).includes('10 / 40'));
  await other.fill('x'.repeat(55));
  ok('the box keeps 40 characters', (await other.inputValue()).length === 40);
  await other.fill('Music video');
  await pg.locator('.show-ed-save').click();
  await pg.waitForTimeout(1500);
  ok('Save stored the words', kindOf(ID.mara) === 'Music video', kindOf(ID.mara));
  ok('no overflow on the editor', (await overflowPx(pg)) <= 0);
  ok('no page errors in the editor', errors.length === 0, errors);
  await ctx.close();

  section('After 121: the cards print the kind (browser)');
  {
    const o = await b.open(SIGNED_OUT, 1280);
    await goto(o.page, `/series/${IDS.nightBus}`);
    await o.page.locator('button.series-tab', { hasText: 'Extras' }).click();
    await o.page.waitForTimeout(500);
    const metas = (await o.page.locator('.spg-extra-meta').allTextContents()).map((t) => t.trim());
    ok('series page Extras: "Music video · 6 min"', metas.includes('Music video · 6 min'), metas);
    ok('series page Extras: "Table read · 6 min"', metas.includes('Table read · 6 min'), metas);
    ok('series page Extras: "Extra · 10 min" for the one without a kind', metas.includes('Extra · 10 min'), metas);
    await o.ctx.close();
    const y = await b.open(MARA, 1280);
    await goto(y.page, '/creator/my-work');
    await y.page.waitForTimeout(1500);
    ok('Your work says Music video on the extra', (await y.page.locator('body').innerText()).includes('Music video'));
    ok('Your work: no page errors', y.errors.length === 0, y.errors);
    await y.ctx.close();
  }

  section('After 121: 40 wide characters on the series page cards');
  const wide = 'Ｗ'.repeat(40);
  const r = await patch(DEE, ID.dee, { extraKind: wide });
  ok('40 full-width characters stored', r.status === 200 && kindOf(ID.dee) === wide, kindOf(ID.dee));
  for (const width of [390, 1280]) {
    const o = await b.open(SIGNED_OUT, width);
    await goto(o.page, `/series/${IDS.nightBus}`);
    await o.page.locator('button.series-tab', { hasText: 'Extras' }).click();
    await o.page.waitForTimeout(500);
    const meta = o.page.locator('.spg-extra-meta', { hasText: 'ＷＷＷ' });
    ok(`${width}: the card prints the wide kind`, (await meta.count()) === 1);
    const fits = await meta.evaluate((el) => { const card = el.closest('.spg-extra-card') || el.parentElement; return el.scrollWidth <= card.getBoundingClientRect().width + 1; }).catch(() => false);
    ok(`${width}: it wraps inside its card`, fits);
    ok(`${width}: no horizontal overflow`, (await overflowPx(o.page)) <= 0, await overflowPx(o.page));
    ok(`${width}: no page errors`, o.errors.length === 0, o.errors);
    await o.ctx.close();
  }
  await submitStepTwo(b, false);
  const o = await b.open(SIGNED_OUT, 390);
  await goto(o.page, `/episode/${ID.dee}`);
  ok('390: the extra’s own page with the wide kind — no overflow', (await overflowPx(o.page)) <= 0, await overflowPx(o.page));
  ok('390: …no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

// The three-step submit at step 2 for bonus content (a saved draft opens
// at its step): "What kind of extra?" is there, greyed before 121.
async function submitStepTwo(b, locked) {
  const uid = await maraVideo(`step2-${locked ? 'pre' : 'post'}`);
  const form = { ...EMPTY_SUBMIT_FORM, contentType: 'bonus', seriesId: IDS.nightBus, title: `Check draft extra ${RUN} step`, step: 2 };
  const r = await call('/api/creator/drafts', { who: MARA, method: 'POST', body: { form, video: { uid, state: 'ready', name: 'step2.mp4', bytes: 1000 } } });
  const draftId = r.json && r.json.draft && r.json.draft.id;
  ok(`submit (${locked ? 'before' : 'after'} 121): a bonus draft at step 2 saved`, r.status === 200 && draftId, r.status);
  const { ctx, page: pg, errors } = await b.open(MARA, 390);
  await goto(pg, `/creator/submit?draft=${encodeURIComponent(draftId)}`);
  await pg.locator('.xk-chips button').first().waitFor({ timeout: 30000 }).catch(() => {});
  await pg.waitForTimeout(1500);
  ok('submit step 2: "What kind of extra?" with its eight chips', (await pg.locator('.xk-chips button').count()) === 8);
  if (locked) {
    ok('submit step 2: every chip disabled', (await pg.locator('.xk-chips button:not([disabled])').count()) === 0);
    ok('submit step 2: the migration line', (await pg.locator('.xk-field').innerText().catch(() => '')).includes('migration 121'));
  } else {
    ok('submit step 2: the chips work', (await pg.locator('.xk-chips button:not([disabled])').count()) === 8);
    await pg.locator('.xk-chips button', { hasText: /^Bloopers$/ }).click();
    ok('submit step 2: Bloopers on', (await pg.locator('.xk-chips button[aria-pressed="true"]').allTextContents()).join() === 'Bloopers');
  }
  ok('submit step 2: no overflow, no page errors', (await overflowPx(pg)) <= 0 && errors.length === 0, errors);
  await ctx.close();
  await call('/api/creator/drafts', { who: MARA, method: 'DELETE', body: { id: draftId } });
}

async function beforeHttp(b) {
  section('Before 121: every page and route answers, extras read "Extra"');
  for (const [p, who] of [[`/series/${IDS.nightBus}`, SIGNED_OUT], [`/episode/${ID.mara}`, SIGNED_OUT], [`/episode/${IDS.nbS1E3}?autoplay=1`, SIGNED_OUT], ['/creator/my-work', MARA], [`/creator/show/${IDS.nightBus}`, MARA], ['/creator/submit?type=bonus', MARA], ['/admin', ADMIN]]) {
    const r = await page(p, who);
    ok(`${p} → 200`, r.status === 200, r.status);
  }
  let r = await call(`/api/series-hub?id=${encodeURIComponent(IDS.nightBus)}`);
  ok('/api/series-hub → 200, no kind anywhere', r.status === 200 && !/"extraKind":"/.test(r.text), r.status);
  r = await call(`/api/episode-page?id=${encodeURIComponent(ID.mara)}`);
  ok('/api/episode-page → 200 with extraKind null', r.status === 200 && r.json && r.json.episode && r.json.episode.extraKind === null, r.status);
  r = await call('/api/creator/my-submissions', { who: MARA });
  ok('/api/creator/my-submissions → 200, extraKind null', r.status === 200 && r.json && r.json.submissions.filter((s) => s.contentType === 'bonus').every((s) => s.extraKind === null), r.status);
  r = await call(`/api/show/${encodeURIComponent(IDS.nightBus)}`, { who: MARA });
  ok('/api/show/<id> → 200', r.status === 200, r.status);
  r = await call('/api/admin/review-queue', { who: ADMIN });
  const item = r.json && r.json.items ? r.json.items.find((i) => i.id === ID.pending) : null;
  ok('/api/admin/review-queue → 200, the pending extra reads Extra', r.status === 200 && item && /^Extra/.test(item.subtitle || '') && item.meta.extraKind === null, item && item.subtitle);
  r = await call('/api/show', { who: MARA });
  ok('GET /api/show → extraKind.ready false with the line', r.status === 200 && r.json.extraKind && r.json.extraKind.ready === false && /migration 121/.test(r.json.extraKind.line || ''), r.json && r.json.extraKind);
  r = await call(`/api/show/episode/${encodeURIComponent(ID.mara)}`, { who: MARA });
  ok('the editor read: the kind locked with the migration line', r.status === 200 && r.json.policy && r.json.policy.extraKind && r.json.policy.extraKind.mode === 'locked' && /migration 121/.test(r.json.policy.extraKind.line || ''), r.json && r.json.policy && r.json.policy.extraKind);
  r = await patch(MARA, ID.mara, { extraKind: 'interview' });
  ok('a PATCH of extraKind → 200 with notSaved', r.status === 200 && Array.isArray(r.json.notSaved) && r.json.notSaved.some((n) => n.field === 'extraKind' && /migration 121/.test(n.reason || '')), r.text.slice(0, 300));
  r = await patch(MARA, ID.mara, { extraKind: 'interview', description: 'Changed before 121.' });
  ok('a PATCH with the kind and another field saves the other field', r.status === 200 && (rows(`select description from public.episodes where id = ${q(ID.mara)}`)[0] || {}).description === 'Changed before 121.', r.text.slice(0, 300));
  const v1 = await maraVideo('submit-pre');
  r = await call('/api/creator/submit-episode', { who: MARA, method: 'POST', body: submitBody(`Check submitted extra ${RUN} pre`, { videoUid: v1, extraKind: 'Interview' }) });
  const subId = r.json && (r.json.id || (r.json.episode && r.json.episode.id));
  if (subId) created.push(subId);
  ok('submit of a bonus with a kind → 200, saved without it', r.status === 200 && subId && rows(`select id from public.episodes where id = ${q(subId)}`).length === 1, `${r.status} ${r.text.slice(0, 200)}`);

  section('Before 121: the editor and the submit page grey the field');
  const { ctx, page: pg, errors } = await b.open(MARA, 390);
  await goto(pg, `/creator/show/${IDS.nightBus}/episode/${ID.mara}`);
  await pg.locator('.xk-chips button').first().waitFor({ timeout: 30000 }).catch(() => {});
  ok('editor: every chip disabled', (await pg.locator('.xk-chips button:not([disabled])').count()) === 0 && (await pg.locator('.xk-chips button').count()) === 8);
  ok('editor: the migration line under it', (await pg.locator('.xk-field').innerText().catch(() => '')).includes('migration 121'));
  ok('editor: no page errors', errors.length === 0, errors);
  ok('editor: no overflow', (await overflowPx(pg)) <= 0);
  await submitStepTwo(b, true);
  const o = await b.open(SIGNED_OUT, 1280);
  await goto(o.page, `/series/${IDS.nightBus}`);
  await o.page.locator('button.series-tab', { hasText: 'Extras' }).click();
  await o.page.waitForTimeout(500);
  const metas = (await o.page.locator('.spg-extra-meta').allTextContents()).map((t) => t.trim());
  ok('series page Extras: the check extra reads "Extra · 6 min"', metas.filter((t) => t === 'Extra · 6 min').length >= 2 && metas.every((t) => /^Extra/.test(t)), metas);
  ok('series page: no page errors', o.errors.length === 0, o.errors);
  await o.ctx.close();
  await ctx.close();
}

await runCheck('extra-kinds', async () => {
  const with121 = hasColumn('episodes', 'extra_kind');
  console.log(`database ${with121 ? 'has' : 'does not have'} migration 121 — running the ${with121 ? 'after' : 'before'} half`);
  cleanup();
  seed(with121);
  const b = await browser();
  try {
    if (with121) {
      await afterHttp();
      await afterBrowser(b);
    } else {
      await beforeHttp(b);
    }
  } finally {
    await b.close();
    cleanup();
  }
});
