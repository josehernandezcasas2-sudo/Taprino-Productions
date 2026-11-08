-- After the migrations: what needs you, and is it working? Read-only: it
-- changes nothing. Run it after supabase/repair_004_059_107.sql (it reads
-- tables that repair puts back) and whenever you want a look under the
-- bonnet. Paste all of it into the Supabase SQL Editor and press Run.
--
-- One row per thing worth knowing. "how_many" is the number; "detail" names
-- the first few; "what_to_do" says where to go. The "Should be 0" rows are
-- the alarms: anything above 0 there is worth a look.

with
public_eps as (
  select * from episodes
   where status = 'approved' and withdrawn_at is null
     and deletion_requested = false and moderation_hold = false
),
ready as (
  select s.id, s.name from series s
   where s.status = 'pending' and s.deletion_requested = false
     and exists (select 1 from public_eps e where e.series_id = s.id)
),
pushed as (
  -- Migration 118 moved a duplicate episode number past the season's
  -- highest + 1000 rather than guess which copy was meant.
  select s.name, e.season, e.series_order from episodes e join series s on s.id = e.series_id
   where e.series_order >= 1000 and e.status <> 'rejected' and e.withdrawn_at is null
),
payee_out_of_step as (
  -- Who gets paid (slice 3b): an episode's open history row should name
  -- the account its columns pay (its own, else its show's, else the
  -- show's owner, else the uploader). The show is the one its money
  -- follows: its series_id, else an extra filed only through
  -- bonus_parent_* follows that show, or its parent episode's show
  -- (lib/showRules.js payeeShowIdOf; Jose, 2026-11-06). The daily cron
  -- puts a stray right.
  select e.id from title_payees tp
    join episodes e on e.id = tp.title_id
    left join episodes pe on e.series_id is null and e.content_type = 'bonus'
                         and e.bonus_parent_type = 'episode' and pe.id = nullif(e.bonus_parent_id, '')
    left join series s on s.id = coalesce(e.series_id,
                                          case when e.content_type = 'bonus' and e.bonus_parent_type = 'series' then nullif(e.bonus_parent_id, '')
                                               when e.content_type = 'bonus' and e.bonus_parent_type = 'episode' then pe.series_id end)
   where tp.title_type = 'episode' and tp.to_at is null
     and tp.payee_id is distinct from coalesce(nullif(e.paid_to, ''), nullif(s.paid_to, ''), s.creator_id, e.submitted_by)
),
payee_invites_old as (
  select id from payee_invites where status = 'pending' and created_at < now() - interval '30 days'
),
payee_invites_stuck as (
  -- An acceptance that stopped part-way (lib/payees.js stuckAcceptedInvites):
  -- the invite reads accepted, but its title doesn't pay the invitee, no
  -- history row was stamped by it and no audit line says it went through.
  -- The daily cron finishes each one or withdraws it and tells both sides,
  -- so two days on there should be none.
  select i.id from payee_invites i
    left join episodes e on i.title_type = 'episode' and e.id = i.title_id
    left join series s on i.title_type = 'series' and s.id = i.title_id
   where i.status = 'accepted' and i.decided_at < now() - interval '2 days'
     and (case when i.title_type = 'series' then nullif(s.paid_to, '') else nullif(e.paid_to, '') end) is distinct from i.invitee_id
     and not exists (select 1 from title_payees tp where tp.set_by = 'invite:' || i.id::text)
     and not exists (select 1 from audit_log a
                      where a.action = 'payee_invite_accepted' and a.target_id = i.title_id
                        and a.details like '%"inviteId":"' || i.id::text || '"%')
)
select section, item, how_many, detail, what_to_do from (

  select 1 as ord, 'Needs you' as section, 'Shows ready to go public' as item,
         (select count(*) from ready) as how_many,
         (select left(string_agg(name, ', ' order by name), 300) from ready) as detail,
         'Admin → Shows → the "Ready to go public" chip: the show''s owner presses Make it public on their show page (a full admin can too, on the show''s admin page). Until then the show and its episodes stay private.' as what_to_do

  union all
  select 2, 'Needs you', 'Episode numbers 118 had to move',
         (select count(*) from pushed),
         (select left(string_agg(name || ' S' || coalesce(season, 1) || ' E' || series_order, ', '), 300) from pushed),
         'Two episodes shared a number, so 118 moved one past 1000. Open the show page (Creator Studio → the show) and press Renumber from 1 on that season, or type the right number.'

  union all
  select 3, 'Needs you', 'Titles waiting for review',
         (select count(*) from episodes where status = 'pending' and withdrawn_at is null and deletion_requested = false),
         null,
         'Admin → Review.'

  union all
  select 4, 'Needs you', 'Applications waiting',
         (select count(*) from creator_applications where status in ('new', 'reviewing')),
         null,
         'Admin → Review (Applications) or Admin → Applications.'

  union all
  select 5, 'Needs you', 'Prices waiting for review',
         (select count(*) from title_prices where status = 'pending' or pending_cents is not null),
         null,
         'Admin → Review (Prices).'

  union all
  select 6, 'Needs you', 'Ads waiting for review',
         (select count(*) from house_ads where review_status = 'pending'),
         null,
         'Admin → Review (Ads).'

  union all
  select 7, 'Needs you', 'Places waiting for review',
         (select count(*) from locations where status = 'pending'),
         null,
         'Admin → Review (Locations).'

  union all
  select 8, 'Needs you', 'Open content reports',
         (select count(*) from content_reports where status = 'open'),
         null,
         'Admin → Content.'

  union all
  select 10, 'Needs you', 'Payee invites waiting over 30 days',
         (select count(*) from payee_invites_old),
         null,
         'Someone was asked to be paid for a title and hasn''t answered in a month. Its earnings keep going where they went; the show''s owner can withdraw the invite on the show page (Who gets paid).'

  union all
  select 9, 'Needs you', 'Deletion requests',
         (select count(*) from episodes where deletion_requested = true and withdrawn_at is null)
           + (select count(*) from series where deletion_requested = true and withdrawn_at is null),
         null,
         'Admin → Review (deletion requests) or Admin → Test content.'

  union all
  select 20, 'Should be 0', 'Stripe events not finished after 10 minutes',
         (select count(*) from stripe_events where processed_at is null and received_at < now() - interval '10 minutes'),
         (select left(string_agg(type, ', '), 300) from stripe_events where processed_at is null and received_at < now() - interval '10 minutes'),
         'Stripe sent these and the site didn''t finish them. The next delivery retries them; if the number stays, look in Vercel → Logs for "webhook".'

  union all
  select 21, 'Should be 0', 'Creator payouts stuck as pending for a day',
         (select count(*) from creator_payouts where status = 'pending' and created_at < now() - interval '1 day'),
         null,
         'Admin → Creator Share payouts: a transfer started and never finished. Check it in the Stripe Dashboard → Transfers.'

  union all
  select 22, 'Should be 0', 'Live episodes with an empty title',
         (select count(*) from public_eps where coalesce(trim(title), '') = ''),
         (select left(string_agg(id, ', '), 300) from public_eps where coalesce(trim(title), '') = ''),
         'Checkout refuses an untitled title and lists print the title as stored. Give each a name in its editor.'

  union all
  select 23, 'Should be 0', 'Episode numbering guard switched off',
         (select count(*) from (select 1) one
           where not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                              where c.relname = 'episodes_show_position_uq' and i.indisvalid)),
         null,
         'The unique index migration 118 made is missing or invalid; run 118 again (it is safe to repeat).'

  union all
  select 25, 'Should be 0', 'Payee rows out of step',
         (select count(*) from payee_out_of_step),
         (select left(string_agg(id, ', '), 300) from payee_out_of_step),
         'An episode''s "who gets paid" history disagrees with who it pays now. The daily cron (creator reminders) closes the stray row and opens the right one; if the number stays above 0 after a day, look in Vercel → Logs for "payees: repaired".'

  union all
  select 26, 'Should be 0', 'Payee invites accepted with nothing moved',
         (select count(*) from payee_invites_stuck),
         (select left(string_agg(id::text, ', '), 300) from payee_invites_stuck),
         'Someone pressed Accept to be paid for a title and it stopped part-way. The daily cron (creator reminders) finishes it, or withdraws it and tells both sides; if the number stays above 0, look in Vercel → Logs for "payees: stuck invite".'

  union all
  select 24, 'Should be 0', 'Tables open to the public API',
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
         (select left(string_agg(c.relname, ', '), 300) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
         'Row level security is off on these: run  alter table <name> enable row level security;  for each.'

  union all
  select 40, 'Is it working', 'Ad plays recorded in the last 7 days',
         (select coalesce(sum(impressions), 0) from ad_impression_days where day >= current_date - 7),
         (select 'credit $' || to_char(coalesce(sum(credit_cents), 0) / 100.0, 'FM999990.00') from ad_impression_days where day >= current_date - 7),
         'Rises as advertisers'' ads play inside titles (what ad share pays creators from). 0 is normal until an approved ad with credit plays in an episode.'

  union all
  select 41, 'Is it working', 'Drafts saved in Creator Studio',
         (select count(*) from creator_drafts),
         null,
         'Migration 116 at work: a creator''s unfinished submissions and Add several uploads.'

  union all
  select 42, 'Is it working', 'Titles on sale',
         (select count(*) from title_prices where status = 'on'),
         (select count(*) || ' bought' from purchases where status = 'completed'),
         'Migration 117 at work: Buy to own.'

  union all
  select 43, 'Is it working', 'Shows public / private',
         (select count(*) from series where status = 'approved'),
         (select count(*) || ' private' from series where status = 'pending'),
         'Migration 118 at work. A private show is waiting for its first approved episode or for Make it public.'

  union all
  select 44, 'Is it working', '"Shot here" credits',
         (select count(*) from location_credits where status = 'approved'),
         (select count(*) || ' waiting on a host' from location_credits where status = 'pending'),
         'Migration 107 at work (put back by the repair).'

) answer
order by ord;
