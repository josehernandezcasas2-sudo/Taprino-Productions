import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { apiGet, apiPost } from '../../lib/api';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, absoluteFill, bannerGradient } from '../../lib/theme';
import ReportSheet from '../../components/ReportSheet';
import SmartImage from '../../components/SmartImage';
import { CrewCardView } from '../../components/CrewBits';

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
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  // A tapped photo post — opened in a plain full-screen viewer below
  // (the website's PostViewerModal has no mobile equivalent yet; video
  // posts still go to /snippets/discover, which is the real reel viewer).
  const [photoPost, setPhotoPost] = useState(null);
  const tokenRef = useRef(null);

  useEffect(() => {
    if (!profileUserId) return undefined;
    let cancelled = false;
    (async () => {
      // Token so the server can tell whether this is the viewer's own
      // profile (isSignedIn / viewerId); never blocks for more than 4s.
      const token = await Promise.race([getToken().catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
      tokenRef.current = token;
      try {
        // /profile/<slug> on the site accepts a user id or an @handle;
        // the API's userId param is the same slug.
        const data = await apiGet(`/api/profile?userId=${encodeURIComponent(profileUserId)}`, token);
        if (!cancelled) {
          setState({ loading: false, error: null, data });
          setFollowing(Boolean(data.viewerFollows));
          setFollowerCount(data.followerCount || 0);
        }
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      }
    })();
    return () => { cancelled = true; };
  }, [profileUserId]);

  function share(profile, canonicalPath) {
    // The nice /profile/<handle> link when one exists, same as the site.
    const url = `${SITE_ORIGIN}${canonicalPath || `/profile/${profile.userId}`}`;
    Share.share({ message: url, url, title: profile.displayName }).catch(() => {});
  }

  function promptSignIn() {
    Alert.alert('Sign in to follow people', 'Following a creator keeps their work close by.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Sign in', onPress: () => router.push('/account') }
    ]);
  }

  async function toggleFollow(profile) {
    if (followBusy) return;
    setFollowBusy(true);
    try {
      const data = await apiPost('/api/profile-follow', { followedId: profile.userId }, tokenRef.current);
      setFollowing(data.following);
      setFollowerCount(data.followers);
    } catch (err) {
      Alert.alert('Could not update that follow', err.message);
    } finally {
      setFollowBusy(false);
    }
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

  const { profile, canonicalPath, creditedWork, pitches, backedPitches, crewCard, totalViews, knownForGenres, roleBadge, posts, savedSnippets, viewerId, isSignedIn } = state.data;
  const initial = profile.displayName && profile.displayName[0] ? profile.displayName[0].toUpperCase() : '?';
  const joinedLabel = profile.joinedAt
    ? new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;
  const isOwnProfile = Boolean(viewerId) && viewerId === profile.userId;

  const statParts = [];
  if (creditedWork.length > 0) statParts.push(`${creditedWork.length} title${creditedWork.length === 1 ? '' : 's'}`);
  if (totalViews > 0) statParts.push(`${formatViews(totalViews)} views`);
  if (followerCount > 0) statParts.push(`${formatViews(followerCount)} follower${followerCount === 1 ? '' : 's'}`);

  function openPost(post) {
    if (post.kind === 'video') router.push(`/snippets/discover?post=${post.id}`);
    else if (post.imageUrl) setPhotoPost(post);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: profile.displayName }} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        {/* Banner (photo > color > default gradient, set on the Account
            screen) with the avatar overlapping its bottom edge, then name /
            @handle and Follow · Share · Report — mirrors the website's
            profile hero (pages/profile/[userId].js). */}
        <View style={styles.hero}>
          <View style={styles.banner}>
            {profile.bannerUrl ? (
              <SmartImage uri={profile.bannerUrl} style={absoluteFill} resizeMode="cover" />
            ) : profile.bannerColor ? (
              <View style={[absoluteFill, { backgroundColor: profile.bannerColor }]} />
            ) : (
              <LinearGradient colors={bannerGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={absoluteFill} />
            )}
          </View>
          <View style={styles.header}>
            {profile.avatarUrl ? (
              <SmartImage uri={profile.avatarUrl} style={styles.avatar} />
            ) : (
              <View style={styles.avatar}><Text style={styles.avatarInitial}>{initial}</Text></View>
            )}
            <View style={styles.nameRow}>
              <Text style={styles.name}>{profile.displayName}</Text>
              {roleBadge ? <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{roleBadge}</Text></View> : null}
            </View>
            {profile.handle ? <Text style={styles.handle}>@{profile.handle}</Text> : null}
            {joinedLabel ? <Text style={styles.joined}>On Studio Tapa TV since {joinedLabel}</Text> : null}
            {statParts.length > 0 ? <Text style={styles.statsText}>{statParts.join(' · ')}</Text> : null}

            <View style={styles.actionsRow}>
              {isOwnProfile ? (
                <Pressable style={styles.actionBtn} onPress={() => router.push('/account')}>
                  <Text style={styles.actionBtnText}>Edit profile</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.actionBtn, following ? styles.actionBtnFollowing : styles.actionBtnPrimary, followBusy && { opacity: 0.6 }]}
                  onPress={isSignedIn ? () => toggleFollow(profile) : promptSignIn}
                  disabled={followBusy}
                  accessibilityState={{ selected: following }}
                >
                  <Text style={[styles.actionBtnText, following ? styles.actionBtnTextFollowing : styles.actionBtnTextPrimary]}>
                    {following ? 'Following' : 'Follow'}
                  </Text>
                </Pressable>
              )}
              {!isOwnProfile ? (
                <Pressable
                  style={styles.actionBtn}
                  onPress={isSignedIn
                    ? () => router.push({ pathname: '/messages/new', params: { to: profile.userId, kind: 'profile', label: profile.displayName } })
                    : () => router.push('/account')}
                >
                  <Text style={styles.actionBtnText}>Message</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.shareBtn} onPress={() => share(profile, canonicalPath)} accessibilityLabel="Share profile">
                <ShareIconSvg size={16} />
              </Pressable>
              {!isOwnProfile && isSignedIn ? (
                <ReportSheet targetType="profile" targetId={profile.userId} title={profile.displayName} />
              ) : null}
            </View>

            {profile.isPlaceholder ? (
              <Text style={styles.placeholderNote}>
                {isOwnProfile
                  ? 'This is how your profile looks right now. Add a name, photo and bio in your account settings.'
                  : 'This person hasn’t set up their profile yet.'}
              </Text>
            ) : null}
          </View>

          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>About</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : (
            <Text style={styles.emptyText}>
              {isOwnProfile ? 'Add a line or two about what you make in your account settings.' : `${profile.displayName} hasn’t written a bio yet.`}
            </Text>
          )}
          {knownForGenres.length > 0 ? (
            <View style={styles.genreRow}>
              <Text style={styles.genreLabel}>Known for</Text>
              {knownForGenres.map((g) => (
                <View key={g} style={styles.genreTag}><Text style={styles.genreTagText}>{g}</Text></View>
              ))}
            </View>
          ) : null}

          {profile.socialLinks.length > 0 ? (
            <View style={styles.linksBox}>
              <Text style={styles.linksBoxLabel}>Links</Text>
              <View style={styles.linksRow}>
                {profile.socialLinks.map((link, i) => (
                  <Pressable key={i} style={styles.linkPill} onPress={() => Linking.openURL(link.url)}>
                    <Text style={styles.linkPillText}>{link.platform || hostnameFor(link.url)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        {/* Crew Call working card — hidden on other people's profiles
            until they set one up; the owner sees the prompt. */}
        {crewCard || isOwnProfile ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Working card</Text>
            {crewCard ? (
              <CrewCardView
                card={crewCard}
                creditedWork={creditedWork}
                isOwn={isOwnProfile}
                onEdit={() => router.push('/crew/card')}
                onFind={() => router.push('/crew')}
                onOpenWork={(w) => router.push(workHref(w))}
              />
            ) : (
              <Pressable onPress={() => router.push('/crew/card')}>
                <Text style={styles.emptyText}>Roles, gear, where you’re based, whether you’re free — so people can find you on Crew Call. <Text style={{ color: colors.olive }}>Set up your card →</Text></Text>
              </Pressable>
            )}
          </>
        ) : null}

        {posts.length > 0 ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Latest post</Text>
            <View style={styles.latestWrap}>
              <PostTile post={posts[0]} onPress={() => openPost(posts[0])} large />
              {posts[0].caption ? <Text style={styles.latestCaption}>{posts[0].caption}</Text> : null}
            </View>
            {posts.length > 1 ? (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Posts</Text>
                <View style={styles.postGrid}>
                  {posts.slice(1).map((post) => (
                    <PostTile key={post.id} post={post} onPress={() => openPost(post)} />
                  ))}
                </View>
              </>
            ) : null}
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
                {item.poster ? <SmartImage uri={item.poster} style={styles.workPoster} /> : <View style={styles.workPoster} />}
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
                  {p.thumbnail ? <SmartImage uri={p.thumbnail} style={styles.pitchThumb} /> : <View style={styles.pitchThumb} />}
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
                  {p.thumbnail ? <SmartImage uri={p.thumbnail} style={styles.pitchThumb} /> : <View style={styles.pitchThumb} />}
                  {p.tag ? <Text style={styles.pitchTag}>{p.tag}</Text> : null}
                  <Text style={styles.pitchTitle} numberOfLines={1}>{p.title}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <PhotoPostViewer post={photoPost} onClose={() => setPhotoPost(null)} />
    </SafeAreaView>
  );
}

// Full-screen look at one photo post: the image shown whole (never
// cropped), caption underneath, tap anywhere or the × to close.
function PhotoPostViewer({ post, onClose }) {
  const { width } = useWindowDimensions();
  if (!post) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewerBackdrop} onPress={onClose}>
        <Pressable style={styles.viewerClose} onPress={onClose} hitSlop={10} accessibilityLabel="Close">
          <Text style={styles.viewerCloseText}>{'×'}</Text>
        </Pressable>
        <SmartImage uri={post.imageUrl} style={{ width: width - 32, height: (width - 32) * 1.25, borderRadius: 10 }} resizeMode="contain" />
        {post.caption ? <Text style={styles.viewerCaption}>{post.caption}</Text> : null}
      </Pressable>
    </Modal>
  );
}

function PostTile({ post, onPress, large }) {
  const imageSrc = post.kind === 'video' ? post.thumbnailUrl : post.imageUrl;
  const tappable = post.kind === 'video' || Boolean(post.imageUrl);
  return (
    <Pressable style={[styles.postTile, large && styles.postTileLarge]} onPress={onPress} disabled={!tappable}>
      {imageSrc ? <SmartImage uri={imageSrc} style={styles.postTileImg} /> : (
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

  hero: { marginBottom: 4 },
  banner: { height: 140, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.hairline },
  header: { alignItems: 'flex-start', marginTop: -44, paddingHorizontal: 8, marginBottom: 6 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', marginBottom: 10, borderWidth: 4, borderColor: colors.surface0, overflow: 'hidden' },
  statsText: { color: colors.inkDim, fontSize: 12.5, marginTop: 2 },
  linksBox: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.hairline, borderRadius: 10, padding: 12, marginTop: 4 },
  linksBoxLabel: { color: colors.inkFaint, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  latestWrap: { maxWidth: 260 },
  latestCaption: { color: colors.inkDim, fontSize: 13.5, lineHeight: 19, marginTop: 8 },
  postTileLarge: { width: '100%' },
  avatarInitial: { color: colors.onBrass, fontSize: 32, fontWeight: '700' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  name: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  roleBadge: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  roleBadgeText: { color: colors.onBrass, fontSize: 10, fontWeight: '700' },
  handle: { color: colors.inkDim, fontSize: 12.5, marginBottom: 2 },
  joined: { color: colors.inkFaint, fontSize: 11.5, marginBottom: 8 },
  placeholderNote: { color: colors.inkDim, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  actionBtn: { paddingVertical: 9, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: colors.hairline },
  actionBtnPrimary: { backgroundColor: colors.brass, borderColor: colors.brass },
  actionBtnFollowing: { borderColor: colors.brass },
  actionBtnText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  actionBtnTextPrimary: { color: colors.onBrass },
  actionBtnTextFollowing: { color: colors.brass },
  viewerBackdrop: { flex: 1, backgroundColor: 'rgba(12,19,31,0.96)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  viewerClose: { position: 'absolute', top: 52, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  viewerCloseText: { color: colors.ink, fontSize: 22, lineHeight: 24 },
  viewerCaption: { color: colors.ink, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 14, paddingHorizontal: 8 },
  genreRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10 },
  genreLabel: { color: colors.inkFaint, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 },
  genreTag: { backgroundColor: colors.surface2, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  genreTagText: { color: colors.inkDim, fontSize: 11 },
  bio: { color: colors.ink, fontSize: 13.5, lineHeight: 20, marginBottom: 10 },
  linksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
