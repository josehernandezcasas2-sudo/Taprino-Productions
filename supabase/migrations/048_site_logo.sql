-- Distinct from favicon_url and app_icon_url (already on this table) —
-- those are the browser tab icon and PWA home-screen icon respectively.
-- This one is the actual visible logo in the header nav, currently a
-- plain "ST" text badge with no image behind it at all.
alter table site_settings add column if not exists site_logo_url text;
comment on column site_settings.site_logo_url is 'Header nav logo image. Null falls back to the plain "ST" text badge.';
