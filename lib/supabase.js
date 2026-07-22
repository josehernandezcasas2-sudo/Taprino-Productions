import { createClient } from '@supabase/supabase-js';

// SECURITY: this uses the service role key, which bypasses Row Level
// Security entirely — full read/write access to every table. That's
// intentional here, not an oversight: every access path in this app goes
// through server-side code (getServerSideProps, API routes) that already
// does its own permission checks (via Clerk — is this person an admin? a
// creator? do they own this submission?) before ever calling into Supabase.
// This client is never imported by anything that runs in the browser, and
// SUPABASE_SERVICE_ROLE_KEY is never passed as a page prop — same rule as
// STRIPE_SECRET_KEY and CLERK_SECRET_KEY elsewhere in this app.
export function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase is not configured — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local.');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false } // no session to persist — Clerk owns identity, this is a pure DB client
  });
}

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
