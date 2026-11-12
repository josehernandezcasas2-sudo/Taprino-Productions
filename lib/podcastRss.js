import { getSupabase } from './supabase';
import { findSeries } from './series';
import { parseRuntimeToSeconds } from './videoMetadata';
import { SITE, SITE_PUBLIC_ORIGIN } from './siteConfig';
import { getRatings } from './ratings';
import { termsWouldClear } from './ageGate';
import { safeFetch } from './safeFetch';
import { audioExtensionOf, audioMimeType, audioStoragePath, rssListsEpisode } from './podcastAudioRules';
import { audioRoutePath, storedAudioBytes } from './podcastAudio';

// XML text-content escaping. Apple's own guidance explicitly warns against
// HTML-style entities (&rsquo; etc.) — only the five predefined XML
// entities are safe here.
function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// RFC 2822, with an explicit numeric zone offset ("+0000") rather than a
// named zone like "GMT" — named zones are legacy/obsolete per the RFC and
// some feed validators flag them, while every timestamp in this database
// is already UTC so the offset is always +0000.
function toRfc2822(isoString) {
  const d = new Date(isoString);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

// itunes:duration accepts either raw seconds or HH:MM:SS — HH:MM:SS is
// the more universally-rendered form across podcast apps, so this always
// reformats to it rather than passing the site's own runtime string
// through unchanged (which is sometimes MM:SS, sometimes H:MM:SS,
// inconsistent in a way a strict feed parser won't forgive).
function toItunesDuration(runtime) {
  const totalSeconds = parseRuntimeToSeconds(runtime) || 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Fallback for episodes imported before audio_bytes existed as a column
// (migration 052) — a HEAD request reads Content-Length without
// downloading the file. Best-effort: if this fails or the host doesn't
// return a length, the enclosure gets a 0 rather than blocking the whole
// feed from generating over one old episode. A file in our own bucket is
// asked through a short signed link (the bucket is private since
// 2026-11-12, lib/podcastAudio.js).
async function getByteLengthFallback(url) {
  if (audioStoragePath(url, process.env.SUPABASE_URL)) return storedAudioBytes(url);
  try {
    // A stored audio link a creator supplied: same public-address check.
    const res = await safeFetch(url, { method: 'HEAD' });
    const len = Number(res.headers.get('content-length') || 0);
    return len > 0 ? len : 0;
  } catch {
    return 0;
  }
}

// Generates a complete RSS 2.0 + iTunes-namespace XML document for one
// podcast show's free-tier episodes. Premium episodes are deliberately
// excluded — RSS has no concept of a paywall or login, so anything in a
// feed is downloadable by anyone who has the feed URL. Returns null if
// the show doesn't exist or has no free-tier podcast episodes to list.
export async function generatePodcastRssFeed(seriesId, siteUrl) {
  const show = await findSeries(seriesId);
  if (!show) return null;

  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('episodes')
    .select('id, title, description, runtime, content_type, status, tier, audio_url, audio_bytes, created_at, series_order, season, artist, rating, available_until, moderation_hold, deletion_requested, withdrawn_at')
    .eq('series_id', seriesId)
    .eq('content_type', 'podcast')
    .eq('status', 'approved')
    .eq('deletion_requested', false).eq('moderation_hold', false)
    .eq('tier', 'free')
    .not('audio_url', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('generatePodcastRssFeed error:', error.message);
    return null;
  }
  // The feed has no viewer, so it carries what the show page gives a
  // listener with no age on file who has taken the viewing terms: anything
  // under 17+ (lib/ageGate.js), and nothing past its availability date.
  // The same rule /api/podcasts/audio/<id> uses to let anyone download an
  // episode the feed lists (lib/podcastAudioRules.js rssListsEpisode), so
  // the feed never lists a file the route then refuses.
  const ratings = await getRatings();
  const now = Date.now();
  const audible = (rows || []).filter((row) => rssListsEpisode(row, { showPublic: true, termsClear: termsWouldClear(row.rating, ratings), now }));
  if (audible.length === 0) return null;

  const showUrl = `${siteUrl}/podcasts/${seriesId}`;
  const artwork = show.poster || show.thumbnail;
  // Same approach as the show page itself (pages/podcasts/[id].js) — the
  // series/show row has no creator-name field of its own, so the host is
  // read off whichever episode happens to be in this list (rows are
  // newest-first, but every episode of a show should share the same
  // artist/host value regardless of order).
  const host = (audible[0] && audible[0].artist) || SITE.name;

  // Each enclosure is our own route on the www host, not the stored file
  // (Jose, 2026-11-12): the route answers with a link that lasts a few
  // hours, and the address in the feed never changes, so podcast apps
  // keep their downloads.
  const items = await Promise.all(audible.map(async (row) => {
    const bytes = row.audio_bytes || (await getByteLengthFallback(row.audio_url));
    const mimeType = audioMimeType(audioExtensionOf(row.audio_url));
    const enclosureUrl = `${SITE_PUBLIC_ORIGIN}${audioRoutePath(row.id, row.audio_url)}`;
    const episodeUrl = `${showUrl}#${row.id}`;
    return `    <item>
      <title>${escapeXml(row.title)}</title>
      <description>${escapeXml(row.description || '')}</description>
      <itunes:summary>${escapeXml(row.description || '')}</itunes:summary>
      <link>${escapeXml(episodeUrl)}</link>
      <guid isPermaLink="false">${escapeXml(row.id)}</guid>
      <pubDate>${toRfc2822(row.created_at)}</pubDate>
      <enclosure url="${escapeXml(enclosureUrl)}" length="${bytes}" type="${mimeType}" />
      <itunes:duration>${toItunesDuration(row.runtime)}</itunes:duration>
      ${row.season ? `<itunes:season>${row.season}</itunes:season>` : ''}
      ${row.series_order ? `<itunes:episode>${row.series_order}</itunes:episode>` : ''}
      <itunes:explicit>false</itunes:explicit>
    </item>`;
  }));

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${escapeXml(show.name)}</title>
    <link>${escapeXml(showUrl)}</link>
    <description>${escapeXml(show.desc || `${show.name} on ${SITE.name}.`)}</description>
    <language>en-us</language>
    <itunes:author>${escapeXml(host)}</itunes:author>
    <itunes:owner>
      <itunes:name>${escapeXml(SITE.name)}</itunes:name>
      <itunes:email>${escapeXml(SITE.contactEmail)}</itunes:email>
    </itunes:owner>
    ${artwork ? `<itunes:image href="${escapeXml(artwork)}" />` : ''}
    <itunes:category text="Arts" />
    <itunes:explicit>false</itunes:explicit>
${items.join('\n')}
  </channel>
</rss>`;
}
