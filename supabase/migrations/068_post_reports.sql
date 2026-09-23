-- Report flag for the posts table (see 067_posts.sql) — same shape as
-- pitch_comments' own reported/report_reason columns (migration history
-- for pitch comments). A report flags for admin review, it does not hide
-- the post itself.
alter table posts add column if not exists reported boolean not null default false;
alter table posts add column if not exists report_reason text;
