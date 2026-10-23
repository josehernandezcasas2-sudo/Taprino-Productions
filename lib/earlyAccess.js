// Early screenings (Jose, 2026-10-12; built 2026-10-23). Pure and
// client-safe: the page and the app read the same answer the server
// computed, nothing here touches the database.
//
// The rule: for EARLY_ACCESS_HOURS after a title is released it plays
// only for the tiers in EARLY_TIERS (Premium and Sponsor), plus admins,
// the title's own creator, and anyone who bought it. Standard gets it a
// day after Premium (its perk line), Basic never gets the early day
// (its "missing" line), and signed-out viewers are Basic. Free titles
// are held too: "early screenings" is a perk of the membership, not of
// the title's tier — Jose to confirm.
//
// "Released" is the later of episodes.released_at (set on approval,
// migration 100; backfilled from available_from / created_at) and
// available_from (a scheduled release counts from when it went live).
export const EARLY_ACCESS_HOURS = 24;
export const EARLY_TIERS = ['premium', 'sponsor'];

const ms = (value) => {
  if (!value) return null;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : null;
};

// When the title became public, as a timestamp in ms; null when unknown
// (an old record with nothing on it plays as usual).
export function releaseTime(episode) {
  if (!episode) return null;
  const times = [ms(episode.releasedAt), ms(episode.availableFrom)].filter((t) => t != null);
  if (times.length) return Math.max(...times);
  return ms(episode.createdAt);
}

export function earlyAccessState(episode, { tier = 'basic', isAdmin = false, isCreator = false, owned = false, now = Date.now() } = {}) {
  const released = releaseTime(episode);
  if (released == null) return { early: false, locked: false, opensAt: null, releasedAt: null };
  const opens = released + EARLY_ACCESS_HOURS * 60 * 60 * 1000;
  const early = now >= released && now < opens;
  const exempt = Boolean(isAdmin || isCreator || owned || EARLY_TIERS.includes(tier));
  return {
    early,
    locked: early && !exempt,
    opensAt: early ? new Date(opens).toISOString() : null,
    releasedAt: new Date(released).toISOString()
  };
}

// "Oct 24 at 3:00 PM PT" — a fixed zone so the server and the browser
// print the same string (hydration), and the studio's own clock.
export function formatOpensAt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
    return `${day} at ${time} PT`;
  } catch (err) {
    return new Date(iso).toISOString();
  }
}
