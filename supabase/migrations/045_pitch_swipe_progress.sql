-- One row per signed-in user, tracking where they are in the Discover
-- swipe deck (pages/pitches/discover.js) so it survives closing the tab,
-- switching devices, or navigating away to read a full pitch. Signed-out
-- visitors get the equivalent via localStorage instead (see
-- lib/swipeProgressStorage.js) — this table is only ever touched by
-- signed-in users.
--
-- Stores pitch IDs, not full pitch objects — the actual pitch content
-- always comes fresh from the server on load, and IDs here are
-- reconciled against that live list, so a pitch that's since been
-- deleted or unapproved just quietly drops out rather than needing any
-- cleanup of this table.
create table if not exists pitch_swipe_progress (
  user_id text primary key,
  deck_ids jsonb not null default '[]',
  second_chance_ids jsonb not null default '[]',
  round integer not null default 1,
  liked_ids jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
comment on table pitch_swipe_progress is 'One row per signed-in user — their current position in the Pitch Room Discover swipe deck. Row is deleted once they finish the deck or explicitly start over.';
