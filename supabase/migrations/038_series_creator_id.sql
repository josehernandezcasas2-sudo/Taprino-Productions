-- Series had no direct link to a person at all — "ownership" was only
-- ever inferred by checking whether someone had at least one episode
-- with this series_id. That's fragile (breaks if episodes get
-- reassigned/removed) and doesn't cover the case where admin creates or
-- uploads on behalf of a creator who can't do it themselves — the show
-- itself never got attributed to anyone in that case, only whichever
-- individual episodes happened to resolve a creatorEmail correctly.
alter table series add column if not exists creator_id text;
create index if not exists series_creator_id_idx on series (creator_id);
