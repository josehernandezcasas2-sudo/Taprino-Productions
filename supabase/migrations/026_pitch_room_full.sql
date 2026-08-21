-- Pitch Room, full version. Extends the pitches table from migration 025
-- and adds everything needed for a real project page: team and photos are
-- kept as JSONB arrays on the pitch row itself (neither needs independent
-- identity or its own queries — a team member is just a name+role, a
-- photo is just a URL — so a whole extra table each would be overhead
-- without benefit). Updates, saves, and comments each get their own
-- table since those genuinely are independent, growing, timestamped
-- records.
alter table pitches add column if not exists tag text;
alter table pitches add column if not exists thumbnail text;
alter table pitches add column if not exists hero_image text;
alter table pitches add column if not exists funding_goal numeric;
alter table pitches add column if not exists funding_raised numeric;
alter table pitches add column if not exists team jsonb not null default '[]';
alter table pitches add column if not exists photos jsonb not null default '[]';
-- Clerk user id of the creator who submitted this — null for anything an
-- admin added directly. This is what makes the creator dashboard possible:
-- "my pitches" means "pitches where created_by = my Clerk user id."
alter table pitches add column if not exists created_by text;
comment on column pitches.funding_goal is 'Self-reported by the creator — not tracked or verified by Studio Tapa, since funding happens on their own external page.';
comment on column pitches.funding_raised is 'Self-reported, same caveat as funding_goal.';
comment on column pitches.team is 'Array of {name, role} objects — the people behind the project.';
comment on column pitches.photos is 'Array of image URLs for the project gallery.';

create table if not exists pitch_updates (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid not null references pitches(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists pitch_updates_pitch_idx on pitch_updates (pitch_id, created_at desc);
comment on table pitch_updates is 'Progress posts on a pitch, newest first. Posting one notifies everyone who has saved that pitch.';

create table if not exists pitch_saves (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  pitch_id uuid not null references pitches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, pitch_id)
);
create index if not exists pitch_saves_user_idx on pitch_saves (user_id);
create index if not exists pitch_saves_pitch_idx on pitch_saves (pitch_id);
comment on table pitch_saves is 'Who is following which pitch — drives both "My Saved Projects" and update notifications.';

-- Comments are visible by default but carry a report flag an admin can act
-- on. Deliberately NOT auto-hidden the moment someone reports it — a
-- single report shouldn't silently censor a comment before a human looks
-- at it; it just surfaces it in the admin queue. Admin can then keep it
-- (clears the report) or delete it (soft delete via status, not a hard
-- row delete, so there's a record of what was removed and why).
create table if not exists pitch_comments (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid not null references pitches(id) on delete cascade,
  user_id text not null,
  user_email text,
  body text not null,
  reported boolean not null default false,
  report_reason text,
  status text not null default 'visible' check (status in ('visible', 'deleted')),
  created_at timestamptz not null default now()
);
create index if not exists pitch_comments_pitch_idx on pitch_comments (pitch_id, created_at);
create index if not exists pitch_comments_reported_idx on pitch_comments (reported) where reported = true;

-- Generalizing notifications to also cover pitch updates, not just
-- episode-related events.
alter table notifications add column if not exists pitch_id uuid references pitches(id) on delete cascade;
