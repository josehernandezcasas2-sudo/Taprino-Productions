#!/usr/bin/env node
// Signs a Clerk-shaped session for one of the rig's accounts with the key
// the fake Clerk serves as its JWKS, and prints the Cookie header value to
// send (or the token alone, for the app's Bearer calls).
//
//   node dev/test-rig/mint-session.mjs user_rigMara            → cookie string
//   node dev/test-rig/mint-session.mjs user_rigMara --token    → the JWT (Authorization: Bearer …)
//   node dev/test-rig/mint-session.mjs user_rigMara --json     → { cookie, token, expiresAt, cookies: [...] }
//   node dev/test-rig/mint-session.mjs --signed-out             → just the dev-browser cookie
//   An account can be named by id or alias: mara, dee, admin, viewer, sub,
//   user_rig_mara, a handle or a username (lib/accounts.mjs).
//   --minutes=N (default 60)
//
// The cookie carries three values: __session (RS256, kid rig-test, sub,
// sid, iat, exp an hour out), __client_uat=1700000000 (before the token's
// iat, or Clerk asks for a handshake), and __clerk_db_jwt — a development
// instance (pk_test_…) sends any document request without that dev-browser
// cookie to Clerk's handshake page, so send it signed out too.
import { FAKE_KEYS, PORTS, HOST } from './lib/config.mjs';
import { loadKeys } from './lib/keys.mjs';
import { signRS256 } from './lib/jwt.mjs';
import { resolveUserId } from './lib/accounts.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const minutesArg = args.find((a) => a.startsWith('--minutes='));
const minutes = minutesArg ? Number(minutesArg.split('=')[1]) : 60;
const userId = resolveUserId(args.find((a) => !a.startsWith('--')));

const devBrowser = `__clerk_db_jwt=dvb_rig_${userId || 'signed_out'}`;

if (flag('signed-out') || !userId) {
  if (!userId && !flag('signed-out')) {
    console.error('usage: mint-session.mjs <userId> [--token|--json] [--minutes=N] | --signed-out');
    process.exit(2);
  }
  const value = devBrowser;
  console.log(flag('json') ? JSON.stringify({ cookie: value, cookies: [{ name: '__clerk_db_jwt', value: 'dvb_rig_signed_out' }] }) : value);
  process.exit(0);
}

const keys = loadKeys();
const now = Math.floor(Date.now() / 1000);
const exp = now + Math.round(minutes * 60);
const token = signRS256({
  sub: userId,
  sid: `sess_rig_${userId}`,
  iat: now - 5,
  nbf: now - 10,
  exp,
  iss: 'https://clerk.example.com',
  azp: `http://${HOST}:${PORTS.next}`
}, keys.clerkPrivatePem, FAKE_KEYS.clerkKid);

const cookie = `__session=${token}; __client_uat=1700000000; ${devBrowser}`;
if (flag('token')) console.log(token);
else if (flag('json')) {
  console.log(JSON.stringify({
    cookie,
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    cookies: [
      { name: '__session', value: token },
      { name: '__client_uat', value: '1700000000' },
      { name: '__clerk_db_jwt', value: `dvb_rig_${userId}` }
    ]
  }));
} else console.log(cookie);
