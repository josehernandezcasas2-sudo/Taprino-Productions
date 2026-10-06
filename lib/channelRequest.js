import { getChannelBySlug, listChannels } from './channelEngine';

// Resolves ?channel=<slug> for the public channel endpoints. No slug = the
// main channel (lowest number). Drafts are never served publicly.
export async function resolvePublicChannel(slug) {
  if (slug && typeof slug === 'string') {
    const channel = await getChannelBySlug(slug);
    return channel && channel.visibility === 'public' ? channel : null;
  }
  const channels = await listChannels();
  return channels[0] || null;
}
