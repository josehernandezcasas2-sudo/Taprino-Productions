// node scripts/test-notification-types.mjs — the notification registry
// (lib/notificationTypes.js) and the app's copy
// (mobile/src/lib/notificationTypes.js): the copy is checked word for word,
// every type the code sends is checked to be registered, every icon to be
// one both platforms draw, and lib/notify.js's development warning (named
// once per unregistered type, never in production, never in the way).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as web from '../lib/notificationTypes.js';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const webSource = read('lib/notificationTypes.js');
const appSource = read('mobile/src/lib/notificationTypes.js');
// mobile/package.json has no "type": "module" (Metro doesn't need one), so
// the app's file is loaded from its source as an ES module, the way
// scripts/test-hosted-auth.mjs does; it imports nothing, so that works.
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

let n = 0;
const t = async (name, fn) => { await fn(); n += 1; console.log('ok', name); };

const body = (src) => src.replace(/^(?:\/\/[^\n]*\n|[ \t]*\n)*/, '');

await t('the app copy is the website file word for word below its header', () => {
  assert.ok(body(webSource).startsWith('export const NOTIFICATION_ICONS'));
  assert.equal(body(appSource), body(webSource));
  assert.deepEqual(Object.keys(app).sort(), Object.keys(web).sort());
  assert.ok(!/^\s*import\s/m.test(webSource), 'lib/notificationTypes.js imports nothing');
});

await t('every entry has a label, a known icon and a known route kind, and none can be changed', () => {
  const entries = Object.entries(web.NOTIFICATION_TYPES);
  assert.ok(entries.length >= 75, `only ${entries.length} types registered`);
  for (const [type, entry] of entries) {
    assert.match(type, /^[a-z][a-z0-9_]*$/, type);
    assert.deepEqual(Object.keys(entry).sort(), ['icon', 'label', 'routeKind'], type);
    assert.equal(typeof entry.label, 'string', type);
    assert.ok(entry.label.trim() === entry.label && entry.label.length > 0 && entry.label.length <= 32, `${type}: "${entry.label}"`);
    assert.ok(web.NOTIFICATION_ICONS.includes(entry.icon), `${type}: icon ${entry.icon}`);
    assert.ok(Object.prototype.hasOwnProperty.call(web.ROUTE_KINDS, entry.routeKind), `${type}: routeKind ${entry.routeKind}`);
    assert.ok(Object.isFrozen(entry), type);
  }
  assert.ok(Object.isFrozen(web.NOTIFICATION_TYPES));
  assert.ok(Object.isFrozen(web.NOTIFICATION_ICONS));
  assert.ok(Object.isFrozen(web.ROUTE_KINDS));
  assert.equal(new Set(web.NOTIFICATION_ICONS).size, web.NOTIFICATION_ICONS.length);
  // Every route kind but none names a site path.
  for (const [k, path] of Object.entries(web.ROUTE_KINDS)) {
    if (k === 'none') assert.equal(path, null);
    else assert.match(path, /^\/[a-z]/, k);
  }
});

await t('lookups: a registered type, an unknown one, and anything that isn\'t a string', () => {
  assert.equal(web.isNotificationType('tip'), true);
  assert.deepEqual({ ...web.notificationType('tip') }, { label: 'New tip', icon: 'tip', routeKind: 'money' });
  assert.equal(web.notificationType('message').routeKind, 'message');
  for (const odd of ['nope', '', 'toString', '__proto__', 'constructor', undefined, null, 7, {}, ['tip']]) {
    assert.equal(web.isNotificationType(odd), false, String(odd));
    assert.equal(web.notificationType(odd), web.UNKNOWN_NOTIFICATION_TYPE);
  }
  assert.deepEqual({ ...web.UNKNOWN_NOTIFICATION_TYPE }, { label: 'Notification', icon: 'bell', routeKind: 'none' });
  assert.deepEqual(app.notificationType('payout'), web.notificationType('payout'));
});

await t('the show types the series revamp sends are registered', () => {
  const show = ['show_live', 'show_pulled', 'show_edit_approved', 'show_edit_denied', 'show_video_approved', 'show_video_denied', 'show_deleted', 'show_deletion_denied', 'episode_moved_by_admin', 'show_numbering_fixed', 'show_owner_changed', 'show_new_episodes'];
  for (const type of show) assert.ok(web.isNotificationType(type), type);
  for (const type of ['episode_approved', 'episode_rejected', 'artwork_approved', 'artwork_denied', 'edit_approved', 'edit_denied', 'deletion_denied', 'deletion_confirmed']) assert.ok(web.isNotificationType(type), type);
});

// Every notifyCreator / notifyMany call in lib/ and pages/ (and the one
// helper that builds them, lib/locationRequests.js notifyBoth): the string
// literals its `type:` can take — a literal compared against (=== 'all')
// is a condition, not a type.
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = new URL(name, dir);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') out.push(...sourceFiles(new URL(`${name}/`, dir))); } else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}
function callEnd(src, start) {
  let i = start;
  let depth = 1;
  let quote = null;
  const templates = [];
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (quote === '`' && c === '$' && src[i + 1] === '{') { templates.push(depth); quote = null; depth += 1; i += 1; } else if (c === quote) quote = null;
    } else if (c === '"' || c === '\'' || c === '`') quote = c;
    else if ('({['.includes(c)) depth += 1;
    else if (')}]'.includes(c)) { depth -= 1; if (templates.length && depth === templates[templates.length - 1]) { templates.pop(); quote = '`'; } }
    i += 1;
  }
  return i;
}
function sentTypes() {
  const found = new Map();
  for (const dir of ['lib/', 'pages/']) {
    for (const file of sourceFiles(new URL(dir, root))) {
      const src = readFileSync(file, 'utf8');
      const calls = /\b(notifyCreator|notifyMany|notifyBoth)\s*\(/g;
      let m;
      while ((m = calls.exec(src))) {
        if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
        const call = src.slice(m.index, callEnd(src, m.index + m[0].length));
        const typeExprs = /\btype\s*:\s*([^,\n}]+)/g;
        let e;
        while ((e = typeExprs.exec(call))) {
          const expr = e[1];
          const literals = /'([a-z][a-z0-9_]*)'/g;
          let l;
          while ((l = literals.exec(expr))) {
            if (/[=!]=\s*$/.test(expr.slice(0, l.index))) continue;
            const where = `${file.pathname.split('/').slice(-2).join('/')}:${src.slice(0, m.index).split('\n').length}`;
            if (!found.has(l[1])) found.set(l[1], where);
          }
        }
      }
    }
  }
  return found;
}

await t('every type the code sends is registered', () => {
  const sent = sentTypes();
  assert.ok(sent.size >= 75, `the scan found ${sent.size} types; it should find every call`);
  assert.ok(!sent.has('all') && !sent.has('approve'), 'conditions are not types');
  const missing = [...sent].filter(([type]) => !web.isNotificationType(type)).map(([type, where]) => `${type} (${where})`);
  assert.deepEqual(missing, [], `sent but not in lib/notificationTypes.js: ${missing.join(', ')}`);
});

await t('every icon is a glyph both platforms draw', () => {
  const webIcons = read('components/PlayerIcons.js');
  const appIcons = read('mobile/src/components/TabBarIcons.js');
  const appTip = read('mobile/src/components/TipSheet.js');
  const pascal = (key) => key.split(/[-_]/).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  for (const icon of web.NOTIFICATION_ICONS) {
    const name = `${pascal(icon)}Icon`;
    assert.ok(new RegExp(`export function ${name}\\b`).test(webIcons), `components/PlayerIcons.js exports ${name}`);
    if (icon === 'tip') assert.ok(/export function TipGlyph\b/.test(appTip), 'mobile/src/components/TipSheet.js exports TipGlyph');
    else assert.ok(new RegExp(`export function ${name}\\b`).test(appIcons), `mobile/src/components/TabBarIcons.js exports ${name}`);
  }
});

// lib/notify.js, loaded with its server imports swapped for stand-ins (the
// way scripts/test-crew-pay.mjs points an import at a file): the database
// and the push service only record what they are handed.
const stub = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const notifySource = read('lib/notify.js')
  .replace("from './supabase'", `from '${stub('export function getSupabase() { return globalThis.__fakeSupabase; }')}'`)
  .replace("from './siteConfig'", `from '${stub("export const SITE = { name: 'Studio Tapa TV', contactEmail: 'hello@example.com' };")}'`)
  .replace("from './push'", `from '${stub('export async function sendPush(p) { globalThis.__pushes.push(p); } export async function sendPushMany(list) { globalThis.__pushes.push(...list); }')}'`)
  .replace("from './notificationTypes'", `from '${new URL('lib/notificationTypes.js', root).href}'`);
assert.ok(!/from '\.\//.test(notifySource), 'every relative import of lib/notify.js is stood in for');
const notify = await import(stub(notifySource));

await t('lib/notify.js: an unregistered type is named once in development, never in production, and the notification goes out either way', async () => {
  const inserts = [];
  globalThis.__fakeSupabase = { from: (table) => ({ insert: (rows) => { inserts.push({ table, rows }); return Promise.resolve({ error: null }); } }) };
  globalThis.__pushes = [];
  const warnings = [];
  const realWarn = console.warn;
  const realEnv = process.env.NODE_ENV;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    process.env.NODE_ENV = 'production';
    await notify.notifyCreator({ userId: 'u1', type: 'made_up_in_prod', message: 'a', href: '/x' });
    await notify.notifyMany([{ userId: 'u2', type: 'made_up_in_prod', message: 'b' }]);
    assert.deepEqual(warnings, []);

    process.env.NODE_ENV = 'development';
    await notify.notifyCreator({ userId: 'u1', type: 'tip', message: 'c', href: '/creator/money' });
    assert.deepEqual(warnings, [], 'a registered type says nothing');
    await notify.notifyCreator({ userId: 'u1', type: 'made_up', message: 'd', episodeId: 'ep-1' });
    await notify.notifyCreator({ userId: 'u1', type: 'made_up', message: 'e' });
    await notify.notifyMany([{ userId: 'u3', type: 'made_up_many', message: 'f' }, { userId: 'u4', type: 'made_up_many', message: 'g' }, { userId: 'u5', type: 'call', message: 'h' }]);
    await notify.notifyCreator({ userId: 'u1', type: undefined, message: 'i' });
    // No one to tell: nothing is sent, so nothing is said.
    await notify.notifyCreator({ userId: null, type: 'never_sent', message: 'j' });
    await notify.notifyMany([{ userId: null, type: 'never_sent_many', message: 'k' }]);
    assert.equal(warnings.length, 3, warnings.join('\n'));
    assert.match(warnings[0], /"made_up" isn't a registered notification type/);
    assert.match(warnings[0], /lib\/notificationTypes\.js and mobile\/src\/lib\/notificationTypes\.js/);
    assert.match(warnings[1], /"made_up_many"/);
    assert.match(warnings[2], /"undefined"/);

    // Behaviour is the same with or without the registry: every row was
    // written and pushed exactly as before.
    const rows = inserts.flatMap((i) => (Array.isArray(i.rows) ? i.rows : [i.rows]));
    assert.ok(inserts.every((i) => i.table === 'notifications'));
    assert.deepEqual(rows.map((r) => r.type), ['made_up_in_prod', 'made_up_in_prod', 'tip', 'made_up', 'made_up', 'made_up_many', 'made_up_many', 'call', undefined]);
    assert.deepEqual(rows[0], { user_id: 'u1', type: 'made_up_in_prod', message: 'a', episode_id: null, pitch_id: null, href: '/x' });
    assert.deepEqual(rows[3], { user_id: 'u1', type: 'made_up', message: 'd', episode_id: 'ep-1', pitch_id: null });
    assert.equal(globalThis.__pushes.length, rows.length);
    assert.deepEqual(globalThis.__pushes[3], { userId: 'u1', body: 'd', href: '/episode/ep-1', data: { type: 'made_up' } });
  } finally {
    console.warn = realWarn;
    if (realEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = realEnv;
  }
});

console.log(`\n${n} notification-type checks passed (${Object.keys(web.NOTIFICATION_TYPES).length} types registered)`);
