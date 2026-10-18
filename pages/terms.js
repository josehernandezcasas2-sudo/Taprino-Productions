import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import LegalLayout from '../components/LegalLayout';
import { SITE, SITE_ADDRESS } from '../lib/siteConfig';

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

  const account = await getAccountContext(req);
  const episodes = await getPublicEpisodes();
  return {
    props: {
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

export default function Terms({ account }) {
  return (
    <LegalLayout
      title="Terms of Service"
      updated="October 18, 2026"
      account={account}
      summary={
        <>
          <strong>The short version.</strong> Watch the free stuff freely. {SITE.premiumTier} is a monthly
          subscription you can cancel any time. If you upload work, <strong>you keep ownership of
          it</strong> — you&rsquo;re giving us permission to stream it, not signing it over. Don&rsquo;t
          upload things you don&rsquo;t have the rights to, and don&rsquo;t try to rip our video.
          We&rsquo;re in private testing, and these terms may still be revised before we open to the
          public (section 15).
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
        share of our membership revenue. For each paid membership that share is $2.00 a month on
        Standard, $3.50 on Premium and $1.50 on Sponsor. You choose who receives it by naming up to 10
        creators on your account page (Artist Support); we split it between them, equally unless you
        set your own shares, each time your membership renews. If you haven&rsquo;t named anyone, we
        allocate it to the creators of the titles you watched in the 30 days before the renewal, and
        if you watched nothing, among creators on the platform in proportion to how much their work
        was watched. Changing your list affects future renewals only. This is how we share our own
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
        <strong>What you&rsquo;re granting us.</strong> A non-exclusive, worldwide, royalty-free
        licence to host, encode, stream, and promote your work on {SITE.name} and in
        marketing for the platform (thumbnails, trailers, social posts, and similar). Non-exclusive
        means you remain free to put the same work anywhere else, including your own channels.
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
        member&rsquo;s payment. We pay your credits on the 1st of each month once your balance reaches
        $25; smaller balances carry over. If a member&rsquo;s payment is refunded or reversed, the
        matching unpaid credit is reversed; if it has already been paid to you, we absorb it. We
        publish the per-tier amounts and may change them with 30 days&rsquo; notice; a credit already
        made never changes.
      </p>
      <p>
        <strong>Referral bonus.</strong> When someone becomes a paying member through your creator
        link, we credit you $1.00 (Standard), $1.50 (Premium) or $0.50 (Sponsor) for each paid renewal
        of that membership during its first 12 months, on top of any member share. A membership is
        credited to the last creator link used in the 30 days before joining, once; the bonus stops
        after 12 months from its first payment, or sooner if the membership is cancelled. You may not
        refer yourself, pay people to subscribe, or misrepresent {SITE.name} when you share your
        link, and when you share it you must say that you earn from it. We can cancel a referral that
        breaks these rules.
      </p>
      <p>
        <strong>Advertising revenue</strong> is not shared with creators at this time. If that changes,
        we&rsquo;ll update this section with 30 days&rsquo; notice.
      </p>
      <p>
        <strong>Getting paid and taxes.</strong> Payouts go through Stripe Connect to an account in your
        name. You must be 18 or older to hold one. Until you set one up, your credits wait for you.
        You&rsquo;re responsible for your own taxes on what we pay you, and Stripe issues tax forms
        where the law requires them.
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
        cause, we&rsquo;ll refund the unused portion.
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

      <h2>15. Changes</h2>
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

      <h2>16. Contact</h2>
      <p>{SITE.contactEmail}</p>
    </LegalLayout>
  );
}
