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
// Flip BLOCK_AI_SEARCH to false to let those engines cite the site.
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

export function robotsTag({ privateBeta }) {
  return privateBeta ? `noindex, nofollow, ${AI_ROBOTS_TAG}` : AI_ROBOTS_TAG;
}

function group(agent, lines) {
  return [`User-agent: ${agent}`, ...lines, ''].join('\n');
}

// The whole robots.txt. While the beta door is shut nobody may crawl
// (every serverless hit is a real cost with no audience behind it);
// after launch the search engines and ad crawlers get the public pages
// and every AI crawler gets nothing. The same AI groups appear in both,
// so the rule never depends on remembering a swap at launch.
export function buildRobotsTxt({ privateBeta, origin }) {
  const out = [];
  out.push(`# Studio Tapa TV. Creators' work here is not for AI training. Policy: ${origin}/terms`);
  out.push(`Content-Signal: ${CONTENT_SIGNAL}`);
  out.push('');
  const aiAgents = BLOCK_AI_SEARCH ? [...AI_TRAINING_AGENTS, ...AI_SEARCH_AGENTS] : AI_TRAINING_AGENTS;
  for (const agent of aiAgents) out.push(group(agent, ['Disallow: /']));
  if (privateBeta) {
    out.push(group('*', ['Disallow: /']));
  } else {
    const publicLines = [...LAUNCH_ALLOW.map((p) => `Allow: ${p}`), ...LAUNCH_DISALLOW.map((p) => `Disallow: ${p}`)];
    for (const agent of ALLOWED_AGENTS) out.push(group(agent, publicLines));
    out.push(group('*', publicLines));
    out.push(`Sitemap: ${origin}/sitemap.xml`);
    out.push('');
  }
  return out.join('\n');
}

// /.well-known/tdmrep.json (W3C TDM Reservation Protocol): the same
// reservation as the header, for crawlers that look for the file.
export function tdmrepJson(policyUrl) {
  return [{ location: '/', 'tdm-reservation': 1, 'tdm-policy': policyUrl }];
}
