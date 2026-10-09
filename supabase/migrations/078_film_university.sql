-- Film University (/university on the web, Home → Film University in the
-- app). Free learning hub in the "Workshop" shape: exercises are the front
-- door, lessons (a video or a document) are what you watch or read to do
-- them, and templates are document lessons flagged for the download shelf.
-- Everything here is admin-authored; there is no creator or viewer write
-- path, so the tables are plain (no RLS — the service-role client is the
-- only thing that reads them, same as every other table in this app).

create table if not exists uni_topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  -- One of the site palette keys (lib/university.js TOPIC_ACCENTS): the
  -- coloured corner on a topic card. Free text so new accents need no migration.
  accent text not null default 'brass',
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table uni_topics is 'Film University topics (Directing, Writing, ...). Each holds an ordered list of lessons.';

create table if not exists uni_lessons (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references uni_topics(id) on delete cascade,
  slug text not null,
  title text not null,
  description text,
  -- 'video' plays through the same signed Cloudflare Stream flow as
  -- episodes (video_src is the stored manifest URL, like episodes.src);
  -- 'document' is a PDF in the public university-docs storage bucket.
  kind text not null check (kind in ('video', 'document')),
  video_src text,
  duration_seconds integer,
  thumbnail_url text,
  document_url text,
  document_pages integer,
  -- Document lessons flagged as templates show on the landing page's
  -- "Templates" shelf and in an exercise's "Use with" box.
  is_template boolean not null default false,
  -- A document lesson attached to a video lesson ("Attached document" box
  -- on the lesson page). Points at another row rather than a loose URL so
  -- the same worksheet can be a lesson of its own and an attachment.
  attachment_lesson_id uuid references uni_lessons(id) on delete set null,
  sort_order integer not null default 0,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, slug)
);
create index if not exists uni_lessons_topic_idx on uni_lessons (topic_id, sort_order);
comment on table uni_lessons is 'Film University lessons: a video (Cloudflare Stream) or a document (PDF in storage), ordered within a topic.';

create table if not exists uni_exercises (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  topic_id uuid references uni_topics(id) on delete set null,
  -- The one-paragraph brief shown on the card and above the steps.
  summary text,
  -- Ordered steps, a JSON array of strings.
  steps jsonb not null default '[]'::jsonb,
  minutes integer,
  -- What you need to do it: any of 'camera', 'phone', 'scene', 'person',
  -- 'nothing'. Drives the filter chips on the Workshop page.
  needs text[] not null default '{}',
  -- "Watch to do it": the main lesson, plus any further ones.
  lesson_id uuid references uni_lessons(id) on delete set null,
  extra_lesson_ids uuid[] not null default '{}',
  -- "Use with": a template document lesson.
  template_lesson_id uuid references uni_lessons(id) on delete set null,
  -- Today's exercise rotates by date through the published list; an admin
  -- can pin one to a specific day instead (pinned_on = that date wins).
  pinned_on date,
  sort_order integer not null default 0,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists uni_exercises_topic_idx on uni_exercises (topic_id, sort_order);
create index if not exists uni_exercises_pinned_idx on uni_exercises (pinned_on) where pinned_on is not null;
comment on table uni_exercises is 'Film University exercises: the Workshop front door. Each links the lessons that teach it and an optional template.';

-- Starter topics so the admin page isn't empty on first open. Harmless to
-- re-run: slugs are unique and conflicts are skipped.
insert into uni_topics (slug, name, description, accent, sort_order) values
  ('directing', 'Directing', 'Blocking, working with actors, shot choice.', 'brass', 1),
  ('writing', 'Writing', 'Loglines to shooting scripts, and the formats that go with them.', 'olive', 2),
  ('editing', 'Editing', 'Rhythm, coverage, cutting dialogue, finishing.', 'sky', 3),
  ('sound', 'Sound', 'Recording on set, dialogue clean-up, mixing for phones.', 'mint', 4),
  ('producing', 'Producing', 'Budgets, call sheets, releases, getting it done.', 'brass-deep', 5),
  ('getting-seen', 'Getting seen', 'Festivals, pitching, Pitch Room, posting short-form.', 'ocean', 6)
on conflict (slug) do nothing;
