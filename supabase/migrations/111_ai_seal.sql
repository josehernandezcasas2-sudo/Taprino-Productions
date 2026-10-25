-- 111: the "Not for AI training" seal (2026-10-25).
-- Every creator's titles, series and profile show the seal unless they
-- switch it off on the account page. The policy (/ai-policy, Terms
-- sections 5 and 6) covers everyone's work either way; this is only
-- whether the mark is drawn. Default on from the day they join.
alter table user_profiles
  add column if not exists ai_seal boolean not null default true;
