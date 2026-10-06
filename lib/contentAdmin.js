import { clerkClient } from '@clerk/nextjs/server';
import { getSupabase } from './supabase';

// Everything on the platform in one list for /admin/content: every
// episode (any status), every series, every channel upload, with who owns
// it and which channels it's on. Admin / view_all_content only.

const TYPE_LABEL = { series: 'Series episode', movie: 'Film', short: 'Short', vertical: 'Vertical', podcast: 'Podcast', bonus: 'Bonus' };

async function ownerLabels(ids) {
  const real = [...new Set(ids.filter((id) => id && id.startsWith('user_')))];
  const out = {};
  if (!real.length) return out;
  try {
    const client = await clerkClient();
    for (let i = 0; i < real.length; i += 100) {
      const { data } = await client.users.getUserList({ userId: real.slice(i, i + 100), limit: 100 });
      for (const u of data) {
        const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId);
        out[u.id] = primary ? primary.emailAddress : u.id;
      }
    }
  } catch (err) {
    console.error('ownerLabels error:', err.message);
  }
  return out;
}

export async function listAllContent() {
  const supabase = getSupabase();
  const [eps, series, media, slots, loops, channels] = await Promise.all([
    supabase.from('episodes').select('id, title, status, tier, content_type, series_id, season, series_order, submitted_by, thumbnail, poster, created_at, moderation_hold, channel_opt_in, deletion_requested'),
    supabase.from('series').select('id, name, status, creator_id, thumbnail, poster, moderation_hold, channel_opt_in, created_at'),
    supabase.from('channel_media').select('id, title, kind, status, owner_id, thumbnail, moderation_hold, created_at'),
    supabase.from('channel_slots').select('channel_id, episode_id, series_id, media_id'),
    supabase.from('channel_schedule').select('channel_id, episode_id'),
    supabase.from('channels').select('id, name')
  ]);
  for (const r of [eps, series, media, slots, loops, channels]) if (r.error) throw new Error(r.error.message);

  const channelName = Object.fromEntries((channels.data || []).map((c) => [c.id, c.name]));
  const usage = {};
  const use = (key, channelId) => { (usage[key] = usage[key] || new Set()).add(channelName[channelId] || 'Unknown channel'); };
  for (const s of slots.data || []) {
    if (s.episode_id) use(`episode:${s.episode_id}`, s.channel_id);
    if (s.series_id) use(`series:${s.series_id}`, s.channel_id);
    if (s.media_id) use(`channel_media:${s.media_id}`, s.channel_id);
  }
  for (const l of loops.data || []) use(`episode:${l.episode_id}`, l.channel_id);

  const seriesById = Object.fromEntries((series.data || []).map((s) => [s.id, s]));
  const owners = await ownerLabels([
    ...(eps.data || []).map((e) => e.submitted_by),
    ...(series.data || []).map((s) => s.creator_id),
    ...(media.data || []).map((m) => m.owner_id)
  ]);
  const label = (id) => (id ? owners[id] || id : 'Studio Tapa');

  const rows = [];
  for (const e of eps.data || []) {
    const s = e.series_id ? seriesById[e.series_id] : null;
    rows.push({
      type: 'episode',
      id: e.id,
      title: e.title,
      sub: s ? `${s.name}${e.series_order != null ? ` · ${e.season != null ? `S${e.season} ` : ''}E${e.series_order}` : ''}` : null,
      kind: TYPE_LABEL[e.content_type] || e.content_type,
      tier: e.tier,
      status: e.deletion_requested ? 'deletion_requested' : e.status,
      held: !!e.moderation_hold || !!(s && s.moderation_hold),
      optIn: !!e.channel_opt_in || !!(s && s.channel_opt_in),
      ownerId: e.submitted_by || null,
      owner: label(e.submitted_by),
      thumbnail: e.thumbnail || e.poster || (s ? s.thumbnail || s.poster : null),
      channels: [...new Set([...(usage[`episode:${e.id}`] || []), ...(e.series_id ? usage[`series:${e.series_id}`] || [] : [])])],
      createdAt: e.created_at,
      publicHref: e.status === 'approved' ? `/episode/${e.id}` : null
    });
  }
  for (const s of series.data || []) {
    rows.push({
      type: 'series',
      id: s.id,
      title: s.name,
      sub: 'Whole series',
      kind: 'Series',
      tier: null,
      status: s.status,
      held: !!s.moderation_hold,
      optIn: !!s.channel_opt_in,
      ownerId: s.creator_id || null,
      owner: label(s.creator_id),
      thumbnail: s.thumbnail || s.poster || null,
      channels: [...(usage[`series:${s.id}`] || [])],
      createdAt: s.created_at,
      publicHref: s.status === 'approved' ? `/series/${s.id}` : null
    });
  }
  for (const m of media.data || []) {
    rows.push({
      type: 'channel_media',
      id: m.id,
      title: m.title,
      sub: 'Channel upload',
      kind: { bumper: 'Bumper', station_id: 'Station ID', promo: 'Promo', show: 'Channel show' }[m.kind] || 'Channel upload',
      tier: null,
      status: m.status,
      held: !!m.moderation_hold,
      optIn: true,
      ownerId: m.owner_id,
      owner: label(m.owner_id),
      thumbnail: m.thumbnail || null,
      channels: [...(usage[`channel_media:${m.id}`] || [])],
      createdAt: m.created_at,
      publicHref: null
    });
  }
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return rows;
}
