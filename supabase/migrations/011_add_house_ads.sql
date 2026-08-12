-- House ads: Studio Taprino's own promos, served as valid VAST so the
-- existing IMA-based player plays them with zero player-side changes. This
-- is the ad system itself, not a placeholder — no network, no approval
-- process, no minimum traffic. Point NEXT_PUBLIC_AD_TAG_URL at your own
-- /api/house-ads/vast endpoint, or leave it unset and the player defaults
-- to it automatically.
create table if not exists house_ads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  advertiser text,                    -- bookkeeping only; never shown to viewers
  video_url text not null,            -- direct, progressive MP4 — VAST needs a real file, not HLS
  width int not null default 1280,
  height int not null default 720,
  duration_seconds numeric not null,  -- VAST's <Duration> must match the real file; nothing auto-detects this server-side, so it's entered same as an episode's runtime
  click_url text not null,            -- where a click actually sends the viewer
  weight int not null default 1,      -- relative odds among active ads; higher runs more often
  active boolean not null default true,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists house_ads_active_idx on house_ads (active) where active;

-- Atomic counters, called from the public tracking-pixel endpoints. Two
-- narrow functions rather than one dynamic-column-name function — no
-- string-built SQL, no injection surface, and the intent is obvious at a
-- glance from either call site.
create or replace function increment_house_ad_impression(target_id uuid)
returns void
language sql
as $$
  update house_ads set impressions = impressions + 1 where id = target_id;
$$;

create or replace function increment_house_ad_click(target_id uuid)
returns void
language sql
as $$
  update house_ads set clicks = clicks + 1 where id = target_id;
$$;

comment on table house_ads is
  'Self-served house ads — a working alternative to a third-party ad network for pre-approval / low-traffic launch. Served as VAST XML by /api/house-ads/vast.';
