-- 119 — Admin → Security and AI security (2026-11-05).
--
-- The switches that used to be Vercel variables or a line of code, now
-- flipped from the admin (lib/securityRules.js, lib/securitySwitches.js):
--   private_beta        the beta door. PRIVATE_BETA=on in Vercel still keeps
--                       it shut whatever this says.
--   hide_from_search    "Keep out of search engines": every page says
--                       noindex and the sitemap is withdrawn. Starts on (the
--                       site isn't launched; Jose, 2026-11-05).
--   block_ai_search     "Block AI answer engines" in robots.txt (was the
--                       BLOCK_AI_SEARCH constant). Starts on, as before.
--   admin_require_2fa   two-step required for the team. ADMIN_REQUIRE_2FA=on
--                       in Vercel still keeps it on.
--   security_checklist  the ticks on "Done in other dashboards" (a note to
--                       self; the page can't see those dashboards).
-- The app's screenshot switch (screen_capture_block) is migration 115's.
--
-- Only columns on the existing site_settings row, which migration 112
-- already locked to the site's own server key. Safe to run more than once.
-- The code reads a database without these columns the way they start.

begin;

alter table site_settings add column if not exists private_beta boolean not null default false;
alter table site_settings add column if not exists hide_from_search boolean not null default true;
alter table site_settings add column if not exists block_ai_search boolean not null default true;
alter table site_settings add column if not exists admin_require_2fa boolean not null default false;
alter table site_settings add column if not exists security_checklist jsonb not null default '{}'::jsonb;

comment on column site_settings.private_beta is 'Admin → Security: the private beta door. PRIVATE_BETA=on in Vercel keeps it shut regardless.';
comment on column site_settings.hide_from_search is 'Admin → Security: every page noindex, sitemap withdrawn. Turn off at launch.';
comment on column site_settings.block_ai_search is 'Admin → AI security: robots.txt turns AI answer engines away (training crawlers are always turned away).';
comment on column site_settings.admin_require_2fa is 'Admin → Security: team accounts without two-step lose the admin. ADMIN_REQUIRE_2FA=on in Vercel keeps it on. If nobody can meet it, set it false here.';
comment on column site_settings.security_checklist is 'Admin → Security: ticks on the "Done in other dashboards" list ({ key: true }).';

-- PostgREST picks the new columns up at once.
notify pgrst, 'reload schema';

commit;

-- What is there now (one row; every value should read as shown).
select private_beta      as door_shut_expect_false,
       hide_from_search  as kept_out_of_search_expect_true,
       block_ai_search   as ai_answer_engines_blocked_expect_true,
       admin_require_2fa as two_step_required_expect_false,
       security_checklist
  from site_settings where id = 1;
