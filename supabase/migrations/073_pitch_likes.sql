-- Discover's elevator redesign (pages/pitches/discover.js) splits the old
-- single heart into two buttons: Save (the existing pitch_saves follow,
-- which still drives "N people following" and creator update emails) and
-- Like, a lightweight public thumbs-up with a count. Same shape as
-- post_likes (070): one row per (pitch, user), the pair's uniqueness is
-- what makes toggling idempotent, and both the count and "did this viewer
-- already like it" come from the same table — no counter column on
-- pitches to keep in sync.
create table if not exists pitch_likes (
  pitch_id uuid not null references pitches(id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (pitch_id, user_id)
);

create index if not exists pitch_likes_pitch_id_idx on pitch_likes (pitch_id);
comment on table pitch_likes is 'Lightweight public likes on pitches (Discover''s Like button). Separate from pitch_saves, which is the follow.';

-- The elevator keeps the whole ordered deck and remembers which floor
-- you're on (you can ride back down to a previous pitch now), where the
-- old swipe deck only kept the cards still ahead of you. Optional column
-- with a default so the mobile app's swipe deck, which doesn't send it,
-- keeps working unchanged.
alter table pitch_swipe_progress add column if not exists floor_index integer not null default 0;
