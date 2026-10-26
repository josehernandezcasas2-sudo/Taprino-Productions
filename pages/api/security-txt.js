import { SITE } from '../../lib/siteConfig';

// /.well-known/security.txt (next.config.js rewrites it here; RFC 9116):
// the address a researcher writes to about a security problem. Expires is
// required and must stay under a year away, so it's computed on the way
// out instead of going stale in a static file (safety batch, 2026-10-26).
const ORIGIN = 'https://www.studiotapatv.site';

export default function handler(req, res) {
  const contact = process.env.SECURITY_CONTACT_EMAIL || SITE.contactEmail;
  const expires = new Date(Date.now() + 180 * 86400000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).send([
    `Contact: mailto:${contact}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en, es',
    `Canonical: ${ORIGIN}/.well-known/security.txt`,
    `Policy: ${ORIGIN}/terms`,
    ''
  ].join('\n'));
}
