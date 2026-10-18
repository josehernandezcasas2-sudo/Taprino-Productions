import * as SecureStore from 'expo-secure-store';

// "Here only for the stream?" — when on, opening the app lands on the
// Stream home instead of the Studio Tapa TV homepage. The account keeps
// the real setting (user_profiles.stay_in_stream); this device copy is
// what the home screen reads at launch, before any network call.
const KEY = 'stay_in_stream';

export async function readStayInStream() {
  try {
    return (await SecureStore.getItemAsync(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function rememberStayInStream(on) {
  try {
    await SecureStore.setItemAsync(KEY, on ? '1' : '0');
  } catch {
    // Device storage refused; the account still has the setting.
  }
}

// Only the first visit to Home after a launch redirects; tapping Home
// later shows the homepage as asked.
let checked = false;
export function takeLaunchCheck() {
  if (checked) return false;
  checked = true;
  return true;
}
