import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SITE } from '../../lib/siteConfig';
import { dollars } from '../../lib/artistSupportRules';

// "Bring your people": a creator's referral link and what it earns
// (Creator Share, lib/creatorShare.js). On /account under the Payouts
// card for creators and admins; the app's ReferralCard mirrors it. A
// member who joins through the link earns the creator a flat bonus on
// renewal for the first 12 months of that membership (site_settings
// referral_bonus_months), on top of the
// share the member points at them.
export default function ReferralCard({ apiPath = '/api/creator/referrals' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(apiPath)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) (d.error ? setError(d.error) : setData(d)); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [apiPath]);

  const origin = typeof window !== 'undefined' ? window.location.origin : SITE.productionDomain;
  const link = data ? `${origin}${data.linkPath}` : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      // The link is selectable text — nothing else to do.
    }
  }

  const bonus = data ? data.bonusTable || {} : {};
  return (
    <div className="account-card refc-card">
      <div className="account-subheading">Bring your people</div>
      <h3 className="refc-title">Your link</h3>
      <p className="account-card-lede">
        Every member who joins through it earns you {dollars(bonus.premium || 0)} a month on Premium, {dollars(bonus.standard || 0)} on Standard and {dollars(bonus.sponsor || 0)} on Sponsor, for their first {data && data.bonusMonths ? data.bonusMonths : 12} months. That&rsquo;s on top of the share they point at you, and it never comes out of theirs.
      </p>
      {error && <p className="asup-note error">{error}</p>}
      {data && (
        <>
          <div className="refc-link">
            <span className="refc-link-text">{link.replace(/^https?:\/\//, '')}</span>
            <button type="button" className="account-btn-secondary" style={{ width: 'auto', margin: 0, padding: '6px 14px' }} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          {!data.handle && (
            <p className="account-fineprint" style={{ marginTop: '0.5rem' }}>
              Set a handle in Public profile above and this becomes {origin.replace(/^https?:\/\//, '')}/@yourname.
            </p>
          )}
          <div className="refc-stats">
            <div className="refc-stat"><b>{data.joined}</b><span>joined through it</span></div>
            <div className="refc-stat"><b>{data.active}</b><span>still members</span></div>
            <div className="refc-stat"><b>{dollars(data.bonusMonthCents)}</b><span>bonus this month</span></div>
            <div className="refc-stat"><b>{dollars(data.bonusTotalCents)}</b><span>bonus all time</span></div>
          </div>
          <p className="account-fineprint">
            {data.pickedBy} member{data.pickedBy === 1 ? ' has' : 's have'} you in their lineup (<Link href="/artist-support">Artist Support</Link>). The link works from a bio, a sticker or an end card. When you share it, say that you earn from it.
          </p>
        </>
      )}
    </div>
  );
}
