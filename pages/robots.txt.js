import { buildRobotsTxt } from '../lib/robotsRules';
import { privateBetaOn } from '../lib/privateBetaRules';

// robots.txt is built, not static: the AI crawler groups are always
// there, and "nobody crawls" turns into "search engines may, AI may not"
// the moment PRIVATE_BETA is blanked, with no file to remember to swap
// (lib/robotsRules.js). Origin from the request like the sitemap, so a
// preview deploy names itself.
export async function getServerSideProps({ req, res }) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const body = buildRobotsTxt({ privateBeta: privateBetaOn(), origin: `${proto}://${host}` });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.write(body);
  res.end();
  return { props: {} };
}

export default function Robots() {
  return null;
}
