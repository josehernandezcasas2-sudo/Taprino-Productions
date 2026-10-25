-- Partners & resources (Connect, 2026-10-25): the places and people a
-- production leans on — rental houses, post, sound, labs, insurance,
-- permits, catering, studios, festivals, distributors, paperwork — near
-- and far, with the deal each one gives Studio Tapa productions and a
-- discount code behind a gate (anyone / signed in / has a working card /
-- on a production / Veteran). Admins keep the list on /admin/partners;
-- every reveal of a code is logged so a partner can be shown what the
-- listing brought them. Service-role only (no RLS).

create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,
  blurb text,
  url text,
  logo_url text,
  -- Where they are (optional; a partner that ships or works remotely can
  -- have no place at all).
  place_label text,
  city text,
  region text,
  country text,
  lat double precision,
  lng double precision,
  ships boolean not null default false,
  -- The offer in words, the code behind the gate, and how to use it.
  deal text,
  code text,
  code_gate text not null default 'account' check (code_gate in ('public', 'account', 'card', 'production', 'veteran')),
  code_note text,
  -- Admin-only: who to talk to there.
  contact_name text,
  contact_email text,
  status text not null default 'listed' check (status in ('draft', 'listed', 'paused')),
  featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table partners is 'Resources & partners on /resources: the deal for Studio Tapa productions and a gated discount code.';
create index if not exists partners_listed_idx on partners (status, featured desc, sort_order, name);

-- One row per person per partner: the first time they revealed the code
-- (and for which production, when they said).
create table if not exists partner_redemptions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners (id) on delete cascade,
  user_id text not null,
  production_id uuid references productions (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (partner_id, user_id)
);
create index if not exists partner_redemptions_partner_idx on partner_redemptions (partner_id, created_at desc);
