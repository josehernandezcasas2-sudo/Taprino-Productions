// Where Clerk's hosted sign-in page sends the phone back to, worked out
// from where the app is running. Pure (no Expo or React Native imports),
// so scripts/test-hosted-auth.mjs can run it in Node; hostedAuth.js feeds
// it the live values.
//
// Clerk refuses a sign-in whose redirect address isn't on the instance's
// allowlist (Clerk Dashboard → Configure → Native applications). Its own
// default is right for a real build — site.studiotapatv.app://callback on
// iOS, the clerk:// intent on Android, both registered when the app is
// added on that page — but in Expo Go the SDK falls back to the address
// the bundle was loaded from: exp://192.168.x.x:8081/--/hosted-auth-callback
// on the dev server, exp://u.expo.dev/update/<update id>/--/… from an EAS
// Update, which is a new address every publish. That is how sign-in broke
// the first time the cloud version opened (2026-10-28).
//
// On iOS the callback never has to be a real link: the system's auth
// session (ASWebAuthenticationSession, which expo-web-browser opens with
// the redirect's scheme as its callbackURLScheme) hands any URL on the
// `exp` scheme straight back to the running app, so one fixed address
// does for the dev server, a tunnel and every update, and it goes on the
// allowlist once. Android Expo Go really routes the link through the OS
// to whatever project the address names, so it keeps the SDK's default.

export const HOSTED_AUTH_CALLBACK_PATH = 'hosted-auth-callback';

// The fixed redirect address for Expo Go on iOS, or null to leave the
// SDK's default in place.
export function hostedAuthRedirectUrl({ os, inExpoGo, projectId }) {
  if (os !== 'ios' || !inExpoGo || !projectId) return null;
  return `exp://u.expo.dev/${projectId}/--/${HOSTED_AUTH_CALLBACK_PATH}`;
}
