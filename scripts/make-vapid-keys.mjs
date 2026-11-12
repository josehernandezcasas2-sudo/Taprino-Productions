// node scripts/make-vapid-keys.mjs — a new key pair for notifications on
// the website (web push, lib/webPush.js; 2026-11-12). Prints the three
// lines to paste into Vercel → Project → Settings → Environment
// Variables (Production, and Preview if wanted). Nothing is written to
// disk; run it once and keep the pair: a new pair means every browser has
// to turn notifications on again.
import { generateVapidKeys } from '../lib/webPushCrypto.js';
import { SITE } from '../lib/siteConfig.js';

const { publicKey, privateKey } = await generateVapidKeys();
console.log(`WEB_PUSH_PUBLIC_KEY=${publicKey}`);
console.log(`WEB_PUSH_PRIVATE_KEY=${privateKey}`);
console.log(`WEB_PUSH_SUBJECT=mailto:${SITE.contactEmail}`);
console.log('\n(The private key is a secret: put it in Vercel only, never in the repository or a chat.)');
