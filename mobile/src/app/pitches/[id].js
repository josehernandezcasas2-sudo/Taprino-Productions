import { useAuth } from '@clerk/expo';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { colors, absoluteFill } from '../../lib/theme';
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

// Mirrors pages/pitches/[id].js — hero with funding progress/donation
// form, wishlist save, share, description/team/photos/updates/backers/
// similar-projects, and the full nested (one-level) comment system:
// post, reply, edit, delete, report. Creator/backer/commenter names are
// plain text here rather than links — pages/profile/[userId].js isn't
// built on mobile yet, so there's nowhere for them to go (next natural
// page to convert).
export default function PitchDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const tokenRef = useRef(null);

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
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.brass} />
      </SafeAreaView>
    );
  }
  if (state.error || !state.data) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.errorText}>Couldn't load this pitch: {state.error || 'not found'}</Text>
      </SafeAreaView>
    );
  }

  const { pitch, similar, updates, recentBackers, backerCount, isSignedIn, userId, bypassingDisabled } = state.data;

  const raisedForPct = pitch.funding_enabled ? (currentTotalRaisedCents || 0) / 100 : (pitch.funding_raised || 0);
  const pct = pitch.funding_goal ? Math.min(100, Math.round((raisedForPct / pitch.funding_goal) * 100)) : null;

  const remaining = (() => {
    if (!pitch.funding_deadline) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(`${pitch.funding_deadline}T00:00:00`);
    const diffDays = Math.round((deadline - today) / 86400000);
    return diffDays < 0 ? null : Math.max(1, diffDays);
  })();

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
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: pitch.title }} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        {bypassingDisabled ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>⚠ Pitch Room is turned off for the public right now — you're seeing this because you're an admin.</Text>
          </View>
        ) : null}

        <View style={styles.hero}>
          {pitch.hero_image || pitch.thumbnail ? (
            <SmartImage uri={pitch.hero_image || pitch.thumbnail} style={styles.heroImage} />
          ) : <View style={styles.heroImage} />}
          <View style={styles.heroOverlay}>
            <Text style={styles.heroEyebrow}>{pitch.tag || 'Project'} · Pitch Room</Text>
            <Text style={styles.heroTitle}>{pitch.title}</Text>

            {pct !== null ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
            ) : null}

            <View style={styles.metaLine}>
              {pct !== null ? <Text style={styles.metaChip}>{pct}% funded</Text> : null}
              {pitch.creator_name ? (
                pitch.created_by ? (
                  <Text style={styles.metaText}> · By <Text style={styles.metaLink} onPress={() => router.push(`/profile/${pitch.created_by}`)}>{pitch.creator_name}</Text></Text>
                ) : (
                  <Text style={styles.metaText}> · By {pitch.creator_name}</Text>
                )
              ) : null}
              {pitch.funding_enabled ? (
                <Text style={styles.metaText}>
                  {' '}· ${((currentTotalRaisedCents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} raised
                  {backerCount > 0 ? ` · ${backerCount} backer${backerCount === 1 ? '' : 's'}` : ''}
                </Text>
              ) : pitch.funding_goal ? (
                <Text style={styles.metaText}> · ${Number(pitch.funding_raised || 0).toLocaleString()} of ${Number(pitch.funding_goal).toLocaleString()} goal</Text>
              ) : null}
              {remaining !== null ? <Text style={styles.metaDeadline}> · {remaining === 1 ? 'Last day' : `${remaining} days left`}</Text> : null}
            </View>

            {pitch.logline ? <Text style={styles.heroLogline}>{pitch.logline}</Text> : null}

            <View style={styles.heroActions}>
              {!pitch.funding_enabled && pitch.project_url ? (
                <Pressable style={styles.fundBtn} onPress={() => Linking.openURL(pitch.project_url)}>
                  <Text style={styles.fundBtnText}>◆ Fund this project</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.iconBtn} onPress={toggleSave}>
                <HeartIcon active={saved} size={17} />
              </Pressable>
              <Pressable style={styles.iconBtn} onPress={() => share(pitch)}>
                <ShareIconSvg size={17} />
              </Pressable>
            </View>

            {pitch.funding_enabled ? (
              <View style={styles.donationBox}>
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
                          <Text style={styles.presetBtnText}>${amount}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.donateRow}>
                      <TextInput
                        style={styles.donateInput}
                        keyboardType="number-pad"
                        placeholder="Amount"
                        placeholderTextColor={colors.inkFaint}
                        value={donationAmount}
                        onChangeText={setDonationAmount}
                        editable={!donating}
                      />
                      <Pressable style={styles.fundBtn} disabled={donating} onPress={() => donate(pitch.id)}>
                        <Text style={styles.fundBtnText}>{donating ? 'Sending…' : '◆ Support this project'}</Text>
                      </Pressable>
                    </View>
                    {donationSuccess ? <Text style={styles.okText}>Thank you for your support!</Text> : null}
                  </>
                ) : (
                  <Text style={styles.metaText}>Sign in on the website to support this project.</Text>
                )}
                {donationError ? <Text style={styles.errorTextSm}>{donationError}</Text> : null}
                <Text style={styles.finePrint}>Support is recorded now — real payment processing for this project is coming soon.</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.body}>
          {pitch.description ? (
            <>
              <Text style={styles.sectionLabel}>The project</Text>
              <Text style={styles.paragraph}>{pitch.description}</Text>
            </>
          ) : null}

          {pitch.team && pitch.team.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Created by</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teamRow}>
                {pitch.team.map((m, i) => (
                  <View key={i} style={styles.teamCard}>
                    <View style={styles.teamAvatar}><Text style={styles.teamAvatarText}>{m.name ? m.name[0].toUpperCase() : '?'}</Text></View>
                    <Text style={styles.teamName}>{m.name}</Text>
                    <Text style={styles.teamRole}>{m.role}</Text>
                  </View>
                ))}
              </ScrollView>
            </>
          ) : null}

          {pitch.photos && pitch.photos.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Photos</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
                {pitch.photos.map((url, i) => <SmartImage key={i} uri={url} style={styles.photoItem} />)}
              </ScrollView>
            </>
          ) : null}

          {updates.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Project updates</Text>
              {updates.map((u) => (
                <View key={u.id} style={styles.updateCard}>
                  <Text style={styles.updateDate}>{new Date(u.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase()}</Text>
                  <Text style={styles.updateTitle}>{u.title}</Text>
                  <Text style={styles.updateBody}>{u.body}</Text>
                </View>
              ))}
            </>
          ) : null}

          {recentBackers.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Backers{backerCount > recentBackers.length ? ` (${backerCount})` : ''}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.backerRow}>
                {recentBackers.map((b) => (
                  <Pressable key={b.userId} style={styles.backer} onPress={() => router.push(`/profile/${b.userId}`)}>
                    <View style={styles.backerAvatar}>{b.avatarUrl ? <SmartImage uri={b.avatarUrl} style={absoluteFill} /> : <Text style={styles.backerAvatarText}>{(b.displayName || '?')[0].toUpperCase()}</Text>}</View>
                    <Text style={styles.backerName}>{b.displayName}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          {similar.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Similar projects</Text>
              <View style={styles.similarGrid}>
                {similar.map((p) => (
                  <Pressable key={p.id} style={styles.similarCard} onPress={() => router.push(`/pitches/${p.id}`)}>
                    {p.thumbnail ? <SmartImage uri={p.thumbnail} style={styles.similarThumb} /> : <View style={styles.similarThumb} />}
                    {p.tag ? <Text style={styles.similarTag}>{p.tag}</Text> : null}
                    <Text style={styles.similarTitle} numberOfLines={1}>{p.title}</Text>
                    {p.creator_name ? (
                      p.created_by ? (
                        <Pressable onPress={() => router.push(`/profile/${p.created_by}`)}>
                          <Text style={[styles.similarCreator, styles.metaLink]} numberOfLines={1}>{p.creator_name}</Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.similarCreator} numberOfLines={1}>{p.creator_name}</Text>
                      )
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <Text style={styles.sectionLabel}>Discussion{commentList.length > 0 ? ` (${countComments(commentList)})` : ''}</Text>
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
              <Text style={styles.charCount}>{commentText.length}/1000</Text>
              <Pressable style={styles.smallPrimaryBtn} disabled={posting} onPress={postComment}>
                <Text style={styles.smallPrimaryBtnText}>{posting ? 'Posting…' : 'Post comment'}</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.metaText}>Sign in to join the discussion.</Text>
          )}

          {commentList.length === 0 ? (
            <Text style={styles.emptyText}>No comments yet — be the first to say something.</Text>
          ) : (
            commentList.map((c) => renderComment(c))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  errorTextSm: { color: colors.danger, fontSize: 12, marginBottom: 6 },
  okText: { color: colors.ok, fontSize: 12, marginTop: 6 },
  emptyText: { color: colors.inkDim, fontSize: 13, marginBottom: 10 },

  banner: { margin: 16, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.hairline },
  bannerText: { color: colors.inkDim, fontSize: 13, lineHeight: 18 },

  hero: { width: '100%', position: 'relative', backgroundColor: colors.surface2 },
  heroImage: { width: '100%', aspectRatio: 16 / 10, resizeMode: 'cover', backgroundColor: colors.surface2 },
  heroOverlay: { padding: 18, paddingTop: 16 },
  heroEyebrow: { color: colors.olive, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  heroTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 10 },
  progressTrack: { height: 6, backgroundColor: colors.surface3, borderRadius: 999, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: colors.brass },
  metaLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 },
  metaChip: { color: colors.olive, fontSize: 12, fontWeight: '700' },
  metaText: { color: colors.inkDim, fontSize: 12 },
  metaLink: { color: colors.olive, fontWeight: '600' },
  metaDeadline: { color: colors.olive, fontSize: 12, fontWeight: '700' },
  heroLogline: { color: colors.ink, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  heroActions: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 6 },
  fundBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 16 },
  fundBtnText: { color: colors.onBrass, fontSize: 13, fontWeight: '700' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.hairline },

  donationBox: { marginTop: 14, backgroundColor: colors.surface2, borderRadius: 12, padding: 14 },
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  presetBtn: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.hairline },
  presetBtnActive: { backgroundColor: colors.brass, borderColor: colors.brass },
  presetBtnText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  donateRow: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  donateInput: { backgroundColor: colors.surface1, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11, color: colors.ink, fontSize: 14, width: 100 },
  finePrint: { color: colors.inkFaint, fontSize: 10.5, marginTop: 8, lineHeight: 14 },

  body: { padding: 16 },
  sectionLabel: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 18, marginBottom: 10 },
  paragraph: { color: colors.inkDim, fontSize: 13.5, lineHeight: 20 },

  teamRow: { gap: 12, paddingRight: 8 },
  teamCard: { width: 110, alignItems: 'center', backgroundColor: colors.surface2, borderRadius: 10, padding: 12 },
  teamAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  teamAvatarText: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  teamName: { color: colors.ink, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  teamRole: { color: colors.inkFaint, fontSize: 10.5, textAlign: 'center', marginTop: 2 },

  photoRow: { gap: 10, paddingRight: 8 },
  photoItem: { width: 140, height: 100, borderRadius: 8, backgroundColor: colors.surface2 },

  updateCard: { backgroundColor: colors.surface2, borderRadius: 10, padding: 14, marginBottom: 10 },
  updateDate: { color: colors.inkFaint, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  updateTitle: { color: colors.ink, fontSize: 14, fontWeight: '700', marginBottom: 5 },
  updateBody: { color: colors.inkDim, fontSize: 12.5, lineHeight: 18 },

  backerRow: { gap: 14, paddingRight: 8 },
  backer: { alignItems: 'center', width: 64 },
  backerAvatar: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  backerAvatarText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  backerName: { color: colors.inkDim, fontSize: 10.5, textAlign: 'center' },

  similarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  similarCard: { width: '47%' },
  similarThumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: colors.surface2, marginBottom: 6 },
  similarTag: { color: colors.brass, fontSize: 10, fontWeight: '700', marginBottom: 2 },
  similarTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  similarCreator: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },

  commentForm: { marginBottom: 14 },
  textarea: { backgroundColor: colors.surface2, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11, color: colors.ink, fontSize: 13.5, minHeight: 60, textAlignVertical: 'top' },
  charCount: { color: colors.inkFaint, fontSize: 10, textAlign: 'right', marginTop: 3, marginBottom: 8 },
  smallPrimaryBtn: { alignSelf: 'flex-start', backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  smallPrimaryBtnText: { color: colors.onBrass, fontSize: 12.5, fontWeight: '700' },
  smallSecondaryBtn: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.hairline },
  smallSecondaryBtnText: { color: colors.ink, fontSize: 12.5, fontWeight: '600' },
  formActions: { flexDirection: 'row', gap: 8 },

  commentCard: { marginBottom: 14, paddingBottom: 2 },
  replyCard: { marginLeft: 20, marginTop: 10, marginBottom: 0 },
  commentMetaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' },
  commentAvatar: { width: 24, height: 24, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginRight: 7 },
  commentAvatarText: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  commentName: { color: colors.ink, fontSize: 12.5, fontWeight: '700' },
  creatorBadge: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 6, marginLeft: 6 },
  creatorBadgeText: { color: colors.onBrass, fontSize: 9, fontWeight: '700' },
  commentDate: { color: colors.inkFaint, fontSize: 10.5 },
  commentBody: { color: colors.ink, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  commentActions: { flexDirection: 'row', gap: 14, flexWrap: 'wrap', alignItems: 'center' },
  commentActionText: { color: colors.inkDim, fontSize: 11.5, fontWeight: '600' },
  reportedText: { color: colors.inkFaint, fontSize: 10.5 },
  reportPicker: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  reportReasonBtn: { borderWidth: 1, borderColor: colors.hairline, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 },
  reportReasonText: { color: colors.inkDim, fontSize: 10.5 },
  editForm: { marginTop: 4 },
  replyList: { marginTop: 4 }
});
