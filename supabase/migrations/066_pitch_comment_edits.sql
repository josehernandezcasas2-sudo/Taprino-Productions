-- Lets a commenter edit their own pitch comment after posting. Separate
-- from created_at (which must never change, it's the thread's sort key)
-- — null means never edited, so the UI only shows "(edited)" when this
-- is actually set.
alter table pitch_comments add column if not exists updated_at timestamptz;
comment on column pitch_comments.updated_at is 'Set only when the commenter edits their own comment after posting. Null means never edited.';
