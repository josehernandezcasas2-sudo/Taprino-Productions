import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { hostedAuthRedirectUrl } from './hostedAuthRules';

// Expo Go, the way Clerk's own SDK tells it apart from a build.
function inExpoGo() {
  return Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';
}

// extra.eas.projectId from app.json (written by `eas init`), which Expo Go
// also carries in the update's manifest.
function easProjectId() {
  const fromEas = Constants.easConfig && Constants.easConfig.projectId;
  const extra = Constants.expoConfig && Constants.expoConfig.extra;
  return fromEas || (extra && extra.eas && extra.eas.projectId) || null;
}

// The params for Clerk's startHostedAuth: the mode plus, in Expo Go on
// iOS, the one fixed redirect address that is on the Clerk allowlist (see
// hostedAuthRules.js). Every sign-in / sign-up button goes through this.
export function hostedAuthParams(mode) {
  const redirectUrl = hostedAuthRedirectUrl({ os: Platform.OS, inExpoGo: inExpoGo(), projectId: easProjectId() });
  return redirectUrl ? { mode, redirectUrl } : { mode };
}
