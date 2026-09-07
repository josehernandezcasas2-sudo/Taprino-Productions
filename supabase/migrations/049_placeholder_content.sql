-- Supports the admin "generate placeholder content" tool — lets admin see
-- how each content type actually looks across browse pages, cards, and
-- hero sections without hand-creating throwaway test episodes (which is
-- exactly how the site ended up with lingering content literally titled
-- "test" and "hi peeps" in earlier sessions). Marking these explicitly
-- means they can always be found and bulk-removed in one action, rather
-- than lingering indefinitely the way ad-hoc test content has before.
alter table episodes add column if not exists is_placeholder boolean not null default false;
alter table series add column if not exists is_placeholder boolean not null default false;
create index if not exists episodes_is_placeholder_idx on episodes (is_placeholder) where is_placeholder = true;
