import { useAuth } from '@clerk/expo';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChatIcon, ClapperboardIcon, ClockIcon, CloseIcon, EyeIcon, ExternalLinkIcon,
  HeadphonesIcon, ImageIcon, LinkIcon, PencilIcon, SettingsIcon, TrashIcon, UndoIcon, WarningIcon
} from '../../components/WorkIcons';
import { apiGet, apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import SmartImage from '../../components/SmartImage';

const SITE_ORIGIN = 'https://studiotapatv.site';

const STATUS_LABEL = {
  pending: { text: 'Pending review', color: colors.olive },
  approved: { text: 'Approved — live', color: colors.ok },
  rejected: { text: 'Rejected', color: colors.danger }
};

const CF_STATE_LABEL = {
  pendingupload: 'Waiting on upload',
  downloading: 'Cloudflare receiving file…',
  queued: 'Queued for processing',
  inprogress: 'Processing…',
  ready: 'Ready to stream',
  error: 'Processing failed'
};

const STANDALONE_TYPE_LABELS = { movie: 'Films', short: 'Shorts', vertical: 'Vertical', podcast: 'Podcasts' };

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

function publicUrlFor(s) {
  const path = s.contentType === 'podcast' && s.seriesId ? `/podcasts/${s.seriesId}` : `/episode/${s.id}`;
  return `${SITE_ORIGIN}${path}`;
}

// Mirrors pages/creator/my-work.js — same stats dashboard, same grouped/
// filterable submission list. Deliberately scoped down on the ACTION
// side: title/description edit requests and deletion requests/cancels
// are built in-app (plain text, low complexity); artwork/video/caption
// replace, audio extraction, bonus content, and the full admin edit
// modal all open the website instead — each of those is really its own
// file-picker + upload flow (or, for the admin modal, a dense multi-field
// form) that deserves its own pass rather than being squeezed in here.
export default function MyWork() {
  const { getToken } = useAuth();
  const [feedState, setFeedState] = useState({ loading: true, error: null, forbidden: false, submissions: null });
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [actionSheet, setActionSheet] = useState(null); // { type: 'episode'|'series', item }
  const [editModal, setEditModal] = useState(null); // { type, currentValues }
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null); // episode item
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const tokenRef = useRef(null);

  async function loadSubmissions() {
    try {
      const token = tokenRef.current !== null ? tokenRef.current : await withTimeout(getToken().catch(() => null), 4000);
      tokenRef.current = token;
      const data = await apiGet('/api/creator/my-submissions', token);
      setFeedState({ loading: false, error: null, forbidden: false, submissions: data.submissions });
    } catch (err) {
      const forbidden = /creator access required/i.test(err.message || '');
      setFeedState({ loading: false, error: err.message, forbidden, submissions: null });
    }
  }

  useEffect(() => {
    loadSubmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyPublicLink(s) {
    try {
      await Clipboard.setStringAsync(publicUrlFor(s));
      setCopiedId(s.id);
      setTimeout(() => setCopiedId((current) => (current === s.id ? null : current)), 2000);
    } catch {
      // Not worth surfacing — same reasoning as the website.
    }
  }

  async function submitEdit(nameValue, description) {
    setEditSaving(true);
    setEditError(null);
    try {
      const isEpisode = editModal.type === 'episode';
      const endpoint = isEpisode ? '/api/creator/request-episode-edit' : '/api/creator/request-series-edit';
      const body = isEpisode
        ? { episodeId: editModal.currentValues.id, title: nameValue, description }
        : { seriesId: editModal.currentValues.id, name: nameValue, description };
      await apiPost(endpoint, body, tokenRef.current);
      setEditModal(null);
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function requestDeletion() {
    if (!deleteReason.trim()) {
      setDeleteError('A reason is required.');
      return;
    }
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      await apiPost('/api/creator/request-episode-deletion', { episodeId: deleteModal.id, action: 'request', reason: deleteReason.trim() }, tokenRef.current);
      setDeleteModal(null);
      setDeleteReason('');
      loadSubmissions();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteSaving(false);
    }
  }

  async function cancelDeletion(episodeId) {
    setActionError(null);
    try {
      await apiPost('/api/creator/request-episode-deletion', { episodeId, action: 'cancel' }, tokenRef.current);
      loadSubmissions();
    } catch (err) {
      setActionError(err.message);
    }
  }

  if (feedState.loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><ActivityIndicator color={colors.brass} /></View>
      </SafeAreaView>
    );
  }

  if (feedState.forbidden) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}>
          <Text style={styles.title}>Creator access required</Text>
          <Text style={styles.note}>This section is only for accounts with creator or admin access.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (feedState.error || !feedState.submissions) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <TopNav />
        <View style={styles.center}><Text style={styles.errorText}>Couldn't load your work: {feedState.error || 'unknown error'}</Text></View>
      </SafeAreaView>
    );
  }

  const submissions = feedState.submissions;
  const total = submissions.length;
  const approvedCount = submissions.filter((s) => s.status === 'approved').length;
  const pendingCount = submissions.filter((s) => s.status === 'pending').length;
  const reviewedCount = approvedCount + submissions.filter((s) => s.status === 'rejected').length;
  const approvalRate = reviewedCount > 0 ? Math.round((approvedCount / reviewedCount) * 100) : null;
  const turnaroundHoursList = submissions
    .filter((s) => s.reviewedAt && s.createdAt)
    .map((s) => (new Date(s.reviewedAt).getTime() - new Date(s.createdAt).getTime()) / (1000 * 60 * 60));
  const avgTurnaroundHours = turnaroundHoursList.length > 0
    ? Math.round(turnaroundHoursList.reduce((a, b) => a + b, 0) / turnaroundHoursList.length)
    : null;
  const missingArtworkCount = submissions.filter((s) => s.status !== 'rejected' && s.missingArtwork).length;

  const filteredSubmissions = submissions.filter((s) => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (searchQuery.trim() && !s.title.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    if (needsAttentionOnly) {
      const needsIt = s.status === 'pending' || (s.missingArtwork && s.status !== 'rejected') || (s.status === 'approved' && s.contentType !== 'podcast' && !s.captionsUrl);
      if (!needsIt) return false;
    }
    return true;
  });

  const groupsByKey = {};
  for (const s of filteredSubmissions) {
    const isGrouped = !!s.seriesId;
    const key = isGrouped ? `series:${s.seriesId}` : `type:${s.contentType}`;
    if (!groupsByKey[key]) {
      groupsByKey[key] = {
        key,
        isGrouped,
        label: isGrouped ? (s.seriesName || 'Untitled show') : (STANDALONE_TYPE_LABELS[s.contentType] || 'Other'),
        typeTag: s.contentType === 'podcast' ? 'podcast' : (s.contentType === 'series' ? 'series' : null),
        items: []
      };
    }
    groupsByKey[key].items.push(s);
  }
  const typeOrder = Object.keys(STANDALONE_TYPE_LABELS);
  const projectGroups = Object.values(groupsByKey).sort((a, b) => {
    if (a.isGrouped !== b.isGrouped) return a.isGrouped ? -1 : 1;
    if (!a.isGrouped && !b.isGrouped) return typeOrder.indexOf(a.items[0].contentType) - typeOrder.indexOf(b.items[0].contentType);
    return a.label.localeCompare(b.label);
  });

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll}>
        <View style={styles.head}>
          <Text style={styles.eyebrow}>Creator Studio</Text>
          <Text style={styles.title}>Your work</Text>
          <Text style={styles.sub}>Everything you've submitted, pending or already live — edit, add artwork, or manage it here.</Text>
          <Pressable style={styles.primaryBtn} onPress={() => Linking.openURL(`${SITE_ORIGIN}/creator`)}>
            <Text style={styles.primaryBtnText}>+ Submit new episode</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => Linking.openURL(`${SITE_ORIGIN}/creator/analytics`)}>
          <Text style={styles.analyticsLink}>Want to see how they're doing? View your numbers →</Text>
        </Pressable>

        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

        {submissions.length === 0 ? (
          <Text style={styles.note}>
            Nothing submitted yet — <Text style={styles.link} onPress={() => Linking.openURL(`${SITE_ORIGIN}/creator`)}>submit your first one</Text>.
          </Text>
        ) : (
          <>
            <View style={styles.statsRow}>
              <View style={styles.stat}><Text style={styles.statValue}>{total}</Text><Text style={styles.statLabel}>Total</Text></View>
              <View style={styles.stat}><Text style={styles.statValue}>{pendingCount}</Text><Text style={styles.statLabel}>Pending</Text></View>
              <View style={styles.stat}><Text style={styles.statValue}>{approvedCount}</Text><Text style={styles.statLabel}>Approved</Text></View>
              <View style={styles.stat}><Text style={styles.statValue}>{approvalRate === null ? '—' : `${approvalRate}%`}</Text><Text style={styles.statLabel}>Approval rate</Text></View>
              <View style={styles.stat}><Text style={styles.statValue}>{avgTurnaroundHours === null ? '—' : `${avgTurnaroundHours}h`}</Text><Text style={styles.statLabel}>Avg. review</Text></View>
            </View>

            {missingArtworkCount > 0 ? (
              <View style={styles.nudge}>
                <ImageIcon size={13} color={colors.olive} />
                <Text style={styles.nudgeText}>
                  {' '}{missingArtworkCount} submission{missingArtworkCount === 1 ? '' : 's'} still missing a poster or thumbnail — open on the website to add one.
                </Text>
              </View>
            ) : null}

            <TextInput
              style={styles.search}
              placeholder="Search your titles…"
              placeholderTextColor={colors.inkFaint}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow} contentContainerStyle={styles.pillRowContent}>
              {['all', 'pending', 'approved', 'rejected'].map((f) => (
                <Pressable key={f} style={[styles.pill, statusFilter === f && styles.pillOn]} onPress={() => setStatusFilter(f)}>
                  <Text style={[styles.pillText, statusFilter === f && styles.pillTextOn]}>{f === 'all' ? 'All' : STATUS_LABEL[f].text}</Text>
                </Pressable>
              ))}
              <Pressable style={[styles.pill, needsAttentionOnly && styles.pillOn]} onPress={() => setNeedsAttentionOnly((v) => !v)}>
                <WarningIcon size={12} color={needsAttentionOnly ? colors.onBrass : colors.ink} />
                <Text style={[styles.pillText, needsAttentionOnly && styles.pillTextOn]}> Needs attention</Text>
              </Pressable>
            </ScrollView>

            {filteredSubmissions.length === 0 ? <Text style={styles.note}>Nothing matches this filter.</Text> : null}

            {projectGroups.map((group) => {
              const pendingInGroup = group.items.filter((s) => s.status === 'pending').length;
              const missingArtworkInGroup = group.items.filter((s) => s.missingArtwork && s.status !== 'rejected').length;
              const groupArt = group.items.find((s) => s.thumbnail || s.poster);
              return (
                <View key={group.key} style={styles.projectGroup}>
                  <View style={styles.projectHeader}>
                    {groupArt ? <SmartImage uri={groupArt.thumbnail || groupArt.poster} style={styles.projectArt} /> : <View style={styles.projectArt} />}
                    <View style={styles.projectTitleWrap}>
                      <View style={styles.projectTitleRow}>
                        <Text style={styles.projectTitle} numberOfLines={1}>{group.label}</Text>
                        {group.typeTag ? (
                          <View style={styles.typeTag}>
                            {group.typeTag === 'podcast' ? <HeadphonesIcon size={10} color={colors.inkDim} /> : null}
                            <Text style={styles.typeTagText}>{group.typeTag === 'podcast' ? ' Podcast' : 'Series'}</Text>
                          </View>
                        ) : null}
                        {group.isGrouped ? (
                          <Pressable style={styles.settingsBtn} onPress={() => setActionSheet({ type: 'series', item: { id: group.key.replace('series:', ''), name: group.label } })}>
                            <SettingsIcon size={14} color={colors.inkDim} />
                          </Pressable>
                        ) : null}
                      </View>
                      <Text style={styles.projectSub}>{group.items.length} episode{group.items.length === 1 ? '' : 's'}</Text>
                    </View>
                    <View style={styles.projectBadges}>
                      {pendingInGroup > 0 ? <Text style={[styles.badge, styles.badgePending]}>{pendingInGroup} pending</Text> : null}
                      {missingArtworkInGroup > 0 ? <Text style={[styles.badge, styles.badgeMissing]}>{missingArtworkInGroup} needs artwork</Text> : null}
                    </View>
                  </View>
                  {group.items.map((s) => {
                    const flags = [];
                    if (s.missingArtwork && s.status !== 'rejected') flags.push({ key: 'artwork', Icon: ImageIcon });
                    if (s.contentType !== 'podcast' && !s.captionsUrl && s.status === 'approved') flags.push({ key: 'captions', Icon: ChatIcon });
                    if (s.artworkPending) flags.push({ key: 'pending', Icon: ClockIcon });
                    if (s.deletionRequested) flags.push({ key: 'deletion', Icon: TrashIcon });
                    return (
                      <Pressable key={s.id} style={styles.row} onPress={() => setActionSheet({ type: 'episode', item: s })}>
                        {s.thumbnail ? <SmartImage uri={s.thumbnail} style={styles.rowThumb} /> : <View style={styles.rowThumb} />}
                        <View style={styles.rowMain}>
                          <View style={styles.rowTitleLine}>
                            <Text style={styles.rowTitle} numberOfLines={1}>{s.title}</Text>
                            {s.hasVideo ? <ClapperboardIcon size={11} color={colors.inkDim} /> : null}
                            {s.hasAudio ? <HeadphonesIcon size={11} color={colors.inkDim} /> : null}
                          </View>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {s.cloudflareState && s.cloudflareState !== 'ready' ? (CF_STATE_LABEL[s.cloudflareState] || s.cloudflareState) : (s.runtime || s.description || '')}
                          </Text>
                          {s.status === 'rejected' && s.rejectionReason ? <Text style={styles.rowRejection}>Admin's note: {s.rejectionReason}</Text> : null}
                          {s.deletionRequested ? <Text style={styles.rowRejection}>Deletion reason: {s.deletionReason}</Text> : null}
                        </View>
                        <View style={styles.rowRight}>
                          <Text style={[styles.statusPill, { color: (STATUS_LABEL[s.status] || {}).color || colors.inkDim }]}>{(STATUS_LABEL[s.status] || {}).text || s.status}</Text>
                          {s.status === 'approved' ? (
                            <View style={styles.viewsRow}><EyeIcon size={11} color={colors.inkFaint} /><Text style={styles.viewsText}> {s.viewCount}</Text></View>
                          ) : null}
                          {flags.length > 0 ? (
                            <View style={styles.flagsRow}>
                              {flags.map((f) => <f.Icon key={f.key} size={12} color={colors.inkFaint} />)}
                            </View>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* Action sheet — episode or series settings */}
      <Modal visible={!!actionSheet} transparent animationType="slide" onRequestClose={() => setActionSheet(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionSheet(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {actionSheet ? <ActionSheetContent
              actionSheet={actionSheet}
              onClose={() => setActionSheet(null)}
              onEdit={(target) => { setActionSheet(null); setEditModal(target); setEditError(null); }}
              onDelete={(item) => { setActionSheet(null); setDeleteModal(item); setDeleteReason(''); setDeleteError(null); }}
              onCancelDeletion={(id) => { setActionSheet(null); cancelDeletion(id); }}
              onCopyLink={copyPublicLink}
              copiedId={copiedId}
            /> : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit title/description or show name/description */}
      <Modal visible={!!editModal} transparent animationType="fade" onRequestClose={() => setEditModal(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditModal(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            {editModal ? <EditModalContent
              editModal={editModal}
              saving={editSaving}
              error={editError}
              onCancel={() => setEditModal(null)}
              onSubmit={submitEdit}
            /> : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Request deletion */}
      <Modal visible={!!deleteModal} transparent animationType="fade" onRequestClose={() => setDeleteModal(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDeleteModal(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeaderText}>Request deletion</Text>
              <Pressable onPress={() => setDeleteModal(null)}><CloseIcon size={16} /></Pressable>
            </View>
            {deleteModal ? (
              <Text style={styles.modalNote}>"{deleteModal.title}" will be hidden from the site right away. An admin still has to confirm the actual removal — you can cancel this request any time before then.</Text>
            ) : null}
            <Text style={styles.label}>Reason — required</Text>
            <TextInput
              style={styles.textarea}
              value={deleteReason}
              onChangeText={setDeleteReason}
              multiline
              numberOfLines={3}
              placeholder=""
              placeholderTextColor={colors.inkFaint}
            />
            {deleteError ? <Text style={styles.errorText}>{deleteError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable style={[styles.primaryBtn, deleteSaving && styles.btnDisabled]} disabled={deleteSaving} onPress={requestDeletion}>
                <Text style={styles.primaryBtnText}>{deleteSaving ? 'Submitting…' : 'Request deletion'}</Text>
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={() => setDeleteModal(null)} disabled={deleteSaving}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function ActionSheetContent({ actionSheet, onClose, onEdit, onDelete, onCancelDeletion, onCopyLink, copiedId }) {
  const { type, item } = actionSheet;
  if (type === 'series') {
    return (
      <>
        <Text style={styles.sheetTitle} numberOfLines={1}>{item.name}</Text>
        <Pressable style={styles.sheetRow} onPress={() => onEdit({ type: 'series', currentValues: { id: item.id, name: item.name, description: '' } })}>
          <PencilIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>Edit show details</Text>
        </Pressable>
        <Pressable style={styles.sheetRow} onPress={() => Linking.openURL(`${SITE_ORIGIN}/creator/my-work`)}>
          <ExternalLinkIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>Add bonus content (on website)</Text>
        </Pressable>
        <Pressable style={styles.sheetCancel} onPress={onClose}><Text style={styles.sheetCancelText}>Close</Text></Pressable>
      </>
    );
  }

  const s = item;
  return (
    <>
      <Text style={styles.sheetTitle} numberOfLines={1}>{s.title}</Text>
      {s.status === 'approved' ? (
        <>
          <Pressable style={styles.sheetRow} onPress={() => Linking.openURL(publicUrlFor(s))}>
            <ExternalLinkIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>View public page</Text>
          </Pressable>
          <Pressable style={styles.sheetRow} onPress={() => onCopyLink(s)}>
            <LinkIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>{copiedId === s.id ? 'Link copied!' : 'Copy public link'}</Text>
          </Pressable>
        </>
      ) : null}
      {!s.deletionRequested ? (
        <Pressable style={styles.sheetRow} onPress={() => onEdit({ type: 'episode', currentValues: { id: s.id, title: s.title, description: s.description || '' } })}>
          <PencilIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>Edit title &amp; description</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.sheetRow} onPress={() => Linking.openURL(`${SITE_ORIGIN}/creator/my-work`)}>
        <ImageIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>Manage artwork, video &amp; captions (on website)</Text>
      </Pressable>
      {s.deletionRequested ? (
        <Pressable style={styles.sheetRow} onPress={() => onCancelDeletion(s.id)}>
          <UndoIcon size={16} color={colors.ink} /><Text style={styles.sheetRowText}>Cancel deletion request</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.sheetRow} onPress={() => onDelete(s)}>
          <TrashIcon size={16} color={colors.danger} /><Text style={[styles.sheetRowText, { color: colors.danger }]}>Request deletion</Text>
        </Pressable>
      )}
      <Pressable style={styles.sheetCancel} onPress={onClose}><Text style={styles.sheetCancelText}>Close</Text></Pressable>
    </>
  );
}

function EditModalContent({ editModal, saving, error, onCancel, onSubmit }) {
  const isEpisode = editModal.type === 'episode';
  const [nameValue, setNameValue] = useState(isEpisode ? editModal.currentValues.title : editModal.currentValues.name);
  const [description, setDescription] = useState(editModal.currentValues.description || '');

  return (
    <>
      <View style={styles.modalHeader}>
        <Text style={styles.modalHeaderText}>Request an edit — {isEpisode ? 'episode' : 'show'}</Text>
        <Pressable onPress={onCancel}><CloseIcon size={16} /></Pressable>
      </View>
      <Text style={styles.modalNote}>
        This goes to Studio Tapa for approval before it changes anything visitors see — the current {isEpisode ? 'title/description' : 'name/description'} stay live until then.
      </Text>
      <Text style={styles.label}>{isEpisode ? 'Title' : 'Show name'}</Text>
      <TextInput style={styles.input} value={nameValue} onChangeText={setNameValue} />
      <Text style={styles.label}>Description</Text>
      <TextInput style={styles.textarea} value={description} onChangeText={setDescription} multiline numberOfLines={4} />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.modalActions}>
        <Pressable style={[styles.primaryBtn, saving && styles.btnDisabled]} disabled={saving} onPress={() => onSubmit(nameValue, description)}>
          <Text style={styles.primaryBtnText}>{saving ? 'Sending…' : 'Send for approval'}</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={onCancel} disabled={saving}>
          <Text style={styles.secondaryBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  scrollView: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  center: { flex: 1, backgroundColor: colors.surface0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 6, marginBottom: 6 },
  note: { color: colors.inkDim, fontSize: 14, lineHeight: 20, marginTop: 8 },
  link: { color: colors.olive },

  head: { marginBottom: 14 },
  eyebrow: { color: colors.olive, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  sub: { color: colors.inkDim, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  primaryBtn: { backgroundColor: colors.brass, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', alignSelf: 'flex-start' },
  primaryBtnText: { color: colors.onBrass, fontSize: 14, fontWeight: '700' },
  secondaryBtn: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', borderWidth: 1, borderColor: colors.hairline },
  secondaryBtnText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },

  analyticsLink: { color: colors.olive, fontSize: 13, marginBottom: 14 },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  stat: { minWidth: 90, backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', flexGrow: 1 },
  statValue: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  statLabel: { color: colors.inkDim, fontSize: 10, marginTop: 2, textAlign: 'center' },

  nudge: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface2, borderRadius: 10, padding: 10, marginBottom: 14 },
  nudgeText: { color: colors.inkDim, fontSize: 12, flex: 1, lineHeight: 17 },

  search: { backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, color: colors.ink, fontSize: 14, marginBottom: 10 },
  pillRow: { marginBottom: 16 },
  pillRowContent: { gap: 8, paddingRight: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface2, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  pillOn: { backgroundColor: colors.brass },
  pillText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  pillTextOn: { color: colors.onBrass },

  projectGroup: { marginBottom: 20 },
  projectHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  projectArt: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surface2 },
  projectTitleWrap: { flex: 1 },
  projectTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  projectTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  typeTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface3, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7 },
  typeTagText: { color: colors.inkDim, fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  settingsBtn: { padding: 4 },
  projectSub: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },
  projectBadges: { gap: 4, alignItems: 'flex-end' },
  badge: { fontSize: 9, fontWeight: '700', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 999, overflow: 'hidden' },
  badgePending: { color: colors.olive, backgroundColor: 'rgba(231,162,85,0.15)' },
  badgeMissing: { color: colors.danger, backgroundColor: 'rgba(226,116,90,0.15)' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  rowThumb: { width: 54, height: 40, borderRadius: 6, backgroundColor: colors.surface2 },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rowTitle: { color: colors.ink, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  rowMeta: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },
  rowRejection: { color: colors.danger, fontSize: 10, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 3 },
  statusPill: { fontSize: 10, fontWeight: '700' },
  viewsRow: { flexDirection: 'row', alignItems: 'center' },
  viewsText: { color: colors.inkFaint, fontSize: 10 },
  flagsRow: { flexDirection: 'row', gap: 4 },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 30 },
  sheetTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 12 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  sheetRowText: { color: colors.ink, fontSize: 14 },
  sheetCancel: { marginTop: 8, paddingVertical: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.hairline },
  sheetCancelText: { color: colors.inkDim, fontSize: 14, fontWeight: '600' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: colors.surface1, borderRadius: 14, padding: 18, width: '100%', maxWidth: 420 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalHeaderText: { color: colors.ink, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  modalNote: { color: colors.inkDim, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  label: { color: colors.inkDim, fontSize: 12, fontWeight: '600', marginBottom: 5, marginTop: 8 },
  input: { backgroundColor: colors.surface2, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11, color: colors.ink, fontSize: 14 },
  textarea: { backgroundColor: colors.surface2, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11, color: colors.ink, fontSize: 14, minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 }
});
