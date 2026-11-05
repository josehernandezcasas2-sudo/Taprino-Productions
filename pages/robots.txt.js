import { buildRobotsTxt } from '../lib/robotsRules';
import { getSecuritySwitches } from '../lib/securitySwitches';

// robots.txt is built, not static: the AI crawler groups are always
// there, and "nobody crawls" turns into "search engines may, AI may not"
// the moment the beta door opens, with no file to remember to swap
// (lib/robotsRules.js). The door, "Keep out of search engines" and
// "Block AI answer engines" are switches on Admin → Security / AI
// security (lib/securitySwitches.js, migration 119), so the CDN keeps a
// copy for five minutes, not an hour. Origin from the request like the
// sitemap, so a preview deploy names itself.
export async function getServerSideProps({ req, res }) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const sw = await getSecuritySwitches();
  const body = buildRobotsTxt({ privateBeta: sw.doorShut, hidden: sw.hidden, blockAiSearch: sw.aiSearchBlocked, origin: `${proto}://${host}` });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.write(body);
  res.end();
  return { props: {} };
}

export default function Robots() {
  return null;
}
