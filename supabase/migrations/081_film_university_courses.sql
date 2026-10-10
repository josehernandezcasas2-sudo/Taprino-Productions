-- Film University, second shape (2026-10-10): a university, not a workshop.
-- Departments (the existing uni_topics) → courses → lessons, with the
-- lessons optionally grouped under module headings. Files (templates,
-- worksheets, sample scripts, example footage) hang off a course or a
-- lesson as "materials" or "examples"; the Examples tab on a course only
-- appears when there are some. Progress (the tick per lesson) is stored
-- per signed-in user so it follows them across devices.
--
-- Run after 078. Existing lessons are moved into one "<Department> 101"
-- course per department so nothing disappears; the Workshop exercises
-- become the assignment on the lesson they taught, and the table goes.

-- 1. Courses --------------------------------------------------------------
create table if not exists uni_courses (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references uni_topics(id) on delete cascade,
  slug text not null unique,
  title text not null,
  description text,
  -- 'start' = Start here, '2' = Level 2, '3' = Level 3.
  level text not null default 'start',
  cover_url text,
  -- Free text shown on the course page ("Nothing to start · a scene by lesson 3").
  needs text,
  -- The course to suggest when this one is finished.
  next_course_id uuid references uni_courses(id) on delete set null,
  sort_order integer not null default 0,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists uni_courses_topic_idx on uni_courses (topic_id, sort_order);
comment on table uni_courses is 'Film University courses: a short, ordered programme inside a department (uni_topics).';

-- 2. Modules (optional headings inside a course) --------------------------
create table if not exists uni_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references uni_courses(id) on delete cascade,
  title text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists uni_modules_course_idx on uni_modules (course_id, sort_order);
comment on table uni_modules is 'Optional module headings that group a course''s lessons on the syllabus.';

-- 3. Lessons move under courses ------------------------------------------
alter table uni_lessons add column if not exists course_id uuid references uni_courses(id) on delete cascade;
alter table uni_lessons add column if not exists module_id uuid references uni_modules(id) on delete set null;
-- The assignment ("Find the turn") lives on the lesson it belongs to.
alter table uni_lessons add column if not exists assignment_title text;
alter table uni_lessons add column if not exists assignment_text text;
alter table uni_lessons add column if not exists assignment_minutes integer;
comment on column uni_lessons.course_id is 'The course this lesson belongs to. Every lesson lives under a course.';
comment on column uni_lessons.assignment_text is 'Optional assignment shown on the lesson page (steps, one per line).';

-- One "<Department> 101" course per department that already has lessons,
-- so every existing lesson has a course to live in.
insert into uni_courses (topic_id, slug, title, description, level, sort_order, published)
select t.id,
       t.slug || '-101',
       t.name || ' 101',
       t.description,
       'start',
       1,
       t.published
from uni_topics t
where exists (select 1 from uni_lessons l where l.topic_id = t.id)
  and not exists (select 1 from uni_courses c where c.topic_id = t.id)
on conflict (slug) do nothing;

update uni_lessons l
set course_id = c.id
from uni_courses c
where l.course_id is null and c.topic_id = l.topic_id and c.slug like '%-101';

-- Lesson slugs are unique within a course now, not a department.
alter table uni_lessons drop constraint if exists uni_lessons_topic_id_slug_key;
create unique index if not exists uni_lessons_course_slug_idx on uni_lessons (course_id, slug);
create index if not exists uni_lessons_course_idx on uni_lessons (course_id, sort_order);

-- 4. Files: materials and examples ---------------------------------------
create table if not exists uni_files (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references uni_courses(id) on delete cascade,
  -- Set when the file belongs to one lesson; null = course-wide.
  lesson_id uuid references uni_lessons(id) on delete set null,
  -- 'material' = something to download and use (template, worksheet);
  -- 'example' = something to look at (sample script, example footage).
  role text not null default 'material' check (role in ('material', 'example')),
  -- 'file' = a download in the university-docs bucket; 'video' = a
  -- Cloudflare Stream clip (examples only).
  kind text not null default 'file' check (kind in ('file', 'video')),
  title text not null,
  description text,
  file_url text,
  -- Short label for the icon: pdf, xlsx, docx, zip, txt, fdx, other.
  file_type text,
  size_bytes bigint,
  pages integer,
  video_src text,
  duration_seconds integer,
  thumbnail_url text,
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists uni_files_course_idx on uni_files (course_id, role, sort_order);
create index if not exists uni_files_lesson_idx on uni_files (lesson_id);
comment on table uni_files is 'Downloadable course materials and examples (files or Cloudflare clips) attached to a course or a lesson.';

-- Documents flagged as templates become materials of their course too, so
-- they show on the Materials tab and in the Library as well as being a
-- reading lesson.
insert into uni_files (course_id, lesson_id, role, kind, title, description, file_url, file_type, pages, thumbnail_url, sort_order, published)
select l.course_id, l.id, 'material', 'file', l.title, l.description, l.document_url, 'pdf', l.document_pages, l.thumbnail_url, l.sort_order, l.published
from uni_lessons l
where l.kind = 'document' and l.is_template and l.document_url is not null and l.course_id is not null
  and not exists (select 1 from uni_files f where f.lesson_id = l.id and f.file_url = l.document_url);

-- 5. Workshop exercises → lesson assignments -----------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'uni_exercises') then
    update uni_lessons l
    set assignment_title = e.title,
        assignment_text = coalesce(e.summary, '') || case when jsonb_array_length(e.steps) > 0
          then E'\n\n' || (select string_agg(value, E'\n') from jsonb_array_elements_text(e.steps)) else '' end,
        assignment_minutes = e.minutes
    from uni_exercises e
    where e.lesson_id = l.id and l.assignment_title is null;
    drop table uni_exercises;
  end if;
end $$;

-- 6. Progress, per signed-in user ----------------------------------------
create table if not exists uni_progress (
  user_id text not null,
  lesson_id uuid not null references uni_lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index if not exists uni_progress_user_idx on uni_progress (user_id);
comment on table uni_progress is 'Which lessons a signed-in viewer has marked done (Clerk user id). Signed-out viewers keep theirs on the device.';
