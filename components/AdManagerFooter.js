import Link from 'next/link';
import { SITE } from '../lib/siteConfig';

export default function AdManagerFooter() {
  return (
    <footer className="ad-manager-footer">
      <div className="ad-manager-footer-inner">
        <span>© {new Date().getFullYear()} {SITE.name}. All rights reserved.</span>
        <div className="ad-manager-footer-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/stream">Back to main site</Link>
        </div>
      </div>
    </footer>
  );
}
