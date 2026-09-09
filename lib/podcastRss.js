import { getSupabase } from './supabase';
import { findSeries } from './series';
import { parseRuntimeToSeconds } from './videoMetadata';
import { SITE } from './siteConfig';

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

const MIME_BY_EXTENSION = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  weba: 'audio/webm'
};

function guessAudioMimeType(url) {
  const match = /\.([a-z0-9]+)(?:\?|$)/i.exec(url || '');
  const ext = match ? match[1].toLowerCase() : '';
  return MIME_BY_EXTENSION[ext] || 'audio/mpeg';
}

// Fallback for episodes imported before audio_bytes existed as a column
// (migration 052) — a HEAD request reads Content-Length without
// downloading the file. Best-effort: if this fails or the host doesn't
// return a length, the enclosure gets a 0 rather than blocking the whole
// feed from generating over one old episode.
async function getByteLengthFallback(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
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
    .select('id, title, description, runtime, audio_url, audio_bytes, created_at, series_order, season, artist')
    .eq('series_id', seriesId)
    .eq('content_type', 'podcast')
    .eq('status', 'approved')
    .eq('deletion_requested', false)
    .eq('tier', 'free')
    .not('audio_url', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('generatePodcastRssFeed error:', error.message);
    return null;
  }
  if (!rows || rows.length === 0) return null;

  const showUrl = `${siteUrl}/podcasts/${seriesId}`;
  const artwork = show.poster || show.thumbnail;
  // Same approach as the show page itself (pages/podcasts/[id].js) — the
  // series/show row has no creator-name field of its own, so the host is
  // read off whichever episode happens to be in this list (rows are
  // newest-first, but every episode of a show should share the same
  // artist/host value regardless of order).
  const host = (rows[0] && rows[0].artist) || SITE.name;

  const items = await Promise.all(rows.map(async (row) => {
    const bytes = row.audio_bytes || (await getByteLengthFallback(row.audio_url));
    const mimeType = guessAudioMimeType(row.audio_url);
    const episodeUrl = `${showUrl}#${row.id}`;
    return `    <item>
      <title>${escapeXml(row.title)}</title>
      <description>${escapeXml(row.description || '')}</description>
      <itunes:summary>${escapeXml(row.description || '')}</itunes:summary>
      <link>${escapeXml(episodeUrl)}</link>
      <guid isPermaLink="false">${escapeXml(row.id)}</guid>
      <pubDate>${toRfc2822(row.created_at)}</pubDate>
      <enclosure url="${escapeXml(row.audio_url)}" length="${bytes}" type="${mimeType}" />
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
