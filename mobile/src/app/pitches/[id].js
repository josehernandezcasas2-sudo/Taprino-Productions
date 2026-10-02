import { useAuth } from '@clerk/expo';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { colors, fonts, absoluteFill } from '../../lib/theme';
import SmartImage from '../../components/SmartImage';

const SITE_ORIGIN = 'https://studiotapatv.site';
const DONATION_PRESETS = [10, 25, 50];
const REPORT_REASONS = ['Spam', 'Harassment', 'Off-topic', 'Other'];

function HeartIcon({ active, size = 17 }) {
  return active ? (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={colors.danger}>
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  ) : (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </Svg>
  );
}
function ShareIconSvg({ size = 17 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 15V4" />
      <Path d="M8 8l4-4 4 4" />
      <Path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
    </Svg>
  );
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

function formatCommentDate(iso) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function countComments(list) {
  return list.reduce((sum, c) => sum + 1 + (c.replies ? c.replies.length : 0), 0);
}

// Same data and features as pages/pitches/[id].js (lib/pitchDetailHub.js
// via /api/pitch-detail): funding progress + donations, save, share,
// description/team/photos/updates/backers/similar projects, and the full
// one-level comment system (post, reply, edit, delete, report). Laid out
// for a phone: full-bleed hero with the title over the art and floating
// back/save/share buttons (no native header), a funding card with the
// big numbers, then numbered sections in the site's mono-eyebrow voice.
export default function PitchDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const tokenRef = useRef(null);
  const insets = useSafeAreaInsets();

  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [saved, setSaved] = useState(false);
  const [commentList, setCommentList] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [reportedIds, setReportedIds] = useState(new Set());
  const [reportingId, setReportingId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [postingReply, setPostingReply] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [donationAmount, setDonationAmount] = useState('');
  const [donating, setDonating] = useState(false);
  const [donationError, setDonationError] = useState(null);
  const [donationSuccess, setDonationSuccess] = useState(false);
  const [currentTotalRaisedCents, setCurrentTotalRaisedCents] = useState(null);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const token = await withTimeout(getToken().catch(() => null), 4000);
        tokenRef.current = token;
        const data = await apiGet(`/api/pitch-detail?id=${encodeURIComponent(id)}`, token);
        if (cancelled) return;
        setState({ loading: false, error: null, data });
        setSaved(data.initialSaved);
        setCommentList(data.comments);
        setCurrentTotalRaisedCents(data.totalRaisedCents);
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  async function toggleSave() {
    if (!state.data?.isSignedIn) return;
    setSaved((s) => !s);
    apiPost('/api/pitch-save', { pitchId: id }, tokenRef.current).catch(() => {});
  }

  async function donate(pitchId) {
    setDonationError(null);
    const amount = Number(donationAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDonationError('Enter an amount greater than $0.');
      return;
    }
    setDonating(true);
    try {
      const data = await apiPost('/api/pitches/donate', { pitchId, amountDollars: amount }, tokenRef.current);
      setCurrentTotalRaisedCents((prev) => (prev || 0) + data.donation.amountCents);
      setDonationAmount('');
      setDonationSuccess(true);
      setTimeout(() => setDonationSuccess(false), 4000);
    } catch (err) {
      setDonationError(err.message);
    } finally {
      setDonating(false);
    }
  }

  function promptSignIn() {
    Alert.alert('Sign in to save projects', 'Saved projects notify you when the creator posts an update.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Sign in', onPress: () => router.push('/account') }
    ]);
  }

  function share(pitch) {
    const url = `${SITE_ORIGIN}/pitches/${pitch.id}`;
    Share.share({ message: url, url, title: pitch.title }).catch(() => {});
  }

  async function refreshComments() {
    try {
      const data = await apiGet(`/api/pitch-comments?pitchId=${id}`);
      setCommentList(data.comments);
    } catch {
      // Non-fatal — the list just stays as whatever it already was.
    }
  }

  async function postComment() {
    if (!commentText.trim()) return;
    setPosting(true);
    setCommentError(null);
    try {
      await apiPost('/api/pitch-comment', { pitchId: id, body: commentText }, tokenRef.current);
      setCommentText('');
      await refreshComments();
    } catch (err) {
      setCommentError(err.message);
    } finally {
      setPosting(false);
    }
  }

  async function postReply(parentCommentId) {
    if (!replyText.trim()) return;
    setPostingReply(true);
    setCommentError(null);
    try {
      await apiPost('/api/pitch-comment', { pitchId: id, body: replyText, parentCommentId }, tokenRef.current);
      setReplyText('');
      setReplyingTo(null);
      await refreshComments();
    } catch (err) {
      setCommentError(err.message);
    } finally {
      setPostingReply(false);
    }
  }

  async function reportComment(commentId, reason) {
    setReportingId(null);
    setReportedIds((prev) => new Set(prev).add(commentId));
    apiPost('/api/pitch-comment-report', { commentId, reason }, tokenRef.current).catch(() => {});
  }

  function startEdit(c) {
    setEditingId(c.id);
    setEditText(c.body);
    setEditError(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditText('');
    setEditError(null);
  }
  async function saveEdit(commentId) {
    if (!editText.trim()) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await apiPatch('/api/pitch-comment', { commentId, body: editText }, tokenRef.current);
      setEditingId(null);
      setEditText('');
      await refreshComments();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  }

  function deleteComment(commentId) {
    Alert.alert('Delete this comment?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(commentId);
          try {
            await apiDelete('/api/pitch-comment', { commentId }, tokenRef.current);
            await refreshComments();
          } catch {
            Alert.alert('Could not delete that comment', 'Try again.');
          } finally {
            setDeletingId(null);
          }
        }
      }
    ]);
  }

  if (state.loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.brass} />
      </View>
    );
  }
  if (state.error || !state.data) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.errorText}>Couldn't load this pitch: {state.error || 'not found'}</Text>
        <Pressable style={[styles.ghostBtn, { marginTop: 16 }]} onPress={() => (router.canGoBack() ? router.back() : router.replace('/pitches'))}>
          <Text style={styles.ghostBtnText}>Back to the Pitch Room</Text>
        </Pressable>
      </View>
    );
  }

  const { pitch, similar, updates, recentBackers, backerCount, isSignedIn, userId, bypassingDisabled, creatorAvatarUrl, creatorDisplayName } = state.data;
  const creatorName = pitch.creator_name || creatorDisplayName;

  const raisedForPct = pitch.funding_enabled ? (currentTotalRaisedCents || 0) / 100 : (pitch.funding_raised || 0);
  const pct = pitch.funding_goal ? Math.min(100, Math.round((raisedForPct / pitch.funding_goal) * 100)) : null;
  const raisedLabel = pitch.funding_enabled
    ? `$${raisedForPct.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${Number(raisedForPct).toLocaleString()}`;

  const remaining = (() => {
    if (!pitch.funding_deadline) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(`${pitch.funding_deadline}T00:00:00`);
    const diffDays = Math.round((deadline - today) / 86400000);
    return diffDays < 0 ? null : Math.max(1, diffDays);
  })();

  // Numbered section eyebrows ("01 — The project"), same voice as the
  // About page; numbered in render order so skipped sections don't leave
  // gaps.
  let sectionNo = 0;
  function sectionLabel(text) {
    sectionNo += 1;
    return <Text style={styles.sectionLabel}>{String(sectionNo).padStart(2, '0')} — {text}</Text>;
  }

  const heroArt = pitch.hero_image || pitch.thumbnail;
  const hasFundingCard = pct !== null || pitch.funding_enabled || Boolean(pitch.project_url) || remaining !== null;

  function renderComment(c, isReply = false) {
    const isOwn = Boolean(userId) && c.user_id === userId;
    const isCreatorComment = Boolean(pitch.created_by) && c.user_id === pitch.created_by;
    const isEditing = editingId === c.id;

    return (
      <View key={c.id} style={[styles.commentCard, isReply && styles.replyCard]}>
        <Pressable style={styles.commentMetaRow} onPress={() => router.push(`/profile/${c.user_id}`)}>
          <View style={styles.commentAvatar}>{c.avatarUrl ? <SmartImage uri={c.avatarUrl} style={absoluteFill} /> : <Text style={styles.commentAvatarText}>{(c.displayName || '?')[0].toUpperCase()}</Text>}</View>
          <Text style={styles.commentName}>{c.displayName}</Text>
          {isCreatorComment ? <View style={styles.creatorBadge}><Text style={styles.creatorBadgeText}>Creator</Text></View> : null}
          <Text style={styles.commentDate}> · {formatCommentDate(c.created_at)}{c.updated_at ? ' · edited' : ''}</Text>
        </Pressable>

        {isEditing ? (
          <View style={styles.editForm}>
            {editError ? <Text style={styles.errorTextSm}>{editError}</Text> : null}
            <TextInput style={styles.textarea} value={editText} onChangeText={setEditText} multiline maxLength={1000} />
            <Text style={styles.charCount}>{editText.length}/1000</Text>
            <View style={styles.formActions}>
              <Pressable style={styles.smallPrimaryBtn} disabled={editSaving} onPress={() => saveEdit(c.id)}>
                <Text style={styles.smallPrimaryBtnText}>{editSaving ? 'Saving…' : 'Save'}</Text>
              </Pressable>
              <Pressable style={styles.smallSecondaryBtn} onPress={cancelEdit}>
                <Text style={styles.smallSecondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={styles.commentBody}>{c.body}</Text>
        )}

        {!isEditing ? (
          <View style={styles.commentActions}>
            {isSignedIn && !isReply ? (
              <Pressable onPress={() => { setReplyingTo(replyingTo === c.id ? null : c.id); setReplyText(''); }}>
                <Text style={styles.commentActionText}>↩ Reply</Text>
              </Pressable>
            ) : null}
            {isOwn ? (
              <>
                <Pressable onPress={() => startEdit(c)}><Text style={styles.commentActionText}>Edit</Text></Pressable>
                <Pressable onPress={() => deleteComment(c.id)} disabled={deletingId === c.id}>
                  <Text style={[styles.commentActionText, { color: colors.danger }]}>{deletingId === c.id ? 'Deleting…' : 'Delete'}</Text>
                </Pressable>
              </>
            ) : null}
            {isSignedIn && !isOwn ? (
              reportedIds.has(c.id) ? (
                <Text style={styles.reportedText}>Reported — thank you.</Text>
              ) : reportingId === c.id ? (
                <View style={styles.reportPicker}>
                  {REPORT_REASONS.map((r) => (
                    <Pressable key={r} style={styles.reportReasonBtn} onPress={() => reportComment(c.id, r)}>
                      <Text style={styles.reportReasonText}>{r}</Text>
                    </Pressable>
                  ))}
                  <Pressable style={styles.reportReasonBtn} onPress={() => setReportingId(null)}>
                    <Text style={styles.reportReasonText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setReportingId(c.id)}><Text style={styles.commentActionText}>Report</Text></Pressable>
              )
            ) : null}
          </View>
        ) : null}

        {!isReply && replyingTo === c.id ? (
          <View style={styles.editForm}>
            <TextInput
              style={styles.textarea}
              value={replyText}
              onChangeText={setReplyText}
              placeholder={`Reply to ${c.displayName}…`}
              placeholderTextColor={colors.inkFaint}
              multiline
              maxLength={1000}
            />
            <Text style={styles.charCount}>{replyText.length}/1000</Text>
            <View style={styles.formActions}>
              <Pressable style={styles.smallPrimaryBtn} disabled={postingReply} onPress={() => postReply(c.id)}>
                <Text style={styles.smallPrimaryBtnText}>{postingReply ? 'Posting…' : 'Post reply'}</Text>
              </Pressable>
              <Pressable style={styles.smallSecondaryBtn} onPress={() => setReplyingTo(null)}>
                <Text style={styles.smallSecondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {!isReply && c.replies && c.replies.length > 0 ? (
          <View style={styles.replyList}>{c.replies.map((r) => renderComment(r, true))}</View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Full-bleed hero: art fading into the page, title block over it. */}
        <View style={styles.hero}>
          {heroArt ? (
            <SmartImage uri={heroArt} style={absoluteFill} resizeMode="cover" />
          ) : (
            <LinearGradient colors={[colors.surface3, colors.surface0]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[absoluteFill, styles.heroFallback]}>
              <Text style={styles.heroInitial}>{(pitch.title || '?')[0].toUpperCase()}</Text>
            </LinearGradient>
          )}
          <LinearGradient
            colors={['rgba(12,19,31,0.55)', 'rgba(12,19,31,0)', 'rgba(12,19,31,0.65)', colors.surface0]}
            locations={[0, 0.25, 0.7, 1]}
            style={absoluteFill}
            pointerEvents="none"
          />

          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <Pressable style={styles.roundBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace('/pitches'))} hitSlop={6} accessibilityLabel="Back">
              <BackIcon />
            </Pressable>
            <View style={styles.topBarRight}>
              <Pressable style={[styles.roundBtn, saved && styles.roundBtnActive]} onPress={isSignedIn ? toggleSave : promptSignIn} hitSlop={6} accessibilityLabel={saved ? 'Unsave' : 'Save'}>
                <HeartIcon active={saved} size={18} />
              </Pressable>
              <Pressable style={styles.roundBtn} onPress={() => share(pitch)} hitSlop={6} accessibilityLabel="Share">
                <ShareIconSvg size={18} />
              </Pressable>
            </View>
          </View>

          <View style={styles.heroContent}>
            <View style={styles.heroChips}>
              {pitch.tag ? <View style={styles.tagChip}><Text style={styles.tagChipText}>{pitch.tag}</Text></View> : null}
              <Text style={styles.heroEyebrow}>Pitch Room</Text>
            </View>
            <Text style={styles.heroTitle}>{pitch.title}</Text>
            {creatorName ? (
              <Pressable
                style={styles.creatorRow}
                onPress={pitch.created_by ? () => router.push(`/profile/${pitch.created_by}`) : undefined}
                disabled={!pitch.created_by}
              >
                <View style={styles.creatorAvatar}>
                  {creatorAvatarUrl
                    ? <SmartImage uri={creatorAvatarUrl} style={absoluteFill} />
                    : <Text style={styles.creatorAvatarText}>{creatorName[0].toUpperCase()}</Text>}
                </View>
                <Text style={styles.creatorText}>by <Text style={pitch.created_by ? styles.creatorLink : null}>{creatorName}</Text></Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.body}>
          {bypassingDisabled ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>⚠ Pitch Room is turned off for the public right now — you're seeing this because you're an admin.</Text>
            </View>
          ) : null}

          {pitch.logline ? (
            <View style={styles.logline}>
              <Text style={styles.loglineText}>{pitch.logline}</Text>
            </View>
          ) : null}

          {hasFundingCard ? (
            <View style={styles.fundCard}>
              {pct !== null ? (
                <>
                  <View style={styles.fundTop}>
                    <Text style={styles.fundRaised}>{raisedLabel}</Text>
                    <Text style={styles.fundGoal}>raised of ${Number(pitch.funding_goal).toLocaleString()}</Text>
                  </View>
                  <View style={styles.track}>
                    <LinearGradient colors={[colors.olive, colors.brass]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${Math.max(pct, 2)}%` }]} />
                  </View>
                </>
              ) : null}

              <View style={styles.stats}>
                {pct !== null ? <Stat value={`${pct}%`} label="funded" /> : null}
                {pitch.funding_enabled ? <Stat value={String(backerCount || 0)} label={backerCount === 1 ? 'backer' : 'backers'} /> : null}
                {remaining !== null ? <Stat value={remaining === 1 ? 'Last' : String(remaining)} label={remaining === 1 ? 'day' : 'days left'} accent /> : null}
              </View>

              {!pitch.funding_enabled && pitch.project_url ? (
                <Pressable style={styles.primaryBtn} onPress={() => Linking.openURL(pitch.project_url)}>
                  <Text style={styles.primaryBtnText}>◆ Fund this project</Text>
                </Pressable>
              ) : null}

              {pitch.funding_enabled ? (
                <View style={styles.donation}>
                  {isSignedIn ? (
                    <>
                      <View style={styles.presetRow}>
                        {DONATION_PRESETS.map((amount) => (
                          <Pressable
                            key={amount}
                            style={[styles.presetBtn, donationAmount === String(amount) && styles.presetBtnActive]}
                            onPress={() => setDonationAmount(String(amount))}
                            disabled={donating}
                          >
                            <Text style={[styles.presetBtnText, donationAmount === String(amount) && styles.presetBtnTextActive]}>${amount}</Text>
                          </Pressable>
                        ))}
                        <View style={styles.amountBox}>
                          <Text style={styles.amountDollar}>$</Text>
                          <TextInput
                            style={styles.amountInput}
                            keyboardType="number-pad"
                            placeholder="Other"
                            placeholderTextColor={colors.inkFaint}
                            value={DONATION_PRESETS.map(String).includes(donationAmount) ? '' : donationAmount}
                            onChangeText={setDonationAmount}
                            editable={!donating}
                          />
                        </View>
                      </View>
                      <Pressable style={styles.primaryBtn} disabled={donating} onPress={() => donate(pitch.id)}>
                        <Text style={styles.primaryBtnText}>{donating ? 'Sending…' : `◆ Support this project${donationAmount ? ` · $${donationAmount}` : ''}`}</Text>
                      </Pressable>
                      {donationSuccess ? <Text style={styles.okText}>Thank you for your support!</Text> : null}
                    </>
                  ) : (
                    <Pressable style={styles.primaryBtn} onPress={() => router.push('/account')}>
                      <Text style={styles.primaryBtnText}>Sign in to support this project</Text>
                    </Pressable>
                  )}
                  {donationError ? <Text style={styles.errorTextSm}>{donationError}</Text> : null}
                  <Text style={styles.finePrint}>Support is recorded now — real payment processing for this project is coming soon.</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {pitch.description ? (
            <>
              {sectionLabel('The project')}
              <Text style={styles.paragraph}>{pitch.description}</Text>
            </>
          ) : null}

          {pitch.team && pitch.team.length > 0 ? (
            <>
              {sectionLabel('The team')}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.hRow}>
                {pitch.team.map((m, i) => (
                  <View key={i} style={styles.teamCard}>
                    <View style={styles.teamAvatar}><Text style={styles.teamAvatarText}>{m.name ? m.name[0].toUpperCase() : '?'}</Text></View>
                    <Text style={styles.teamName} numberOfLines={1}>{m.name}</Text>
                    {m.role ? <Text style={styles.teamRole} numberOfLines={2}>{m.role}</Text> : null}
                  </View>
                ))}
              </ScrollView>
            </>
          ) : null}

          {pitch.photos && pitch.photos.length > 0 ? (
            <>
              {sectionLabel('Behind the scenes')}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.hRow}>
                {pitch.photos.map((url, i) => <SmartImage key={i} uri={url} style={styles.photoItem} resizeMode="cover" />)}
              </ScrollView>
            </>
          ) : null}

          {updates.length > 0 ? (
            <>
              {sectionLabel('Updates')}
              <View style={styles.timeline}>
                {updates.map((u, i) => (
                  <View key={u.id} style={styles.updateItem}>
                    <View style={styles.updateRail}>
                      <View style={styles.updateDot} />
                      {i < updates.length - 1 ? <View style={styles.updateLine} /> : null}
                    </View>
                    <View style={styles.updateCard}>
                      <Text style={styles.updateDate}>{new Date(u.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</Text>
                      <Text style={styles.updateTitle}>{u.title}</Text>
                      <Text style={styles.updateBody}>{u.body}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {recentBackers.length > 0 ? (
            <>
              {sectionLabel(`Backers${backerCount > recentBackers.length ? ` · ${backerCount}` : ''}`)}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.hRow}>
                {recentBackers.map((b) => (
                  <Pressable key={b.userId} style={styles.backer} onPress={() => router.push(`/profile/${b.userId}`)}>
                    <View style={styles.backerAvatar}>{b.avatarUrl ? <SmartImage uri={b.avatarUrl} style={absoluteFill} /> : <Text style={styles.backerAvatarText}>{(b.displayName || '?')[0].toUpperCase()}</Text>}</View>
                    <Text style={styles.backerName} numberOfLines={1}>{b.displayName}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          {sectionLabel(`Discussion${commentList.length > 0 ? ` · ${countComments(commentList)}` : ''}`)}
          {isSignedIn ? (
            <View style={styles.commentForm}>
              {commentError ? <Text style={styles.errorTextSm}>{commentError}</Text> : null}
              <TextInput
                style={styles.textarea}
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Say something about this project…"
                placeholderTextColor={colors.inkFaint}
                multiline
                maxLength={1000}
              />
              <View style={styles.commentFormFoot}>
                <Text style={styles.charCount}>{commentText.length}/1000</Text>
                <Pressable style={styles.smallPrimaryBtn} disabled={posting || !commentText.trim()} onPress={postComment}>
                  <Text style={styles.smallPrimaryBtnText}>{posting ? 'Posting…' : 'Post'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={styles.signInPrompt} onPress={() => router.push('/account')}>
              <Text style={styles.signInPromptText}>Sign in to join the discussion →</Text>
            </Pressable>
          )}

          {commentList.length === 0 ? (
            <Text style={styles.emptyText}>No comments yet — be the first to say something.</Text>
          ) : (
            <View style={styles.commentList}>{commentList.map((c) => renderComment(c))}</View>
          )}

          {similar.length > 0 ? (
            <>
              {sectionLabel('More like this')}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.hRow}>
                {similar.map((p) => (
                  <Pressable key={p.id} style={styles.similarCard} onPress={() => router.push(`/pitches/${p.id}`)}>
                    <View style={styles.similarThumb}>
                      {p.thumbnail ? <SmartImage uri={p.thumbnail} style={absoluteFill} resizeMode="cover" /> : (
                        <LinearGradient colors={[colors.surface3, colors.surface1]} style={[absoluteFill, styles.heroFallback]}>
                          <Text style={styles.similarInitial}>{(p.title || '?')[0].toUpperCase()}</Text>
                        </LinearGradient>
                      )}
                    </View>
                    <View style={styles.similarBody}>
                      {p.tag ? <Text style={styles.similarTag}>{p.tag}</Text> : null}
                      <Text style={styles.similarTitle} numberOfLines={1}>{p.title}</Text>
                      {p.creator_name ? <Text style={styles.similarCreator} numberOfLines={1}>by {p.creator_name}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ value, label, accent }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && { color: colors.olive }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function BackIcon({ size = 18, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 140 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontFamily: fonts.body, fontSize: 15, textAlign: 'center' },
  errorTextSm: { color: colors.danger, fontFamily: fonts.body, fontSize: 12.5, marginTop: 8 },
  okText: { color: colors.ok, fontFamily: fonts.monoMedium, fontSize: 12, marginTop: 10, textAlign: 'center' },
  emptyText: { color: colors.inkFaint, fontFamily: fonts.body, fontSize: 14, marginTop: 4 },
  ghostBtn: { borderWidth: 1, borderColor: colors.hairline, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
  ghostBtnText: { fontFamily: fonts.displaySemi, fontSize: 13, color: colors.ink },

  // Hero
  hero: { width: '100%', height: 460, backgroundColor: colors.surface2, justifyContent: 'flex-end' },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  heroInitial: { fontFamily: fonts.bodyBold, fontSize: 180, color: 'rgba(251,232,211,0.07)' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  topBarRight: { flexDirection: 'row', gap: 10 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(10,10,14,0.55)', borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', alignItems: 'center', justifyContent: 'center' },
  roundBtnActive: { borderColor: colors.danger },
  heroContent: { paddingHorizontal: 20, paddingBottom: 18 },
  heroChips: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  tagChip: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 11 },
  tagChipText: { fontFamily: fonts.displayBold, fontSize: 12, color: colors.onBrass },
  heroEyebrow: { fontFamily: fonts.monoMedium, fontSize: 10.5, letterSpacing: 2, textTransform: 'uppercase', color: colors.olive },
  heroTitle: { fontFamily: fonts.bodyBold, fontSize: 36, lineHeight: 40, color: colors.ink },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14, alignSelf: 'flex-start' },
  creatorAvatar: { width: 30, height: 30, borderRadius: 15, overflow: 'hidden', backgroundColor: colors.brass, borderWidth: 1.5, borderColor: 'rgba(251,232,211,0.6)', alignItems: 'center', justifyContent: 'center' },
  creatorAvatarText: { fontFamily: fonts.monoBold, fontSize: 12, color: colors.onBrass },
  creatorText: { fontFamily: fonts.body, fontSize: 14.5, color: colors.inkDim },
  creatorLink: { color: colors.ink, fontFamily: fonts.bodyBold },

  body: { paddingHorizontal: 20 },
  banner: { padding: 12, borderRadius: 12, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.warn, marginBottom: 16 },
  bannerText: { color: colors.inkDim, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },

  logline: { borderLeftWidth: 3, borderLeftColor: colors.brass, paddingLeft: 14, marginBottom: 20 },
  loglineText: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25, color: colors.ink },

  // Funding card
  fundCard: { backgroundColor: colors.surface1, borderRadius: 20, borderWidth: 1, borderColor: colors.hairline, padding: 18, marginBottom: 8 },
  fundTop: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  fundRaised: { fontFamily: fonts.displayBold, fontSize: 32, color: colors.ink },
  fundGoal: { fontFamily: fonts.display, fontSize: 14, color: colors.inkFaint },
  track: { height: 8, borderRadius: 999, backgroundColor: colors.surface3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  stats: { flexDirection: 'row', marginTop: 16, marginBottom: 2 },
  stat: { flex: 1 },
  statValue: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink },
  statLabel: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.inkFaint, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.onBrass },
  donation: { marginTop: 4 },
  presetRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  presetBtn: { flex: 1, alignItems: 'center', borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface2 },
  presetBtnActive: { backgroundColor: colors.brass, borderColor: colors.brass },
  presetBtnText: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.ink },
  presetBtnTextActive: { color: colors.onBrass },
  amountBox: { flex: 1.3, flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface2, paddingHorizontal: 10 },
  amountDollar: { fontFamily: fonts.displayBold, fontSize: 14, color: colors.inkFaint },
  amountInput: { flex: 1, color: colors.ink, fontFamily: fonts.displayBold, fontSize: 14, paddingVertical: 10, paddingLeft: 3 },
  finePrint: { color: colors.inkFaint, fontFamily: fonts.body, fontSize: 11.5, marginTop: 12, lineHeight: 16, textAlign: 'center' },

  // Sections
  sectionLabel: { fontFamily: fonts.monoMedium, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: colors.olive, marginTop: 32, marginBottom: 14 },
  paragraph: { fontFamily: fonts.body, fontSize: 15.5, lineHeight: 24, color: colors.inkDim },
  bleed: { marginHorizontal: -20 },
  hRow: { gap: 12, paddingHorizontal: 20 },

  teamCard: { width: 128, backgroundColor: colors.surface1, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline, padding: 14, alignItems: 'center' },
  teamAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  teamAvatarText: { fontFamily: fonts.monoBold, fontSize: 18, color: colors.onBrass },
  teamName: { fontFamily: fonts.displayBold, fontSize: 13.5, color: colors.ink, textAlign: 'center' },
  teamRole: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkFaint, textAlign: 'center', marginTop: 3 },

  photoItem: { width: 240, height: 160, borderRadius: 14, backgroundColor: colors.surface2 },

  timeline: {},
  updateItem: { flexDirection: 'row' },
  updateRail: { width: 22, alignItems: 'center' },
  updateDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brass, marginTop: 18 },
  updateLine: { flex: 1, width: 2, backgroundColor: colors.hairline, marginTop: 4 },
  updateCard: { flex: 1, backgroundColor: colors.surface1, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline, padding: 15, marginBottom: 12, marginLeft: 6 },
  updateDate: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkFaint, marginBottom: 6 },
  updateTitle: { fontFamily: fonts.displayBold, fontSize: 15.5, color: colors.ink, marginBottom: 6 },
  updateBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim },

  backer: { alignItems: 'center', width: 68 },
  backerAvatar: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  backerAvatarText: { fontFamily: fonts.monoBold, fontSize: 16, color: colors.onBrass },
  backerName: { fontFamily: fonts.display, fontSize: 11.5, color: colors.inkDim, textAlign: 'center' },

  similarCard: { width: 210, backgroundColor: colors.surface1, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  similarThumb: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface2 },
  similarInitial: { fontFamily: fonts.bodyBold, fontSize: 44, color: 'rgba(251,232,211,0.12)' },
  similarBody: { padding: 12 },
  similarTag: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.brass, marginBottom: 4 },
  similarTitle: { fontFamily: fonts.displayBold, fontSize: 14.5, color: colors.ink },
  similarCreator: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint, marginTop: 2 },

  // Discussion
  commentForm: { backgroundColor: colors.surface1, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline, padding: 12, marginBottom: 18 },
  commentFormFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  signInPrompt: { backgroundColor: colors.surface1, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline, padding: 16, marginBottom: 18 },
  signInPromptText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.olive },
  commentList: { gap: 2 },
  textarea: { backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, color: colors.ink, fontFamily: fonts.body, fontSize: 14.5, minHeight: 70, textAlignVertical: 'top' },
  charCount: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 10.5 },
  smallPrimaryBtn: { alignSelf: 'flex-start', backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 18 },
  smallPrimaryBtnText: { color: colors.onBrass, fontFamily: fonts.displayBold, fontSize: 13 },
  smallSecondaryBtn: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.hairline },
  smallSecondaryBtnText: { color: colors.ink, fontFamily: fonts.displaySemi, fontSize: 13 },
  formActions: { flexDirection: 'row', gap: 8, marginTop: 8 },

  commentCard: { backgroundColor: colors.surface1, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline, padding: 14, marginBottom: 10 },
  replyCard: { backgroundColor: colors.surface2, borderColor: 'transparent', marginTop: 10, marginBottom: 0, padding: 12 },
  commentMetaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
  commentAvatar: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  commentAvatarText: { color: colors.onBrass, fontFamily: fonts.monoBold, fontSize: 11 },
  commentName: { color: colors.ink, fontFamily: fonts.displayBold, fontSize: 13.5 },
  creatorBadge: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7, marginLeft: 7 },
  creatorBadgeText: { color: colors.onBrass, fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase' },
  commentDate: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 10.5 },
  commentBody: { color: colors.ink, fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, marginBottom: 8 },
  commentActions: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', alignItems: 'center' },
  commentActionText: { color: colors.inkDim, fontFamily: fonts.monoMedium, fontSize: 11.5 },
  reportedText: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 11 },
  reportPicker: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  reportReasonBtn: { borderWidth: 1, borderColor: colors.hairline, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  reportReasonText: { color: colors.inkDim, fontFamily: fonts.mono, fontSize: 11 },
  editForm: { marginTop: 6 },
  replyList: { marginTop: 4 }
});
