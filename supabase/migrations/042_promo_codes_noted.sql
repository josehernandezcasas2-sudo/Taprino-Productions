-- A plain admin checkbox, unrelated to redemption — for tracking "I've
-- written this one down / put it on a physical product" bookkeeping that
-- has nothing to do with whether a user has actually redeemed it yet.
-- A code can be noted before it's ever redeemed (e.g. printed on a card
-- for a festival giveaway) or after, so this is deliberately independent
-- of redeemed_by/redeemed_at rather than derived from them.
alter table promo_codes add column if not exists noted boolean not null default false;
comment on column promo_codes.noted is
  'Admin-only bookkeeping checkbox — has this code been written down / put on a product? No effect on redemption.';
