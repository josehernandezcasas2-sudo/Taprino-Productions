import { getSupabase } from './supabase';
import { getPublicEpisodes } from './publicEpisodes';
import { isPublicShow, normalizeCredits } from './showRules';

// Linked credits (decision 20; slice 6): a show's or a title's Studio and
// Producer lines can be tied to an account (`series.credits` /
// `episodes.credits`, migration 118: { studio: { name, userId },
// producer: { name, userId } }). This module answers two questions for the
// public side, server only:
//
//   linkedCreditTitles(userId)  the titles that name this account, for the
//                               profile's "Tagged in" grid (through
//                               getCreditedWork in lib/userProfiles.js)
//   linkedCreditAccounts()      every account named on a title, with the
//                               titles' names, for Artist Support's pick
//                               list (lib/artistSupport.js)
//
// Only what the public catalogue shows counts: a public show
// (isPublicShow: approved, not pulled, not on its way out) for a show's own
// credit, a title getPublicEpisodes lists for an episode's or a standalone
// title's own credit. A database before migration 118 has no `credits`
// column: both answer nothing, and nothing errors. Every read is bounded.

const CREDIT_KEYS = ['studio', 'producer'];
const LABEL = { studio: 'Studio', producer: 'Producer' };
const MAX_ROWS = 500;
// The value goes into a PostgREST or() string: an id with anything but
// these characters (a Clerk id never has any) is never looked up.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

// The role words a title's own credits give this account: "Studio",
// "Producer", or "Studio and Producer"; null when neither line names it.
export function linkedCreditRole(credits, userId) {
  if (!userId) return null;
  const c = normalizeCredits(credits);
  const keys = CREDIT_KEYS.filter((k) => c[k] && c[k].userId === userId);
  if (!keys.length) return null;
  return keys.map((k) => LABEL[k]).join(' and ');
}

// The account ids a title's own credits name.
function linkedIds(credits) {
  const c = normalizeCredits(credits);
  return [...new Set(CREDIT_KEYS.map((k) => (c[k] && c[k].userId ? c[k].userId : null)).filter(Boolean))];
}

// Rows of `table` whose own credits name an account: the one given, or
// (without one) any. [] before 118; a failed read is logged and answers
// [] — or, with `strict` (Artist Support's list), throws.
async function readLinkedRows(table, columns, userId, { strict = false } = {}) {
  const path = (k) => `credits->${k}->>userId`;
  const filter = userId
    ? CREDIT_KEYS.map((k) => `${path(k)}.eq.${userId}`).join(',')
    : CREDIT_KEYS.map((k) => `${path(k)}.not.is.null`).join(',');
  const { data, error } = await getSupabase().from(table).select(columns).or(filter).limit(MAX_ROWS);
  if (error) {
    if (isMissingColumn(error)) return [];
    console.error(`linkedCredits (${table}):`, error.message);
    if (strict) throw new Error(`linkedCredits: the ${table} read failed`);
    return [];
  }
  return data || [];
}

// `kind` (series | podcast | vertical) arrives with `credits`, in 118.
const SERIES_COLUMNS = 'id, name, poster, thumbnail, created_at, status, moderation_hold, deletion_requested, kind, credits';
const EPISODE_COLUMNS = 'id, credits';

// The public titles whose credits name this account, as the profile grid
// draws them: { id, title, poster, type, contentType, mainGenre,
// createdAt, role, seriesId }. A show's own credit lists the show; an
// episode's own credit (overriding its show's) lists the episode, unless
// its show is listed for this account already. The caller drops titles
// the account made itself (they are listed once, without a role).
export async function linkedCreditTitles(userId) {
  if (!userId || !SAFE_ID.test(String(userId))) return [];
  const [seriesRows, episodeRows] = await Promise.all([
    readLinkedRows('series', SERIES_COLUMNS, userId),
    readLinkedRows('episodes', EPISODE_COLUMNS, userId)
  ]);
  const out = [];
  const listedShows = new Set();
  for (const s of seriesRows) {
    if (!isPublicShow(s)) continue;
    const role = linkedCreditRole(s.credits, userId);
    if (!role) continue;
    listedShows.add(s.id);
    out.push({
      id: s.id,
      title: s.name ?? null,
      poster: s.poster || s.thumbnail || null,
      type: 'series',
      // A podcast show reads "Podcast · Producer", like its episodes.
      contentType: s.kind === 'podcast' ? 'podcast' : 'series',
      mainGenre: null,
      createdAt: s.created_at ?? null,
      role,
      seriesId: null
    });
  }
  const linkedEpisodes = episodeRows.filter((e) => linkedCreditRole(e.credits, userId));
  if (linkedEpisodes.length) {
    const publicById = new Map((await getPublicEpisodes()).map((e) => [e.id, e]));
    for (const row of linkedEpisodes) {
      const e = publicById.get(row.id);
      if (!e) continue;
      if (e.seriesId && listedShows.has(e.seriesId)) continue;
      out.push({
        id: e.id,
        title: e.title,
        poster: e.poster || e.thumbnail || null,
        type: 'episode',
        contentType: e.contentType,
        mainGenre: e.mainGenre || null,
        createdAt: e.createdAt,
        role: linkedCreditRole(row.credits, userId),
        seriesId: e.seriesId || null
      });
    }
  }
  return out;
}

// Every account a public title's credits name: Map(userId → { titles:
// [name…], mostRecent }). Artist Support decides who of them may be
// picked (lib/artistSupport.js). { strict } throws when a read fails
// (members' picks are paid from that list) instead of answering fewer.
export async function linkedCreditAccounts({ strict = false } = {}) {
  const [seriesRows, episodeRows] = await Promise.all([
    readLinkedRows('series', SERIES_COLUMNS, null, { strict }),
    readLinkedRows('episodes', EPISODE_COLUMNS, null, { strict })
  ]);
  const byAccount = new Map();
  const add = (userId, title, createdAt) => {
    if (!userId || !title) return;
    if (!byAccount.has(userId)) byAccount.set(userId, { titles: new Set(), mostRecent: createdAt || null });
    const entry = byAccount.get(userId);
    entry.titles.add(title);
    if (createdAt && (!entry.mostRecent || createdAt > entry.mostRecent)) entry.mostRecent = createdAt;
  };
  for (const s of seriesRows) {
    if (!isPublicShow(s)) continue;
    for (const id of linkedIds(s.credits)) add(id, s.name, s.created_at);
  }
  if (episodeRows.length) {
    const publicById = new Map((await getPublicEpisodes({ strict })).map((e) => [e.id, e]));
    for (const row of episodeRows) {
      const e = publicById.get(row.id);
      if (!e) continue;
      for (const id of linkedIds(row.credits)) add(id, e.title, e.createdAt);
    }
  }
  return byAccount;
}
