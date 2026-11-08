#!/usr/bin/env node
// Payee invites accepted with nothing moved (lib/payees.js
// stuckAcceptedInvites / finishStuckInvite, the daily
// /api/cron/creator-reminders) and their supabase/health_check.sql row:
//   one that can still go through is finished (the column, its history
//   stamped invite:<id>, the audit line, both sides told), one whose
//   invitee can't be paid any more is withdrawn and both told, one whose
//   acceptance went through (its audit line) and one still under way are
//   left alone; one older than three days is withdrawn as stale.
// The cron also runs its other daily steps (reminders, crew pay, the payee
// cut-over and repair, prices); those are idempotent repairs of the seed.
//   node dev/test-rig/checks/payee-invites.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import { IDS, USERS, RUN, ok, section, runCheck, call, sql, rows, q, insert, ago, uidFor } from './lib.mjs';
import { spawnSync } from 'node:child_process';
import { PSQL, PORTS, HOST } from '../lib/config.mjs';

const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const FILMS = ['a', 'b', 'c', 'd', 'e'].map((k) => `ck-pay-${k}-${RUN}`);
const INV = Object.fromEntries(['finish', 'role', 'done', 'young', 'stale'].map((k) => [k, crypto.randomUUID()]));
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

function seed() {
  FILMS.forEach((id, i) => insert('episodes', {
    id, title: `Check payee film ${i + 1} ${RUN}`, description: 'Payee check.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie', artist: 'Mara Reyes',
    runtime: '1:00:00', rating: 'TV-PG', release_year: 2026, src: src(IDS.film), video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, deletion_requested: false,
    moderation_hold: false, submitted_by: USERS.mara, status: 'approved', reviewed_at: ago(9), released_at: ago(9), created_at: ago(10)
  }));
  const invite = (id, film, invitee, decided) => insert('payee_invites', { id, title_type: 'episode', title_id: film, invitee_id: invitee, invited_by: USERS.mara, status: 'accepted', created_at: minutesAgo(24 * 60 * 5), decided_at: decided });
  invite(INV.finish, FILMS[0], USERS.dee, minutesAgo(30));
  invite(INV.role, FILMS[1], USERS.viewer, minutesAgo(30));
  invite(INV.done, FILMS[2], USERS.dee, minutesAgo(30));
  invite(INV.young, FILMS[3], USERS.dee, minutesAgo(2));
  invite(INV.stale, FILMS[4], USERS.dee, minutesAgo(24 * 60 * 3 + 30));
  // C's acceptance went through and moved nobody's money: its audit line.
  insert('audit_log', { admin_id: USERS.dee, action: 'payee_invite_accepted', target_type: 'episode', target_id: FILMS[2], details: JSON.stringify({ actor: 'payee', words: 'accepted', inviteId: INV.done }) });
}
function cleanup() {
  const ids = FILMS.map(q).join(', ');
  sql(`delete from public.payee_invites where title_id in (${ids})`);
  sql(`delete from public.title_payees where title_id in (${ids})`);
  sql(`delete from public.audit_log where target_id in (${ids})`);
  sql(`delete from public.notifications where message like '%Check payee film%'`);
  sql(`delete from public.episodes where id in (${ids})`);
}
// The health check's row, read from the file itself (psql runs it the way
// the SQL Editor would; unaligned output, '|' between columns).
function healthStuck() {
  const file = new URL('../../../supabase/health_check.sql', import.meta.url).pathname;
  const r = spawnSync(PSQL, ['-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-h', HOST, '-p', String(PORTS.postgres), '-U', 'postgres', '-d', 'postgres', '-f', file], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const line = (r.stdout || '').split('\n').find((l) => l.includes('Payee invites accepted with nothing moved'));
  return line ? Number(line.split('|')[2]) : null;
}
const inv = (id) => rows(`select status, decided_at from public.payee_invites where id = ${q(id)}`)[0] || {};
const paidTo = (id) => (rows(`select paid_to from public.episodes where id = ${q(id)}`)[0] || {}).paid_to;

await runCheck('payee-invites', async () => {
  cleanup();
  const before = healthStuck();
  ok('health_check.sql runs and has the row', typeof before === 'number', before);
  seed();
  try {
    section('Before the daily repair');
    ok('the health check counts the one older than two days', healthStuck() === before + 1, `${before} → ${healthStuck()}`);
    section('The daily repair (/api/cron/creator-reminders)');
    const r = await call('/api/cron/creator-reminders', { method: 'POST', headers: { Authorization: 'Bearer rig-cron-secret' } });
    ok('the cron answers 200', r.status === 200, `${r.status} ${r.text.slice(0, 300)}`);
    const rep = r.json && r.json.payeeRepair;
    ok('…one finished, two withdrawn (no access, stale)', rep && rep.invitesFinished === 1 && rep.stuckWithdrawn === 2, rep);
    ok('finished: the title pays the invitee now', paidTo(FILMS[0]) === USERS.dee, paidTo(FILMS[0]));
    ok('finished: its history row is stamped invite:<id>', rows(`select payee_id from public.title_payees where set_by = ${q(`invite:${INV.finish}`)}`).some((x) => x.payee_id === USERS.dee));
    ok('finished: the invite stays accepted', inv(INV.finish).status === 'accepted');
    const audit = rows(`select details from public.audit_log where target_id = ${q(FILMS[0])} and action = 'payee_invite_accepted'`);
    ok('finished: an audit line says the repair finished it', audit.some((a) => /"finishedBy":"repair"/.test(a.details || '')), audit);
    ok('finished: the inviter and the invitee are told', rows(`select user_id, type from public.notifications where message like '%Check payee film 1 ${RUN}%'`).length >= 2);
    ok('no Creator Studio: withdrawn (cancelled), nothing moved', inv(INV.role).status === 'cancelled' && paidTo(FILMS[1]) === null, { inv: inv(INV.role), paid: paidTo(FILMS[1]) });
    ok('…both sides told nothing moved', rows(`select user_id from public.notifications where type = 'payee_invite_cancelled' and message like '%Check payee film 2 ${RUN}%'`).length === 2);
    ok('went through already (its audit line): left alone', inv(INV.done).status === 'accepted' && paidTo(FILMS[2]) === null);
    ok('still under way (two minutes): left alone', inv(INV.young).status === 'accepted' && paidTo(FILMS[3]) === null);
    ok('older than three days: withdrawn as stale', inv(INV.stale).status === 'cancelled' && paidTo(FILMS[4]) === null);
    ok('the health check is back where it was', healthStuck() === before, `${before} → ${healthStuck()}`);
    const again = await call('/api/cron/creator-reminders', { method: 'POST', headers: { Authorization: 'Bearer rig-cron-secret' } });
    ok('a second run changes nothing', again.status === 200 && again.json.payeeRepair.invitesFinished === 0 && again.json.payeeRepair.stuckWithdrawn === 0, again.json && again.json.payeeRepair);
    const noAuth = await call('/api/cron/creator-reminders', { method: 'POST' });
    ok('the cron refuses a call without the secret or an admin', noAuth.status === 403, noAuth.status);
  } finally {
    cleanup();
  }
});
