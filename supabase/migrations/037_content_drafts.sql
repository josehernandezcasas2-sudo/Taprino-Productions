-- One draft per (user, form type) — auto-saved as someone fills out a
-- pitch or episode submission, so getting interrupted (closed tab,
-- crashed browser, ran out of time) doesn't mean starting over. Only the
-- text/metadata fields are ever stored here — actual video/image files
-- selected via <input type="file"> can't be serialized to JSON, so a
-- resumed draft restores everything except file selections, which need
-- to be re-attached. That's an accepted, unavoidable limitation of
-- browser file inputs, not an oversight.
create table if not exists content_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  draft_type text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, draft_type)
);
create index if not exists content_drafts_user_idx on content_drafts (user_id, draft_type);
