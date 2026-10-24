import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import LegalLayout from '../components/LegalLayout';
import { SITE, SITE_ADDRESS } from '../lib/siteConfig';
import { getShareSettings } from '../lib/artistSupport';
import { dollars } from '../lib/artistSupportRules';
import { getTipSettings } from '../lib/tips';

// TEMPLATE — NOT LEGAL ADVICE.
// The creator licensing section (§5) is the part that most needs a lawyer's
// eyes: it decides what rights creators hand over, and getting it wrong is
// expensive in both directions. It is deliberately narrow here — a licence to
// stream, not an assignment of ownership — because that's the fairer default
// and the easier one to widen later with consent.
//
// Contact details, address, and jurisdiction all come from
// lib/siteConfig.js — fill them in there once, not here.

export async function getServerSideProps({ req, res }) {
  // WO-2 asked whether these could become getStaticProps. They can't as
  // written: each one fetches account context so the header nav renders
  // correctly for signed-in users (their name, admin link, tier). Dropping
  // that would break the header on every legal page.
  //
  // Caching gets the same saving without that regression. Legal text
  // changes maybe a few times a year, so signed-out visitors — which
  // includes every crawler, and the AdSense reviewer — can hold a copy for
  // an hour and revalidate in the background for a day after that.
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('Vary', 'Cookie');
  }

  const [account, episodes, share, tipSettings] = await Promise.all([getAccountContext(req), getPublicEpisodes(), getShareSettings().catch(() => null), getTipSettings().catch(() => null)]);
  return {
    props: {
      // Section 16 (Tips) reads the studio's cut and its cap live from Settings.
      tipCutPercent: tipSettings ? tipSettings.cutPercent : 5,
      tipCutMaxCents: tipSettings ? tipSettings.cutMaxCents : 10000,
      // The Creator Share numbers in sections 4 and 5 are whatever
      // /admin/creator-money has in force, plus any change it scheduled.
      share: share ? {
        shareCents: share.shareCents,
        bonusCents: share.bonusCents,
        payoutMinimumCents: share.payoutMinimumCents,
        referralBonusMonths: share.referralBonusMonths,
        adSharePercent: share.adSharePercent == null ? 50 : share.adSharePercent,
        scheduled: share.scheduled ? { numbers: share.scheduled.numbers, effectiveAt: share.scheduled.effectiveAt, setAt: share.scheduled.setAt || null } : null,
        changedAt: share.changedAt || null
      } : null,
      account: {
        mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
        isSignedIn: account.isSignedIn,
        isSubscriber: account.isSubscriber,
        email: account.email,
        isAdmin: account.isAdmin,
        isCreator: account.isCreator
      }
    }
  };
}

// The text was last edited on this date; a Creator Share change saved or
// scheduled later moves the "updated" date with it.
const TEXT_UPDATED = '2026-10-24';
const FALLBACK_SHARE = { shareCents: { standard: 200, premium: 350, sponsor: 150 }, bonusCents: { standard: 100, premium: 150, sponsor: 50 }, payoutMinimumCents: 2500, referralBonusMonths: 12, adSharePercent: 50 };
const adPct = (x) => (x && x.adSharePercent != null ? Number(x.adSharePercent) : 50);
const longDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const bonusSpan = (m) => (Number(m) > 0 ? `during its first ${m} months` : 'for as long as that membership lasts');

export default function Terms({ account, share, tipCutPercent = 5, tipCutMaxCents = 10000 }) {
  const n = share || FALLBACK_SHARE;
  const next = share && share.scheduled ? share.scheduled.numbers : null;
  const updated = [TEXT_UPDATED, share && share.changedAt, share && share.scheduled && share.scheduled.setAt].filter(Boolean).sort().pop();
  return (
    <LegalLayout
      title="Terms of Service"
      updated={longDate(updated.length === 10 ? `${updated}T12:00:00Z` : updated)}
      account={account}
      summary={
        <>
          <strong>The short version.</strong> Watch the free stuff freely. {SITE.premiumTier} is a monthly
          subscription you can cancel any time. If you upload work, <strong>you keep ownership of
          it</strong> — you&rsquo;re giving us permission to stream it, not signing it over. Don&rsquo;t
          upload things you don&rsquo;t have the rights to, and don&rsquo;t try to rip our video.
          We&rsquo;re in private testing, and these terms may still be revised before we open to the
          public (section 16).
        </>
      }
    >
      <h2>1. Who these terms are between</h2>
      <p>
        These terms are between you and {SITE.legalName}, doing business as {SITE.studio}
        {SITE_ADDRESS ? ` (${SITE_ADDRESS})` : ''}, which operates {SITE.name}. Using the site means you
        accept them. If you don&rsquo;t, please don&rsquo;t use it.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You must be 13 or older to create an account, and 18 or older to subscribe or submit work.
        Keep your login details to yourself — you&rsquo;re responsible for what happens under your
        account. Give us accurate information and keep it current.
      </p>

      <h2>3. Free content and ads</h2>
      <p>
        Most content is free to watch and supported by advertising. By watching free content you
        accept that ads may play before or during it. Deliberately blocking, spoofing, or
        automating ad playback to inflate counts is a breach of these terms.
      </p>

      <h2>4. {SITE.premiumTier} membership</h2>
      <p>
        {SITE.premiumTier} is a recurring monthly subscription. It renews automatically until you cancel,
        and you can cancel any time from your account page — access continues to the end of the
        period you&rsquo;ve already paid for.
      </p>
      <p>
        <strong>Refunds.</strong> Payments are generally non-refundable except where the law requires
        otherwise, or where we can&rsquo;t deliver what you paid for. If something went wrong, email
        {SITE.contactEmail} and we&rsquo;ll deal with it fairly rather than hiding behind this paragraph.
      </p>
      <p>
        We may change the price with at least 30 days&rsquo; notice to existing members before it
        affects them. Membership benefits may change over time; we won&rsquo;t remove a benefit that
        was the main reason you subscribed without telling you first.
      </p>
      <p>
        <strong>Your creator share.</strong> We pay the people who make what&rsquo;s on {SITE.name} a
        share of our membership revenue. For each paid membership that share is {dollars(n.shareCents.standard)} a month on
        Standard, {dollars(n.shareCents.premium)} on Premium and {dollars(n.shareCents.sponsor)} on Sponsor. You choose who receives it by naming up to 10
        creators on your account page (Artist Support); we split it between them, equally unless you
        set your own shares, every month you pay, including the first. If you haven&rsquo;t named
        anyone, we allocate it to the creators of the titles you watched in the 30 days before that
        payment, and
        if you watched nothing, among creators on the platform in proportion to how much their work
        was watched. You can&rsquo;t name yourself. Changing your list affects future payments only. This is how we share our own
        revenue: it is not a payment from you to a creator, not a donation and not a purchase, it is
        not tax-deductible, and it gives you nothing beyond the membership itself. If you joined
        through a creator&rsquo;s link, that creator is your first pick until you change it, and we
        pay them a referral bonus that doesn&rsquo;t come out of your share.
      </p>

      <h2 id="submit-work">5. If you submit work</h2>
      <p>
        This is the section that matters most, so it&rsquo;s in plain language.
      </p>
      <p>
        <strong>You keep your copyright.</strong> Uploading to {SITE.name} does not transfer
        ownership of your work to us. It stays yours.
      </p>
      <p>
        <strong>What you&rsquo;re granting us.</strong> A non-exclusive, worldwide licence to host, encode, stream, and promote your work on {SITE.name} and in
        marketing for the platform (thumbnails, trailers, social posts, and similar). Non-exclusive
        means you remain free to put the same work anywhere else, including your own channels. We
        don&rsquo;t pay a fee each time your work is streamed or promoted; what creators earn from
        {SITE.name} is the creator share described below, and any separate agreement we make with
        you in writing.
      </p>
      <p>
        <strong>You can withdraw it.</strong> Request removal and we&rsquo;ll take it down within 30
        days. Copies already in circulation off-platform, and material already printed or scheduled
        in marketing, may take longer to fully disappear.
      </p>
      <p>
        <strong>What you&rsquo;re promising us.</strong> That you own or have licensed everything in
        what you upload — footage, music, fonts, likenesses, and locations included. Unlicensed music
        is the most common way this goes wrong. If a claim is made against us because of something you
        uploaded without the rights to it, you&rsquo;re responsible for that.
      </p>
      <p>
        <strong>Member share.</strong> When a member names you on their account page, or watches your
        released work under the default described in section 4, we credit you a share of that
        member&rsquo;s payment. Payouts start on the 1st of each month for every balance of {dollars(n.payoutMinimumCents)} or more;
        smaller balances carry over. If our own balance can&rsquo;t cover every payout that day, the
        longest-waiting credits are paid first and the rest follow as soon as funds allow. If a member&rsquo;s payment is refunded or reversed, the
        matching unpaid credit is reversed; if it has already been paid to you, we absorb it. The
        amounts are published here. A change that pays creators less takes effect no sooner than 30
        days after we publish it here and email creators about it; a change in creators&rsquo; favour
        can start straight away. A credit already made never changes.
      </p>
      {next && (
        <p>
          <strong>Change announced.</strong> From {longDate(share.scheduled.effectiveAt)}, the member
          share becomes {dollars(next.shareCents.standard)} (Standard), {dollars(next.shareCents.premium)} (Premium)
          and {dollars(next.shareCents.sponsor)} (Sponsor); the referral bonus {dollars(next.bonusCents.standard)},{' '}
          {dollars(next.bonusCents.premium)} and {dollars(next.bonusCents.sponsor)}, paid {bonusSpan(next.referralBonusMonths)};
          the ad share {adPct(next)}%; and payouts go out at {dollars(next.payoutMinimumCents)} or more. Credits made before then don&rsquo;t change.
        </p>
      )}
      <p>
        <strong>Referral bonus.</strong> When someone becomes a paying member through your creator
        link, we credit you {dollars(n.bonusCents.standard)} (Standard), {dollars(n.bonusCents.premium)} (Premium) or {dollars(n.bonusCents.sponsor)} (Sponsor) for each paid month of
        that membership {bonusSpan(n.referralBonusMonths)}, including the first, on top of any member share. A membership is
        credited to the last creator link used in the 30 days before joining (or to the creator a member
        names when they join), once; {Number(n.referralBonusMonths) > 0 ? `the bonus stops after ${n.referralBonusMonths} months from its first payment, or sooner if the membership is cancelled` : 'the bonus stops if the membership is cancelled'}. You may not
        refer yourself, pay people to subscribe, or misrepresent {SITE.name} when you share your
        link, and when you share it you must say that you earn from it. We can cancel a referral that
        breaks these rules.
      </p>
      <p>
        <strong>Ad share.</strong> When an advertiser&rsquo;s ad plays inside your released title (before it, in
        a break, or during a live channel broadcast of it), we credit you {adPct(n)}% of what that advertiser
        paid us for that play. Plays are counted by the title they ran in, the month they ran, and credited on
        the 1st of the next month alongside your member share, under the same payout rules. Our own house ads,
        station bumpers, plays by ad-free members, and ads inside podcasts (podcast ads are your own until we
        add our audio ads) earn nothing, and a title we own ourselves keeps everything. The percentage is
        published here; a decrease takes effect no sooner than 30 days after we publish it and email creators,
        as with the member share.
      </p>
      <p>
        <strong>Getting paid and taxes.</strong> Payouts go through Stripe Connect to an account in your
        name. You must be 18 or older to hold one. Until you set one up, your credits wait for you.
        You&rsquo;re responsible for your own taxes on what we pay you, and Stripe issues tax forms
        where the law requires them.
      </p>
      <p>
        <strong>Credits that aren&rsquo;t earned.</strong> Credits that come from fraud or from gaming
        how shares are allocated are not earned. That includes payments made with stolen cards or later
        disputed as unauthorised, fake or coordinated accounts, bots or paid viewing, swapping picks
        with other creators for money, and referring yourself. When we see signs of this we can hold
        your payouts while we look into it (for up to 90 days, and we&rsquo;ll tell you), cancel the
        credits involved, and recover any of them already paid out from your future credits. Ordinary
        refunds are different: as above, we absorb those once you&rsquo;ve been paid.
      </p>
      <p>
        <strong>If your work comes down or your account closes.</strong> Credits you earned before you
        withdraw your work, close your account, or we suspend or close it stay yours (apart from
        credits that weren&rsquo;t earned, above). From that date you have 90 days to collect them: we
        pay out the whole balance, even under {dollars(n.payoutMinimumCents)}, once you have a payout account set up, and we
        email you reminders before the time runs out. Anything not
        collected within those 90 days goes into the site-wide pool and is shared among other creators
        in proportion to how much their work was watched. We can extend the 90 days by agreement, for
        example while we work with you on a new cut of your film.
      </p>
      <p>
        <strong>Review.</strong> Submissions are reviewed before publication. We can decline or remove
        anything, and we&rsquo;ll tell you why. This is editorial judgement, not a guarantee that
        published work has been legally cleared.
      </p>

      <h2>6. What you may not do</h2>
      <ul>
        <li>Download, rip, record, restream, or redistribute content from the platform</li>
        <li>Get around signed links, paywalls, or any other access control</li>
        <li>Share your account so people can watch premium content without subscribing</li>
        <li>Upload anything unlawful, hateful, harassing, or sexually explicit involving minors</li>
        <li>Upload work you don&rsquo;t have the rights to</li>
        <li>Scrape the site, or hit it with automated traffic that degrades it for others</li>
      </ul>

      <h2>7. Copyright complaints</h2>
      <p>
        If something here infringes your copyright, email {SITE.contactEmail} with: what work is being
        infringed, where it is on our site, your contact details, a statement that you believe in good
        faith the use isn&rsquo;t authorised, and a statement under penalty of perjury that your notice
        is accurate and you&rsquo;re authorised to act. We remove infringing material promptly and
        terminate repeat infringers.
      </p>

      <h2>8. Availability</h2>
      <p>
        We aim to keep the service running but we don&rsquo;t promise it will always be available or
        uninterrupted. We may change or discontinue features. If we shut the service down entirely,
        we&rsquo;ll give creators reasonable notice to retrieve their work and refund any unused
        prepaid membership.
      </p>

      <h2>9. Liability</h2>
      <p>
        The service is provided &ldquo;as is.&rdquo; To the extent the law allows, we&rsquo;re not
        liable for indirect or consequential losses, and our total liability to you is limited to what
        you&rsquo;ve paid us in the twelve months before the claim. Nothing here limits liability that
        can&rsquo;t legally be limited.
      </p>

      <h2>10. Ending things</h2>
      <p>
        You can close your account any time. We can suspend or close accounts that breach these terms,
        with notice where it&rsquo;s reasonable to give it. If we close your paid membership without
        cause, we&rsquo;ll refund the unused portion. If you&rsquo;re a creator, section 5 says what
        happens to credits you&rsquo;ve earned.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These terms are governed by the laws of {SITE.jurisdiction}, and disputes go to the courts there.
      </p>

      <h2 id="live-tv">12. Live TV</h2>
      <p>
        Live channels play like television: everyone watching sees the same program at the same time, with the
        same ad breaks, whether or not they have an account or a membership. Programs carry the rating their
        creators gave them, up to TV-MA or R, and the rating is shown as each program starts.
      </p>
      <p>
        If you watch without an account, or without an age on your account, rated programs play only after you
        confirm that you are old enough for the ratings shown. That confirmation is yours to make, and you are
        responsible for who watches on your device; add your age on your account page and the channel applies it
        for you instead. Live channels can include live broadcasts, ads and bumpers, and work from other
        creators, and what airs can change at any time.
      </p>
      <p>
        The same confirmation covers titles in the library rated under 17+ (PG-13, TV-14 and the like): without an
        age on your account you can watch them once you have confirmed you are old enough for the rating shown.
        Titles rated 17+ (R, NC-17, TV-MA) and unrated titles, which we treat as 17+ until a creator or admin rates
        them, always need an account with your age.
      </p>

      <h2 id="pitch-room">13. Pitch Room</h2>
      <p>
        Pitch Room lets creators present a project and lets you back it. Backing is a contribution to the
        creator&rsquo;s project, not a purchase, an investment, or a pre-order: you don&rsquo;t receive
        ownership, a share of revenue, or a guarantee that the project gets made, finished, or released on{' '}
        {SITE.name}. Any rewards or updates a creator describes are the creator&rsquo;s own promises.
      </p>
      <p>
        {SITE.name} keeps a platform fee from each contribution; the current fee is shown on the project page
        before you back it, and the rest goes to the creator. Contributions are final once charged. Until
        card payments are switched on, a contribution is recorded as a pledge and no money is taken.
      </p>
      <p>
        Creators must describe their projects honestly, hold the rights to what they show, and use what they
        raise on the project. We can remove a project, refund contributions where we can, and end a
        creator&rsquo;s access if those rules are broken.
      </p>

      <h2 id="crew-call">14. Crew Call and Messages</h2>
      <p>
        Crew Call is a way for people on {SITE.name} to find each other: working cards (what you do, what gear
        you have, where you are), a board of calls (who&rsquo;s needed, when, where, how it pays), and private
        messages. We only connect people. Any job, loan of gear, payment, or agreement that comes out of it is
        between you and the other person; {SITE.name} is not a party to it, doesn&rsquo;t process the money,
        and doesn&rsquo;t vouch for either side. Check the person, the pay, and the paperwork yourself.
      </p>
      <p>
        What you put on your card and in a call must be true. A call&rsquo;s pay label (paid, union, deferred,
        unpaid, other) is the poster&rsquo;s word, and it&rsquo;s on the poster to honor it and to follow the
        labor and union rules that apply to them. A person&rsquo;s track record on {SITE.name} is built only
        from jobs the poster confirmed and titles released here; it&rsquo;s a record of activity, not an
        endorsement by us.
      </p>
      <p>
        Messages are private between the two people in the conversation. We don&rsquo;t read them, except that
        when someone reports a conversation the most recent messages are sent to us with the report so we can
        act on it. You can mute or block anyone. Harassment, spam, scams, and soliciting anything illegal get
        the account removed. Only your city or neighborhood is shown on your card and calls; your exact
        location is used for distance and never shown.
      </p>

      <h2 id="buying">15. Buying a title</h2>
      <p>
        Some films, episodes and series can be bought outright instead of, or as well as, a membership.
        Buying a title gives you a personal, non-transferable licence to stream it on {SITE.name} and in
        our app, without ads, for as long as the service exists. It is not a download and not a copy you
        own; the creator keeps their copyright. The price is set by the creator and checked by us, and
        a price change only applies to new buyers. Where a creator runs a sale, the sale price is the
        price.
      </p>
      <p>
        <strong>It stays yours.</strong> If a creator later takes a title down, or leaves {SITE.name},
        the title leaves the catalogue but keeps playing for the people who bought it. The one
        exception is a title we are legally required to remove (a copyright claim we uphold, a court
        order, or content that breaks the law): then we refund every buyer in full and the title is
        gone for everyone.
      </p>
      <p>
        <strong>Refunds.</strong> You can refund a purchase yourself from your account page within 14
        days of buying it, as long as you have watched less than 10% of it (for a series, 10% of the
        episodes together). After that, write to {SITE.contactEmail}; those refunds are at our discretion
        and final. A refunded title leaves your library. Payment is handled by Stripe, and sales tax is
        added where the law requires it.
      </p>
      <p>
        <strong>For creators.</strong> A creator who prices a title agrees that buyers keep it under this
        section, receives their share of each sale as described in section 5, and sees that share
        reversed when a sale is refunded. A creator can stop selling a title at any time; existing
        buyers are unaffected.
      </p>

      <h2 id="tips">16. Tips</h2>
      <p>
        You can tip a creator from their profile or a title&rsquo;s page. A tip is a thank-you, sent
        through Stripe to the creator&rsquo;s own account. It is not a purchase: it buys nothing and
        unlocks nothing. It is also not a donation. {SITE.name} and its creators are not charities and
        a tip is not tax-deductible. The one exception is a creator who links a fiscal sponsor on their
        profile: giving through that sponsor&rsquo;s own page is a donation to the sponsor under the
        sponsor&rsquo;s terms, and that money never passes through us.
      </p>
      <p>
        <strong>What the creator gets.</strong> We keep {tipCutPercent}% of the tip, and never more
        than {dollars(tipCutMaxCents)} from any one tip. The card
        processing fee is added on top of the tip and paid by you, not taken out of it, so the
        creator keeps more of what you meant to give; the amounts are shown before you pay. The
        creator&rsquo;s share lands in their Stripe account when the card clears. Tips are final. We
        refund a tip only when something went wrong (a mistaken amount, a card used without
        permission), at our discretion, and a refunded or disputed tip is taken back from the creator.
      </p>
      <p>
        <strong>Notes and names.</strong> A note sent with a tip is shown to the creator, who can hide
        it; we can hide or remove it too, and abusive notes get the account removed. Your name is shown
        to the creator only if you choose; otherwise you appear as &ldquo;a fan&rdquo;. For creators:
        tips count as income that Stripe reports, and section 5&rsquo;s rules on unearned credits
        apply to tips that turn out to be fraudulent.
      </p>

      <h2>17. Changes</h2>
      <p>
        We&rsquo;ll update the date at the top. Material changes get 30 days&rsquo; notice by email to
        account holders. Continuing to use the service after that means you accept the new terms.
      </p>
      <p>
        <strong>Before public launch.</strong> {SITE.name} is in private testing. These terms, the
        creator share in section 5 included, are being reviewed and may be revised before we open to
        the public. We&rsquo;ll email account holders before a revision takes effect, and no revision
        reduces credits you&rsquo;ve already earned.
      </p>

      <h2>18. Contact</h2>
      <p>{SITE.contactEmail}</p>
    </LegalLayout>
  );
}
