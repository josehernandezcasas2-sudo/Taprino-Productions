-- Series have never had a review/status concept before now — they've
-- always been immediately live the moment a row exists (episodes are the
-- only thing that's ever been gated behind pending/approved). Defaulting
-- existing rows to 'approved' means nothing already on the site changes
-- behavior; only series created through the new creator-facing "Add
-- Series" flow start as 'pending'.
--
-- Note this is independent of public visibility: a series with zero
-- approved episodes already doesn't show up anywhere on the site, since
-- every browse page is driven by querying episodes and grouping them by
-- series_id, not by querying series directly. This status column is
-- about admin reviewing the series' own metadata (name, description,
-- artwork) before other people can discover/select it, not about hiding
-- it from public pages a second time.
alter table series add column if not exists status text not null default 'approved';
alter table series add column if not exists submitted_by text;
alter table series add column if not exists reviewed_by text;
alter table series add column if not exists reviewed_at timestamptz;
create index if not exists series_status_idx on series (status);

comment on column series.status is 'pending | approved | rejected. Existing rows default to approved so nothing already live is affected.';
