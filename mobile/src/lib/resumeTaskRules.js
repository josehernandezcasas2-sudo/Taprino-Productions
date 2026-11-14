// Signing in or signing up in the middle of something keeps the person
// where they were, and picks the thing back up (Jose, 2026-11-14: "i want
// them to be able to sign up and sign in but maintain within what they
// were doing"). Pure and client-safe, no imports; the app's
// mobile/src/lib/resumeTaskRules.js is this file word for word
// (scripts/test-resume-task.mjs checks it).
//
// Two halves:
//   - where Clerk sends the person afterwards: stayHereProps (a button
//     that opens sign-in) and stayHereSignUpProps (one that opens sign-up)
//     name the page they are on for BOTH outcomes, so the answer never
//     depends on Clerk's defaults or on a redirect set in the dashboard;
//   - what they were doing: a mark ({ task, path, at }) kept for a few
//     minutes — sessionStorage on the website (lib/resumeTask.js), memory
//     in the app (mobile/src/lib/resumeTask.js). Back on the same page and
//     signed in, the button that left the mark takes it and carries on:
//     the Tip sheet opens, Checkout starts, the plans open.

// Long enough to create an account with an emailed code, short enough
// that a mark left by someone who closed the box is forgotten.
export const RESUME_MINUTES = 15;

// The tasks that are picked back up. A task is 'tip:<creator id>',
// 'buy:<type>:<title id>' or 'plans'.
export const TASKS = { tip: 'tip', buy: 'buy', plans: 'plans' };

export function tipTask(creatorId) {
  return `tip:${creatorId == null ? '' : String(creatorId)}`;
}

export function buyTask(type, id) {
  return `buy:${String(type || '')}:${String(id || '')}`;
}

// 'buy:episode:night-bus-e1' → { type: 'episode', id: 'night-bus-e1' }.
export function buyParts(task) {
  const m = /^buy:([a-z]+):(.+)$/.exec(typeof task === 'string' ? task : '');
  return m ? { type: m[1], id: m[2] } : null;
}

// A site path and nothing else ('/episode/x?autoplay=1'); anything that
// could leave the site ('//evil', '/\evil', a full address) becomes '/'.
export function sitePath(value) {
  const v = typeof value === 'string' ? value : '';
  // eslint-disable-next-line no-control-regex
  if (!/^\/(?![/\\])/.test(v) || /[\u0000-\u001f\\]/.test(v)) return '/';
  return v;
}

// The page without its query or hash: where a mark belongs.
export function pageOf(value) {
  return sitePath(value).split(/[?#]/)[0] || '/';
}

// For a button that opens Clerk's sign-in (openSignIn, <SignInButton>):
// signing in, or creating an account from that box, both end here.
export function stayHereProps(path) {
  const here = sitePath(path);
  return { forceRedirectUrl: here, signUpForceRedirectUrl: here };
}

// For a button that opens Clerk's sign-up (openSignUp, <SignUpButton>).
export function stayHereSignUpProps(path) {
  const here = sitePath(path);
  return { forceRedirectUrl: here, signInForceRedirectUrl: here };
}

export function taskMark(task, path, now = Date.now()) {
  return { task: String(task || ''), path: pageOf(path), at: Number(now) || 0 };
}

// Is this mark too old (or not a mark at all)? A stale one is thrown away.
export function markStale(mark, now = Date.now()) {
  if (!mark || typeof mark.task !== 'string' || !mark.task || typeof mark.path !== 'string') return true;
  const age = Number(now) - Number(mark.at);
  return !(age >= 0 && age <= RESUME_MINUTES * 60000);
}

// Does the mark say to carry on with `want` on this page? `want` is a
// whole task ('plans', 'tip:user_1') or a family ending in ':' ('buy:').
export function resumeDue(mark, { want, path, now = Date.now() } = {}) {
  if (markStale(mark, now)) return false;
  if (typeof want !== 'string' || !want) return false;
  if (mark.path !== pageOf(path)) return false;
  return want.endsWith(':') ? mark.task.startsWith(want) && mark.task.length > want.length : mark.task === want;
}
