// Early screenings — the app's copy of the website's lib/earlyAccess.js
// formatter. The rule itself runs on the server: /api/episode-page sends
// `earlyAccess: { early, locked, opensAt }` and /api/stream-token refuses
// a locked title with a message that starts "Early screening".
export const EARLY_ACCESS_HOURS = 24;

// "Oct 24 at 3:00 PM PT" — the studio's clock, same as the website.
export function formatOpensAt(iso) {
  if (!iso) return 'tomorrow';
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
    return `${day} at ${time} PT`;
  } catch (err) {
    return 'tomorrow';
  }
}
