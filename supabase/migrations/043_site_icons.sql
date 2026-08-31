-- Admin-replaceable favicon (browser tab icon) and app icon (used in
-- manifest.json for "Add to Home Screen"/PWA install). Both null by
-- default, falling back to the static /icon.svg already in /public —
-- same optional-override pattern as search_icon_url and theme_overrides
-- on this same table.
alter table site_settings add column if not exists favicon_url text;
alter table site_settings add column if not exists app_icon_url text;

comment on column site_settings.favicon_url is 'Overrides the browser tab icon. Null = falls back to /icon.svg.';
comment on column site_settings.app_icon_url is 'Overrides the PWA/home-screen app icon served via /api/manifest. Null = falls back to /icon.svg.';
