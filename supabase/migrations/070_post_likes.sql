-- One row per (post, user) like — the pair's uniqueness is what makes
-- toggling idempotent and lets a post's like count and "did this viewer
-- already like it" both come from the same table, no separate counter
-- column on posts to keep in sync.
create table if not exists post_likes (
  post_id text not null references posts(id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_post_id_idx on post_likes (post_id);
