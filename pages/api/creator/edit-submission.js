import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { creatorOwnsSeries } from '../../../lib/series';
import { internalError, sendError } from '../../../lib/apiErrors';
import { isTitleId } from '../../../lib/titleIds';
import { MAX_EPISODE_NUMBER, flashingLightsChange, holdsSlot, slotCheck, slotTakenBody, titleRunnerOf } from '../../../lib/showRules';
import { syncNumberTitles } from '../../../lib/numberTitles';
import { anchoredExtras, cancelPendingInvites, noticeEarningsMoved, withPayeeStamps } from '../../../lib/payees';
import { wellFormedBody } from '../../../lib/wellFormed';

// Mirrors the fields REQUIRED_FIELDS enforces in submit-episode.js, minus
// videoUid (the video itself isn't editable here — re-uploading a new cut
// is a separate feature, not this one) plus the series-specific fields.
const EDITABLE_FIELDS = ['title', 'description', 'artist', 'runtime', 'genre', 'mainGenre', 'tier', 'contentType', 'seriesId', 'season', 'seriesOrder', 'rating', 'releaseYear'];
const VALID_TIERS = ['free', 'premium'];
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast', 'bonus'];
// Where an episode sits in its show's running order. A save that changes
// one of them asks whether the new place is free first.
const PLACE_COLUMNS = ['series_id', 'season', 'series_order', 'content_type'];
// What the numbering rules read of a show's episodes (lib/showRules.js
// slotCheck). Every one of them is older than migration 118, so the check
// works before it has run.
const SLOT_COLUMNS = 'id, title, status, content_type, season, series_order, withdrawn_at, deletion_requested, created_at';

function posInt(v) {
  if (v === undefined || v === null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Whether a place column keeps its value. A season left empty plays as
// Season 1 (lib/showRules.js seasonOf), so the 1 written into it below is
// not a move: a title fix on such a row (from before migration 118 filled
// the seasons in) mustn't be refused over a number it already had.
function samePlace(column, a, b) {
  if (column === 'season') return (posInt(a) || 1) === (posInt(b) || 1);
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (x === null || y === null) return x === y;
  return String(x) === String(y);
}

// Migration 118's unique index on (series_id, season, series_order).
function positionTaken(error) {
  return Boolean(error) && error.code === '23505' && /episodes_show_position_uq/.test(error.message || '');
}

async function showRows(supabase, seriesId) {
  const { data, error } = await supabase.from('episodes').select(SLOT_COLUMNS).eq('series_id', seriesId);
  if (error) throw internalError(error, 'edit-submission slots');
  return data || [];
}

export default async function handler(req, res) {
  // A lone surrogate in any text would make Postgres refuse the save
  // (a 500): every string in the body is made well formed first.
  wellFormedBody(req);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    return await editSubmission(req, res);
  } catch (err) {
    return sendError(res, err, 'creator/edit-submission', 'Could not save your changes.');
  }
}

async function editSubmission(req, res) {
  const { userId, email, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { episodeId, ...fields } = req.body || {};
  if (!episodeId || !isTitleId(String(episodeId))) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }

  const supabase = getSupabase();

  // Ownership + pending-only check happens as part of the update's WHERE
  // clause below (not a separate read-then-write), which closes the gap
  // where someone else's episode gets approved in between a check and the
  // write — but we still need to know up front whether it *would* have
  // matched, to tell the creator why nothing changed. Its place is read
  // too, for the slot check (series_id was compared below without ever
  // being selected, so staying in the same series always asked again
  // whether the creator owns it).
  const { data: existing, error: fetchError } = await supabase
    .from('episodes')
    .select('id, submitted_by, status, content_type, series_id, season, series_order, withdrawn_at, has_flashing_lights, moderation_hold, deletion_requested')
    .eq('id', String(episodeId))
    .maybeSingle();

  if (fetchError) throw internalError(fetchError, 'edit-submission read');
  if (!existing) {
    return res.status(404).json({ error: 'Submission not found.' });
  }
  if (existing.submitted_by !== userId) {
    return res.status(403).json({ error: 'That submission does not belong to you.' });
  }
  if (existing.status !== 'pending') {
    return res.status(400).json({ error: 'Only submissions still pending review can be edited — this one has already been reviewed.' });
  }

  const updates = {};
  for (const f of EDITABLE_FIELDS) {
    if (fields[f] === undefined) continue;
    if (String(fields[f]).trim() === '' && f !== 'seriesId') continue; // allow clearing seriesId back out
    updates[f] = fields[f];
  }

  if (updates.tier && !VALID_TIERS.includes(updates.tier)) {
    return res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
  }
  if (updates.contentType && !VALID_CONTENT_TYPES.includes(updates.contentType)) {
    return res.status(400).json({ error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}` });
  }

  const effectiveContentType = updates.contentType || existing.content_type;
  const isNewSeries = updates.seriesId === '__new__';
  if (updates.seriesId !== undefined && !isNewSeries) {
    // The id goes into a query below: a browser's value is checked first.
    const id = String(updates.seriesId).trim();
    if (id && !isTitleId(id)) {
      return res.status(400).json({ error: 'That show isn’t there any more — pick another.' });
    }
    updates.seriesId = id;
  }
  // Moving a submission into a series: only one of the creator's own.
  if (updates.seriesId && !isNewSeries && updates.seriesId !== existing.series_id && !(await creatorOwnsSeries(userId, updates.seriesId, { isAdmin }))) {
    return res.status(403).json({ error: 'You can only add episodes to your own series.' });
  }

  const dbUpdates = {};
  // "Contains flashing lights" (Jose, 2026-11-13): this route only edits a
  // title still in review, where the uploader may tick or untick it; the
  // rule is lib/showRules.js flashingLightsChange all the same, so this
  // route can never take a live title's warning off.
  if (fields.hasFlashingLights !== undefined) {
    if (typeof fields.hasFlashingLights !== 'boolean') return res.status(400).json({ error: 'Say whether it contains flashing lights.' });
    const verdict = flashingLightsChange(
      { target: 'episode', isUploader: true, isAdmin: false, status: existing.status, held: Boolean(existing.moderation_hold), deletionRequested: Boolean(existing.deletion_requested), withdrawn: Boolean(existing.withdrawn_at) },
      Boolean(existing.has_flashing_lights),
      fields.hasFlashingLights
    );
    if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.line, code: verdict.code, field: 'hasFlashingLights' });
    if (verdict.change !== null) dbUpdates.has_flashing_lights = verdict.change;
  }
  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.artist !== undefined) dbUpdates.artist = updates.artist;
  if (updates.runtime !== undefined) dbUpdates.runtime = updates.runtime;
  if (updates.genre !== undefined) dbUpdates.genre = updates.genre;
  if (updates.mainGenre !== undefined) dbUpdates.main_genre = updates.mainGenre;
  if (updates.tier !== undefined) dbUpdates.tier = updates.tier;
  if (updates.rating !== undefined) dbUpdates.rating = updates.rating;
  if (updates.releaseYear !== undefined) {
    const year = Number(updates.releaseYear);
    dbUpdates.release_year = Number.isInteger(year) ? year : null;
  }
  if (updates.contentType !== undefined) dbUpdates.content_type = updates.contentType;
  // Podcasts group into a "show" the same way series episodes group into a
  // series — CreatorSubmissionForm/ManualEpisodeForm both treat 'podcast'
  // and 'series' identically for this exact field set (see their shared
  // `contentType === 'series' || contentType === 'podcast'` checks). This
  // used to only recognize 'series' here, which meant editing ANY field on
  // a pending podcast episode silently nulled out its show/season/episode
  // number — a real data-loss bug, not just a missed edge case.
  const usesShowGrouping = effectiveContentType === 'series' || effectiveContentType === 'podcast';
  if (updates.seriesId !== undefined) dbUpdates.series_id = usesShowGrouping && !isNewSeries ? updates.seriesId || null : null;
  // A season or number the column can't take used to reach the database
  // as it was typed (NaN, a fraction: a 500); the words are
  // submit-episode's. A zero season is still Season 1, as before.
  if (updates.season !== undefined) {
    if (usesShowGrouping) {
      const season = Number(updates.season) || 1;
      if (!posInt(season)) return res.status(400).json({ error: 'Seasons are numbered from 1.' });
      dbUpdates.season = season;
    } else {
      dbUpdates.season = null;
    }
  }
  if (updates.seriesOrder !== undefined) {
    if (usesShowGrouping) {
      const number = posInt(updates.seriesOrder);
      if (!number) return res.status(400).json({ error: 'Episode numbers start at 1.' });
      if (number > MAX_EPISODE_NUMBER) return res.status(400).json({ error: `Episode numbers go up to ${MAX_EPISODE_NUMBER}.` });
      dbUpdates.series_order = number;
    } else {
      dbUpdates.series_order = null;
    }
  }

  if (Object.keys(dbUpdates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  // Its new place can't be another episode's: a live or in-review episode
  // of the show keeps its number (a declined or withdrawn one holds none,
  // amendment 6 of the series revamp). Before migration 118 this is the
  // only thing that stops two S1 E3s; after it the index backs it up, and
  // a number the index refused used to answer "Could not save your
  // changes." Asked only when the save moves the episode, so a show that
  // already has two rows on one number (before 118) never blocks a fix to
  // a title or a genre.
  const next = { ...existing, ...dbUpdates };
  const holdsPlace = usesShowGrouping && Boolean(next.series_id) && holdsSlot(next);
  if (holdsPlace && (next.season === null || next.season === undefined)) {
    // No season plays as Season 1 (lib/showRules.js); writing it makes the
    // check below and the index read the same place.
    dbUpdates.season = 1;
    next.season = 1;
  }
  const checkSlot = async () => slotCheck(await showRows(supabase, next.series_id), { season: next.season, number: next.series_order, excludeId: existing.id });
  if (holdsPlace && PLACE_COLUMNS.some((c) => c in dbUpdates && !samePlace(c, dbUpdates[c], existing[c]))) {
    const slot = await checkSlot();
    if (!slot.free) return res.status(409).json(slotTakenBody(slot));
  }

  // The extras filed after it follow its show (Jose, 2026-11-06), so a
  // move to another show (or out of one) takes them along — earnings, price
  // and all. Here, as on the show page (lib/showRules.js canMoveTo), a
  // creator only carries along extras they run; a full admin carries any,
  // and whoever stops being paid is told.
  const showMove = 'series_id' in dbUpdates && (dbUpdates.series_id || null) !== (existing.series_id || null);
  let movingExtras = [];
  let fromShow = null;
  let toShow = null;
  if (showMove && existing.content_type !== 'bonus') {
    movingExtras = await anchoredExtras({ episodeIds: [existing.id] });
    if (movingExtras.length) {
      const readShow = async (sid) => {
        if (!sid || !isTitleId(String(sid))) return null;
        const { data, error: showError } = await supabase.from('series').select('*').eq('id', sid).maybeSingle();
        if (showError) throw internalError(showError, 'edit-submission show');
        return data || null;
      };
      [fromShow, toShow] = await Promise.all([readShow(existing.series_id), readShow(dbUpdates.series_id)]);
      if (!isAdmin && movingExtras.some((x) => titleRunnerOf(x, fromShow) !== userId)) {
        return res.status(403).json({ error: 'Extras filed after it would move with it, and they aren’t yours to move. Ask an admin.', code: 'extras' });
      }
    }
  }

  // The `.eq('status', 'pending')` here is the real enforcement, same
  // pattern as review-submission.js — even if two requests race, only one
  // can land while status is still pending.
  // A move into another show can change who the title pays (slice 3b):
  // its history is written with the save (lib/payees.js).
  let saveResult = null;
  const doSave = async () => {
    saveResult = await supabase
      .from('episodes')
      .update(dbUpdates)
      .eq('id', existing.id)
      .eq('submitted_by', userId)
      .eq('status', 'pending')
      .select('id');
  };
  let stamped = null;
  if (showMove) {
    stamped = await withPayeeStamps({ scope: { episodeIds: [existing.id] }, patch: { episodes: { [existing.id]: { series_id: dbUpdates.series_id || null } } }, write: doSave, setBy: `edit:${userId}` });
  } else {
    await doSave();
  }
  const { data: saved, error } = saveResult;

  if (error) {
    // Taken between the check and the write (two saves at once), under
    // migration 118's unique index: the same answer as the check's.
    if (positionTaken(error) && holdsPlace) {
      return res.status(409).json(slotTakenBody(await checkSlot()));
    }
    throw internalError(error, 'edit-submission write');
  }
  // Reviewed between the read above and this write: nothing was saved,
  // and the creator is told why (it used to answer ok).
  if (!saved || saved.length === 0) {
    return res.status(400).json({ error: 'Only submissions still pending review can be edited — this one has already been reviewed.' });
  }

  // Its extras went with it: whoever they stopped paying is told, and a new
  // runner sends their invites and sets their prices from now on.
  if (movingExtras.length) {
    const extraIds = new Set(movingExtras.map((x) => x.id));
    const changedExtras = stamped && stamped.changed ? stamped.changed.filter((c) => c.type === 'episode' && extraIds.has(c.id)) : [];
    if (changedExtras.length) {
      await noticeEarningsMoved({ changed: changedExtras, viewer: { userId, email }, how: 'moved' }).catch((err) => console.error('edit-submission earnings notice:', err && err.message));
    }
    const byRunner = new Map();
    for (const x of movingExtras) {
      const before = titleRunnerOf(x, fromShow);
      const after = titleRunnerOf(x, toShow);
      if (before === after) continue;
      if (!byRunner.has(after || '')) byRunner.set(after || '', []);
      byRunner.get(after || '').push(x.id);
    }
    const moved = [...byRunner.values()].flat();
    if (moved.length) {
      await cancelPendingInvites({ titles: moved.map((id) => ({ type: 'episode', id })), reason: 'runner', actor: { userId, email, isAdmin } })
        .catch((err) => console.error('edit-submission invites:', err && err.message));
      for (const [runner, ids] of byRunner) {
        if (!runner) continue;
        const { error: priceError } = await supabase.from('title_prices').update({ creator_id: runner }).eq('target_type', 'episode').in('target_id', ids);
        if (priceError && !/title_prices|PGRST205|does not exist/i.test(priceError.message || '')) console.error('edit-submission price owner:', priceError.message);
      }
    }
  }

  // A title that is only its number follows a new number (lib/numberTitles.js).
  if ('series_order' in dbUpdates || 'season' in dbUpdates || 'title' in dbUpdates) await syncNumberTitles([existing.id]);

  return res.status(200).json({ ok: true, episodeId: existing.id });
}
