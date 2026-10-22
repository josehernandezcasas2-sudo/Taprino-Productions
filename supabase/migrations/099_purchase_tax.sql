-- 099: Sales tax on Buy to own (Jose, 2026-10-22: Stripe Tax on from the
-- first sale). Checkout works the tax out from the buyer's address and
-- the studio's registrations and adds it on top of the price; the
-- webhook records what was collected here. The creator's share is
-- unchanged (fixed by transfer_data.amount at Checkout), so the tax
-- lands on the studio's side of the balance to be remitted. fee_cents
-- is re-read at completion as Stripe's fee on the whole charge (price +
-- tax), so Studio money's expected net per sale is still
-- platform_cents - fee_cents + tax_cents.

alter table purchases add column if not exists tax_cents integer not null default 0 check (tax_cents >= 0);
