// Where the rig keeps things and which ports it listens on. Everything that
// changes at run time (the database cluster, keys, stored files, logs, pid
// files) lives under RIG_DATA_DIR, outside the repo, so a reset of the
// container loses only data the rig rebuilds by itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = path.resolve(RIG_DIR, '..', '..');

const tmp = process.env.TMPDIR || '/tmp';
export const DATA_DIR = path.resolve(process.env.RIG_DATA_DIR || path.join(tmp, 'studio-tapa-rig'));
export const CACHE_DIR = path.resolve(process.env.RIG_CACHE_DIR || path.join(tmp, 'studio-tapa-rig-cache'));

export const PATHS = {
  pgdata: path.join(DATA_DIR, 'pgdata'),
  pgsock: path.join(DATA_DIR, 'pgsock'),
  keys: path.join(DATA_DIR, 'keys'),
  storage: path.join(DATA_DIR, 'storage'),
  run: path.join(DATA_DIR, 'run'),
  logs: path.join(DATA_DIR, 'logs'),
  state: path.join(DATA_DIR, 'state'),
  postgrestConf: path.join(DATA_DIR, 'postgrest.conf'),
  appFile: path.join(DATA_DIR, 'run', 'app-dir')
};

export const PORTS = {
  supabase: 54321,
  // The same stand-in over TLS (a rig-made CA), for the app: next/image only
  // accepts https Supabase addresses (next.config.js remotePatterns).
  supabaseTls: 54331,
  stripe: 54322,
  clerk: 54323,
  cloudflare: 54324,
  postgrest: 54325,
  postgrestAdmin: 54326,
  postgres: Number(process.env.RIG_PG_PORT || 54329),
  next: Number(process.env.RIG_NEXT_PORT || 3100)
};

export const HOST = '127.0.0.1';

function firstExisting(list) {
  return list.find((p) => p && fs.existsSync(p)) || list[list.length - 1];
}

export const PG_BIN = process.env.RIG_PG_BIN || firstExisting(['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/local/bin']);
export const PSQL = process.env.RIG_PSQL || firstExisting([path.join(PG_BIN, 'psql'), '/usr/bin/psql']);
export const POSTGREST_VERSION = '12.2.12';
export const POSTGREST_BIN = process.env.RIG_POSTGREST_BIN || path.join(CACHE_DIR, `postgrest-v${POSTGREST_VERSION}`, 'bin', 'postgrest');

// The fixed, fake keys. None of these is a real credential: the Stripe key
// is a test-mode shape the stand-in accepts (lib/stripe.js never sends a
// live key to STRIPE_API_HOST), the publishable key encodes
// "clerk.example.com$", and the Clerk secret only ever reaches the fake.
export const FAKE_KEYS = {
  stripeSecret: 'sk_test_rig',
  stripeWebhookSecret: 'whsec_rig',
  stripeConnectWebhookSecret: 'whsec_rig_connect',
  clerkSecret: 'sk_test_rig',
  clerkPublishable: 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k',
  clerkKid: 'rig-test',
  cloudflareAccount: 'rig-account',
  cloudflareToken: 'rig-cloudflare-token',
  cloudflareCustomerCode: 'test'
};

export function urls() {
  return {
    supabase: `http://${HOST}:${PORTS.supabase}`,
    supabaseTls: `https://${HOST}:${PORTS.supabaseTls}`,
    stripe: `http://${HOST}:${PORTS.stripe}`,
    clerk: `http://${HOST}:${PORTS.clerk}`,
    cloudflare: `http://${HOST}:${PORTS.cloudflare}`,
    postgrest: `http://${HOST}:${PORTS.postgrest}`,
    next: `http://${HOST}:${PORTS.next}`
  };
}

export function ensureDirs() {
  for (const p of [DATA_DIR, PATHS.keys, PATHS.storage, PATHS.run, PATHS.logs, PATHS.state]) fs.mkdirSync(p, { recursive: true });
}

export const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
export const hostname = os.hostname();
