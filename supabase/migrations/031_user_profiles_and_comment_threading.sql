-- User profiles — separate from Clerk's own user object on purpose.
-- display_name is public (replaces showing raw email anywhere a user's
-- identity appears, like pitch comments). gender/age are explicitly
-- private — collected for our own aggregate understanding only, never
-- returned by any endpoint a browser could use to show one user's
-- profile to another. social_links is here now (empty by default) since
-- it's the natural next piece for a future creator profile page — no
-- separate migration needed when that gets built.
create table if not exists user_profiles (
  user_id text primary key,
  display_name text,
  gender text,
  age int,
  social_links jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column user_profiles.display_name is 'Public — shown instead of email anywhere a user''s identity appears (e.g. pitch comments).';
comment on column user_profiles.gender is 'PRIVATE. Aggregate metadata only — never exposed to other users or in any public-facing query.';
comment on column user_profiles.age is 'PRIVATE. Same rule as gender.';

-- Comment threading — a reply references its parent. Top-level comments
-- have parent_comment_id = null, same table either way.
alter table pitch_comments add column if not exists parent_comment_id uuid references pitch_comments(id) on delete cascade;
create index if not exists pitch_comments_parent_idx on pitch_comments (parent_comment_id);

-- Privacy cleanup — comments already stored real email addresses and
-- displayed them publicly. Display name resolution now happens
-- dynamically via user_profiles at read time instead, so the stored
-- email is both unused going forward and a liability sitting in the
-- table. Clearing it here rather than leaving it as dead data.
update pitch_comments set user_email = null;
