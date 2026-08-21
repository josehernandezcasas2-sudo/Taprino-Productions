import { XMLParser } from 'fast-xml-parser';

// Normalizes a standard podcast RSS feed (RSS 2.0 + the iTunes podcast
// namespace most hosts use — Spotify for Podcasters, Buzzsprout,
// Libsyn, Anchor, etc. all export this same shape) into the fields this
// app actually needs. Deliberately tolerant: a feed missing iTunes-
// specific tags (season/episode number, duration) still imports fine,
// just without that metadata pre-filled.
export function parsePodcastFeed(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'item'
  });

  let data;
  try {
    data = parser.parse(xmlText);
  } catch (err) {
    throw new Error('That doesn\u2019t look like a valid RSS feed — could not parse the XML.');
  }

  const channel = data && data.rss && data.rss.channel;
  if (!channel) {
    throw new Error('That doesn\u2019t look like a podcast RSS feed — no <channel> found.');
  }

  const items = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);
  if (items.length === 0) {
    throw new Error('That feed has no episodes in it.');
  }

  const showImage =
    (channel['itunes:image'] && channel['itunes:image']['@_href']) ||
    (channel.image && channel.image.url) ||
    null;

  const episodes = items.map((item, i) => {
    const enclosure = item.enclosure;
    const audioUrl = enclosure && enclosure['@_url'] ? enclosure['@_url'] : null;
    const durationRaw = item['itunes:duration'];
    return {
      guid: (item.guid && (item.guid['#text'] || item.guid)) || `item-${i}`,
      title: stripHtml(item.title) || `Untitled episode ${i + 1}`,
      description: stripHtml(item.description || item['itunes:summary'] || ''),
      audioUrl,
      pubDate: item.pubDate || null,
      season: item['itunes:season'] ? Number(item['itunes:season']) : null,
      episodeNumber: item['itunes:episode'] ? Number(item['itunes:episode']) : null,
      runtime: formatDuration(durationRaw)
    };
  });

  return {
    showTitle: stripHtml(channel.title) || 'Imported podcast',
    showDescription: stripHtml(channel.description || ''),
    showImage,
    episodes
  };
}

function stripHtml(value) {
  if (!value) return '';
  const text = typeof value === 'object' ? (value['#text'] || '') : String(value);
  return text.replace(/<[^>]*>/g, '').trim();
}

function formatDuration(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  if (/^\d+$/.test(str)) {
    const totalSeconds = Number(str);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return str;
}
