-- 117: Title ids are text (2026-11-02; found on 2026-11-01 while checking
-- the series plan against the code).
--
-- Every episode and series id on the site is a text slug
-- ("night-bus-last-stop-lx3k9a", "placeholder-movie-<stamp>"), but Buy to
-- own (097) and ad share (103) declared the columns that hold them as
-- uuid. So a creator's price could never be saved (and no Buy card ever
-- showed), and no ad play was ever tied to the title it played in: the
-- impression pixel only kept uuid-shaped episodes, and the database would
-- have refused a slug anyway, so ad share credited nothing while the
-- advertiser was still charged. No row can hold a title id in these
-- columns yet, so nothing needs converting; uuid -> text keeps any value
-- as its text form either way.
--
-- Re-runnable: altering a text column to text is a no-op, and the
-- function is dropped and created by its exact signature.
--
-- Needs 097 (Buy to own) and 103 (Ad share). On 2026-11-03 the first run
-- stopped at "relation ad_impression_days does not exist": 103 was not in
-- the database. Now it says which migration to run first, and changes
-- nothing (the SQL Editor runs the whole paste as one transaction).
-- supabase/check_migrations.sql lists every migration a database lacks.

do $$
begin
  if to_regclass('public.title_prices') is null or to_regclass('public.purchases') is null then
    raise exception '117 needs migration 097 (Buy to own) first. Run 097_buy_to_own.sql, then 117 again. Nothing was changed.';
  end if;
  if to_regclass('public.ad_impression_days') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'creator_ledger' and column_name = 'episode_id') then
    raise exception '117 needs migration 103 (Ad share) first. Run 103_ad_share.sql, then 117 again. Nothing was changed.';
  end if;
end $$;

alter table title_prices alter column target_id type text using target_id::text;
alter table purchases alter column target_id type text using target_id::text;
alter table ad_impression_days alter column episode_id type text using episode_id::text;
alter table creator_ledger alter column episode_id type text using episode_id::text;

-- Counts one play of an ad inside a title, as in 103, now keyed on the
-- title's real (text) id. The uuid version goes, so nothing can call it.
drop function if exists record_ad_impression(uuid, uuid, text);

create or replace function record_ad_impression(p_ad uuid, p_episode text, p_surface text)
returns void
language plpgsql
as $$
declare
  cost numeric := 0;
begin
  select case when ad_account_id is null then 0 else coalesce(cost_per_impression_cents, 0) end
    into cost
    from house_ads
   where id = p_ad;
  if not found then
    return;
  end if;
  insert into ad_impression_days (ad_id, episode_id, surface, day, impressions, credit_cents)
  values (p_ad, p_episode, p_surface, current_date, 1, cost)
  on conflict (ad_id, episode_id, surface, day) do update
    set impressions = ad_impression_days.impressions + 1,
        credit_cents = ad_impression_days.credit_cents + excluded.credit_cents;
end;
$$;

-- Only the server (the service-role key) may call it (migration 112's rule).
revoke execute on function record_ad_impression(uuid, text, text) from public, anon, authenticated;
grant execute on function record_ad_impression(uuid, text, text) to service_role;

-- 103 made ad_impression_days without row level security (it came before
-- 112, which turned it on for every table there was). Where 103 was run
-- after 112, this is the line that closes it; elsewhere it changes nothing.
alter table ad_impression_days enable row level security;

comment on column title_prices.target_id is 'The episode or series id (text, like every title id on the site; uuid until migration 117).';
comment on column purchases.target_id is 'The episode or series id (text, like every title id on the site; uuid until migration 117).';
comment on column ad_impression_days.episode_id is 'The title the ad played inside (text, like every title id on the site; uuid until migration 117).';

-- Supabase's API layer (PostgREST) caches column types and function
-- signatures; it normally reloads after a schema change by itself, but the
-- site calls record_ad_impression by name, so ask for the reload outright.
notify pgrst, 'reload schema';
