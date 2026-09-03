-- Curated rows for "Option A" browse pages (pages/type/[type].js today,
-- other pages later): each row is either an auto-managed 'genre' row
-- (membership computed from content, same as the homepage's existing
-- behavior) or an admin-created 'custom' row (an explicit, hand-picked
-- list of episodes). Both kinds share the same ordering and
-- active/inactive toggle, since "move the lists up or down" was asked
-- for both, not just the new custom ones.
--
-- scope identifies which page a row belongs to (e.g. 'type:films',
-- 'type:series') — a custom group made for the Films page has no
-- business also appearing on the Series page, and genre rows are
-- naturally scoped this way too (a genre's row on the Films page only
-- ever contains films, regardless of what else carries that genre).
create table if not exists curated_groups (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  group_type text not null check (group_type in ('genre', 'custom')),
  genre_name text,
  title text,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Keeps at most one row per (scope, genre) — auto-created genre rows
  -- are looked up by this, so a genre a page has already seen doesn't
  -- get a duplicate row every time content changes. NULL genre_name
  -- (every 'custom' row) doesn't count as a duplicate of another NULL
  -- under Postgres's unique-constraint rules, so this doesn't limit how
  -- many custom groups a scope can have.
  unique (scope, group_type, genre_name)
);
create index if not exists curated_groups_scope_idx on curated_groups (scope, position);

create table if not exists curated_group_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references curated_groups(id) on delete cascade,
  episode_id text not null references episodes(id) on delete cascade,
  position integer not null default 0,
  unique (group_id, episode_id)
);
create index if not exists curated_group_items_group_idx on curated_group_items (group_id, position);

comment on table curated_groups is 'One row per curated browse-page section (genre-based or hand-picked custom), reorderable and independently hideable via active.';
comment on column curated_groups.scope is 'Which page this row belongs to, e.g. type:films. A row never appears outside its own scope.';
comment on table curated_group_items is 'Explicit episode membership for group_type=custom rows only — genre rows compute membership live from content instead.';

alter table site_settings add column if not exists curated_rows_random_order boolean not null default false;
comment on column site_settings.curated_rows_random_order is 'When true, curated row order is shuffled per page load instead of following each row''s admin-set position.';
