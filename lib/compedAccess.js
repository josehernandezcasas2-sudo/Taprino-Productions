import { getSupabase } from './supabase';

// Checks the admin-managed invite list (see the comped_access table,
// migration 019). Case-insensitive, since email casing is not meaningful
// for the providers people actually sign in with.
export async function isCompedEmail(email) {
  if (!email) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('comped_access')
    .select('email')
    .ilike('email', email)
    .maybeSingle();

  if (error) {
    console.error('isCompedEmail error:', error.message);
    return false; // fail closed — a lookup error should never silently grant free access
  }
  return Boolean(data);
}

export async function listCompedAccess() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('comped_access')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listCompedAccess error:', error.message);
    return [];
  }
  return data;
}
