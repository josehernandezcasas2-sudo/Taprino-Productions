import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { apiGet } from '../../lib/api';
import { colors } from '../../lib/theme';

const SITE_ORIGIN = 'https://studiotapatv.site';

function ShareIconSvg({ size = 17 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 15V4" />
      <Path d="M8 8l4-4 4 4" />
      <Path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
    </Svg>
  );
}
function VideoCameraIconSvg({ size = 12, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="2.5" y="6.5" width="13" height="11" rx="1.8" />
      <Path d="M15.5 10.5l6-3.3v9.6l-6-3.3z" />
    </Svg>
  );
}
function ImageIconSvg({ size = 12, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <Path d="M4 17l5-5 4 4 3-3 4 4" />
    </Svg>
  );
}

function hostnameFor(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return 'Link';
  }
}
function workTypeLabel(item) {
  if (item.contentType === 'series' || item.type === 'series') return 'Series';
  if (item.contentType === 'movie') return 'Film';
  if (item.contentType === 'podcast') return 'Podcast';
  return 'Short';
}
function workHref(item) {
  return item.type === 'series' ? `/series/${item.id}` : `/episode/${item.id}`;
}
function formatViews(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 >= 100000 ? 1 : 0)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}K`;
  return String(n);
}
function formatRuntime(totalSeconds) {
  const secs = Math.round(totalSeconds);
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Mirrors pages/profile/[userId].js — header (avatar, role badge, joined
// date, stats, known-for genres, bio, social links, share), Posts,
// Saved Snippets (own profile only), "Tagged in" credited work, Pitch
// Room projects created, and projects backed. A post tile opens
// /snippets/discover?post=<id> (the full reel viewer) instead of an
// in-place Instagram-style modal like the website's PostViewerModal —
// only video posts are tappable this way, since that's the only kind
// with a mobile viewer; a photo tile just isn't interactive yet.
export default function PublicProfile() {
  const { userId: profileUserId } = useLocalSearchParams();
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    if (!profileUserId) return undefined;
    let cancelled = false;
    apiGet(`/api/profile?userId=${encodeURIComponent(profileUserId)}`)
      .then((data) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, data: null }); });
    return () => { cancelled = true; };
  }, [profileUserId]);

  function share(profile) {
    const url = `${SITE_ORIGIN}/profile/${profile.userId}`;
    Share.share({ message: url, url, title: profile.displayName }).catch(() => {});
  }

  if (state.loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.brass} />
      </SafeAreaView>
    );
  }
  if (state.error || !state.data) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.errorText}>Couldn't load this profile: {state.error || 'not found'}</Text>
      </SafeAreaView>
    );
  }

  const { profile, creditedWork, pitches, backedPitches, totalViews, knownForGenres, roleBadge, posts, savedSnippets, viewerId } = state.data;
  const initial = profile.displayName && profile.displayName[0] ? profile.displayName[0].toUpperCase() : '?';
  const joinedLabel = profile.joinedAt
    ? new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;
  const isOwnProfile = Boolean(viewerId) && viewerId === profile.userId;

  function openPost(post) {
    if (post.kind === 'video') router.push(`/snippets/discover?post=${post.id}`);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: profile.displayName }} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          {profile.avatarUrl ? (
            <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatar}><Text style={styles.avatarInitial}>{initial}</Text></View>
          )}
          <View style={styles.nameRow}>
            <Text style={styles.name}>{profile.displayName}</Text>
            {roleBadge ? <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{roleBadge}</Text></View> : null}
          </View>
          {joinedLabel ? <Text style={styles.joined}>On Studio Tapa TV since {joinedLabel}</Text> : null}

          {creditedWork.length > 0 || totalViews > 0 ? (
            <View style={styles.statsRow}>
              <Text style={styles.statsText}>{creditedWork.length} title{creditedWork.length === 1 ? '' : 's'}</Text>
              {totalViews > 0 ? <Text style={styles.statsText}> · {formatViews(totalViews)} views</Text> : null}
            </View>
          ) : null}

          {knownForGenres.length > 0 ? (
            <View style={styles.genreRow}>
              <Text style={styles.genreLabel}>Known for</Text>
              {knownForGenres.map((g) => (
                <View key={g} style={styles.genreTag}><Text style={styles.genreTagText}>{g}</Text></View>
              ))}
            </View>
          ) : null}

          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          {profile.socialLinks.length > 0 ? (
            <View style={styles.linksRow}>
              {profile.socialLinks.map((link, i) => (
                <Pressable key={i} style={styles.linkPill} onPress={() => Linking.openURL(link.url)}>
                  <Text style={styles.linkPillText}>{link.platform || hostnameFor(link.url)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Pressable style={styles.shareBtn} onPress={() => share(profile)}>
            <ShareIconSvg size={16} />
          </Pressable>
        </View>

        {posts.length > 0 ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Posts</Text>
            <View style={styles.postGrid}>
              {posts.map((post) => (
                <PostTile key={post.id} post={post} onPress={() => openPost(post)} />
              ))}
            </View>
          </>
        ) : null}

        {isOwnProfile && savedSnippets.length > 0 ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Saved Snippets</Text>
            <View style={styles.postGrid}>
              {savedSnippets.map((post) => (
                <PostTile key={post.id} post={post} onPress={() => openPost(post)} />
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>Tagged in</Text>
        {creditedWork.length === 0 ? (
          <Text style={styles.emptyText}>Nothing tagged here yet — this fills in once {profile.displayName} is credited on something.</Text>
        ) : (
          <View style={styles.workGrid}>
            {creditedWork.map((item) => (
              <Pressable key={`${item.type}-${item.id}`} style={styles.workItem} onPress={() => router.push(workHref(item))}>
                {item.poster ? <Image source={{ uri: item.poster }} style={styles.workPoster} /> : <View style={styles.workPoster} />}
                <Text style={styles.workTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.workType}>{workTypeLabel(item)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {pitches.length > 0 ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Pitch Room projects</Text>
            <View style={styles.pitchGrid}>
              {pitches.map((p) => (
                <Pressable key={p.id} style={styles.pitchCard} onPress={() => router.push(`/pitches/${p.id}`)}>
                  {p.thumbnail ? <Image source={{ uri: p.thumbnail }} style={styles.pitchThumb} /> : <View style={styles.pitchThumb} />}
                  {p.tag ? <Text style={styles.pitchTag}>{p.tag}</Text> : null}
                  <Text style={styles.pitchTitle} numberOfLines={1}>{p.title}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {backedPitches.length > 0 ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Projects backed</Text>
            <View style={styles.pitchGrid}>
              {backedPitches.map((p) => (
                <Pressable key={p.id} style={styles.pitchCard} onPress={() => router.push(`/pitches/${p.id}`)}>
                  {p.thumbnail ? <Image source={{ uri: p.thumbnail }} style={styles.pitchThumb} /> : <View style={styles.pitchThumb} />}
                  {p.tag ? <Text style={styles.pitchTag}>{p.tag}</Text> : null}
                  <Text style={styles.pitchTitle} numberOfLines={1}>{p.title}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PostTile({ post, onPress }) {
  const imageSrc = post.kind === 'video' ? post.thumbnailUrl : post.imageUrl;
  return (
    <Pressable style={styles.postTile} onPress={onPress} disabled={post.kind !== 'video'}>
      {imageSrc ? <Image source={{ uri: imageSrc }} style={styles.postTileImg} /> : (
        <View style={[styles.postTileImg, styles.postTileCaptionWrap]}>
          <Text style={styles.postTileCaptionText} numberOfLines={4}>&ldquo;{post.caption}&rdquo;</Text>
        </View>
      )}
      <View style={styles.postTileBadge}>
        {post.kind === 'video' ? (
          <>
            <VideoCameraIconSvg size={11} />
            {post.durationSeconds != null ? <Text style={styles.postTileBadgeText}> {formatRuntime(post.durationSeconds)}</Text> : null}
          </>
        ) : (
          <ImageIconSvg size={11} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  emptyText: { color: colors.inkDim, fontSize: 13, lineHeight: 19 },

  header: { alignItems: 'flex-start', marginBottom: 6 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarInitial: { color: colors.ink, fontSize: 28, fontWeight: '700' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  name: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  roleBadge: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  roleBadgeText: { color: colors.onBrass, fontSize: 10, fontWeight: '700' },
  joined: { color: colors.inkFaint, fontSize: 11.5, marginBottom: 8 },
  statsRow: { flexDirection: 'row', marginBottom: 8 },
  statsText: { color: colors.inkDim, fontSize: 12.5 },
  genreRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10 },
  genreLabel: { color: colors.inkFaint, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 },
  genreTag: { backgroundColor: colors.surface2, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  genreTagText: { color: colors.inkDim, fontSize: 11 },
  bio: { color: colors.ink, fontSize: 13.5, lineHeight: 20, marginBottom: 10 },
  linksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  linkPill: { borderWidth: 1, borderColor: colors.hairline, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  linkPillText: { color: colors.olive, fontSize: 12, fontWeight: '600' },
  shareBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },

  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 18 },
  sectionLabel: { color: colors.ink, fontSize: 14, fontWeight: '700', marginBottom: 10 },

  postGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  postTile: { width: '31.5%', aspectRatio: 9 / 16, position: 'relative' },
  postTileImg: { width: '100%', height: '100%', borderRadius: 6, backgroundColor: colors.surface2 },
  postTileCaptionWrap: { alignItems: 'center', justifyContent: 'center', padding: 10 },
  postTileCaptionText: { color: colors.inkDim, fontSize: 10.5, textAlign: 'center', fontStyle: 'italic' },
  postTileBadge: { position: 'absolute', bottom: 5, left: 5, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(12,19,31,0.75)', borderRadius: 999, paddingVertical: 2, paddingHorizontal: 6 },
  postTileBadgeText: { color: colors.ink, fontSize: 9 },

  workGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  workItem: { width: '30%' },
  workPoster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: colors.surface2, marginBottom: 5 },
  workTitle: { color: colors.ink, fontSize: 11.5, fontWeight: '700' },
  workType: { color: colors.inkFaint, fontSize: 10, marginTop: 1 },

  pitchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  pitchCard: { width: '47%' },
  pitchThumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: colors.surface2, marginBottom: 6 },
  pitchTag: { color: colors.brass, fontSize: 10, fontWeight: '700', marginBottom: 2 },
  pitchTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' }
});
