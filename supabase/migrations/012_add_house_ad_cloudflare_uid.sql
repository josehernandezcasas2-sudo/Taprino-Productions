-- Tracks which house ads were imported via Cloudflare Stream rather than
-- the direct small-file upload, so the admin dashboard can show where each
-- came from and so a future cleanup job has something to key off of if a
-- Cloudflare-hosted house ad is ever deleted.
alter table house_ads add column if not exists cloudflare_uid text;

comment on column house_ads.cloudflare_uid is
  'Cloudflare Stream video uid, when this ad was imported via resumable upload rather than the direct small-file path. Null for direct uploads.';
