import { getSupabase } from './supabase';
import { notifyCreator } from './notify';
import { getPublicDisplayNames, getPublicIdentities } from './userProfiles';

export const PITCH_TAGS = [
  'Documentary', 'Narrative Film', 'Short Film', 'Series', 'Animation',
  'Vertical', 'Podcast', 'Music Video', 'Other'
];

// PRIVACY: pitch rows carry the creator's contact email, Stripe Connect
// account id, the platform's cut, and internal submit/review ids — none of
// which a public page or the app should ever receive. Everything that
// serves pitches to the public (Pitch Room, Discover, pitch page, home,
// app APIs) goes through this; admin/creator code queries the table itself.
const PRIVATE_PITCH_FIELDS = ['creator_email', 'creator_stripe_account_id', 'platform_cut_percent', 'submitted_by', 'reviewed_by', 'reviewed_at'];
export function toPublicPitch(row) {
  if (!row) return row;
  const copy = { ...row };
  for (const field of PRIVATE_PITCH_FIELDS) delete copy[field];
  return copy;
}

export async function getApprovedPitches() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pitches')
    .select('*')
    .eq('status', 'approved')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getApprovedPitches error:', error.message);
    return [];
  }
  return data.map(toPublicPitch);
}

export async function getAllPitches() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pitches')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getAllPitches error:', error.message);
    return [];
  }
  return data;
}

export async function getPitchById(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('pitches').select('*').eq('id', id).maybeSingle();
  if (error) {
    console.error('getPitchById error:', error.message);
    return null;
  }
  return data;
}

// A pitch is only editable by the creator who owns it — checked by
// comparing created_by against the caller's own Clerk user id, not just
// "any signed-in creator." Two different people both having creator
// access doesn't mean either can touch the other's pitch.
export async function getPitchesForCreator(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pitches')
    .select('*')
    .eq('created_by', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getPitchesForCreator error:', error.message);
    return [];
  }
  return data;
}

// Same tag, not the pitch itself, capped at a handful — this is meant as
// a "here's a few more like this" row, not a full secondary browse.
export async function getSimilarPitches(tag, excludeId, limit = 4) {
  if (!tag) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pitches')
    .select('*')
    .eq('status', 'approved')
    .eq('tag', tag)
    .neq('id', excludeId)
    .limit(limit);
  if (error) {
    console.error('getSimilarPitches error:', error.message);
    return [];
  }
  return data.map(toPublicPitch);
}

export async function getPitchUpdates(pitchId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pitch_updates')
    .select('*')
    .eq('pitch_id', pitchId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getPitchUpdates error:', error.message);
    return [];
  }
  return data;
}

// Posting an update fans out a notification to everyone who's saved this
// pitch — this is the entire reason pitch_saves exists as its own table
// rather than just a boolean, since we need the actual list of who to
// notify, not just a count.
export async function postPitchUpdate(pitchId, title, body) {
  const supabase = getSupabase();
  const { data: pitch } = await supabase.from('pitches').select('title').eq('id', pitchId).maybeSingle();
  const { error } = await supabase.from('pitch_updates').insert({ pitch_id: pitchId, title, body });
  if (error) {
    console.error('postPitchUpdate error:', error.message);
    return { ok: false, error: error.message };
  }

  const { data: savers } = await supabase.from('pitch_saves').select('user_id').eq('pitch_id', pitchId);
  if (savers && savers.length > 0 && pitch) {
    await Promise.all(
      savers.map((s) =>
        notifyCreator({
          userId: s.user_id,
          type: 'pitch_update',
          message: `${pitch.title} posted an update: ${title}`,
          pitchId
        })
      )
    );
  }
  return { ok: true };
}

export async function isPitchSaved(userId, pitchId) {
  if (!userId) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pitch_saves')
    .select('id')
    .eq('user_id', userId)
    .eq('pitch_id', pitchId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function getSavedPitchIds(userId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase.from('pitch_saves').select('pitch_id').eq('user_id', userId);
  if (error) return [];
  return data.map((r) => r.pitch_id);
}

export async function togglePitchSave(userId, pitchId) {
  const supabase = getSupabase();
  const alreadySaved = await isPitchSaved(userId, pitchId);
  if (alreadySaved) {
    await supabase.from('pitch_saves').delete().eq('user_id', userId).eq('pitch_id', pitchId);
    return { saved: false };
  }
  await supabase.from('pitch_saves').insert({ user_id: userId, pitch_id: pitchId });
  return { saved: true };
}

// Approved pitches this user has saved, newest save first — for the
// Saved Pitches section on /wishlist. Goes through toPublicPitch like
// every other public read; a saved pitch that's since been unapproved or
// deleted just drops out rather than showing a dead card.
export async function getSavedPitches(userId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data: saves, error } = await supabase
    .from('pitch_saves')
    .select('pitch_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error || !saves || saves.length === 0) return [];
  const ids = saves.map((s) => s.pitch_id);
  const { data: pitches, error: pitchError } = await supabase
    .from('pitches')
    .select('*')
    .in('id', ids)
    .eq('status', 'approved');
  if (pitchError) {
    console.error('getSavedPitches error:', pitchError.message);
    return [];
  }
  const byId = new Map(pitches.map((p) => [p.id, toPublicPitch(p)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// Likes are the lightweight public thumbs-up from Discover's elevator
// (migration 073) — deliberately separate from pitch_saves, which is the
// follow that drives update emails and "N people following."
export async function getLikedPitchIds(userId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase.from('pitch_likes').select('pitch_id').eq('user_id', userId);
  if (error) return [];
  return data.map((r) => r.pitch_id);
}

// { [pitchId]: count } for every pitch with at least one like. Same
// lightweight-aggregate pattern as the save counts in lib/pitchRoom.js —
// just the pitch_id column, counted here, rather than full rows.
export async function getPitchLikeCounts() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('pitch_likes').select('pitch_id');
  if (error) return {};
  const counts = {};
  for (const row of data) counts[row.pitch_id] = (counts[row.pitch_id] || 0) + 1;
  return counts;
}

export async function togglePitchLike(userId, pitchId) {
  const supabase = getSupabase();
  const { data: existing, error: readError } = await supabase
    .from('pitch_likes')
    .select('pitch_id')
    .eq('user_id', userId)
    .eq('pitch_id', pitchId)
    .maybeSingle();
  if (readError) {
    console.error('togglePitchLike read error:', readError.message);
    return { error: readError.message };
  }
  let liked;
  if (existing) {
    const { error } = await supabase.from('pitch_likes').delete().eq('user_id', userId).eq('pitch_id', pitchId);
    if (error) return { error: error.message };
    liked = false;
  } else {
    const { error } = await supabase.from('pitch_likes').insert({ user_id: userId, pitch_id: pitchId });
    if (error) return { error: error.message };
    liked = true;
  }
  const { count } = await supabase
    .from('pitch_likes')
    .select('pitch_id', { count: 'exact', head: true })
    .eq('pitch_id', pitchId);
  return { liked, count: count || 0 };
}

export async function getPitchComments(pitchId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pitch_comments')
    .select('*')
    .eq('pitch_id', pitchId)
    .eq('status', 'visible')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('getPitchComments error:', error.message);
    return [];
  }

  // PRIVACY: display name is resolved here, fresh, from user_profiles —
  // never from anything stored on the comment row itself. This also means
  // a display name change applies retroactively to someone's past
  // comments, which is the correct behavior (same as every other site
  // that shows a live username rather than a name frozen at post time).
  const identities = await getPublicIdentities(data.map((c) => c.user_id));
  const withNames = data.map((c) => ({ ...c, displayName: identities[c.user_id].displayName, avatarUrl: identities[c.user_id].avatarUrl }));

  // Thread into top-level comments with nested replies — flat storage,
  // shaped into a tree only at read time, so a reply is still just a
  // normal row (simpler moderation, simpler reporting) rather than a
  // structurally different kind of record.
  const byId = Object.fromEntries(withNames.map((c) => [c.id, { ...c, replies: [] }]));
  const topLevel = [];
  for (const c of withNames) {
    if (c.parent_comment_id && byId[c.parent_comment_id]) {
      byId[c.parent_comment_id].replies.push(byId[c.id]);
    } else {
      topLevel.push(byId[c.id]);
    }
  }
  return topLevel;
}

export async function getReportedComments() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pitch_comments')
    .select('*, pitches(title)')
    .eq('reported', true)
    .eq('status', 'visible')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getReportedComments error:', error.message);
    return [];
  }
  const displayNames = await getPublicDisplayNames(data.map((c) => c.user_id));
  return data.map((c) => ({ ...c, displayName: displayNames[c.user_id] }));
}
