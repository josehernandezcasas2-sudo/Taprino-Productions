import { getSupabase } from './supabase';
import { notifyCreator } from './notify';

export const PITCH_TAGS = [
  'Documentary', 'Narrative Film', 'Short Film', 'Series', 'Animation',
  'Vertical', 'Podcast', 'Music Video', 'Other'
];

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
  return data;
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
  return data;
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
  return data;
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
  return data;
}
