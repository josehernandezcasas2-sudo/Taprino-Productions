// What the site tells crawlers (Jose, 2026-10-25: creators want a home
// their work is not harvested from). Pure and import-free so middleware
// (Edge) and the robots.txt route share one source of truth; tested by
// scripts/test-harvest.mjs.
//
// Honest scope: robots.txt and these headers are requests. OpenAI,
// Anthropic, Google, Apple, Meta and Common Crawl document that they
// honour them; ByteDance does not read them; the "user-initiated"
// fetchers (ChatGPT-User, Claude-User, Perplexity-User) say robots.txt
// may not apply to them. Vercel Firewall / the edge is what enforces.

// Crawlers that collect for model training. Named one by one because
// each company only reads its own group; `*` rules do not cover them.
export const AI_TRAINING_AGENTS = [
  'GPTBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'CCBot', 'Google-Extended',
  'Applebot-Extended', 'meta-externalagent', 'FacebookBot', 'Amazonbot', 'Bytespider',
  'cohere-ai', 'cohere-training-data-crawler', 'Diffbot', 'ImagesiftBot', 'AI2Bot',
  'Ai2Bot-Dolma', 'Timpibot', 'PetalBot', 'YouBot', 'MistralAI-Training', 'omgili',
  'omgilibot', 'img2dataset', 'Webzio-Extended', 'PanguBot', 'Kangaroo Bot', 'Scrapy',
  'iaskspider', 'TikTokSpider', 'VelenPublicWebCrawler', 'Meltwater'
];

// Crawlers that feed AI answer engines (Perplexity, ChatGPT search, Claude
// search). Blocked too: the site's stance is "not an input to a model".
// BLOCK_AI_SEARCH is the default; since 2026-11-05 the switch is Admin →
// AI security → "Block AI answer engines" (site_settings.block_ai_search,
// migration 119), passed in as `blockAiSearch`.
export const AI_SEARCH_AGENTS = [
  'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Amzn-SearchBot', 'DuckAssistBot',
  'Kimi-SearchBot', 'Perplexity-User', 'ChatGPT-User', 'Claude-User', 'meta-externalfetcher',
  'MistralAI-User', 'Google-Agent'
];
export const BLOCK_AI_SEARCH = true;

// Search engines and the ad crawlers the public site needs. AdsBot and
// Mediapartners ignore `*` rules, so each gets an explicit group.
export const ALLOWED_AGENTS = ['Googlebot', 'Googlebot-Image', 'Googlebot-Video', 'AdsBot-Google', 'AdsBot-Google-Mobile', 'Mediapartners-Google', 'Bingbot', 'Applebot', 'DuckDuckBot'];

// Pages a public crawler has no business in once the site is open.
export const LAUNCH_DISALLOW = ['/admin', '/admin/', '/creator', '/creator/', '/account', '/messages', '/api/', '/suspended', '/welcome'];
// Feeds that must stay reachable under /api/: podcast RSS (Google reads
// it for YouTube Music; podcast apps never read robots.txt anyway).
export const LAUNCH_ALLOW = ['/api/podcasts/'];

// Cloudflare's Content Signals line: classic search yes, AI answers no,
// training no. A request like the rest, but the one most crawlers parse.
export const CONTENT_SIGNAL = 'search=yes, ai-input=no, ai-train=no';

// Response headers (next.config.js carries the TDM ones; middleware the
// X-Robots-Tag, merged with noindex while the beta door is shut).
export const AI_ROBOTS_TAG = 'noai, noimageai';
export const TDM_HEADERS = (policyUrl) => [
  { key: 'TDM-Reservation', value: '1' },
  { key: 'TDM-Policy', value: policyUrl },
  { key: 'Content-Usage', value: 'train-ai=n, ai-use=n' }
];

// `hidden`: Admin → Security → "Keep out of search engines" (migration
// 119): pages stay open to anyone with a link, every one says noindex.
export function robotsTag({ privateBeta, hidden = false }) {
  return privateBeta || hidden ? `noindex, nofollow, ${AI_ROBOTS_TAG}` : AI_ROBOTS_TAG;
}

function group(agent, lines) {
  return [`User-agent: ${agent}`, ...lines, ''].join('\n');
}

// The whole robots.txt. While the beta door is shut nobody may crawl
// (every serverless hit is a real cost with no audience behind it);
// after launch the search engines and ad crawlers get the public pages
// and every AI crawler gets nothing. The same AI groups appear in both,
// so the rule never depends on remembering a swap at launch.
//
// `hidden` (kept out of search engines, door open) keeps the public
// groups but drops the Sitemap line: a search engine has to be allowed to
// fetch a page to read its noindex and drop it from the results; a page
// blocked here can linger in them as a bare link.
export function buildRobotsTxt({ privateBeta, hidden = false, blockAiSearch = BLOCK_AI_SEARCH, origin }) {
  const out = [];
  out.push(`# Studio Tapa TV. Creators' work here is not for AI training. Policy: ${origin}/ai-policy`);
  out.push(`Content-Signal: ${CONTENT_SIGNAL}`);
  out.push('');
  const aiAgents = blockAiSearch ? [...AI_TRAINING_AGENTS, ...AI_SEARCH_AGENTS] : AI_TRAINING_AGENTS;
  for (const agent of aiAgents) out.push(group(agent, ['Disallow: /']));
  if (privateBeta) {
    out.push(group('*', ['Disallow: /']));
  } else {
    const publicLines = [...LAUNCH_ALLOW.map((p) => `Allow: ${p}`), ...LAUNCH_DISALLOW.map((p) => `Disallow: ${p}`)];
    for (const agent of ALLOWED_AGENTS) out.push(group(agent, publicLines));
    out.push(group('*', publicLines));
    if (!hidden) {
      out.push(`Sitemap: ${origin}/sitemap.xml`);
      out.push('');
    }
  }
  return out.join('\n');
}

// /.well-known/tdmrep.json (W3C TDM Reservation Protocol): the same
// reservation as the header, for crawlers that look for the file.
export function tdmrepJson(policyUrl) {
  return [{ location: '/', 'tdm-reservation': 1, 'tdm-policy': policyUrl }];
}

// Refusing AI crawlers in code (Jose, 2026-11-12: the code side of the
// Vercel firewall item). middleware.js answers 403 to a request whose
// User-Agent names an AI training crawler, always, and an AI answer
// engine while Admin → AI security's "Block AI answer engines" is on
// (site_settings.block_ai_search). The names are the same lists robots.txt
// uses, so the two never disagree.
//
// Honest scope: a User-Agent is whatever the sender says. This stops the
// crawlers that announce themselves, including the ones that ignore
// robots.txt; one pretending to be a browser gets through, and only
// Vercel's firewall (its bot list and rate limits) reaches further.
//
// Never refused: robots.txt (RFC 9309 reads a 4xx on it as "no
// restrictions at all"), /.well-known/ (tdmrep.json, security.txt), the
// AI policy and the Terms (the statements a crawler is meant to read).
// Search engines and the app never carry these names.
export const CRAWLER_REFUSAL_EXEMPT = ['/robots.txt', '/ai-policy', '/terms'];
export const CRAWLER_REFUSAL_EXEMPT_PREFIXES = ['/.well-known/'];

const TRAINING_TOKENS = AI_TRAINING_AGENTS.map((a) => a.toLowerCase());
const ANSWER_TOKENS = AI_SEARCH_AGENTS.map((a) => a.toLowerCase());

// 'training', 'answer' or null, from a User-Agent header. Matching is a
// case-insensitive substring: crawlers put their token inside a longer
// string ("Mozilla/5.0 … GPTBot/1.2; +https://openai.com/gptbot").
export function aiCrawlerKind(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (!ua) return null;
  if (TRAINING_TOKENS.some((t) => ua.includes(t))) return 'training';
  if (ANSWER_TOKENS.some((t) => ua.includes(t))) return 'answer';
  return null;
}

export function crawlerRefusalExempt(pathname) {
  const p = String(pathname || '/');
  if (CRAWLER_REFUSAL_EXEMPT.some((e) => p === e || p === `${e}/`)) return true;
  return CRAWLER_REFUSAL_EXEMPT_PREFIXES.some((prefix) => p.startsWith(prefix));
}

// The kind refused ('training' | 'answer'), or null to let it through.
export function refuseAiCrawler({ userAgent, pathname, blockAiSearch = BLOCK_AI_SEARCH } = {}) {
  if (crawlerRefusalExempt(pathname)) return null;
  const kind = aiCrawlerKind(userAgent);
  if (kind === 'training') return kind;
  if (kind === 'answer' && blockAiSearch !== false) return kind;
  return null;
}

// What the 403 says (plain text; a crawler reads nothing else).
export function crawlerRefusalText(origin) {
  return `Automated AI crawlers aren't allowed on Studio Tapa TV. Nothing here is licensed for AI training or AI answers. Policy: ${origin || 'https://www.studiotapatv.site'}/ai-policy\n`;
}
