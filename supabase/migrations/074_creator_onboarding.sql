-- Creator onboarding (/apply redesign).
--
-- Applications now belong to a signed-in account: user_id lets "Accept"
-- grant Creator Studio directly and lets the applicant see where their
-- application stands. The rights check (five yes/no questions answered
-- on the page before applying) travels with the row, so review opens
-- with the likely holds already listed instead of discovering them after
-- the master arrives.
alter table creator_applications add column if not exists user_id text;
alter table creator_applications add column if not exists rating text;
alter table creator_applications add column if not exists rights_answers jsonb;
alter table creator_applications add column if not exists rights_result text;   -- clear | held | blocked
alter table creator_applications add column if not exists rights_attested boolean not null default false;
alter table creator_applications add column if not exists decision_note text;   -- shown to the applicant
alter table creator_applications add column if not exists role_granted_at timestamptz;

create index if not exists creator_applications_user_idx on creator_applications (user_id);

comment on column creator_applications.content_type is 'short | film | series | podcast | vertical (older rows: film | series | other)';
comment on column creator_applications.rights_result is 'Computed from rights_answers when submitted: clear (nothing flagged), held (would sit in review until licences arrive), blocked (not the rights holder; the form refuses these).';
comment on column creator_applications.decision_note is 'Optional note written by the reviewer when accepting or declining. The applicant sees it on /apply and in the decision email; admin_notes stays internal.';
comment on column creator_applications.role_granted_at is 'Set when accepting the application gave (or confirmed) the applicant''s creator role.';
