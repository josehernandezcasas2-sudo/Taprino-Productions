-- 100: Early screenings (Jose, 2026-10-12 decision, built 2026-10-23).
-- For the first 24 hours after a premium-tier title is released it plays
-- only for Premium and Sponsor members (and admins, the creator, and
-- anyone who bought it); Standard, Basic and signed-out viewers see the
-- "Early screening" panel until it opens. Free titles and podcasts go
-- out to everyone the same day. released_at is the moment the title
-- became public: set when a submission is approved (lib/reviewQueue.js),
-- backfilled here as the availability window's start or the row's
-- creation. lib/earlyAccess.js takes the later of released_at and
-- available_from, so a scheduled release counts from when it went live.

alter table episodes add column if not exists released_at timestamptz;

update episodes
set released_at = coalesce(available_from, created_at)
where status = 'approved' and released_at is null;
