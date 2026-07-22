import { getSupabase } from './supabase';

// SERVER-ONLY, same rules as lib/publicEpisodes.js — call from
// getServerSideProps, pass results down as props.

export async function getAllSeries() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('series').select('*');
  if (error) {
    console.error('getAllSeries error:', error.message);
    return [];
  }
  return data.map(rowToSeries);
}

export async function findSeries(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('series').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return rowToSeries(data);
}

function rowToSeries(row) {
  return {
    id: row.id,
    name: row.name,
    desc: row.description,
    trailerSrc: row.trailer_src,
    heroImage: row.hero_image
  };
}
