// The environment the app runs with under the rig. Every variable the app
// reads is set here explicitly — the rig's addresses and fake keys, or
// blank — so nothing comes from a checkout's .env.local, and
// __NEXT_PROCESSED_ENV tells @next/env the environment is already loaded
// (it then applies no .env file at all). The names are collected from the
// app's own code at start, so a branch that reads a new variable gets it
// blanked too.
import fs from 'node:fs';
import path from 'node:path';
import { FAKE_KEYS, PORTS, HOST, urls } from './config.mjs';

const SCAN_DIRS = ['lib', 'pages', 'components', 'contexts'];
const SCAN_FILES = ['middleware.js', 'next.config.js'];
const KEEP = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'NEXT_PHASE', 'PORT', 'HOSTNAME', 'TZ', 'PATH', 'HOME', 'PWD', 'TMPDIR']);

export function envNamesUsedBy(appDir) {
  const names = new Set();
  const re = /process\.env\.([A-Z][A-Z0-9_]+)|process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]|\benv\.([A-Z][A-Z0-9_]{3,})\b|'((?:VERCEL|CORS|ADMIN|PRIVATE|SECURITY|STRIPE|CLOUDFLARE|CRON|AD)_[A-Z0-9_]+)'/g;
  const scan = (file) => {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      return;
    }
    let m;
    while ((m = re.exec(text))) names.add(m[1] || m[2] || m[3] || m[4]);
  };
  for (const d of SCAN_DIRS) {
    (function walk(p) {
      let entries = [];
      try {
        entries = fs.readdirSync(p, { withFileTypes: true });
      } catch (err) {
        return;
      }
      for (const e of entries) {
        const full = path.join(p, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') walk(full);
        } else if (/\.(js|jsx|mjs|ts|tsx)$/.test(e.name)) scan(full);
      }
    })(path.join(appDir, d));
  }
  for (const f of SCAN_FILES) scan(path.join(appDir, f));
  for (const k of KEEP) names.delete(k);
  return names;
}

export function appEnv(appDir, keys) {
  const u = urls();
  const supabase = process.env.RIG_SUPABASE_TLS === '0' ? u.supabase : u.supabaseTls;
  const rig = {
    __NEXT_PROCESSED_ENV: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_EXTRA_CA_CERTS: keys.tls.caFile,

    SUPABASE_URL: supabase,
    NEXT_PUBLIC_SUPABASE_URL: supabase,
    SUPABASE_SERVICE_ROLE_KEY: keys.serviceRoleKey,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anonKey,

    STRIPE_SECRET_KEY: FAKE_KEYS.stripeSecret,
    STRIPE_API_HOST: HOST,
    STRIPE_API_PORT: String(PORTS.stripe),
    STRIPE_API_PROTOCOL: 'http',
    STRIPE_WEBHOOK_SECRET: FAKE_KEYS.stripeWebhookSecret,
    STRIPE_CONNECT_WEBHOOK_SECRET: FAKE_KEYS.stripeConnectWebhookSecret,

    CLERK_API_URL: u.clerk,
    CLERK_SECRET_KEY: FAKE_KEYS.clerkSecret,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE_KEYS.clerkPublishable,
    CLERK_JWT_KEY: keys.clerkPublicPem,
    NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: '1',

    CLOUDFLARE_ACCOUNT_ID: FAKE_KEYS.cloudflareAccount,
    CLOUDFLARE_API_TOKEN: FAKE_KEYS.cloudflareToken,
    CLOUDFLARE_STREAM_CUSTOMER_CODE: FAKE_KEYS.cloudflareCustomerCode,
    CLOUDFLARE_API_BASE: `${u.cloudflare}/client/v4`,
    CLOUDFLARE_STREAM_ORIGIN: u.cloudflare,

    // Known values so the cron routes and the drop notifier can be called.
    CRON_SECRET: 'rig-cron-secret',
    ADMIN_NOTIFY_SECRET: 'rig-admin-notify-secret',
    EXPO_PUSH_URL: `${u.clerk}/__expo/push/send`,
    PAYEE_RULE_FROM: '2026-10-15T00:00:00.000Z'
  };
  const env = {};
  for (const name of envNamesUsedBy(appDir)) env[name] = '';
  // Clerk's and Next's own switches the app never names.
  for (const name of ['NEXT_PUBLIC_CLERK_JS_URL', 'NEXT_PUBLIC_CLERK_JS_VERSION', 'NEXT_PUBLIC_CLERK_PROXY_URL', 'NEXT_PUBLIC_CLERK_DOMAIN', 'NEXT_PUBLIC_CLERK_IS_SATELLITE', 'NEXT_PUBLIC_CLERK_SIGN_IN_URL', 'NEXT_PUBLIC_CLERK_SIGN_UP_URL', 'CLERK_ENCRYPTION_KEY', 'CLERK_MACHINE_SECRET_KEY', 'CLERK_API_VERSION']) env[name] = '';
  Object.assign(env, rig);
  // Let a caller point one variable elsewhere: RIG_APP_ENV_<NAME>=value.
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('RIG_APP_ENV_')) env[k.slice('RIG_APP_ENV_'.length)] = v;
  return env;
}
