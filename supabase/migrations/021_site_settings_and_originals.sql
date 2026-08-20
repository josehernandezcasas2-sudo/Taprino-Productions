-- Site-wide settings singleton — starting with the Shop link, but this is
-- the natural home for future site-level toggles too, rather than adding
-- a new one-off table each time. Off by default until an admin actually
-- configures a real URL.
create table if not exists site_settings (
  id int primary key default 1,
  shop_enabled boolean not null default false,
  shop_url text,
  updated_at timestamptz not null default now(),
  constraint site_settings_singleton check (id = 1)
);
insert into site_settings (id) values (1) on conflict (id) do nothing;
comment on table site_settings is
  'Site-wide toggleable settings, singleton row. Shop link is the first — off until an admin sets a real URL in /admin/content-lifecycle.';

-- Tapa Originals — a designation independent of tier (free/premium). An
-- episode can be a free Original or a premium Original; this just marks
-- "made exclusively for Studio Tapa" separately from what it costs to watch.
alter table episodes add column if not exists is_original boolean not null default false;
comment on column episodes.is_original is
  'Tapa Originals — exclusive-to-Studio-Tapa designation, independent of tier. Toggled per-episode by admin/creator.';
