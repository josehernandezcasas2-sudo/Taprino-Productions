-- 112 — Database lockdown + webhook retries (safety batch, 2026-10-26).
-- Run in the Supabase SQL Editor. Safe to run again at any time, and worth
-- running again after any later migration that creates a table.
--
-- 1. Only the server's key reaches the data.
--    Supabase publishes every table in the public schema through its REST
--    API, and by default the "anon" and "authenticated" roles may read and
--    write all of them: anyone holding the project's anon key (which
--    Supabase treats as public, and which this site never uses) could read
--    every account, message and payment and call add_ad_credits(). The site
--    only ever talks to the database with the service-role key, which
--    bypasses row level security, so switching RLS on everywhere with no
--    policies, and taking the grants away from anon/authenticated, changes
--    nothing for the site and closes that door. Storage buckets are not
--    touched (they live in the storage schema with their own rules).

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- New tables, sequences and functions created later from the SQL Editor
-- start out closed the same way.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;

-- 2. Webhook events that died half-way can be retried.
--    stripe_events (migration 083) records an event before the work runs,
--    so a function that timed out left the row behind and Stripe's retry
--    was answered as a duplicate. processed_at is set when the work
--    finishes; a row without it, older than a couple of minutes, is picked
--    up again by the next delivery (pages/api/webhook.js).
alter table stripe_events add column if not exists processed_at timestamptz;
update stripe_events set processed_at = received_at where processed_at is null;

-- 3. Ad credits are applied once per Checkout session, in one transaction.
--    The purchase row (unique on the session) and the balance move
--    together, so a retried event can never add the same credits twice.
create or replace function apply_ad_credit_purchase(p_session text, p_account uuid, p_amount integer, p_payment_intent text)
returns boolean
language plpgsql
as $$
declare inserted_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    return false;
  end if;
  insert into ad_credit_purchases (ad_account_id, stripe_checkout_session_id, stripe_payment_intent_id, amount_cents)
  values (p_account, p_session, p_payment_intent, p_amount)
  on conflict (stripe_checkout_session_id) do nothing
  returning id into inserted_id;
  if inserted_id is null then
    return false;
  end if;
  perform add_ad_credits(p_account, p_amount);
  return true;
end;
$$;

revoke execute on function apply_ad_credit_purchase(text, uuid, integer, text) from public, anon, authenticated;
grant execute on function apply_ad_credit_purchase(text, uuid, integer, text) to service_role;
