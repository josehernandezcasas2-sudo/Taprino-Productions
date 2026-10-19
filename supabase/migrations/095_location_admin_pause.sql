-- Who paused a place: when an admin pauses it (from /admin/locations),
-- the host can't simply resume it (lib/locations.js setListingStatus);
-- an admin resumes it. A host's own pause stays theirs to undo.
alter table locations add column if not exists paused_by_admin boolean not null default false;
