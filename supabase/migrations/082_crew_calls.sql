-- Crew Call step 3: the calls board and the track record.
--
-- Anyone signed in can post a call (a role needed, when, where or remote,
-- how it pays) and respond to one. A response is a message to the poster
-- with the call attached (dm_threads context). The poster books people;
-- after the last day the poster (or an admin, if the poster goes quiet)
-- says whether each booked person worked it. A "worked" outcome is the
-- only way to earn a confirmed job, and confirmed jobs + released titles
-- on Studio Tapa decide the tier shown next to a name everywhere:
-- New crew (first month) → Crew → Veteran (3+). Hand-typed credits never
-- count. Service-role only, like every other table (no RLS).

create table if not exists crew_calls (
  id uuid primary key default gen_random_uuid(),
  poster_id text not null,
  title text not null,
  -- One role per call (lib/crewOptions.js CREW_ROLES); spots is how many.
  role text not null,
  spots integer not null default 1 check (spots between 1 and 20),
  pay_type text not null check (pay_type in ('paid', 'union', 'deferred', 'unpaid', 'other')),
  pay_note text,
  starts_on date,
  ends_on date,
  remote boolean not null default false,
  -- Where, as the geocoder returned it (same shape as crew_cards). The
  -- point is used for the distance filter and the notification radius.
  place_label text,
  city text,
  region text,
  country text,
  lat double precision,
  lng double precision,
  -- Optional link to a Pitch Room project or a series ("Crew needed"
  -- block on that page). project_title is copied at post time.
  project_type text check (project_type in ('pitch', 'series')),
  project_id text,
  project_title text,
  details text,
  status text not null default 'open' check (status in ('open', 'closed', 'removed')),
  closed_at timestamptz,
  -- Same report/flag machinery as titles (lib/moderation.js target 'call').
  moderation_hold boolean not null default false,
  responses_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table crew_calls is 'Crew Call board posts: a role needed, when, where, pay. Close themselves a week after the last day.';
create index if not exists crew_calls_open_idx on crew_calls (status, created_at desc);
create index if not exists crew_calls_poster_idx on crew_calls (poster_id, created_at desc);
create index if not exists crew_calls_project_idx on crew_calls (project_type, project_id) where status = 'open';

create table if not exists crew_responses (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references crew_calls (id) on delete cascade,
  user_id text not null,
  message text not null,
  -- The conversation this response opened (the message went there too).
  thread_id uuid references dm_threads (id) on delete set null,
  status text not null default 'sent' check (status in ('sent', 'booked', 'declined', 'withdrawn')),
  booked_at timestamptz,
  -- After the last day: did they work it? Set by the poster, or an admin.
  outcome text check (outcome in ('worked', 'no_show', 'cancelled')),
  outcome_at timestamptz,
  outcome_by text,
  created_at timestamptz not null default now(),
  unique (call_id, user_id)
);
comment on table crew_responses is 'Responses to a call. outcome = worked is a confirmed job on the responder''s track record.';
create index if not exists crew_responses_user_idx on crew_responses (user_id, outcome);
create index if not exists crew_responses_call_idx on crew_responses (call_id, created_at);

-- One line each way after a confirmed job ("would work together again").
create table if not exists crew_endorsements (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references crew_responses (id) on delete cascade,
  from_user_id text not null,
  to_user_id text not null,
  line text not null check (char_length(line) between 1 and 200),
  would_again boolean not null default true,
  created_at timestamptz not null default now(),
  unique (response_id, from_user_id)
);
create index if not exists crew_endorsements_to_idx on crew_endorsements (to_user_id, created_at desc);

-- Matching calls email people whose card lists the role and whose place +
-- travel radius reaches the call; this is the off switch.
alter table crew_cards add column if not exists call_emails boolean not null default true;

-- Notifications can now carry a link (a call, a conversation), so the
-- bell opens the right place instead of just marking read.
alter table notifications add column if not exists href text;

-- Calls can be reported and flagged like titles and profiles.
alter table content_reports drop constraint if exists content_reports_target_type_check;
alter table content_reports add constraint content_reports_target_type_check check (target_type in ('episode', 'series', 'channel_media', 'profile', 'call'));
alter table content_flags drop constraint if exists content_flags_target_type_check;
alter table content_flags add constraint content_flags_target_type_check check (target_type in ('episode', 'series', 'channel_media', 'profile', 'call'));
