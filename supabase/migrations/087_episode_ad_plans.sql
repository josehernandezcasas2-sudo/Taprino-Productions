-- Episode Ad Curator (mockups/episode-ad-curator-v1.html, decisions
-- 2026-10-14): one ad plan per episode. A plan is the list of breaks
-- (seconds into the episode) and what each break is made of: exact
-- sections (any approved ad of that length), range sections (one ad
-- inside the range, bumpers take the rest), flex blocks (any lengths,
-- bumpers at the end) and pinned Studio Tapa ads. Each break books a
-- fixed number of seconds (the pieces, rounded up to round_to), so
-- runtime + breaks is an exact air length the scheduler can trust.
--
-- Only a plan with status 'ready' changes playback: the live channel
-- stops for its breaks and the main player plays them as pods. A
-- 'draft' (or no row at all) leaves the episode exactly as before.
-- Decisions (Jose, 2026-10-14): admins and content schedulers curate;
-- no cap per break, under 15 minutes of ads per hour on a channel;
-- bumper time is computed (whatever makes the break an even length);
-- self-implemented ads never count but are always shown; pinning is
-- internal, Studio Tapa's own ads only. Run after 086.

create table if not exists episode_ad_plans (
  -- episodes.id is text (not uuid) on this database, like every other
  -- table that points at an episode.
  episode_id text primary key references episodes(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'ready')),
  -- [{ "at": seconds, "pieces": [{ "kind": "exact", "seconds": 15 } |
  --   { "kind": "range", "min": 10, "max": 15 } | { "kind": "flex", "seconds": 60 } |
  --   { "kind": "pinned", "adId": uuid, "seconds": 20, "title": "..." }] }]
  breaks jsonb not null default '[]',
  -- Sponsor segments already inside the video, marked so breaks keep
  -- clear of them: [{ "inSeconds", "outSeconds", "sponsor", "url", "card" }]
  self_ads jsonb not null default '[]',
  round_to integer not null default 15 check (round_to between 1 and 300),
  merge_adjacent boolean not null default true,
  -- lib/adPlanRules.js AUTO_BUMPERS
  auto_bumper text not null default 'station_id' check (auto_bumper in ('presented_by', 'supported_by', 'station_id', 'channel', 'hold')),
  on_demand boolean not null default true,
  -- Computed on save from the episode's runtime and the breaks.
  air_seconds integer,
  ads_seconds integer not null default 0,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists episode_ad_plans_status_idx on episode_ad_plans (status);

-- Site-wide ad plan settings: the exact section sizes the curator offers
-- (and the advertiser form steers uploads to), the channel's hourly cap,
-- and the default rounding for a new plan.
alter table site_settings add column if not exists ad_section_sizes jsonb not null default '[10, 15, 20, 30]';
alter table site_settings add column if not exists ad_hour_cap_seconds integer not null default 900;
alter table site_settings add column if not exists ad_break_round_seconds integer not null default 15;

comment on table episode_ad_plans is 'Episode Ad Curator: per-episode ad breaks and what fills them (lib/adPlanRules.js). Only status=ready changes playback.';
comment on column site_settings.ad_section_sizes is 'Exact section sizes offered by the Ad Curator, in seconds. Advertisers are steered to these lengths.';
comment on column site_settings.ad_hour_cap_seconds is 'Ads per clock hour a channel may carry (900 = 15 minutes). The scheduler flags hours over it.';
