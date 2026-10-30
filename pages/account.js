import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useClerk, SignInButton, SignUpButton } from '@clerk/nextjs';
import BackButton from '../components/BackButton';
import AccountShell from '../components/account/AccountShell';
import { useOwnProfile } from '../components/account/useOwnProfile';
import { membershipTileLines } from '../components/account/MembershipSection';
import PositionedPhoto from '../components/PositionedPhoto';
import { accountPageProps } from '../lib/accountPage';
import { freeAccessNoteFor, roleBadgeFor } from '../lib/accountRules';
import { memberBadge } from '../lib/membershipTiers';
import { dollars } from '../lib/creatorMoneyRules';
import { SITE } from '../lib/siteConfig';

// The account hub (Jose, 2026-10-29, option B of the "Account page"
// canvas https://claude.ai/artifact/CKYB1K51ueg8ESLQCbNqQa): the identity
// card, six tiles that carry their own state and open their own page
// under /account/… (Money is the existing /creator/money with Payouts on
// top), Log out, and a quiet line to the delete request on the Security
// page. Until 2026-10-29 this was one 6,000px column of nine cards; those
// cards live on in components/account/*.js, one per page.
export async function getServerSideProps({ req, res }) {
  return accountPageProps(req, res);
}

const LEGACY_HASHES = { '#membership': '/account/membership', '#purchases': '/account/purchases', '#money': '/creator/money', '#delete': '/account/security#delete' };

function TileIcon({ kind }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' };
  if (kind === 'membership') return <svg {...common} stroke="var(--olive)"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" /></svg>;
  if (kind === 'profile') return <svg {...common} stroke="var(--brass)"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
  if (kind === 'money') return <svg {...common} stroke="var(--ok)"><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 0 1 0 3h-2a1.5 1.5 0 0 0 0 3H15" /></svg>;
  if (kind === 'purchases') return <svg {...common} stroke="var(--ink-dim)"><path d="M4 8h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z" /><path d="M12 8v12" /></svg>;
  if (kind === 'preferences') return <svg {...common} stroke="var(--ink-dim)"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2.5" /><circle cx="10" cy="17" r="2.5" /></svg>;
  return <svg {...common} stroke="var(--ink-dim)"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>;
}

function Tile({ href, kind, title, lines, cta }) {
  return (
    <Link href={href} className="acct-tile" data-tile={kind}>
      <TileIcon kind={kind} />
      <span className="acct-tile-title">{title}</span>
      <span className="acct-tile-lines">
        {lines.filter(Boolean).map((l, i) => <span key={i}>{l}</span>)}
      </span>
      <span className="acct-tile-cta">{cta} ›</span>
    </Link>
  );
}

export default function Account(props) {
  const { isSignedIn, isSubscriber, tier = 'basic', plans = [], email, isAdmin, isSubAdmin, isCreator, isComped, mainGenres, newsletterStatus, subscriptionDetails, promoAccessExpiresAt, userId, twoFactorEnabled = false, teamTwoStep = null } = props;
  const router = useRouter();
  const { signOut } = useClerk();
  const { profile } = useOwnProfile();
  const [purchases, setPurchases] = useState(null);
  const [tipsSent, setTipsSent] = useState(null);
  const [money, setMoney] = useState(null);

  // The old one-page links still land: /account#membership and
  // #purchases (the tab bar and a few banners used them), ?twostep=1
  // from lib/adminPage.js.
  useEffect(() => {
    if (!router.isReady || !isSignedIn) return;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (router.query.twostep === '1') { router.replace('/account/security?twostep=1'); return; }
    if (LEGACY_HASHES[hash]) router.replace(LEGACY_HASHES[hash]);
  }, [router, isSignedIn]);

  useEffect(() => {
    if (!isSignedIn) return undefined;
    let cancelled = false;
    fetch('/api/purchases').then((r) => r.json()).then((d) => { if (!cancelled) setPurchases(Array.isArray(d.items) ? d.items : []); }).catch(() => { if (!cancelled) setPurchases([]); });
    fetch('/api/tips?mine=1').then((r) => r.json()).then((d) => { if (!cancelled) setTipsSent(Array.isArray(d.tips) ? d.tips : []); }).catch(() => { if (!cancelled) setTipsSent([]); });
    if (isCreator || isAdmin) {
      fetch('/api/creator/money').then((r) => r.json()).then((d) => { if (!cancelled) setMoney(d && !d.error ? d : false); }).catch(() => { if (!cancelled) setMoney(false); });
    }
    return () => { cancelled = true; };
  }, [isSignedIn, isCreator, isAdmin]);

  const shellProps = { mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator };

  if (!isSignedIn) {
    return (
      <AccountShell {...shellProps} back={false}>
        <BackButton fallbackHref="/stream" />
        <div className="account-card" style={{ maxWidth: 560 }}>
          <div className="account-eyebrow">Your account</div>
          <h3>Sign in or create your account</h3>
          <p>
            Real email + password now — sign in if you&rsquo;ve been here before, or create a free
            account if you&rsquo;re new. Either way, you can upgrade to {SITE.premiumTier} any time once
            signed in.
          </p>
          <SignInButton mode="modal" forceRedirectUrl="/account">
            <button className="account-btn-primary">Sign in</button>
          </SignInButton>
          <SignUpButton mode="modal" forceRedirectUrl="/account">
            <button className="account-btn-secondary">Create a free account</button>
          </SignUpButton>
          <div className="account-fineprint">
            A free account doesn&rsquo;t unlock {SITE.premiumTier} content by itself — you can upgrade any time
            from the account page once signed in.
          </div>
        </div>
      </AccountShell>
    );
  }

  const freeAccessNote = freeAccessNoteFor({ isAdmin, isSubAdmin, isComped, promoAccessExpiresAt });
  const roleBadge = roleBadgeFor({ isAdmin, isSubAdmin, isCreator });
  const avatarLetter = email && email[0] ? email[0].toUpperCase() : '?';
  const displayName = profile && profile.displayName ? profile.displayName : (email || 'Your account');
  const handle = profile && profile.handle ? `@${profile.handle}` : null;
  const twoStepOn = teamTwoStep ? teamTwoStep.on : twoFactorEnabled;
  const ownedCount = purchases ? purchases.length : null;
  const tipCount = tipsSent ? tipsSent.length : null;
  const nextPayout = money && money.top && money.top.nextPayout;

  return (
    <AccountShell {...shellProps} back={false}>
      <BackButton fallbackHref="/stream" />

      <div className="account-identity acct-identity">
        <div className="account-identity-top">
          <PositionedPhoto className="account-avatar" url={profile && (profile.avatarBase64 || profile.avatarUrl)} position={profile && profile.avatarPosition} zoom={(profile && profile.avatarZoom) || 1}>
            {!(profile && (profile.avatarBase64 || profile.avatarUrl)) && avatarLetter}
          </PositionedPhoto>
          <div className="account-identity-meta">
            <div className="account-identity-name-row">
              <h3>{displayName}</h3>
              {roleBadge && <span className="account-role-badge">{roleBadge}</span>}
              {memberBadge(tier, SITE.premiumTier) && <span className="account-tier-badge">{memberBadge(tier, SITE.premiumTier)}</span>}
            </div>
            <div className="account-identity-sub">
              {handle && <span className="account-identity-handle">{handle}</span>}
              {handle && email && ' · '}
              {email || 'Signed in'}
            </div>
          </div>
        </div>
        {userId && (
          <Link href={`/profile/${(profile && profile.handle) || userId}`} className="account-btn-secondary account-identity-link">
            View public profile →
          </Link>
        )}
      </div>

      <nav className="acct-tiles" aria-label="Account sections">
        <Tile
          href="/account/membership"
          kind="membership"
          title="Membership"
          lines={membershipTileLines({ plans, tier, subscriptionDetails, freeAccessNote })}
          cta="Manage"
        />
        <Tile
          href="/account/profile"
          kind="profile"
          title="Profile"
          lines={[
            profile ? `${displayName}${handle ? ` · ${handle}` : ''}` : 'Loading…',
            'Visible to anyone',
            (isCreator || isAdmin) && profile ? (profile.aiSeal !== false ? 'Not for AI training seal on' : 'Seal off') : null
          ]}
          cta="Edit"
        />
        {(isCreator || isAdmin) && (
          <Tile
            href="/creator/money"
            kind="money"
            title="Money"
            lines={[
              money === null ? 'Loading…' : money ? `${money.periodLabel || 'This month'} ${dollars(money.top.monthCents)}` : 'Every lane that pays you',
              money ? (nextPayout && nextPayout.willPay ? `Owed ${dollars(money.top.owedCents)} · pays on the 1st` : `Owed ${dollars(money.top.owedCents)}`) : null,
              money && money.payouts ? (money.payouts.availableCents == null ? 'Payouts: set up in Stripe' : `${dollars(money.payouts.availableCents)} in your Stripe balance`) : 'Payouts and the full history'
            ]}
            cta="Open"
          />
        )}
        <Tile
          href="/account/purchases"
          kind="purchases"
          title="Purchases"
          lines={[
            ownedCount === null ? 'Loading…' : ownedCount === 0 ? 'No titles bought yet' : `${ownedCount} title${ownedCount === 1 ? '' : 's'} you own`,
            tipCount === null ? null : tipCount === 0 ? 'No tips sent' : `${tipCount} tip${tipCount === 1 ? '' : 's'} sent`,
            'Receipts and refunds'
          ]}
          cta="See all"
        />
        <Tile
          href="/account/preferences"
          kind="preferences"
          title="Preferences"
          lines={[
            `Newsletter ${newsletterStatus === 'subscribed' ? 'on' : newsletterStatus === 'opted_out' ? 'off' : 'not chosen'}`,
            profile ? `Start in Stream ${profile.stayInStream ? 'on' : 'off'}` : 'Start in Stream',
            'Push, in the app'
          ]}
          cta="Change"
        />
        <Tile
          href="/account/security"
          kind="security"
          title="Security"
          lines={[
            `Two-step ${twoStepOn ? 'on' : 'off'}`,
            email || 'Email & password',
            'Devices, log out, delete'
          ]}
          cta="Manage"
        />
      </nav>

      <div className="acct-hub-foot">
        <button type="button" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} onClick={() => signOut({ redirectUrl: '/' })}>Log out of this device</button>
        <div className="acct-delete-line">
          <Link href="/account/security#delete">Delete account…</Link>
          <span>Removes your profile, wishlist and viewing history for good.</span>
        </div>
      </div>
    </AccountShell>
  );
}
