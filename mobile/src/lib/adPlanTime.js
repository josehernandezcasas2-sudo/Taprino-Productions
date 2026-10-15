// Mirror of the two air-time helpers in lib/adPlanRules.js on the website.
// A ready ad plan makes a live program longer than its video: the channel
// counts air seconds, the video counts its own. `breaks` come from
// /api/channel/play as [{ index, at, booked, airStart, airEnd }].

export function airToEpisode(airOffset, breaks) {
  const air = Math.max(0, Number(airOffset) || 0);
  let shift = 0;
  for (const b of breaks || []) {
    if (air < b.airStart) break;
    if (air < b.airEnd) return { episodeSeconds: b.at, inBreak: { index: b.index, at: b.at, elapsed: air - b.airStart, remaining: b.airEnd - air, booked: b.booked } };
    shift += b.booked;
  }
  return { episodeSeconds: air - shift, inBreak: null };
}

export function episodeToAir(episodeSeconds, breaks) {
  const ep = Math.max(0, Number(episodeSeconds) || 0);
  return ep + (breaks || []).filter((b) => b.at <= ep).reduce((s, b) => s + b.booked, 0);
}
