-- Messages (Crew Call step 2): in-app DMs between two accounts. Every
-- conversation starts from something — a working card, a piece of gear,
-- later a call — and the thread remembers the latest "about" so the other
-- person knows why you wrote. One thread per pair of people.
--
-- Rules (lib/messages.js): anyone signed in can start a conversation;
-- blocking stops it both ways and hides the blocker's card from the
-- blocked person's directory; a report attaches the last messages as a
-- snapshot (dm_reports) and files a profile report through the existing
-- moderation flow. Service-role only, like every other table (no RLS).

create table if not exists dm_threads (
  id uuid primary key default gen_random_uuid(),
  -- The pair, sorted, so (a, b) and (b, a) are the same thread.
  user_a text not null,
  user_b text not null,
  -- { kind: 'card' | 'gear' | 'call' | 'profile', label, id? } — the
  -- latest thing the conversation was about, shown above the messages.
  context jsonb,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_id text,
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);
comment on table dm_threads is 'Direct-message threads, one per pair of accounts (user_a < user_b).';
create index if not exists dm_threads_a_idx on dm_threads (user_a, last_message_at desc);
create index if not exists dm_threads_b_idx on dm_threads (user_b, last_message_at desc);

create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references dm_threads (id) on delete cascade,
  sender_id text not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
comment on table dm_messages is 'Messages in a dm_thread. Private: only the two participants read them (plus a snapshot on a report).';
create index if not exists dm_messages_thread_idx on dm_messages (thread_id, created_at);

-- Per person, per thread: where they've read up to, mute, and when we
-- last emailed them about it (one email per thread per 30 minutes).
create table if not exists dm_thread_state (
  thread_id uuid not null references dm_threads (id) on delete cascade,
  user_id text not null,
  last_read_at timestamptz,
  muted boolean not null default false,
  last_emailed_at timestamptz,
  primary key (thread_id, user_id)
);

create table if not exists user_blocks (
  blocker_id text not null,
  blocked_id text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
comment on table user_blocks is 'Blocker can''t be messaged by blocked; blocker''s Crew Call card is hidden from blocked.';
create index if not exists user_blocks_blocked_idx on user_blocks (blocked_id);

-- A reported conversation: the last messages at the time of the report,
-- so an admin can judge it without messages being readable otherwise.
create table if not exists dm_reports (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references dm_threads (id) on delete cascade,
  reporter_id text not null,
  reported_id text not null,
  reason text not null,
  messages jsonb not null,
  status text not null default 'open' check (status in ('open', 'dismissed', 'upheld')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists dm_reports_open_idx on dm_reports (status, created_at desc);

-- Profile reports (the Report button on /profile/<id>, and a reported
-- conversation) were never allowed by 072's check constraints, which only
-- listed episode/series/channel_media — the insert failed. Widen them.
alter table content_reports drop constraint if exists content_reports_target_type_check;
alter table content_reports add constraint content_reports_target_type_check check (target_type in ('episode', 'series', 'channel_media', 'profile'));
alter table content_flags drop constraint if exists content_flags_target_type_check;
alter table content_flags add constraint content_flags_target_type_check check (target_type in ('episode', 'series', 'channel_media', 'profile'));
