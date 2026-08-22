-- Nav visibility toggles for Vertical and Podcasts, matching the existing
-- live_tv_enabled pattern — default true (visible) so existing sites don't
-- lose these links on upgrade.
alter table site_settings add column if not exists vertical_enabled boolean not null default true;
alter table site_settings add column if not exists podcasts_enabled boolean not null default true;
