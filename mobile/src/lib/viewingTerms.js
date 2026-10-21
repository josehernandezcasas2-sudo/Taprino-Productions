import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// The viewing terms, taken once per device by anyone without an age on
// their account. One acceptance covers the live channels (any rated
// program) and library titles under 17+; 17+ and unrated titles always
// need an account with an age. Sent to the API as `terms` (the live
// player's `liveTerms` means the same thing). Same key the live player
// has always used, so an earlier acceptance there still counts.
export const VIEWING_TERMS_KEY = 'live_tv_terms_accepted';
export const TERMS_URL = 'https://www.studiotapatv.site/terms#live-tv';

export async function readViewingTerms() {
  try {
    if (Platform.OS === 'web') return window.localStorage.getItem(VIEWING_TERMS_KEY) === '1';
    return (await SecureStore.getItemAsync(VIEWING_TERMS_KEY)) === '1';
  } catch (err) {
    return false;
  }
}

export async function saveViewingTerms() {
  try {
    if (Platform.OS === 'web') window.localStorage.setItem(VIEWING_TERMS_KEY, '1');
    else await SecureStore.setItemAsync(VIEWING_TERMS_KEY, '1');
  } catch (err) { /* the gate shows again next time */ }
}

// Appends ?terms=1 (or &terms=1) when the device has taken the terms.
export async function withTerms(path) {
  if (!(await readViewingTerms())) return path;
  return `${path}${path.includes('?') ? '&' : '?'}terms=1`;
}
