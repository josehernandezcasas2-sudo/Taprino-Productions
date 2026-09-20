import Link from 'next/link';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import { SITE } from '../lib/siteConfig';

// Deliberately its own component rather than HeaderNav with an
// "adManager" prop — the two navs share almost no links (nothing here
// about browsing content, wishlists, or creator tools), and keeping them
// separate means a change to the main site's nav can never accidentally
// leak an ad-manager-only link into the regular streaming experience, or
// vice versa. That separation is the entire point of this build: an
// advertiser's own tools should never surface for someone who just wants
// to stream or use the Pitch Room, and the reverse — this nav should
// never grow a "browse movies" link just because it's convenient.
export default function AdManagerNav({ companyName }) {
  const router = useRouter();
  const { signOut } = useClerk();

  return (
    <header className="ad-manager-nav">
      <div className="ad-manager-nav-inner">
        <div className="ad-manager-brand">
          <Link href="/advertise/dashboard" className="ad-manager-brand-link">{SITE.name}</Link>
          <span className="ad-manager-badge">Ad Manager</span>
        </div>

        <nav className="ad-manager-nav-links">
          <Link href="/advertise/dashboard" className={router.pathname === '/advertise/dashboard' ? 'ad-manager-link active' : 'ad-manager-link'}>
            Dashboard
          </Link>
          <Link href="/advertise/account" className={router.pathname === '/advertise/account' ? 'ad-manager-link active' : 'ad-manager-link'}>
            Account
          </Link>
        </nav>

        <div className="ad-manager-nav-right">
          {companyName && <span className="ad-manager-company-name">{companyName}</span>}
          <Link href="/stream" className="ad-manager-exit-link">← Back to main site</Link>
          <button type="button" className="ad-manager-signout-btn" onClick={() => signOut({ redirectUrl: '/advertise/login' })}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
