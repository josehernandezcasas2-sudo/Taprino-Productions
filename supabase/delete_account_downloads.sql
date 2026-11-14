-- Carrying out an account's deletion request: its download records.
--
-- A deletion request is carried out by hand: the site emails it to the
-- studio (pages/api/account/request-deletion.js) and nothing on the site
-- deletes an account's rows by itself. The Privacy page says the account's
-- data — "the record of your phones and downloads" among it — is removed
-- within 30 days of the request. This is that part, for downloads in the
-- app (migration 123): the phones the account downloaded on, and the
-- record of every copy, whatever became of it.
--
-- How: replace user_REPLACE_ME below — once — with the account's id
-- ("user_…", as the request's email states it and Admin → Accounts shows
-- it), and run this in the Supabase SQL Editor. It answers one row: the
-- account, and how many rows went. Running it again answers 0 and 0. With
-- the placeholder left in it deletes nothing.
--
-- The files on the person's phones are not ours to reach. If the account
-- can still sign in, the app deletes them at its next check-in (the server
-- no longer has a copy on record for that phone). If it can't — the
-- account is gone from sign-in too — the app stops playing them at their
-- dates: at most 33 days after the last check-in for a member's copy, 30
-- for a bought title.

with target as (
  select 'user_REPLACE_ME'::text as user_id
),
copies as (
  delete from public.downloads d using target t where d.user_id = t.user_id returning 1
),
phones as (
  delete from public.download_devices p using target t where p.user_id = t.user_id returning 1
)
select
  (select user_id from target) as account,
  (select count(*) from copies) as download_rows_deleted,
  (select count(*) from phones) as phone_rows_deleted;
