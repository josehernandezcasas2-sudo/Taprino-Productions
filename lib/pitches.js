import { getSupabase } from './supabase';

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
