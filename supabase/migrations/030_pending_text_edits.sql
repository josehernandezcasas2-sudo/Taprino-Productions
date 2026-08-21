-- Same staging pattern as pending_poster/pending_thumbnail (see
-- resolve-artwork.js): a creator requesting a title/description change on
-- something already live doesn't touch the live fields directly — it
-- stages the proposed values here, and an admin approves (copies
-- pending → live) or denies (just clears the pending columns) it.
alter table episodes add column if not exists pending_title text;
alter table episodes add column if not exists pending_description text;
alter table series add column if not exists pending_name text;
alter table series add column if not exists pending_description text;
comment on column episodes.pending_title is 'Staged title change awaiting admin approval — does not affect the live title until approved.';
comment on column series.pending_name is 'Staged show/series name change awaiting admin approval.';
