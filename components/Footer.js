import Link from 'next/link';
import { useState, useEffect } from 'react';
import NewsletterSignup from './NewsletterSignup';
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
  const [logoUrl, setLogoUrl] = useState(null);

  // Self-fetched rather than passed as a prop, same reasoning as
  // HeaderNav's own settings fetch — Footer renders bare on every page,
  // and this is the one place that also needs to know about the logo now
  // that it's admin-uploadable. Public and cached, so this costs nothing
  // extra beyond what HeaderNav is already fetching on the same page.
  useEffect(() => {
    fetch('/api/site-settings')
      .then((r) => r.json())
      .then((data) => setLogoUrl(data.logoUrl || null))
      .catch(() => {});
  }, []);

  return (
    <footer className="site-footer site-footer-rich">
      <div className="footer-grid">
        <div className="footer-brand">
          <div className="footer-brand-mark">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="footer-logo-image" />
            ) : (
              <span className="footer-logo-badge">ST</span>
            )}
            <span>
              Studio <strong>Tapa</strong>
            </span>
          </div>
          <p>An independent screening room for creators who&rsquo;d rather be backed than bought.</p>
        </div>

        <div className="footer-col footer-col-newsletter">
          <NewsletterSignup />
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
          <h4>Advertise</h4>
          <Link href="/advertise">Create an ad account</Link>
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
