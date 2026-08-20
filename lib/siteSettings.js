import { getSupabase } from './supabase';

export async function getSiteSettings() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
  if (error) {
    console.error('getSiteSettings error:', error.message);
    return { shopEnabled: false, shopUrl: null };
  }
  return {
    shopEnabled: Boolean(data && data.shop_enabled),
    shopUrl: data ? data.shop_url : null
  };
}
