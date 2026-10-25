-- Emergency Call + the bench (Connect, 2026-10-25).
--
-- Someone bailed the night before: an urgent call needs a person by a
-- time within the next 48 hours. Urgent calls sit at the top of the
-- board, go out with an urgent push/email, and close themselves once the
-- time has passed. People can say "I'm free right now" on their card for
-- a few hours, which puts them first in line for urgent calls nearby.
-- The bench: a poster can book someone as the backup for a spot, and
-- promote them in one tap when the booked person drops. Showing up for
-- an urgent call ("came through") is counted on the track record.

alter table crew_calls add column if not exists urgent boolean not null default false;
-- When the person is needed by (urgent calls only; within 48 h of posting).
alter table crew_calls add column if not exists needed_by timestamptz;
-- When the first response landed, so the poster can see how fast the
-- board moved ("first response in 9 min").
alter table crew_calls add column if not exists first_response_at timestamptz;
create index if not exists crew_calls_urgent_idx on crew_calls (urgent, needed_by) where status = 'open';

-- "I'm free right now" until this time; null or past = not flagged.
alter table crew_cards add column if not exists available_now_until timestamptz;

-- A response can be booked as the backup for the spot (the bench). It
-- doesn't count against the spots until it's promoted to booked.
alter table crew_responses drop constraint if exists crew_responses_status_check;
alter table crew_responses add constraint crew_responses_status_check check (status in ('sent', 'booked', 'backup', 'declined', 'withdrawn'));
alter table crew_responses add column if not exists benched_at timestamptz;
