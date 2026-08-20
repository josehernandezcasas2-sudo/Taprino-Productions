import Link from 'next/link';
import { SITE } from '../lib/siteConfig';

// Full-bleed, four-column footer — replaces the old single-line version
// that used to be copy-pasted inline into every page (~20 of them, per
// the original CSS comment). Import this instead; the goal is that
// changing the footer is a one-file edit from here on, the same reason
// lib/siteConfig.js exists.
//
// Deliberately NOT linking to "Back a Creator" or "Pitch Room" yet — those
// are the crowdfunding/revenue-share features flagged as needing legal
// review before launch. Add them here once that's resolved and the pages
// actually exist; linking to them now would either 404 or ship something
// that hasn't been cleared.
export default function Footer() {
  return (
    <footer className="site-footer site-footer-rich">
      <div className="footer-grid">
        <div className="footer-brand">
          <div className="footer-brand-mark">
            <span className="footer-logo-badge">ST</span>
            <span>
              Studio <strong>Tapa</strong>
            </span>
          </div>
          <p>An independent screening room for creators who&rsquo;d rather be backed than bought.</p>
        </div>

        <div className="footer-col">
          <h4>Browse</h4>
          <Link href="/?type=series">Series</Link>
          <Link href="/?type=movie">Films</Link>
          <Link href="/?type=vertical">Vertical</Link>
          <Link href="/?type=podcast">Podcasts</Link>
        </div>

        <div className="footer-col">
          <h4>{SITE.premiumTier}</h4>
          <Link href="/account">Membership</Link>
        </div>

        <div className="footer-col">
          <h4>Legal</h4>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/cookies">Cookies</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </div>

      <div className="footer-bottom">
        <span>&copy; {new Date().getFullYear()} {SITE.studio} TV. All rights reserved.</span>
        <span>{SITE.productionDomain.replace('https://', '')}</span>
      </div>
    </footer>
  );
}
