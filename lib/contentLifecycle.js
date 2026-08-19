import { getSupabase } from './supabase';

// Singleton row, same pattern as channel_settings. Falls back to sane
// defaults (2 weeks new, 1 week leaving-soon) if the row is somehow
// missing — this should never actually happen given the migration seeds
// it, but a homepage row silently disappearing because of a missing
// settings row would be a much worse failure mode than just using the
// default.
export async function getLifecycleSettings() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('content_lifecycle_settings')
    .select('new_release_days, leaving_soon_days')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('getLifecycleSettings error:', error.message);
    return { newReleaseDays: 14, leavingSoonDays: 7 };
  }
  return { newReleaseDays: data.new_release_days, leavingSoonDays: data.leaving_soon_days };
}

export async function updateLifecycleSettings({ newReleaseDays, leavingSoonDays }) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('content_lifecycle_settings')
    .update({ new_release_days: newReleaseDays, leaving_soon_days: leavingSoonDays, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw new Error(error.message);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// `availableFrom`/`availableUntil` are ISO strings or null, matching what
// getPublicEpisodes() passes through. All three functions are pure and
// synchronous — the actual settings values come from getLifecycleSettings()
// once per page load, not re-fetched per episode.
export function isNewRelease(availableFrom, newReleaseDays, now = Date.now()) {
  if (!availableFrom) return false;
  const from = new Date(availableFrom).getTime();
  if (Number.isNaN(from) || from > now) return false;
  return now - from <= newReleaseDays * DAY_MS;
}

export function isLeavingSoon(availableUntil, leavingSoonDays, now = Date.now()) {
  if (!availableUntil) return false;
  const until = new Date(availableUntil).getTime();
  if (Number.isNaN(until)) return false;
  return until > now && until - now <= leavingSoonDays * DAY_MS;
}

export function isExpired(availableUntil, now = Date.now()) {
  if (!availableUntil) return false;
  const until = new Date(availableUntil).getTime();
  return !Number.isNaN(until) && until <= now;
}
