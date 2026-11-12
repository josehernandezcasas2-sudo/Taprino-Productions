// The rig's keys, made on first start and kept under RIG_DATA_DIR/keys
// (never in the repo): the RSA pair the fake Clerk signs sessions with
// and serves as its JWKS, PostgREST's JWT secret, the service-role and
// anon keys minted from it, the authenticator role's password, and the
// app's web push (VAPID) pair.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PATHS, ensureDirs } from './config.mjs';
import { signHS256 } from './jwt.mjs';
import { makeVapidKeys } from './webpush.mjs';

const file = (name) => path.join(PATHS.keys, name);

function readOr(name, make) {
  const p = file(name);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const value = make();
  fs.writeFileSync(p, value, { mode: 0o600 });
  return value;
}

export function ensureKeys() {
  ensureDirs();
  // Clerk's networkless check strips a fixed RSA-2048 prefix off the PEM,
  // so the pair must be 2048 bits with e = 65537.
  if (!fs.existsSync(file('clerk-private.pem')) || !fs.existsSync(file('clerk-public.pem'))) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
    fs.writeFileSync(file('clerk-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(file('clerk-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
  }
  const jwtSecret = readOr('postgrest-jwt-secret', () => crypto.randomBytes(48).toString('base64url'));
  const authenticatorPassword = readOr('authenticator-password', () => crypto.randomBytes(18).toString('hex'));
  const now = Math.floor(Date.now() / 1000);
  // Ten years: the key is reminted whenever the secret is (a fresh data dir).
  const serviceRoleKey = readOr('service-role.jwt', () => signHS256({ role: 'service_role', iss: 'supabase-rig', iat: now, exp: now + 10 * 365 * 86400 }, jwtSecret));
  const anonKey = readOr('anon.jwt', () => signHS256({ role: 'anon', iss: 'supabase-rig', iat: now, exp: now + 10 * 365 * 86400 }, jwtSecret));
  // The storage stand-in signs its object links with its own secret.
  const storageSecret = readOr('storage-secret', () => crypto.randomBytes(32).toString('base64url'));
  // The app's web push keys (WEB_PUSH_PUBLIC_KEY / _PRIVATE_KEY, lib/webPush.js).
  const vapid = JSON.parse(readOr('vapid.json', () => JSON.stringify(makeVapidKeys())));
  const tls = ensureTls();
  return {
    tls,
    clerkPrivatePem: fs.readFileSync(file('clerk-private.pem'), 'utf8'),
    clerkPublicPem: fs.readFileSync(file('clerk-public.pem'), 'utf8'),
    jwtSecret,
    authenticatorPassword,
    serviceRoleKey,
    anonKey,
    storageSecret,
    vapidPublicKey: vapid.publicKey,
    vapidPrivateKey: vapid.privateKey
  };
}

export function loadKeys() {
  return ensureKeys();
}

// A CA of the rig's own and a certificate for 127.0.0.1/localhost signed
// by it, for the Supabase stand-in's https listener. The app trusts the CA
// through NODE_EXTRA_CA_CERTS (nothing turns verification off); the smoke
// browser trusts the one certificate by its key (Chromium's
// --ignore-certificate-errors-spki-list), which `spki` is for.
function ensureTls() {
  const ca = file('rig-ca.pem');
  const cert = file('supabase-tls.pem');
  const key = file('supabase-tls.key');
  if (!fs.existsSync(ca) || !fs.existsSync(cert) || !fs.existsSync(key)) {
    const caKey = file('rig-ca.key');
    const csr = file('supabase-tls.csr');
    const ext = file('supabase-tls.ext');
    const run = (args) => {
      const r = spawnSync('openssl', args, { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`openssl ${args[0]} failed: ${r.stderr || r.error}`);
    };
    run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', ca, '-days', '3650', '-subj', '/CN=Studio Tapa test rig CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', '/CN=127.0.0.1']);
    fs.writeFileSync(ext, 'subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
    run(['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', cert, '-days', '800', '-extfile', ext]);
    for (const p of [caKey, key]) fs.chmodSync(p, 0o600);
  }
  const certPem = fs.readFileSync(cert, 'utf8');
  const spki = crypto.createHash('sha256').update(crypto.createPublicKey(certPem).export({ type: 'spki', format: 'der' })).digest('base64');
  return { caFile: ca, certFile: cert, keyFile: key, spki };
}
