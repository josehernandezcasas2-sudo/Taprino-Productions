import { getSupabase } from './supabase';
import { likeLiteral } from './likeLiteral';

// Checks the admin-managed invite list (see the comped_access table,
// migration 019). Case-insensitive, since email casing is not meaningful
// for the providers people actually sign in with.
// `report` (optional): an object whose `failed` is set when the list
// couldn't be read — the answer is still false (fail closed), but a caller
// that must not mistake "couldn't read" for "isn't comped" can tell
// (lib/accountContext.js billingKnown: downloads never end a member's
// copies on a failed read).
export async function isCompedEmail(email, report = null) {
  if (!email) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('comped_access')
    .select('email')
    .ilike('email', likeLiteral(email))
    .maybeSingle();

  if (error) {
    console.error('isCompedEmail error:', error.message);
    if (report && typeof report === 'object') report.failed = true;
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
