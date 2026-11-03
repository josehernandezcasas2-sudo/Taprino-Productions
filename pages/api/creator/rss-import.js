import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { validateRemoteVideoUrl } from '../../../lib/urlValidation';
import { importAudioFromUrl } from '../../../lib/audioUpload';
import { checkRateLimit } from '../../../lib/rateLimit';
import { internalError, sendError } from '../../../lib/apiErrors';
import { isTitleId } from '../../../lib/titleIds';
import { creatorOwnsSeries } from '../../../lib/series';
import { createShow, mintTitleId } from '../../../lib/showPage';
import { FILES_PER_DROP, SHOW_KINDS, applyShowDefaults, inRunningOrder, kindFromEpisodes, nextFreeNumber, planBatch } from '../../../lib/showRules';

// Takes the episode list the creator already reviewed and checked off in
// the preview step (see rss-preview.js) — deliberately does NOT re-fetch
// the feed here. The creator already saw exactly this data on screen and
// chose what to import; re-fetching could return something different if
// the feed changed in between, silently importing something they never
// actually saw. Each audioUrl still gets the same SSRF-safe validation
// and content-type/size checks as any other imported audio, same as if
// it had been pasted in by hand — the fact that it came from a feed
// doesn't make it any more trustworthy than a manually-pasted link.
//
// The series revamp (amendment 7, 2026-11-02):
//   - a new show is made by createShow (lib/showPage.js) as a podcast,
//     private until it is made public, with the import's choices as its
//     defaults — and removed again when nothing could be imported;
//   - an existing show has to be the creator's, take new episodes (not
//     declined, pulled or leaving) and be a podcast (or still empty);
//   - numbers come from lib/showRules.js planBatch over the show's own
//     rows: an item's itunes:episode is honoured when it's free, the rest
//     take the next free numbers, oldest first by publish date (feeds list
//     the newest first; the old numbering, "its place in the list",
//     numbered a feed backwards and collided with the show's own
//     episodes);
//   - an item already in the show (the same title, at its number when it
//     carries one) or listed twice is skipped, and the answer says which:
//     re-importing a feed adds only what's new.
// The show's defaults (Who can watch, rating, genres, Made by, ads) fill
// whatever the import left blank, copied onto each episode (amendment 2).
const MAX_ITEMS = 100;

function posInt(v) {
  if (v === undefined || v === null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function text(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

function sameTitle(a, b) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) !== '' && norm(a) === norm(b);
}

function timeOf(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  // One import can pull up to 100 audio files into storage, so imports
  // are a few an hour per creator (security round, 2026-10-26).
  if (!(await checkRateLimit(`rss-import:${userId}`, 5, 3600))) {
    return res.status(429).json({ error: 'That’s a lot of imports for one hour — try again later.' });
  }

  try {
    return await importFeed(req, res, { userId, email, isAdmin });
  } catch (err) {
    return sendError(res, err, 'creator/rss-import', 'Could not import the feed. Try again in a moment.', { plainStatus: 400 });
  }
}

async function importFeed(req, res, { userId, email, isAdmin }) {
  const { showName, seriesId: existingSeriesId, episodes, defaultTier, defaultMainGenre, defaultGenre, defaultArtist, defaultRating } = req.body || {};
  if (!Array.isArray(episodes) || episodes.length === 0) {
    return res.status(400).json({ error: 'No episodes selected to import.' });
  }
  if (episodes.length > MAX_ITEMS) {
    return res.status(400).json({ error: 'Import at most 100 episodes at a time — split larger back-catalogs into batches.' });
  }
  const newName = text(showName, 120);
  if (!existingSeriesId && !newName) {
    return res.status(400).json({ error: 'Name the show, or choose an existing one to import into.' });
  }

  const supabase = getSupabase();

  // Only into a show you own (an admin can import into any), that takes
  // new episodes, and that is a podcast.
  let show = null;
  let rows = [];
  let adoptKind = false;
  if (existingSeriesId) {
    if (!isTitleId(String(existingSeriesId))) return res.status(404).json({ error: 'That show doesn’t exist.' });
    const { data, error } = await supabase.from('series').select('*').eq('id', String(existingSeriesId)).maybeSingle();
    if (error) throw internalError(error, 'rss-import show');
    if (!data) return res.status(404).json({ error: 'That show doesn’t exist.' });
    if (!(await creatorOwnsSeries(userId, data.id, { isAdmin }))) return res.status(403).json({ error: 'You can only import into your own shows.' });
    if (data.deletion_requested) return res.status(400).json({ error: 'That show’s removal is requested — it takes nothing new.' });
    if (data.status === 'rejected' && !isAdmin) return res.status(400).json({ error: 'An admin declined that show — resubmit it before adding to it.' });
    if (data.moderation_hold && !isAdmin) return res.status(400).json({ error: 'That show is pulled while an admin looks at it — nothing can be added for now.' });
    const column = SHOW_KINDS.includes(data.kind) ? data.kind : null;
    if (column === 'vertical') return res.status(400).json({ error: 'That is a vertical series: a podcast feed goes into a podcast.' });
    const { data: rowData, error: rowsError } = await supabase.from('episodes').select('id, title, season, series_order, status, content_type, withdrawn_at, created_at').eq('series_id', data.id);
    if (rowsError) throw internalError(rowsError, 'rss-import rows');
    rows = rowData || [];
    const placed = rows.filter((r) => inRunningOrder(r) && (r.content_type === 'series' || r.content_type === 'podcast'));
    if (placed.length > 0 && (column || kindFromEpisodes(placed)) !== 'podcast') {
      return res.status(400).json({ error: 'That show is a series: a podcast feed goes into a podcast.' });
    }
    // An empty show (made through "Add series", which sends no kind)
    // becomes a podcast with its first import.
    adoptKind = placed.length === 0 && Object.prototype.hasOwnProperty.call(data, 'kind') && column !== 'podcast';
    show = data;
  }

  // What each episode gets: the import's choices, the show's defaults in
  // the blanks, then the old fallbacks.
  const chosen = applyShowDefaults({
    tier: defaultTier === 'premium' || defaultTier === 'free' ? defaultTier : null,
    rating: text(defaultRating, 40) || null,
    mainGenre: text(defaultMainGenre, 60) || null,
    genre: text(defaultGenre, 120) || null,
    artist: text(defaultArtist, 120) || null
  }, show);
  const fields = {
    tier: chosen.tier === 'premium' ? 'premium' : 'free',
    rating: chosen.rating || null,
    main_genre: chosen.mainGenre || null,
    genre: chosen.genre || null,
    artist: chosen.artist || null,
    ads_enabled: chosen.adsEnabled !== false
  };

  // The items as the feed gave them, the ones already here or listed
  // twice set aside.
  const skipped = [];
  const seenGuids = new Set();
  const items = [];
  episodes.forEach((raw, i) => {
    const ep = raw && typeof raw === 'object' ? raw : {};
    const item = {
      at: i,
      guid: text(ep.guid, 500) || `item-${i}`,
      title: text(ep.title, 200),
      description: typeof ep.description === 'string' ? ep.description.slice(0, 5000) : '',
      audioUrl: ep.audioUrl,
      pubDate: ep.pubDate || null,
      season: posInt(ep.season),
      number: posInt(ep.episodeNumber),
      runtime: text(ep.runtime, 20)
    };
    if (seenGuids.has(item.guid)) {
      skipped.push({ title: item.title || `Item ${i + 1}`, reason: 'Listed twice in this import' });
      return;
    }
    seenGuids.add(item.guid);
    const season = item.season || 1;
    const twin = rows.find((r) => inRunningOrder(r) && sameTitle(r.title, item.title) && (r.season || 1) === season && (item.number === null || r.series_order === item.number));
    if (twin) {
      skipped.push({ title: item.title, reason: twin.series_order ? `Already in the show as S${twin.season || 1} E${twin.series_order}` : 'Already in the show' });
      return;
    }
    items.push(item);
  });

  if (items.length === 0) {
    return res.status(200).json({ imported: 0, failed: [], skipped, renumbered: [], episodes: [], seriesId: show ? show.id : null, newShow: null });
  }

  // Numbers: oldest first (an item without a date after the dated ones,
  // in the feed's order), each item's own number when it's free, the next
  // free ones for the rest — planned in drops of FILES_PER_DROP over the
  // show's rows plus what the earlier drops placed.
  const ordered = [...items].sort((a, b) => {
    const ta = timeOf(a.pubDate);
    const tb = timeOf(b.pubDate);
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return ta - tb;
    }
    return a.at - b.at;
  });
  const planned = [];
  const planRows = [...rows];
  for (let start = 0; start < ordered.length; start += FILES_PER_DROP) {
    const drop = ordered.slice(start, start + FILES_PER_DROP);
    const plan = planBatch(drop.map((it) => ({ name: '', title: it.title, number: it.number, season: it.season })), { season: 1, rows: planRows, sortBy: 'given' });
    for (const p of plan.items) {
      const it = drop[p.index];
      planned.push({ ...it, season: p.season, seriesOrder: p.seriesOrder, note: p.note });
      if (p.seriesOrder) planRows.push({ id: `planned-${it.at}`, content_type: 'podcast', status: 'pending', season: p.season, series_order: p.seriesOrder });
    }
  }

  // A new show, now that there is something to put in it.
  let newShow = null;
  if (!show) {
    newShow = await createShow({
      name: newName,
      kind: 'podcast',
      defaults: { tier: fields.tier, rating: fields.rating, mainGenre: fields.main_genre, genre: fields.genre, artist: fields.artist, adsEnabled: fields.ads_enabled },
      creatorId: userId,
      submittedBy: email || null,
      submittedByUserId: userId
    });
  }
  const seriesId = show ? show.id : newShow.id;

  const results = { imported: 0, failed: [], skipped, renumbered: [], episodes: [] };
  for (const item of planned) {
    const label = item.title || (item.seriesOrder ? `Episode ${item.seriesOrder}` : 'An episode');
    if (!item.seriesOrder) {
      results.failed.push({ title: label, error: 'No episode number left in that season.' });
      continue;
    }
    try {
      const urlCheck = validateRemoteVideoUrl(item.audioUrl);
      if (!urlCheck.ok) {
        results.failed.push({ title: label, error: urlCheck.error, season: item.season, number: item.seriesOrder });
        continue;
      }
      const { url: audioUrl } = await importAudioFromUrl(urlCheck.url, `${(item.title || 'episode').slice(0, 60)}.mp3`);

      const row = {
        id: mintTitleId(item.title || 'episode', { fallback: 'episode' }),
        title: item.title || `Episode ${item.seriesOrder}`,
        description: item.description || '',
        content_type: 'podcast',
        series_id: seriesId,
        season: item.season,
        series_order: item.seriesOrder,
        runtime: item.runtime || '',
        ...fields,
        audio_url: audioUrl,
        deletion_requested: false,
        moderation_hold: false,
        status: 'pending',
        submitted_by: userId
      };
      let { error: insertError } = await supabase.from('episodes').insert(row);
      // Taken a moment ago (under migration 118's index): the next free one.
      if (insertError && insertError.code === '23505' && /episodes_show_position_uq/.test(insertError.message || '')) {
        const { data: fresh } = await supabase.from('episodes').select('id, season, series_order, status, content_type, withdrawn_at').eq('series_id', seriesId);
        row.series_order = nextFreeNumber([...(fresh || []), ...planRows], row.season);
        ({ error: insertError } = await supabase.from('episodes').insert(row));
      }
      if (insertError) {
        console.error('creator/rss-import episode:', insertError.message);
        results.failed.push({ title: label, error: 'Could not save this episode.', season: item.season, number: item.seriesOrder });
        continue;
      }
      results.imported += 1;
      results.episodes.push({ id: row.id, title: row.title, season: row.season, number: row.series_order });
      if (item.number && item.number !== row.series_order) results.renumbered.push({ title: row.title, from: item.number, to: row.series_order });
    } catch (err) {
      // The audio import's lines about the link (too big, not audio,
      // unreachable) are the creator's to see; storage's own text names
      // internals, so it stays in the log (lib/audioUpload.js words those
      // "Could not check / create storage…", "Could not save the audio…").
      const message = (err && err.message) || '';
      if ((err && err.internal) || /^Could not (check storage|create storage|save the audio)/.test(message)) {
        console.error('creator/rss-import audio:', message);
        results.failed.push({ title: label, error: 'Could not store this episode’s audio — try it again later.', season: item.season, number: item.seriesOrder });
      } else {
        results.failed.push({ title: label, error: message || 'Could not import this episode.', season: item.season, number: item.seriesOrder });
      }
    }
  }

  // A new show with nothing in it is removed again; an empty one becomes
  // a podcast with its first import.
  let answerSeriesId = seriesId;
  if (newShow && results.imported === 0) {
    const { error: undoError } = await supabase.from('series').delete().eq('id', newShow.id);
    if (undoError) console.error('creator/rss-import show undo:', undoError.message);
    answerSeriesId = null;
  } else if (adoptKind && results.imported > 0) {
    const { error: kindError } = await supabase.from('series').update({ kind: 'podcast' }).eq('id', seriesId);
    if (kindError) console.error('creator/rss-import show kind:', kindError.message);
  }

  return res.status(200).json({
    ...results,
    seriesId: answerSeriesId,
    newShow: newShow && answerSeriesId ? { id: newShow.id, name: newShow.name, status: newShow.status } : null
  });
}
