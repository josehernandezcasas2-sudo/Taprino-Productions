import { dollars } from '../../lib/donationMath';
import { SITE } from '../../lib/siteConfig';

// What a project has earned, on the creator's pitch dashboard: paid
// backings only, the creator's share after the platform cut, refunds
// shown so the numbers match their Stripe balance. Backer names are
// public display names, never emails.
const EMPTY = { raisedCents: 0, yourShareCents: 0, platformCutCents: 0, backers: 0, refundedCents: 0, refundedCount: 0, recent: [] };

export default function PitchEarnings({ pitch, earnings }) {
  const e = earnings || EMPTY;
  const cut = Number(pitch.platform_cut_percent || 0);
  return (
    <div className="earn">
      <div className="earn-stats">
        <div>
          <span className="earn-num">{dollars(e.raisedCents)}</span>
          <span className="earn-label">raised{pitch.funding_goal ? ` of $${Number(pitch.funding_goal).toLocaleString()}` : ''}</span>
        </div>
        <div>
          <span className="earn-num">{e.backers}</span>
          <span className="earn-label">backer{e.backers === 1 ? '' : 's'}</span>
        </div>
        <div>
          <span className="earn-num earn-you">{dollars(e.yourShareCents)}</span>
          <span className="earn-label">your share, after {SITE.studio}’s {cut}% cut</span>
        </div>
        {e.refundedCount > 0 && (
          <div>
            <span className="earn-num">{dollars(e.refundedCents)}</span>
            <span className="earn-label">refunded ({e.refundedCount})</span>
          </div>
        )}
      </div>
      {e.recent.length > 0 ? (
        <ul className="earn-list">
          {e.recent.map((r) => (
            <li key={r.id} className={r.status}>
              <span>{r.backerName}</span>
              <span>{new Date(r.at).toLocaleDateString()}</span>
              <span>{r.status === 'refunded' ? `${dollars(r.amountCents)} refunded` : `${dollars(r.amountCents)} · ${dollars(r.yourShareCents)} to you`}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="earn-empty">{pitch.funding_enabled ? 'No backings yet — share your project page to get the first one.' : 'Backing is off for this project.'}</p>
      )}
      <p className="earn-note">
        Backers pay the pledge plus Stripe’s card fee. Your share is the pledge minus {SITE.studio}’s cut; it lands in your Stripe balance and pays out to your bank on Stripe’s schedule. A refund returns the whole backing to the backer and takes your share back out of your balance.
      </p>
    </div>
  );
}
