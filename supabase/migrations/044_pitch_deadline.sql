-- Optional, self-reported funding deadline — same trust model as
-- funding_goal/funding_raised (migration 026): the creator reports it,
-- Studio Tapa doesn't verify or enforce it, since the actual funding
-- happens on the creator's own external page.
alter table pitches add column if not exists funding_deadline date;
comment on column pitches.funding_deadline is 'Self-reported by the creator — not tracked or enforced by Studio Tapa, same caveat as funding_goal/funding_raised.';
