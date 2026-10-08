-- The Connect / Stream kicker labels under the logo (lib/siteSettings.js
-- reads connect_label / stream_label; /api/admin/site-settings writes
-- them). The code shipped without this migration, so saving Site
-- Settings failed with "Could not find the 'connect_label' column" until
-- now — found 2026-10-08 while verifying the admin redesign.
alter table site_settings add column if not exists connect_label text not null default 'Connect';
alter table site_settings add column if not exists stream_label text not null default 'Stream';
