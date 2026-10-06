import { getAccountContext } from './accountContext';
import { getPublicEpisodes } from './publicEpisodes';
import { listChannels, getChannelNow, planChannelDays, channelClock, channelToPublic } from './channelEngine';
import { mergeForGuide } from './channelPlan';

// Shared getServerSideProps for /live (main channel) and /live/[slug].
export async function getLivePageProps({ req, res, slug }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  const base = {
    mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator
  };

  let channels;
  try {
    channels = await listChannels();
  } catch (err) {
    console.error('live page: channels unavailable:', err.message);
    return { props: { ...base, unavailable: true } };
  }
  const channel = slug ? channels.find((c) => c.slug === slug) : channels[0];
  if (!channel) {
    if (slug) return { notFound: true };
    return { props: { ...base, unavailable: true } };
  }

  const at = new Date();
  const today = channelClock(at).date;
  const [nowStates, days] = await Promise.all([
    Promise.all(channels.map((c) => getChannelNow(c, at).catch(() => null))),
    planChannelDays(channel, [today], { includeLive: true, at })
  ]);
  const nowIndex = channels.findIndex((c) => c.id === channel.id);

  return {
    props: {
      ...base,
      channels: channels.map((c, i) => ({
        ...channelToPublic(c),
        nowTitle: nowStates[i] ? (nowStates[i].live ? nowStates[i].live.title : nowStates[i].program ? (nowStates[i].program.seriesName || nowStates[i].program.title) : null) : null,
        isLive: !!(nowStates[i] && nowStates[i].live)
      })),
      channel: channelToPublic(channel),
      initialNow: JSON.parse(JSON.stringify(nowStates[nowIndex] || { onAir: false, serverTime: at.toISOString() })),
      initialGuide: { date: today, today, segments: mergeForGuide(days[today]) },
      nowSec: channelClock(at).sec
    }
  };
}
