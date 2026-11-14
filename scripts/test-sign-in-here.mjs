// node scripts/test-sign-in-here.mjs — every button on the website that
// opens Clerk's sign-in or sign-up box says where the person ends up
// afterwards (Jose, 2026-11-14: "i want them to be able to sign up and
// sign in but maintain within what they were doing"). A box opened in the
// middle of something goes through components/SignInHere.js or
// lib/resumeTaskRules.js stayHereProps / stayHereSignUpProps; the general
// ways in name both outcomes themselves. This reads the source, so a new
// bare <SignInButton> or openSignIn() fails here before it ships.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
const files = ['pages', 'components', 'contexts', 'lib'].flatMap((d) => walk(join(ROOT, d))).map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, 'utf8') }));
// Comment lines never count: they describe, they don't open anything.
const code = (text) => text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n');

// The general ways in: each names where a sign-in AND a sign-up land.
const GENERAL = {
  'pages/account.js': ['forceRedirectUrl="/signed-in?next=/account" signUpForceRedirectUrl="/account"', 'forceRedirectUrl="/account" signInForceRedirectUrl="/signed-in?next=/account"'],
  'pages/welcome.js': ['forceRedirectUrl={landing} signUpForceRedirectUrl={next}'],
  'pages/advertise/login.js': ['forceRedirectUrl="/advertise/dashboard" signUpForceRedirectUrl="/advertise/dashboard"']
};

t('a Clerk button is used only by SignInHere and the general ways in', () => {
  const users = files.filter((f) => /<Sign(In|Up)Button\b/.test(code(f.text))).map((f) => f.path).sort();
  assert.deepEqual(users, ['components/SignInHere.js', ...Object.keys(GENERAL)].sort());
});

t('the general ways in name both outcomes', () => {
  for (const [path, needles] of Object.entries(GENERAL)) {
    const text = files.find((f) => f.path === path).text;
    for (const needle of needles) assert.ok(text.includes(needle), `${path}: ${needle}`);
    // No Clerk button there is left with one outcome unnamed.
    for (const tag of code(text).match(/<Sign(In|Up)Button\b[^>]*>/g) || []) {
      assert.match(tag, /forceRedirectUrl=/, `${path}: ${tag}`);
      assert.match(tag, /sign(In|Up)ForceRedirectUrl=/, `${path}: ${tag}`);
    }
  }
});

t('SignInHere hands Clerk this page for both outcomes', () => {
  const text = files.find((f) => f.path === 'components/SignInHere.js').text;
  assert.match(text, /<SignInButton mode="modal" \{\.\.\.stayHereProps\(asPath\)\}>/);
  assert.match(text, /<SignUpButton mode="modal" \{\.\.\.stayHereSignUpProps\(asPath\)\}>/);
});

t('every openSignIn / openSignUp call passes the stay-here props', () => {
  const calls = [];
  for (const f of files) {
    const body = code(f.text);
    for (const m of body.matchAll(/\bopenSign(In|Up)\(([^)]*)\)/g)) calls.push({ path: f.path, kind: m[1], args: m[2] });
  }
  assert.ok(calls.length >= 6, `found ${calls.length} calls`);
  for (const c of calls) {
    const want = c.kind === 'In' ? /^stayHereProps\(router\.asPath$/ : /^stayHereSignUpProps\(router\.asPath$/;
    assert.match(c.args, want, `${c.path}: openSign${c.kind}(${c.args})`);
  }
  // The legacy prop Clerk's box no longer reads is gone.
  for (const f of files) assert.ok(!/openSign(In|Up)\(\{\s*redirectUrl/.test(f.text), f.path);
});

t('Tip, Own and the paywall leave a mark before the box opens', () => {
  const tip = files.find((f) => f.path === 'components/TipSheet.js').text;
  assert.match(tip, /rememberTask\(task\);\s*\n\s*openSignIn\(stayHereProps\(router\.asPath\)\);/);
  assert.match(tip, /if \(takeTask\(task\)\) setOpen\(true\);/);
  const buy = files.find((f) => f.path === 'components/BuyBits.js').text;
  assert.match(buy, /rememberTask\(buyTask\(type, id\)\);\s*\n\s*openSignIn\(stayHereProps\(router\.asPath\)\);/);
  assert.match(buy, /useResumeTask\('buy:', isSignedIn,/);
  const episode = files.find((f) => f.path === 'pages/episode/[id].js').text;
  assert.match(episode, /rememberTask\(TASKS\.plans\);\s*\n\s*openSignIn\(stayHereProps\(router\.asPath\)\);/);
  assert.match(episode, /useResumeTask\(TASKS\.plans, isSignedIn,/);
});

console.log(`${n} passed`);
