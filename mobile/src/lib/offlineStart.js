// The app opened with no connection and copies on the phone, so it went
// straight to Downloads (components/downloads/DownloadsBoot.js). No
// imports: the home screen asks here before its own launch redirect
// ("Here only for the stream?"), so the two never pull against each other.
let offline = false;

export function markOfflineStart() {
  offline = true;
}

export function startedOffline() {
  return offline;
}
