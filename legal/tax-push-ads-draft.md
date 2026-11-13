# Studio Tapa TV — sales tax, notifications and ads: what changed, for counsel

**Draft for counsel · prepared 2026-11-12 · everything quoted under "Live" is already on the site as a template, not yet reviewed.** This covers the round of 2026-11-12: sales tax on memberships, Pitch Room backings and location bookings; browser notifications; Studio Tapa's own ads in the app; and the Privacy Policy lines that describe them. The other two drafts (`creator-share-terms-draft.md`, `ai-policy-terms-draft.md`) are unchanged and still waiting.

## 0. What the site does (so the wording describes something real)

- **Sales tax.** Stripe Tax works the tax out at checkout from the buyer's address and Studio Taprino LLC's tax registrations, and adds it on top of the price. With no registration yet, every tax is $0. Three switches on the admin's Settings page: memberships (on), backings (on), bookings (off until a product tax code is chosen). Stripe product tax codes used: a membership is `txcd_10402200` (streamed audio-visual subscription), a backing is `txcd_90000001` (cash donation). There is no code for renting a place for a shoot.
- **Who keeps the tax.** On a taxed backing or booking, the creator or host is paid a fixed amount (their share) by transfer, and the tax stays with the LLC, which owes it. Before 2026-11-12 the LLC's cut was taken as an application fee instead; each payment records which way it was split, and refunds and chargebacks follow that record.
- **Existing members.** Subscriptions that started before the switch was turned on stay untaxed; new ones are taxed where the LLC is registered.
- **Refunds.** A full refund returns the price and its tax. When a producer cancels part of a paid booking under the listing's cancellation policy, the refund returns that share of the place and its tax, and the host's transfer is reversed in proportion to the whole charge.
- **Browser notifications.** Account → Preferences has a switch. When it's on and the browser agrees, the site stores the browser's push address (a link to the browser maker's push service) and two encryption keys, and every notification the site puts in the bell also goes to that browser, encrypted, with its words and link. Off by the switch, the browser's settings, or signing out of that browser. A push address the service reports as gone, or one switched off, is kept marked as switched off, never with message content. The app's notifications (since 2026-10-24) go through Expo's push service and Apple or Google.
- **Studio Tapa's own ads in the app.** The app now plays the same ads the website plays in its player: Studio Tapa's own and those advertisers buy through the site's ad system, before and during titles, on Live TV and between Snippets. They set no cookies and use no advertising ID. The site counts plays per ad, per title, per day, to charge the advertiser and pay the title's creator their share (Terms section 5, "Ad share"); the count isn't tied to the viewer. Google's ad software is not in the app yet.
- **Google on the website.** AdSense's display-ads script loads on public pages only (never account, creator, admin, message or screener pages, nor the error pages), and since 2026-11-13 never for a member whose plan is ad-free (Premium, Sponsor, and the accounts the site treats the same: the team, comped and promo access): it loads for visitors who aren't signed in and for Basic and Standard members. The website's player uses Google's IMA software to play Studio Tapa's own ads, and, once the studio sets up Google Ad Manager, asks Google for a video ad when it has none of its own for a break (never for viewers who get no ads in the player).
- **Podcasts are ad-free** (since 2026-11-13). No ad of Studio Tapa's, no advertiser's and no Google ad plays on a podcast episode, on the website or in the app: no pre-roll, no break, and no ad plan can be made for one. A sponsor read a podcaster puts in their own audio is theirs and untouched. A live channel's own breaks still run around a podcast it airs.
- **Muting ads** (since 2026-11-13). Every ad in the players can be muted with the player's own mute; muting an ad keeps the programme muted after it. Ads can't be skipped.

## 1. Terms of Service — live since 2026-11-12

Section 4 (Membership), end of the first paragraph:

> Where the law requires it, sales tax is added at checkout and shown before you pay.

Section 13 (Pitch Room), in the paragraph on the platform fee:

> Where the law requires it, sales tax is added at checkout and shown before you pay.

Section 14 (Crew Call and Messages), new paragraph `#locations`:

> **Booking a place.** When you book a place through Locations, sales tax is added at checkout where the law requires it and shown before you pay.

(Section 15, Buying a title, has carried the same sentence since 2026-10-22.)

## 2. Privacy Policy — live since 2026-11-12

- The short version now says the ads come from two places: "our own and our advertisers' ads in the player, and Google's display ads on some public pages" (it said all ads come from Google, which wasn't true).
- "If you subscribe" became **If you pay for something** (memberships, titles, tips, backings and bookings through Stripe), with a **Sales tax** paragraph: Stripe works the tax out from the address given at checkout, and the amount of tax charged is kept with the payment record.
- New **If you turn on notifications**: the browser paragraph and the app paragraph as described in section 0, and that a switched-off address or token is kept marked as switched off, with no message content.
- **Advertising** now has two parts (and says the website's player may ask Google's Ad Manager for a video ad when the studio has none of its own for a break): **Our own ads** (chosen by us, no cookies, no advertising ID, plays counted per ad, title and day and not tied to the viewer; on the website played through Google's IMA software; in the app in our own player, with no Google ad software) and **Google's ads** (AdSense on public pages only).
- The line "Tapa + members are shown no ads, and no ad request is made on their behalf, so no advertising cookies are set for them" was wrong twice: Standard members see ads, and the AdSense script loaded on public pages for everyone. On 2026-11-12 it read that Premium and Sponsor members see no ads in the player and no ad is requested for them there, that Google's display-ads script still loads on public pages for everyone, members included, and that Live TV carries ads for every viewer. **Since 2026-11-13** (question 7 below) it reads: "Google's display-ads script isn't loaded for them either: it loads on our public pages only for visitors who aren't signed in and for members whose plan has ads. Live TV carries ads for every viewer."
- **Since 2026-11-13** the short version says "We show ads on free content (never on podcasts)", and **Our own ads** ends: "Podcasts carry none of these ads: no ad of ours, and no Google ad, plays on a podcast episode."

## 2a. Terms of Service — changed 2026-11-13

Section 5, the **Ad share** paragraph: "ads inside podcasts (podcast ads are your own until we add our audio ads) earn nothing" became

> Podcasts carry no ads of ours, so they earn no ad share; a sponsor read you put in your own audio stays yours.
- **Who we share data with** now also lists Brevo (newsletter), Expo (app notifications), the browser's push service, OpenStreetMap's Nominatim (turning a typed place into a map point), Upstash's short-lived request counters, and Stripe for sales tax.

## 3. Ready for when Google's ads go into the app (not live)

The app will play Google's ads only once Jose sets up a Google ad account and a real app build (Expo Go can't run Google's ad software). When that happens, the Privacy Policy needs a paragraph like this, and the app store listings change too:

> **Google's ads in the app.** When we don't have an ad of our own for a break, the app may ask Google for one. Google's ad software then uses your device's advertising identifier (on iPhone only if you allow tracking when asked) and information about your device and the app to choose and measure the ad. In the European Economic Area, the UK and Switzerland, and in US states whose laws require it, the app asks for your choice first, and you can change it in the app's preferences. Members who don't see ads in the player get no Google ad request either.

## 4. Questions for counsel

1. **Bookings: are we a marketplace facilitator?** The LLC takes the producer's payment for a host's place and keeps a 10% cut. Under California's and other states' marketplace-facilitator rules, is the LLC the one that must collect and remit tax on bookings, and what is the taxable item: a short-term rental of real property, a service, or exempt? That decides the tax code and whether the switch should ever go on.
2. **Bookings have almost no terms.** The Terms carry only the tax sentence for Locations. The real rules live on the site's pages: the 10% cut from the host's side, the card fee on the producer, the host's 48-hour reply window (three missed in a row pause their places), the listing's cancellation policy and its refund percentage, a host's cancellation refunding everything, an admin settling damage or a no-show, the address unlocking only after payment. Should these be in the Terms, and in which section?
3. **Backings coded as cash donations.** Section 13 says a backing is final and that any rewards a creator describes are the creator's own promises. Is coding the whole backing as a non-taxable cash donation (`txcd_90000001`) right when a creator offers a reward, or does a reward make part of it a taxable sale by the creator? The Terms also say a backing isn't tax-deductible; does "cash donation" in Stripe's tax coding create any inconsistency with that?
4. **Starting to tax members.** New members are taxed once the LLC registers; existing subscriptions stay untaxed. If we later tax existing members on renewal, what notice do California's automatic-renewal law and the Terms require first?
5. **Partial booking refunds.** We return the refunded share of the place and its tax, and take back the host's transfer in proportion to the whole charge. Does the Terms' wording need to say how a partial refund is split between host, tax and our cut?
6. **Browser notifications and consent.** Is the browser's own permission prompt plus our switch enough consent for push notifications in the EEA and UK? How long may we keep a switched-off push address (we keep it so a browser that comes back isn't asked twice)?
7. **Paying members and AdSense — settled 2026-11-13 (Jose: "Premium members should not have the Google banner").** The site no longer loads the AdSense script for a member whose plan is ad-free: the page reads the signed-in account it already reads for that page and leaves the script out for Premium and Sponsor members, the team, and comped or promo access. Visitors who aren't signed in and Basic and Standard members still get it, on public pages only (and no longer on the error pages). The Privacy Policy says so (section 2 above). Two edges, for completeness: a member who signs in partway through a visit keeps the script that page loaded until the next full page load, and the browser's offline copy of a page never runs it (it can't reach Google offline). Nothing left to answer unless counsel sees a problem with those.
8. **The app's ads and the stores.** Our own ads use no identifiers. What should the Apple privacy label and Google Play's Data safety form say today, and what changes when Google's ads are added (App Tracking Transparency, Google's consent message, the "contains ads" declaration)?
9. **Children.** The site isn't directed at children under 13 but carries titles rated for all audiences. When Google's ads go into the app, which setting should Google's child-directed and under-age-of-consent tags take?

## 5. Operational note (not a legal question)

When a deletion request is carried out, the person's push addresses and app tokens should go with the rest of the account (the `web_push_subscriptions` and `push_tokens` rows).
