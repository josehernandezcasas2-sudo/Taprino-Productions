// node scripts/test-crawler-refusal.mjs — the site refuses AI crawlers in
// code (2026-11-12; lib/robotsRules.js refuseAiCrawler, which middleware.js
// runs on every request): training crawlers always, answer engines while
// "Block AI answer engines" is on, never robots.txt, /.well-known/, the AI
// policy, the Terms, search engines, link previews, podcast apps or the app.
import assert from 'node:assert/strict';
import {
  AI_TRAINING_AGENTS, AI_SEARCH_AGENTS, aiCrawlerKind, crawlerRefusalExempt, refuseAiCrawler, crawlerRefusalText, CRAWLER_REFUSAL_EXEMPT
} from '../lib/robotsRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

// User agents as the crawlers send them.
const TRAINING_UAS = [
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'CCBot/2.0 (https://commoncrawl.org/faq/)',
  'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
  'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
  'Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
  'Mozilla/5.0 (compatible; Diffbot/0.1; +http://www.diffbot.com)',
  'Scrapy/2.11.2 (+https://scrapy.org)',
  'Mozilla/5.0 (compatible; AI2Bot-Dolma; +https://allenai.org/crawler)',
  'img2dataset/1.45',
  'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)'
];
const ANSWER_UAS = [
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
  'Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)',
  'Claude-User/1.0',
  'DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)',
  'meta-externalfetcher/1.1'
];
const NEVER_UAS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Googlebot-Image/1.0',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
  'AdsBot-Google (+http://www.google.com/adsbot.html)',
  'Mediapartners-Google',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Twitterbot/1.0',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  // The app (React Native's networking, expo-video's players) and podcast apps.
  'Studio%20Tapa%20TV/1 CFNetwork/1568.200.51 Darwin/24.1.0',
  'okhttp/4.12.0',
  'AppleCoreMedia/1.0.0.22B83 (iPhone; U; CPU OS 18_1 like Mac OS X; en_us)',
  'Podcasts/1.1.0.1 CFNetwork/1568.200.51 Darwin/24.1.0',
  'Overcast/3.0 (+http://overcast.fm/; Apple Watch podcast app)',
  'Pocket Casts',
  'Spotify/8.9.94 iOS/18.1 (iPhone15,2)',
  'Stripe/1.0 (+https://stripe.com/docs/webhooks)',
  'vercel-cron/1.0',
  '',
  undefined
];

t('every name robots.txt turns away is one the site refuses', () => {
  for (const a of AI_TRAINING_AGENTS) assert.equal(aiCrawlerKind(`Mozilla/5.0 (compatible; ${a}/1.0)`), 'training', a);
  for (const a of AI_SEARCH_AGENTS) assert.equal(aiCrawlerKind(`Mozilla/5.0 (compatible; ${a}/1.0)`), 'answer', a);
});

t('the crawlers as they really announce themselves', () => {
  for (const ua of TRAINING_UAS) assert.equal(aiCrawlerKind(ua), 'training', ua);
  for (const ua of ANSWER_UAS) assert.equal(aiCrawlerKind(ua), 'answer', ua);
  assert.equal(aiCrawlerKind('mozilla/5.0 (compatible; gptbot/1.2)'), 'training', 'any case');
});

t('search engines, link previews, browsers, podcast apps and the app are never crawlers', () => {
  for (const ua of NEVER_UAS) assert.equal(aiCrawlerKind(ua), null, String(ua));
  for (const ua of NEVER_UAS) assert.equal(refuseAiCrawler({ userAgent: ua, pathname: '/stream', blockAiSearch: true }), null, String(ua));
});

t('training crawlers are refused everywhere but the exempt paths, whatever the switch says', () => {
  const ua = TRAINING_UAS[0];
  for (const path of ['/', '/stream', '/episode/night-bus-e1', '/api/home-feed', '/api/podcasts/show-1/rss.xml', '/api/podcasts/audio/ep1.mp3', '/sitemap.xml', '/robots.txt.bak', '/terms-of-something', '/ai-policy-old']) {
    assert.equal(refuseAiCrawler({ userAgent: ua, pathname: path, blockAiSearch: false }), 'training', path);
    assert.equal(refuseAiCrawler({ userAgent: ua, pathname: path, blockAiSearch: true }), 'training', path);
  }
});

t('answer engines follow "Block AI answer engines"', () => {
  for (const ua of ANSWER_UAS) {
    assert.equal(refuseAiCrawler({ userAgent: ua, pathname: '/stream', blockAiSearch: true }), 'answer', ua);
    assert.equal(refuseAiCrawler({ userAgent: ua, pathname: '/stream', blockAiSearch: false }), null, ua);
  }
  assert.equal(refuseAiCrawler({ userAgent: ANSWER_UAS[0], pathname: '/stream' }), 'answer', 'blocked by default, as the switch starts');
});

t('robots.txt, /.well-known/, the AI policy and the Terms always answer', () => {
  assert.deepEqual(CRAWLER_REFUSAL_EXEMPT, ['/robots.txt', '/ai-policy', '/terms']);
  for (const path of ['/robots.txt', '/.well-known/tdmrep.json', '/.well-known/security.txt', '/ai-policy', '/ai-policy/', '/terms', '/terms/']) {
    assert.equal(crawlerRefusalExempt(path), true, path);
    for (const ua of [...TRAINING_UAS, ...ANSWER_UAS]) assert.equal(refuseAiCrawler({ userAgent: ua, pathname: path, blockAiSearch: true }), null, `${path} ${ua}`);
  }
  for (const path of ['/', '/.well-known', '/well-known/x', '/ai-policyx', '/terms#ai', '/api/security-txt']) assert.equal(crawlerRefusalExempt(path), false, path);
});

t('the refusal says where the policy is', () => {
  assert.equal(crawlerRefusalText('https://www.studiotapatv.site'), "Automated AI crawlers aren't allowed on Studio Tapa TV. Nothing here is licensed for AI training or AI answers. Policy: https://www.studiotapatv.site/ai-policy\n");
  assert.ok(crawlerRefusalText().includes('https://www.studiotapatv.site/ai-policy'));
});

console.log(`${n} passed`);
