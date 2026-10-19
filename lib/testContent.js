import { getSupabase } from './supabase';
import { likeLiteral } from './likeLiteral';
import { cloudflareUidFromUrl } from './cloudflareUpload';
import { recordOrphan, storagePathFromUrl } from './orphanedMedia';
import { invalidateCache } from './redis';

// Admin → Content → Test content (/admin/test-content; mockup
// mockups/test-content-v1.html, signed off 2026-10-18). Finds what looks
// like a test — placeholders the site generated, anything whose name says
// "test", titles whose creator asked for deletion — plus anything an admin
// adds by name, and deletes it for good. Videos and images go to
// orphaned_media (the Library's Orphaned media card clears them), the same
// as every other delete. Anything with money attached (a paid backing, a
// paid booking) is refused: refund it first so no money record disappears.

const TEST_NAME = /\btest(s|ing)?\b/i;
export const KINDS = ['episode', 'series', 'pitch', 'location', 'call'];

const KIND_LABEL = { episode: 'Title', series: 'Series', pitch: 'Pitch', location: 'Location', call: 'Crew call' };
const TYPE_LABEL = { movie: 'Movie', short: 'Short', series: 'Episode', podcast: 'Podcast episode', vertical: 'Vertical' };

function episodeMedia(e) {
  return [cloudflareUidFromUrl(e.src), cloudflareUidFromUrl(e.trailer_src), storagePathFromUrl(e.poster), storagePathFromUrl(e.thumbnail)].filter(Boolean).length;
}
function seriesMedia(s) {
  return [cloudflareUidFromUrl(s.trailer_src), storagePathFromUrl(s.poster), storagePathFromUrl(s.thumbnail)].filter(Boolean).length;
}

// Pitch and location images sit in the same episode-art bucket.
function imagePaths(urls) {
  return [...new Set(urls.flat().map((u) => (u && typeof u === 'object' ? u.url : u)).filter((u) => typeof u === 'string').map(storagePathFromUrl).filter(Boolean))];
}
function pitchImages(p) {
  return imagePaths([p.thumbnail, p.hero_image, Array.isArray(p.photos) ? p.photos : []]);
}

const PITCH_COLS = 'id, title, status, thumbnail, hero_image, photos, created_at';
const LOCATION_COLS = 'id, title, status, proof_url, created_at';
const EP_COLS = 'id, title, status, content_type, tier, is_placeholder, series_id, deletion_requested, src, trailer_src, poster, thumbnail, created_at';
const SERIES_COLS = 'id, name, status, is_placeholder, deletion_requested, trailer_src, poster, thumbnail, created_at';

async function moneyBlocks(supabase, pitchIds, locationIds) {
  const blocks = {};
  if (pitchIds.length) {
    const { data } = await supabase.from('pitch_donations').select('pitch_id, status').in('pitch_id', pitchIds).in('status', ['completed', 'refunded']);
    for (const d of data || []) blocks[`pitch:${d.pitch_id}`] = (blocks[`pitch:${d.pitch_id}`] || 0) + 1;
  }
  if (locationIds.length) {
    const { data } = await supabase.from('location_requests').select('location_id, status, paid_at').in('location_id', locationIds);
    for (const r of data || []) {
      if (r.paid_at || ['paid', 'done', 'refunded'].includes(r.status)) blocks[`location:${r.location_id}`] = (blocks[`location:${r.location_id}`] || 0) + 1;
    }
  }
  return blocks;
}

async function locationPhotoCounts(supabase, ids) {
  if (!ids.length) return {};
  const { data } = await supabase.from('location_photos').select('location_id, url').in('location_id', ids);
  const counts = {};
  for (const p of data || []) if (storagePathFromUrl(p.url)) counts[p.location_id] = (counts[p.location_id] || 0) + 1;
  return counts;
}

function blockText(kind, n) {
  if (kind === 'pitch') return `Has ${n} paid backing${n === 1 ? '' : 's'} — refund them on Pitches & comments first`;
  return `Has ${n} paid booking${n === 1 ? '' : 's'} — refund them on Locations first`;
}

// Rows for the page. Placeholders with the same name are folded into one
// row ("5 copies"); a series carries its episodes along.
function buildRows({ episodes, series, pitches, locations, calls, blocks, photoCounts = {}, reasonFor }) {
  const seriesById = new Map(series.map((s) => [s.id, s]));
  const episodesBySeries = new Map();
  for (const e of episodes) {
    if (!e.series_id) continue;
    if (!episodesBySeries.has(e.series_id)) episodesBySeries.set(e.series_id, []);
    episodesBySeries.get(e.series_id).push(e);
  }

  const rows = [];
  const placeholderFolds = new Map();
  function fold(key, row) {
    const had = placeholderFolds.get(key);
    if (!had) { placeholderFolds.set(key, row); return; }
    had.items.push(...row.items);
    had.copies += 1;
    had.rowCount += row.rowCount;
    had.media += row.media;
  }

  for (const s of series) {
    const eps = episodesBySeries.get(s.id) || [];
    const reasons = reasonFor('series', s.name, s);
    const row = {
      kind: 'series',
      title: s.name,
      items: [{ kind: 'series', id: s.id }],
      copies: 1,
      rowCount: 1 + eps.length,
      media: seriesMedia(s) + eps.reduce((n, e) => n + episodeMedia(e), 0),
      along: [...new Set(eps.map((e) => e.title))],
      meta: `Series · ${s.status}${eps.length ? ` · ${eps.length === 1 ? '1 episode goes' : `${eps.length} episodes go`} with it` : ''}`,
      reasons,
      blocked: null
    };
    if (s.is_placeholder) fold(`series:${s.name}`, row); else rows.push({ group: 'series', ...row });
  }

  for (const e of episodes) {
    // An episode of a listed series goes with that series instead.
    if (e.series_id && seriesById.has(e.series_id)) continue;
    const reasons = reasonFor('episode', e.title, e);
    const row = {
      kind: 'episode',
      title: e.title,
      items: [{ kind: 'episode', id: e.id }],
      copies: 1,
      rowCount: 1,
      media: episodeMedia(e),
      along: [],
      meta: `${TYPE_LABEL[e.content_type] || 'Title'} · ${e.status}${e.tier === 'premium' ? ' · premium' : ''}`,
      reasons,
      blocked: null
    };
    if (e.is_placeholder) fold(`episode:${e.content_type}:${e.title}`, row); else rows.push({ group: 'titles', ...row });
  }

  for (const p of pitches) {
    const n = blocks[`pitch:${p.id}`];
    rows.push({ group: 'other', kind: 'pitch', title: p.title, items: [{ kind: 'pitch', id: p.id }], copies: 1, rowCount: 1, media: pitchImages(p).length, along: [], meta: `Pitch · ${p.status} · its likes, saves and comments go with it`, reasons: reasonFor('pitch', p.title, p), blocked: n ? blockText('pitch', n) : null });
  }
  for (const l of locations) {
    const n = blocks[`location:${l.id}`];
    rows.push({ group: 'other', kind: 'location', title: l.title, items: [{ kind: 'location', id: l.id }], copies: 1, rowCount: 1, media: (photoCounts[l.id] || 0) + (storagePathFromUrl(l.proof_url) ? 1 : 0), along: [], meta: `Location · ${l.status} · its photos, requests and blocked days go with it`, reasons: reasonFor('location', l.title, l), blocked: n ? blockText('location', n) : null });
  }
  for (const c of calls) {
    rows.push({ group: 'other', kind: 'call', title: c.title || c.role || 'Crew call', items: [{ kind: 'call', id: c.id }], copies: 1, rowCount: 1, media: 0, along: [], meta: `Crew call · ${c.status} · its responses go with it`, reasons: reasonFor('call', c.title, c), blocked: null });
  }

  for (const row of placeholderFolds.values()) {
    rows.push({ group: 'placeholders', ...row, meta: `${row.meta.split(' · ')[0]}${row.copies > 1 ? ` · ${row.copies} copies` : ''}${row.along.length ? ` · each with ${row.along.map((t) => `“${t.replace(/^\[Placeholder\]\s*/, '')}”`).join(' and ')}` : ''}` });
  }

  return rows.map((r) => ({
    ...r,
    key: r.items.map((i) => `${i.kind}:${i.id}`).join(','),
    // Ticked when the page opens: placeholders and deletion requests.
    // Something that only *says* test waits for a tick, so a real film
    // with "test" in its name can't go by accident.
    preselect: !r.blocked && r.reasons.some((x) => x === 'placeholder' || x === 'deletion_requested')
  }));
}

function detectReasons(kind, name, row) {
  const reasons = [];
  if (row.is_placeholder) reasons.push('placeholder');
  if (row.deletion_requested) reasons.push('deletion_requested');
  if (name && TEST_NAME.test(name)) reasons.push('name_test');
  return reasons;
}

async function loadAll(supabase) {
  const [ep, se, pi, lo, ca] = await Promise.all([
    supabase.from('episodes').select(EP_COLS).order('created_at'),
    supabase.from('series').select(SERIES_COLS).order('created_at'),
    supabase.from('pitches').select(PITCH_COLS).order('created_at'),
    supabase.from('locations').select(LOCATION_COLS).order('created_at'),
    supabase.from('crew_calls').select('id, title, role, status, created_at').order('created_at')
  ]);
  for (const r of [ep, se, pi, lo]) if (r.error) throw new Error(r.error.message);
  return { episodes: ep.data || [], series: se.data || [], pitches: pi.data || [], locations: lo.data || [], calls: ca.error ? [] : (ca.data || []) };
}

export async function findTestContent() {
  const supabase = getSupabase();
  const all = await loadAll(supabase);
  const flagged = (kind, name, row) => detectReasons(kind, name, row).length > 0;

  const series = all.series.filter((s) => flagged('series', s.name, s));
  const seriesIds = new Set(series.map((s) => s.id));
  // A flagged series brings every episode it has; other episodes only when flagged themselves.
  const episodes = all.episodes.filter((e) => (e.series_id && seriesIds.has(e.series_id)) || flagged('episode', e.title, e));
  const pitches = all.pitches.filter((p) => flagged('pitch', p.title, p));
  const locations = all.locations.filter((l) => flagged('location', l.title, l));
  const calls = all.calls.filter((c) => flagged('call', c.title, c));

  const blocks = await moneyBlocks(supabase, pitches.map((p) => p.id), locations.map((l) => l.id));
  const photoCounts = await locationPhotoCounts(supabase, locations.map((l) => l.id));
  return buildRows({ episodes, series, pitches, locations, calls, blocks, photoCounts, reasonFor: detectReasons });
}

// "Add something else by name": anything matching, flagged or not.
export async function searchContent(q) {
  const text = String(q || '').trim().slice(0, 80);
  if (text.length < 2) return [];
  const pattern = `%${likeLiteral(text)}%`;
  const supabase = getSupabase();
  const [ep, se, pi, lo, ca] = await Promise.all([
    supabase.from('episodes').select(EP_COLS).ilike('title', pattern).limit(20),
    supabase.from('series').select(SERIES_COLS).ilike('name', pattern).limit(20),
    supabase.from('pitches').select(PITCH_COLS).ilike('title', pattern).limit(20),
    supabase.from('locations').select(LOCATION_COLS).ilike('title', pattern).limit(20),
    supabase.from('crew_calls').select('id, title, role, status').ilike('title', pattern).limit(20)
  ]);
  const series = se.data || [];
  const seriesIds = series.map((s) => s.id);
  let episodes = ep.data || [];
  if (seriesIds.length) {
    const { data: children } = await supabase.from('episodes').select(EP_COLS).in('series_id', seriesIds);
    const have = new Set(episodes.map((e) => e.id));
    episodes = episodes.concat((children || []).filter((e) => !have.has(e.id)));
  }
  const pitches = pi.data || [];
  const locations = lo.data || [];
  const blocks = await moneyBlocks(supabase, pitches.map((p) => p.id), locations.map((l) => l.id));
  const photoCounts = await locationPhotoCounts(supabase, locations.map((l) => l.id));
  const rows = buildRows({ episodes, series, pitches, locations, calls: ca.error ? [] : (ca.data || []), blocks, photoCounts, reasonFor: (kind, name, row) => {
    const r = detectReasons(kind, name, row);
    return r.length ? r : ['added'];
  } });
  return rows.map((r) => ({ ...r, group: 'search', preselect: false }));
}

async function orphanEpisode(e, reason) {
  const uid = cloudflareUidFromUrl(e.src);
  const trailer = cloudflareUidFromUrl(e.trailer_src);
  const poster = storagePathFromUrl(e.poster);
  const thumb = storagePathFromUrl(e.thumbnail);
  await Promise.all([
    uid ? recordOrphan({ kind: 'cloudflare_video', reference: uid, reason, context: e.title }) : null,
    trailer ? recordOrphan({ kind: 'cloudflare_video', reference: trailer, reason: `${reason} (trailer)`, context: e.title }) : null,
    poster ? recordOrphan({ kind: 'storage_image', reference: poster, reason: `${reason} (poster)`, context: e.title }) : null,
    thumb ? recordOrphan({ kind: 'storage_image', reference: thumb, reason: `${reason} (thumbnail)`, context: e.title }) : null
  ]);
  return [uid, trailer, poster, thumb].filter(Boolean).length;
}

async function deleteEpisodes(supabase, episodes, reason) {
  let media = 0;
  for (const e of episodes) media += await orphanEpisode(e, reason);
  const ids = episodes.map((e) => e.id);
  if (!ids.length) return { count: 0, media };
  // Tables that hold an episode id without a foreign key.
  await supabase.from('watch_history').delete().in('episode_id', ids);
  await supabase.from('notifications').delete().in('episode_id', ids);
  const { error, count } = await supabase.from('episodes').delete({ count: 'exact' }).in('id', ids);
  if (error) throw new Error(`Could not delete titles: ${error.message}`);
  return { count: count || 0, media };
}

// items: [{ kind, id }]. Re-reads everything; never trusts the page.
export async function deleteTestContent(items) {
  const supabase = getSupabase();
  const want = {};
  for (const k of KINDS) want[k] = [];
  for (const it of Array.isArray(items) ? items.slice(0, 500) : []) {
    if (it && KINDS.includes(it.kind) && it.id) want[it.kind].push(String(it.id));
  }

  const result = { deleted: { episode: 0, series: 0, pitch: 0, location: 0, call: 0 }, media: 0, skipped: [], titles: [] };
  const reason = 'test content deleted';

  // Series first: their episodes go with them.
  if (want.series.length) {
    const { data: series, error } = await supabase.from('series').select(SERIES_COLS).in('id', want.series);
    if (error) throw new Error(error.message);
    const ids = (series || []).map((s) => s.id);
    if (ids.length) {
      const { data: eps } = await supabase.from('episodes').select(EP_COLS).in('series_id', ids);
      const r = await deleteEpisodes(supabase, eps || [], reason);
      result.deleted.episode += r.count;
      result.media += r.media;
      for (const s of series) {
        const trailer = cloudflareUidFromUrl(s.trailer_src);
        const poster = storagePathFromUrl(s.poster);
        const thumb = storagePathFromUrl(s.thumbnail);
        await Promise.all([
          trailer ? recordOrphan({ kind: 'cloudflare_video', reference: trailer, reason: `${reason} (trailer)`, context: s.name }) : null,
          poster ? recordOrphan({ kind: 'storage_image', reference: poster, reason: `${reason} (poster)`, context: s.name }) : null,
          thumb ? recordOrphan({ kind: 'storage_image', reference: thumb, reason: `${reason} (thumbnail)`, context: s.name }) : null
        ]);
        result.media += [trailer, poster, thumb].filter(Boolean).length;
      }
      const { error: delErr, count } = await supabase.from('series').delete({ count: 'exact' }).in('id', ids);
      if (delErr) throw new Error(`Could not delete series: ${delErr.message}`);
      result.deleted.series += count || 0;
      result.titles.push(...series.map((s) => s.name));
    }
  }

  if (want.episode.length) {
    const { data: eps, error } = await supabase.from('episodes').select(EP_COLS).in('id', want.episode);
    if (error) throw new Error(error.message);
    const r = await deleteEpisodes(supabase, eps || [], reason);
    result.deleted.episode += r.count;
    result.media += r.media;
    result.titles.push(...(eps || []).map((e) => e.title));
  }

  const blocks = await moneyBlocks(supabase, want.pitch, want.location);
  for (const kind of ['pitch', 'location']) {
    if (!want[kind].length) continue;
    const table = kind === 'pitch' ? 'pitches' : 'locations';
    const { data: rows } = await supabase.from(table).select(kind === 'pitch' ? PITCH_COLS : LOCATION_COLS).in('id', want[kind]);
    const ok = [];
    for (const row of rows || []) {
      const n = blocks[`${kind}:${row.id}`];
      if (n) result.skipped.push({ title: row.title, reason: blockText(kind, n) });
      else ok.push(row);
    }
    if (ok.length) {
      const ids = ok.map((r) => r.id);
      let images = [];
      if (kind === 'pitch') {
        for (const p of ok) images.push(...pitchImages(p).map((path) => ({ path, context: p.title })));
      } else {
        const { data: photos } = await supabase.from('location_photos').select('location_id, url').in('location_id', ids);
        const titleOf = Object.fromEntries(ok.map((l) => [l.id, l.title]));
        images = imagePaths((photos || []).map((p) => p.url)).map((path) => ({ path, context: titleOf[(photos.find((p) => storagePathFromUrl(p.url) === path) || {}).location_id] }));
        for (const l of ok) { const proof = storagePathFromUrl(l.proof_url); if (proof) images.push({ path: proof, context: `${l.title} (proof)` }); }
      }
      await Promise.all(images.map((im) => recordOrphan({ kind: 'storage_image', reference: im.path, reason, context: im.context })));
      result.media += images.length;
      const { error, count } = await supabase.from(table).delete({ count: 'exact' }).in('id', ids);
      if (error) throw new Error(`Could not delete ${table}: ${error.message}`);
      result.deleted[kind] += count || 0;
      result.titles.push(...ok.map((r) => r.title));
    }
  }

  if (want.call.length) {
    const { data: calls } = await supabase.from('crew_calls').select('id, title, role').in('id', want.call);
    const ids = (calls || []).map((c) => c.id);
    if (ids.length) {
      const { error, count } = await supabase.from('crew_calls').delete({ count: 'exact' }).in('id', ids);
      if (error) throw new Error(`Could not delete crew calls: ${error.message}`);
      result.deleted.call += count || 0;
      result.titles.push(...calls.map((c) => c.title || c.role));
    }
  }

  if (result.deleted.episode) await invalidateCache('public_episodes_v1');
  if (result.deleted.series) await invalidateCache('all_series_approved_v1');
  return result;
}

export { KIND_LABEL };
