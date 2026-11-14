# Studio Tapa TV — downloads in the app: what the site does, for counsel

**Draft for counsel · prepared 2026-11-14 · everything quoted under "Live" is already on the site as a template, not yet reviewed.** This covers one feature: keeping a title in the Studio Tapa TV app to watch without a connection. It is built but **switched off**: nobody can download anything until a full admin turns the switch on (Admin → Downloads), so there is time to answer the questions in section 4 first. The other drafts (`creator-share-terms-draft.md`, `ai-policy-terms-draft.md`, `tax-push-ads-draft.md`) are unchanged and still waiting.

## 0. What the site does (so the wording describes something real)

- **Who can download.** Members on the Premium or Sponsor plan (the studio's own team accounts count as Premium, as do accounts given free access), and anyone who bought the title outright (Buy to own, Terms section 15), whatever their plan. Standard and Basic members see "Downloads come with Premium". Signed-out visitors are asked to sign in.
- **Where.** Only in the app (iPhone and Android). A browser cannot download anything; the website's Downloads page says so and lists the person's phones. Podcasts are not downloadable.
- **What is on the phone.** An ordinary MP4 video file made by our video host (Cloudflare Stream), fetched through a link that works for six hours and only after the server has checked, for that request, that the person may play the title (age, viewing terms, early screenings, plan or purchase, takedowns) and may download it. **The file is not encrypted and not DRM-protected.** It is kept in the app's cache folder, which iOS and Android do not copy into iCloud or desktop backups; the phone's operating system may delete it when storage runs low. The app plays it only inside its own player, with the screenshot and screen-recording block on. A person with a modified ("jailbroken" or "rooted") phone could copy the file out.
- **The month rule.** A member's copy plays offline until two days after the end of the month they have paid for, and never longer than 33 days without the phone connecting, whatever the billing period. After that it is locked (not deleted) until the phone connects once. A bought title needs no plan; the phone must connect at least every 30 days. The phone also refuses to play if its clock has been set back behind the last time it was online.
- **The check-in.** When the app is online it tells the server which titles it holds, and the server answers for each one: licensed again (a new date); left as it is (downloads are switched off site-wide: it plays until its date and is not renewed); ended (the membership no longer carries downloads: the file stays on the phone, locked, for 30 days in case they rejoin, then the app deletes it); or taken back (the title was taken down or pulled, its creator switched downloads off, a purchase was refunded, or the phone was removed from the account: the app deletes the file).
- **What cannot be taken back.** A phone that stays offline keeps playing its copies until their dates run out: at most 33 days for a member, 30 for a bought title. That is true after a takedown, a refund, a cancelled membership, a creator switching downloads off, and a phone removed from the account.
- **Limits.** 25 titles on a phone, 2 phones per account. A phone can be removed from the list in the app or on the website.
- **Creators.** Every title has a switch, "Allow downloads in the app", in the episode editor. It is **on by default** for every title, including titles uploaded before the feature existed. The person who uploaded the title, the owner of its show, or the studio's team can turn it off at any time; then no new copy can be made and existing copies are removed at each phone's next check-in. Nothing was sent to creators about this yet (see question 2).
- **What the studio keeps.** Per phone: a random identifier the app generates for that install, the phone's name as the phone reports it (on many phones this includes the owner's first name, e.g. "Mara's iPhone"), iPhone or Android, when it first downloaded and when it last checked in, and when it was removed from the list. Per copy: the account, the phone, the title, whether it is a member's copy or a bought one, when it was downloaded, until when it may play, when it was last renewed, and how it ended (removed by the phone, or taken back and why). Rows are kept after a copy or a phone is removed, as history. No location, no advertising identifier, no hardware serial.
- **Ads and money.** A downloaded title plays without ads. An offline play is not counted as a view and earns the creator no ad share; for a member who has not chosen creators on Artist Support, the creator share of their membership is allocated by what they watched, and offline watching reaches the server only if the app is online while it plays (see question 6).
- **The switch and the lock.** One switch turns the whole feature on or off; only a full admin can flip it. It has a lock: while locked nobody can flip it, and unlocking takes a full admin typing the word UNLOCK. Every change is written to the audit log and emailed to the studio's security address.

## 1. Terms of Service — live since 2026-11-14

Section 4 (Membership), new paragraph `#downloads`:

> **Downloads in the app.** Where we offer it, Premium and Sponsor members can keep titles inside our app to watch without a connection: up to 25 titles on a phone, on 2 phones. A downloaded title plays offline until 2 days after the end of the month you've paid for, and never longer than 33 days without the phone connecting to us; after that it is locked until the phone connects once. If your membership ends, or moves to a plan without downloads, the copies lock and the app removes them 30 days later unless you rejoin. A title you bought (section 15) can be kept the same way without a membership, as long as the phone connects at least every 30 days. A download is a temporary copy for watching in our app, not a file you own: you may not copy it out of the app, share it, or keep it by other means, and the app removes it if the title is taken down or its creator switches downloads off for it. We can change this feature or switch it off; switching it off deletes nothing you've downloaded, but the copies aren't renewed past their date.

(The numbers are printed from the same constants the app and the server use, so the page follows them if they change.)

Section 5 (If you submit work), new paragraph after "You can withdraw it":

> **Downloads in the app.** Where we offer downloads (section 4), Premium and Sponsor members, and people who bought your title, can keep it inside our app to watch offline, under the limits described there. Each title has a switch, "Allow downloads in the app", which is on unless you turn it off. Turn it off and no new copy can be made, and copies already on phones are removed the next time those phones connect; a phone that stays offline keeps its copy until its date runs out, at most 33 days.

Section 6 (What you may not do), first bullet, was "Download, rip, record, restream, or redistribute content from the platform":

> Download, rip, record, restream, or redistribute content from the platform, other than keeping a title in our app with the app's own Download button (section 4)

Section 15 (Buying a title), first paragraph, was "It is not a download and not a copy you own; the creator keeps their copyright.":

> It is not a file you own or can take elsewhere; the creator keeps their copyright. Where we offer downloads, you can also keep it inside our app to watch offline (section 4).

**Not changed, and perhaps it should be:** the licence creators grant in section 5 still reads "to host, encode, stream, and promote your work" (question 1), and "You can withdraw it" still promises removal "within 30 days" (question 3).

## 2. Privacy Policy — live since 2026-11-14

New heading under "What we collect", **If you download in the app**:

> When you keep a title in the app to watch offline, we store a random identifier the app makes for that phone, the phone's name as it reports it (for example "Mara's iPhone"), whether it is an iPhone or an Android phone, which titles are on it, when each was downloaded and until when it may play, and when the phone last checked in with us. We use this to keep downloads to the phones and titles your plan allows, and to show you your phones so you can remove one. The file itself comes from our video host, Cloudflare, through a link that lasts a few hours. Where you are in a downloaded title is kept on your phone, and reaches us as watch progress only while the app is online. When you remove a phone it leaves your list; we keep the record that it was removed and of the downloads it held.

"How long we keep it" was not changed: it says account data is kept while the account exists and removed within 30 days of a deletion request (see section 5 below).

## 3. AI policy page — live since 2026-11-14, shown only while the switch is on

Card 05 ("The app · Captures come out black"), added after "Screenshots and screen recording are blocked while a title plays in the Studio Tapa TV app.":

> Premium and Sponsor members, and people who bought a title, can keep a title in the app to watch offline. The copy sits in the app's own storage, out of the phone's backups, plays only in the app, and locks if the phone hasn't checked in with us by its date. It is an ordinary video file, not an encrypted one, so we can't promise nobody ever gets one out of a phone; a creator can switch downloads off for any title of theirs.

While the switch is off the page says nothing about downloads.

## 4. Questions for counsel

1. **Does the creators' licence cover a download?** Section 5 grants a licence "to host, encode, stream, and promote". An offline copy inside our app is a reproduction on the viewer's device, held for up to 33 days. Is that inside "stream", or does the grant need a word for it (for example "and to make temporary offline copies available to members and buyers inside our apps")? If the grant has to change, does that apply to work already uploaded, or only to work uploaded after the change?
2. **The switch is on by default. Is that consent?** Every existing title became downloadable-by-default the day the feature is switched on, and the only notice so far is the Terms paragraph. Do creators need (a) advance notice by email with a period to switch titles off before the feature goes live, (b) an explicit opt-in per creator or per title, or (c) is an opt-out switch plus the Terms change enough? Does the answer differ for creators in the EU or UK? We can turn the default to off, or email every creator and wait, before the switch goes on.
3. **Withdrawal and takedowns against offline copies.** "You can withdraw it … we'll take it down within 30 days" — a phone that stays offline can keep playing a member's copy for up to 33 days after the creator withdraws the title or switches downloads off. Should the Terms say 35 days, should the offline window be shortened, or is the existing sentence about "copies already in circulation" enough? Same question for a title we are legally required to remove (a copyright claim we uphold, a court order): is an offline window of up to 33 days acceptable there, and should section 7 (copyright complaints) say anything about it?
4. **No DRM.** The copy is a plain file protected by where it is stored and by the app's rules, not by encryption. Do the Terms' promises to creators (section 5's "Your work is not for AI training", the AI policy page) remain accurate with that, given what the AI policy page now says about downloads? Do any of the creators' own upstream licences (music libraries, stock footage, festival or distributor agreements) commonly forbid non-DRM offline copies, so that we should warn creators next to the switch?
5. **Bought titles.** Section 15 says a bought title stays with the buyer if the creator later takes it down. A buyer's offline copy also survives that takedown (it keeps renewing), but is removed if the title is one we are legally required to remove or pulled by our own moderation, and after a refund. Is that consistent with what section 15 promises buyers and creators, and should the refund sentence mention that a download made before the refund can keep playing offline for up to 30 days?
6. **Money for creators from offline watching.** An offline play runs no ads and is counted for the membership share only if the phone happens to be online. Is the Terms' description of how the creator share is allocated ("the creators of the titles you watched in the 30 days before that payment") still accurate if some watching is never reported? Should the Terms say offline plays may not count, or should the app report them at the next check-in (a build change we can make)?
7. **Device names as personal data.** We store the phone's name, which often contains a first name, and a random per-install identifier. Is the Privacy Policy paragraph enough for the GDPR/UK GDPR and California notices (purpose: enforcing plan limits; legal basis: contract)? How long may we keep the rows for removed phones and ended copies — we keep them indefinitely today as history?
8. **The lock-out after a cancelled membership.** When a membership ends the files stay on the phone, locked, for 30 days. Is keeping a locked file on someone's device after they cancelled a problem under any consumer rule, or is the Terms sentence enough?
9. **App stores.** Do Apple's and Google's rules treat an offline download tied to a subscription bought outside their billing differently from streaming (the membership and Buy to own are paid through Stripe in a browser)? What should the store listings and the Apple privacy label say about downloads and the stored device name?
10. **Children's titles.** The site is not directed at children under 13 but carries all-audience titles. Does offline viewing change anything about the age gate (the same gate runs before a download as before playback: an account with an age on file, or the viewing terms for titles under 17+)?

## 5. Operational notes (not legal questions)

- When a deletion request is carried out, the person's `download_devices` and `downloads` rows should go with the rest of the account, like the push rows named in the last draft. Nothing does that automatically yet.
- A suspended account cannot check in, so its copies simply run out at their dates; nothing deletes them from the phone sooner.
- The switch is off. Turning it on is a decision for after questions 1–3 at least.
