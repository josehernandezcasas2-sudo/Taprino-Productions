# Studio Tapa TV — Creator Share: proposed Terms language

**Draft for counsel · prepared 2026-10-17 · not live.** Numbers in [brackets] are Jose's working proposals, not decisions. The live Terms (`pages/terms.js`) currently carry a bracketed "revenue share terms to be finalised" placeholder in section 5 and say nothing about any of this. Nothing pays out until this is settled.

## 0. What the product does

Studio Tapa TV (the LLC's streaming service) sells memberships through Stripe: Standard [$7.99], Premium [$12.99] and a launch-window Sponsor plan [$6.99]. Creators upload work under a non-exclusive licence (existing section 5) and are paid through Stripe Connect Express accounts the LLC's platform created for them.

Three money lanes, kept separate on purpose:

1. **Earnings (revenue share).** The LLC pays creators a share of its own membership revenue. Two parts: a **member share** and a **referral bonus** (below). Membership money lands in the LLC's Stripe balance; each paid invoice becomes a ledger credit per creator; once a month the LLC transfers each creator's unpaid credits to their Stripe account. The member never pays a creator and the LLC never holds a member's money for anyone else.
2. **Fan support (tips).** A fan pays a creator through Stripe Checkout as a destination charge to the creator's Stripe account; the LLC keeps a disclosed cut as the application fee. Not built yet; same shape as Pitch Room backing.
3. **Project backing (Pitch Room).** Already live. Donation-style; the backer gets nothing but the thank-you.

Grants from The Juanita Foundation / From the Heart are a separate nonprofit's money and are deliberately outside all of this.

**How a member's share is allocated.** A member names up to 10 creators on their account page ("Membership Artist Support"). On each renewal the member share for their tier is split between those creators, equally unless the member set their own weights. A member who names nobody has the share allocated to the creators of the titles they watched in the 30 days before the renewal, and, if they watched nothing, across creators on the platform in proportion to views. The list is a snapshot at each renewal; edits never move money already credited.

**Referral bonus.** A creator has a link (`studiotapatv.site/@handle`). A visit through it is remembered for [30 days] (last click wins). If that person buys a membership, the subscription is attributed to the creator on its first paid invoice and the LLC credits the creator a flat bonus on every paid invoice of that subscription while it lasts: [$1.00] Standard and Sponsor, [$2.00] Premium. The attribution ends when the subscription is cancelled. Self-referral is refused in code. The referred member's lineup starts with the referrer as their first pick, removable.

**Payouts.** Monthly on the [1st], one Stripe Connect transfer per creator with at least [$10] of unpaid credit; smaller balances carry over. A refund or chargeback on a membership payment reverses that payment's credits if they have not been paid out; if they have, the LLC absorbs it.

## 1. Terms of Service · section 4 (Membership) · add

> **Your creator share.** We pay the people who make what's on Studio Tapa TV a share of our membership revenue. For each paid membership that share is [$2.00] a month on Standard and Sponsor and [$4.00] a month on Premium. You choose who receives it by naming up to 10 creators on your account page; we split it between them, equally unless you set your own shares, each time your membership renews. If you haven't named anyone, we allocate it to the creators of the titles you watched in the 30 days before the renewal, and if you watched nothing, among creators on the platform in proportion to how much their work was watched. Changing your list affects future renewals only. This is how we share our revenue: it is not a payment from you to a creator, not a donation and not a purchase, it is not tax-deductible, and it gives you nothing beyond the membership itself. If you joined through a creator's link, that creator is your first pick until you change it, and we pay them a referral bonus that does not come out of your share.

## 2. Terms of Service · section 5 (If you submit work) · replace the bracketed "Revenue" paragraph

> **Member share.** When a member names you on their account page, or watches your released work under the default described in section 4, we credit you a share of that member's payment. Credits are earned once you have a payout account with our payment processor (Stripe) and are paid on the [1st of each month] once your balance reaches [$10]; smaller balances carry over. If you have no payout account, we hold your credits for up to [12 months] and remind you; after that they lapse and return to the platform pool. If a member's payment is refunded or reversed, the matching credit is reversed; if it has already been paid to you, we absorb it. We publish the per-tier amounts and may change them with 30 days' notice; a credit already made never changes.
>
> **Referral bonus.** When someone becomes a paying member through your creator link, we credit you [$1.00] (Standard, Sponsor) or [$2.00] (Premium) for each paid renewal of that membership while it stays active, on top of any member share. A membership is attributed once, to the last link used in the [30 days] before joining, and the attribution ends when that membership is cancelled. You may not refer yourself, pay people to subscribe, or misrepresent Studio Tapa TV when you share your link, and when you share it you must say that you earn from it. We can void an attribution that breaks this. Bonuses are paid with your member share, under the same schedule and minimum.
>
> **Advertising revenue.** [Still to be decided. Separate decision; the ledger is built to take it when it is.]
>
> **Payout accounts and taxes.** Payouts go through Stripe Connect. You must be 18 or older to hold a payout account, you are responsible for your own taxes on everything we or members pay you, and Stripe issues tax forms where the law requires it.

## 3. Terms of Service · new section · Tips (when tips launch)

> **For fans.** You can tip a creator from their profile or a title's page. A tip is a thank-you, not a purchase: it buys nothing and it isn't a donation to a charity. Of each tip, Studio Tapa TV keeps [5%] and you cover the card-processing fee shown before you pay; the rest goes to the creator's Stripe account. Tips are final except where the law requires a refund or we decide one is warranted. Notes sent with tips are moderated.
>
> **For creators.** Tips reach your Stripe account at the moment they're paid, less our cut and the processing fee the fan covered. The payout-account and tax terms above apply.

## 4. Privacy Policy · add

> We use your viewing history on Studio Tapa TV to allocate the creator share of your membership when you haven't chosen creators yourself.

## 5. Questions for counsel

1. **Characterisation.** Is the member share (and the referral bonus) a royalty for the content licence, or a payment for services? It decides whether Stripe files 1099-MISC or 1099-NEC for creators, and the wording of section 5.
2. **Unclaimed credit.** Does a credit that is conditional on holding a payout account, held [12 months] with reminders and then lapsing, stay outside California unclaimed-property rules? If not, what does?
3. **Money transmission.** Please confirm the framing: the LLC pays its own contractors from its own revenue (earnings lane), and tips and backing move through Stripe Connect destination charges with the LLC as the platform. Nothing is held on anyone's behalf.
4. **FTC endorsement disclosure.** Is "when you share it you must say that you earn from it" sufficient as the creator-facing obligation, and should the site show a disclosure on referred visits?
5. **Automatic renewal.** The existing section 4 and Stripe's customer portal handle cancellation. Anything the share adds under California's ARL?
6. **Minors.** Members must pass the site's age gate; creators under 18 cannot hold Stripe Express accounts. Anything to add for a minor whose work is on the site?
7. **Stripe's platform agreement.** The LLC is responsible as the platform for refunds, disputes and fraud on connected accounts. Any wording the creator terms should carry from it?

## 6. The numbers to confirm

| Item | Proposal |
| --- | --- |
| Member share per renewal | Standard $2.00 · Premium $4.00 · Sponsor $2.00 |
| Referral bonus per paid renewal | Standard $1.00 · Premium $2.00 · Sponsor $1.00 |
| Referral window | 30 days, last click wins |
| Payout day and minimum | 1st of the month, $10 |
| Unclaimed credit | held 12 months with reminders, then lapses to the pool |
| Tip cut | 5%, fan covers card fee, $1 minimum, $500 maximum |
| Supporter name visibility | anonymous unless the member opts in |
