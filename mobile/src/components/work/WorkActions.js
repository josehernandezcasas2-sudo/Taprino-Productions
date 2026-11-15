import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiPost, freshToken } from '../../lib/api';
import { showCall } from '../../lib/showApi';
import { episodeHasPage, fieldPolicy, fieldPolicyLine, flashingLightsPolicy, saveSummary } from '../../lib/showRules';
import { copyLinkFor, runtimeWords, titleDashHref } from '../../lib/workListRules';
import { downloadableKind } from '../../lib/downloadRules';
import { downloadsSwitchFrom, saveAroundDownloads } from '../../lib/downloadLogic';
import { absoluteFill, colors, fonts, oliveTint } from '../../lib/theme';
import { pickImageAsDataUrl } from '../CreatorBits';
import FlashingLightsField from '../FlashingLightsField';
import DownloadsAllowedField from '../DownloadsAllowedField';
import SellTitleSheet from '../SellTitleSheet';
import PayeeCard from '../show/PayeeCard';
import { ChevronIcon, HANDOFF_MS, Sheet, episodeEditorRoute, showRoute, ss } from '../show/ShowBits';
import { openOnWebsite } from '../show/EditorBits';
import { hrefToRoute } from '../PushListener';
import {
  ChatIcon, ClapperboardIcon, CloseIcon, ExternalLinkIcon, EyeIcon, HeadphonesIcon, ImageIcon, LinkIcon, PencilIcon, SettingsIcon, TrashIcon, UndoIcon
} from '../WorkIcons';

// What Your work's ⋯ and a title's dashboard do in the app (the revamp of
// 2026-11-15, mockups/work-revamp-contract.md "Builder C"). The keys are
// lib/workListRules.js's menu keys and lib/titleDashRules.js's action keys
// (the same set): every one runs here, so the list and the dashboard can't
// drift. The sheets and boxes are the ones Your work had before the
// revamp, moved here whole: the title / description / notes box (with
// "Contains flashing lights" and "Allow downloads in the app"), Request
// deletion, Sell this title, Who gets paid, the title image.
//
//   open            a title of its own → its dashboard; a show's episode → its editor
//   edit_full |
//   edit_submission |
//   edit_words      the title / description / notes box
//   view            the public page (the app's own screen for it)
//   copy            the public address on the clipboard ("Link copied" for 2 s)
//   sell            Sell this title / Price and sales
//   payee           a title of its own: Who gets paid in a sheet; a show's
//                   episode: its editor, where the same card sits
//   artwork | video | captions | replace_file
//                   the website (the app has no artwork, file or caption
//                   upload for a title of its own; the menu says so)
//   extract_audio   POST /api/creator/extract-podcast-audio, polled every 3 s
//   channels        POST /api/creator/channel-opt-in
//   cancel_removal  POST /api/creator/request-episode-deletion { action: 'cancel' }
//   remove          Request deletion (the same route, action 'request')
//
// Kept from before the revamp, which the rules don't name: "Open on the
// show page" for a show's episode, and the title image (add / replace /
// remove) for a title of its own.

// The www host: the bare studiotapatv.site 308-redirects there, so a
// copied link should already be the address it lands on.
export const SITE_ORIGIN = 'https://www.studiotapatv.site';

// The line under a menu item or a button that opens the website.
export const ON_WEBSITE = 'On the website';

// Keys whose work happens on the website for a title of its own, and the
// tab of the website's title dashboard each one opens.
const WEB_TAB = { artwork: 'artwork', video: 'video', captions: 'video', replace_file: 'video' };
export const isWebsiteAction = (key) => Object.prototype.hasOwnProperty.call(WEB_TAB, key);
export function websitePathFor(key, id) {
  return `${titleDashHref(id)}?tab=${WEB_TAB[key] || 'overview'}`;
}

// Keys that present something (a box, a sheet, the photo picker, the
// system browser): after the ⋯ sheet, they wait for it to slide away (iOS
// won't present while a modal is still closing).
const PRESENTS = new Set(['edit_full', 'edit_submission', 'edit_words', 'sell', 'remove', 'title_image', 'title_image_remove', 'artwork', 'video', 'captions', 'replace_file']);

const MENU_ICON = {
  open: ChevronIcon,
  show_page: ChevronIcon,
  edit_full: PencilIcon,
  edit_submission: PencilIcon,
  edit_words: PencilIcon,
  view: EyeIcon,
  copy: LinkIcon,
  artwork: ImageIcon,
  title_image: ImageIcon,
  title_image_remove: TrashIcon,
  video: ClapperboardIcon,
  captions: ChatIcon,
  extract_audio: HeadphonesIcon,
  channels: SettingsIcon,
  cancel_removal: UndoIcon,
  remove: TrashIcon
};
const DOLLAR_KEYS = new Set(['sell', 'payee']);

// A film's or a short's notes for its own page (2026-11-08; the website's
// components/PageNotesField.js): the box shows while the database has the
// column (my-submissions' pageNotesReady, migration 118) and the title has
// its own page. The show editor's limits and words.
const PAGE_NOTES_MAX = 4000;
function notesBoxShows(s) {
  if (!s || s.pageNotesReady !== true) return false;
  return episodeHasPage({ contentType: s.contentType ?? null, seriesId: s.seriesId ?? null, hasPage: typeof s.hasPageChoice === 'boolean' ? s.hasPageChoice : null });
}

// What the edit box needs about a title of its own: its words now, what
// waits for approval, and where it stands (the website's editValuesFor).
export function editValuesFor(s) {
  return {
    id: s.id,
    contentType: s.contentType ?? null,
    title: s.title,
    description: s.description || '',
    pageNotes: s.pageNotes || '',
    notesShown: notesBoxShows(s),
    status: s.status,
    held: Boolean(s.held),
    deletionRequested: Boolean(s.deletionRequested),
    withdrawnAt: s.withdrawnAt || null,
    pendingTitle: s.pendingTitle || null,
    pendingDescription: s.pendingDescription || null,
    pendingPageNotes: typeof s.pendingPageNotes === 'string' ? s.pendingPageNotes : null,
    pageNotesWaitReady: s.pageNotesWaitReady !== false,
    hasFlashingLights: s.hasFlashingLights === true
  };
}

// The title image can be set on this title from the app (the old sheet's
// rule): not a podcast or a vertical title, not on its way out, and on a
// live title only while the database can hold a waiting one.
export function titleImageOpen(s) {
  return Boolean(s) && !s.deletionRequested && !s.withdrawnAt && !['podcast', 'vertical'].includes(s.contentType) && !(s.status === 'approved' && s.titleImageWaitReady === false);
}

// A row the actions can run on, for a title the dashboard shows (Your work
// hands its own rows from buildWorkList).
export function rowForTitle(s, title) {
  return { key: `title:${s.id}`, id: s.id, raw: s, kind: 'title', showId: null, code: '', title, showName: '', publicPath: null, href: titleDashHref(s.id), menu: [] };
}

// The items of a row's ⋯ sheet: the rules' menu in its words and order,
// with "Open on the show page" after Open for a show's episode and the
// title image after the artwork for a title of its own; the danger items
// after a divider.
export function menuItemsFor(row, { copiedId = null } = {}) {
  const s = row.raw || {};
  const out = [];
  const danger = [];
  for (const m of Array.isArray(row.menu) ? row.menu : []) {
    const item = {
      key: m.key,
      label: m.key === 'copy' && copiedId === row.id ? 'Link copied' : m.label,
      detail: m.detail || '',
      web: row.kind === 'title' && isWebsiteAction(m.key),
      danger: m.tone === 'danger'
    };
    (item.danger ? danger : out).push(item);
    if (m.key === 'open' && row.kind !== 'title' && row.showId) out.push({ key: 'show_page', label: 'Open on the show page', detail: '' });
    if (m.key === 'artwork' && row.kind === 'title' && titleImageOpen(s)) {
      out.push({ key: 'title_image', label: s.titleImageUrl || s.pendingTitleImageUrl ? 'Replace the title image' : 'Add a title image', detail: s.pendingTitleImageUrl || s.pendingTitleImageRemoval ? 'one waits for approval' : '' });
      if (s.titleImageUrl && !s.pendingTitleImageRemoval) out.push({ key: 'title_image_remove', label: 'Remove the title image', detail: '' });
    }
  }
  return danger.length ? [...out, { divider: true }, ...danger] : out;
}

// The hook: run(key, row) and the sheets and boxes it opens (`element`,
// drawn once at the end of the screen). `pricing` is the screen's
// /api/creator/pricing answer (or null), `loadPricing` reads it again,
// `onChanged` reads the screen's titles again after anything changed.
// Errors and the title image's words are kept per title (errors[id],
// notices[id]) for the screen to draw on that title.
export function useWorkActions({ getToken, router, pricing = null, loadPricing = null, onChanged = null }) {
  const [menuRow, setMenuRow] = useState(null);
  const [editModal, setEditModal] = useState(null); // { type, currentValues }
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  // The server's line when a save found the database without migration 123:
  // the edit box greys "Allow downloads in the app" with it.
  const [downloadsBehind, setDownloadsBehind] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null); // { id, title }
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [sellModal, setSellModal] = useState(null); // { type, id, title, sub }
  const [payeeSheet, setPayeeSheet] = useState(null); // { id, title, block, error, words }
  const [copiedId, setCopiedId] = useState(null);
  const [errors, setErrors] = useState({});
  const [notices, setNotices] = useState({});
  const [busy, setBusy] = useState({}); // id → the key running
  const [extract, setExtract] = useState(null); // { id, percent }
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const pricingRef = useRef(loadPricing);
  pricingRef.current = loadPricing;
  const changed = () => { if (changedRef.current) changedRef.current(); };

  const setOne = (setter, id, value) => setter((m) => {
    const next = { ...m };
    if (value) next[id] = value;
    else delete next[id];
    return next;
  });
  const fail = (id, words) => setOne(setErrors, id, words);
  const note = (id, words) => setOne(setNotices, id, words);
  const busyOn = (id, key) => setOne(setBusy, id, key);

  // --- the title, description and notes ------------------------------------------

  // The show editor's own save, PATCH /api/show/episode/<id> (the website's
  // components/RequestEditModal.js, 2026-11-12). Only what changed is
  // sent; the server's field policy decides: on a live title they wait
  // for approval, on one that has never been live they apply at once.
  // "Allow downloads in the app" rides on the same save and applies at
  // once; a database without migration 123 refuses the whole save over it
  // (503 'migration-123'): the box greys with the server's line and the
  // rest is sent again without it (mobile/src/lib/downloadLogic.js).
  async function submitEdit(body) {
    const cv = editModal.currentValues;
    const path = `/api/show/episode/${encodeURIComponent(String(cv.id))}`;
    setEditSaving(true);
    setEditError(null);
    try {
      const { r, behind } = await saveAroundDownloads((b) => showCall('PATCH', path, b, getToken), body);
      if (behind) setDownloadsBehind(behind);
      if (!r) return null;
      if (!r.ok) throw new Error(r.error);
      const notSaved = Array.isArray(r.data.notSaved) ? r.data.notSaved : [];
      if (notSaved.length) throw new Error(notSaved.map((x) => x && x.reason).filter(Boolean).join(' ') || 'Some of it didn’t save.');
      changed();
      return { staged: r.data.staged || [], applied: r.data.applied || [], notices: r.data.notices || [] };
    } catch (err) {
      setEditError(err.message);
      return null;
    } finally {
      setEditSaving(false);
    }
  }

  // Where "Allow downloads in the app" stands for the title in the box:
  // the episode editor's own read, GET /api/show/episode/<id> (no box for
  // a podcast, an older server, or a read that failed).
  async function loadDownloadsSwitch() {
    const cv = editModal && editModal.currentValues;
    if (!cv || !cv.id) return null;
    return downloadsSwitchFrom(await showCall('GET', `/api/show/episode/${encodeURIComponent(String(cv.id))}`, undefined, getToken));
  }

  // A change waiting for approval taken back (DELETE …/staged?field=).
  async function cancelWaiting(field) {
    const cv = editModal.currentValues;
    setEditError(null);
    const r = await showCall('DELETE', `/api/show/episode/${encodeURIComponent(String(cv.id))}/staged?field=${encodeURIComponent(field)}`, undefined, getToken);
    if (!r.ok) {
      setEditError(r.error);
      return false;
    }
    changed();
    return true;
  }

  // --- the rest -------------------------------------------------------------------------

  // The title image: the title set as a picture, a PNG with a transparent
  // background, saved through the show editor's own route (on a live
  // title it waits for approval).
  async function pickTitleImage(s, { remove = false } = {}) {
    fail(s.id, null);
    let img = null;
    if (!remove) {
      try {
        img = await pickImageAsDataUrl({ width: 1200, format: 'png' });
      } catch (err) {
        fail(s.id, err.message);
        return;
      }
      if (!img) return;
    }
    busyOn(s.id, remove ? 'title_image_remove' : 'title_image');
    const r = await showCall('PATCH', `/api/show/episode/${encodeURIComponent(String(s.id))}`, remove ? { removeTitleImage: true } : { titleImageBase64: img.base64, titleImageFileName: img.fileName }, getToken);
    if (!alive.current) return;
    busyOn(s.id, null);
    if (!r.ok) {
      fail(s.id, r.error);
      return;
    }
    const waits = Array.isArray(r.data.staged) && r.data.staged.some((f) => f === 'titleImage' || f === 'titleImageRemoval');
    note(s.id, remove
      ? (waits ? 'Removing the title image waits for approval.' : 'The title image is removed: the title shows as text.')
      : (waits ? 'The new title image waits for approval; visitors see the live one until then.' : 'The title image is saved.'));
    changed();
  }

  async function requestDeletion() {
    if (!deleteReason.trim()) {
      setDeleteError('A reason is required.');
      return;
    }
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      await apiPost('/api/creator/request-episode-deletion', { episodeId: deleteModal.id, action: 'request', reason: deleteReason.trim() }, await freshToken(getToken));
      setDeleteModal(null);
      setDeleteReason('');
      changed();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteSaving(false);
    }
  }

  async function cancelDeletion(id) {
    fail(id, null);
    busyOn(id, 'cancel_removal');
    try {
      await apiPost('/api/creator/request-episode-deletion', { episodeId: id, action: 'cancel' }, await freshToken(getToken));
      changed();
    } catch (err) {
      if (alive.current) fail(id, err.message);
    } finally {
      if (alive.current) busyOn(id, null);
    }
  }

  async function openPayee(id, title) {
    setPayeeSheet({ id, title: title || 'this title', block: null, error: null, words: null });
    const r = await showCall('GET', `/api/payees?type=episode&id=${encodeURIComponent(id)}`, undefined, getToken);
    setPayeeSheet((cur) => (cur && cur.id === id ? { ...cur, block: r.ok ? r.data.payee || null : null, error: r.ok ? (r.data.payee ? null : 'Couldn’t read who gets paid.') : r.error } : cur));
  }

  async function setChannels(s, optIn) {
    fail(s.id, null);
    busyOn(s.id, 'channels');
    const r = await showCall('POST', '/api/creator/channel-opt-in', { type: 'episode', id: s.id, optIn }, getToken);
    if (!alive.current) return;
    busyOn(s.id, null);
    if (!r.ok) fail(s.id, r.error || 'Could not change that.');
    changed();
  }

  // The website's extractAudio: ask, then ask again every 3 s until the
  // audio is ready.
  const extracting = useRef(null);
  async function extractAudio(s) {
    if (extracting.current) return;
    extracting.current = s.id;
    fail(s.id, null);
    setExtract({ id: s.id, percent: null });
    const poll = async () => {
      if (!alive.current) return;
      const r = await showCall('POST', '/api/creator/extract-podcast-audio', { episodeId: s.id }, getToken);
      if (!alive.current) return;
      if (!r.ok) {
        fail(s.id, r.error || 'Could not extract audio.');
        extracting.current = null;
        setExtract(null);
        return;
      }
      if (r.data.status === 'ready') {
        extracting.current = null;
        setExtract(null);
        changed();
        return;
      }
      setExtract({ id: s.id, percent: r.data.percentComplete ?? null });
      setTimeout(poll, 3000);
    };
    poll();
  }

  async function copyLink(row) {
    const s = row.raw || {};
    const path = row.publicPath || (s.contentType === 'podcast' && s.seriesId ? `/podcasts/${encodeURIComponent(s.seriesId)}` : `/episode/${encodeURIComponent(row.id)}`);
    try {
      await Clipboard.setStringAsync(copyLinkFor({ publicPath: path }, SITE_ORIGIN));
      setCopiedId(row.id);
      setTimeout(() => { if (alive.current) setCopiedId((cur) => (cur === row.id ? null : cur)); }, 2000);
    } catch {
      // Not worth surfacing — same reasoning as the website.
    }
  }

  async function openSell(row) {
    const s = row.raw || {};
    if (!pricing && pricingRef.current) await pricingRef.current();
    setSellModal({ type: 'episode', id: row.id, title: row.title, sub: [row.code, runtimeWords(s.runtime), row.showName || s.seriesName].filter(Boolean).join(' · ') });
  }

  function go(href) {
    const where = hrefToRoute(href);
    if (!where) return;
    if (where.route) router.push(where.route);
    else openOnWebsite(href);
  }

  // One action on one row.
  function run(key, row) {
    const s = row.raw || {};
    fail(row.id, null);
    switch (key) {
      case 'open':
        if (row.kind === 'title') router.push(titleDashHref(row.id));
        else if (row.showId) router.push(episodeEditorRoute(row.showId, row.id));
        break;
      case 'show_page':
        if (row.showId) router.push(showRoute(row.showId, { ep: row.id }));
        break;
      case 'edit_full':
      case 'edit_submission':
      case 'edit_words':
        setEditError(null);
        setDownloadsBehind(null);
        setEditModal({ type: 'episode', currentValues: editValuesFor(s) });
        break;
      case 'view':
        if (row.publicPath) go(row.publicPath);
        break;
      case 'copy':
        copyLink(row);
        break;
      case 'sell':
        openSell(row);
        break;
      case 'payee':
        if (row.kind !== 'title' && row.showId) router.push(episodeEditorRoute(row.showId, row.id));
        else openPayee(row.id, row.title);
        break;
      case 'artwork':
      case 'video':
      case 'captions':
      case 'replace_file':
        openOnWebsite(websitePathFor(key, row.id));
        break;
      case 'extract_audio':
        extractAudio(s);
        break;
      case 'channels':
        setChannels(s, !s.channelOptIn);
        break;
      case 'cancel_removal':
        cancelDeletion(row.id);
        break;
      case 'remove':
        setDeleteReason('');
        setDeleteError(null);
        setDeleteModal({ id: row.id, title: row.title });
        break;
      case 'title_image':
        pickTitleImage(s);
        break;
      case 'title_image_remove':
        pickTitleImage(s, { remove: true });
        break;
      default:
        break;
    }
  }

  const openMenu = useCallback((row) => setMenuRow(row), []);

  // A ⋯ item: Copy link stays in the sheet (its words say it worked); the
  // rest close it first.
  function pick(item) {
    const row = menuRow;
    if (!row) return;
    if (item.key === 'copy') {
      run('copy', row);
      return;
    }
    setMenuRow(null);
    if (PRESENTS.has(item.key) || (item.key === 'payee' && row.kind === 'title')) setTimeout(() => run(item.key, row), HANDOFF_MS);
    else run(item.key, row);
  }

  const menuItems = menuRow ? menuItemsFor(menuRow, { copiedId }) : [];

  const element = (
    <>
      {menuRow ? (
        <Sheet title={menuRow.title} eyebrow={menuRow.code || menuRow.showName || null} onClose={() => setMenuRow(null)}>
          <View accessibilityRole="menu">
            {menuItems.map((it, i) => (it.divider ? <View key={`d${i}`} style={ss.actionDivider} /> : <MenuItem key={it.key} item={it} onPress={() => pick(it)} />))}
          </View>
        </Sheet>
      ) : null}

      {/* Buy to own: Sell this title / Run a sale (components/SellTitleSheet.js) */}
      <Modal visible={Boolean(sellModal) && Boolean(pricing)} transparent animationType="fade" onRequestClose={() => setSellModal(null)}>
        <View style={wa.modalBackdrop}>
          <Pressable style={absoluteFill} onPress={() => setSellModal(null)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={wa.modalCard}>
            {sellModal && pricing ? <SellTitleSheet
              target={sellModal}
              price={pricing.prices ? pricing.prices[`${sellModal.type}:${sellModal.id}`] || null : null}
              blocked={pricing.blocked ? pricing.blocked[`${sellModal.type}:${sellModal.id}`] || null : null}
              settings={pricing.settings || {}}
              getToken={() => freshToken(getToken)}
              onClose={() => setSellModal(null)}
              onSaved={() => { if (pricingRef.current) pricingRef.current(); }}
            /> : null}
          </View>
        </View>
      </Modal>

      {/* Who gets paid for a title of its own (slice 3b) */}
      {payeeSheet ? (
        <Sheet title={`Who gets paid for “${payeeSheet.title}”`} onClose={() => setPayeeSheet(null)}>
          {payeeSheet.words ? <Text style={ss.okText} accessibilityLiveRegion="polite">{payeeSheet.words}</Text> : null}
          {payeeSheet.error ? <Text style={ss.error}>{payeeSheet.error}</Text> : !payeeSheet.block ? <ActivityIndicator color={colors.olive} /> : (
            <PayeeCard
              payee={payeeSheet.block}
              mode="modal"
              onChanged={(next, words) => {
                // (null, null): the block was out of date — read it again.
                if (!next && !words) openPayee(payeeSheet.id, payeeSheet.title);
                else setPayeeSheet((cur) => (cur ? { ...cur, block: next || cur.block, words } : cur));
                changed();
              }}
            />
          )}
        </Sheet>
      ) : null}

      {/* The title, description and notes */}
      <Modal visible={Boolean(editModal)} transparent animationType="fade" onRequestClose={() => setEditModal(null)}>
        {/* The notes box makes the card tall: it scrolls, and on iOS it
            rides up with the keyboard so the field being typed in stays in
            view. */}
        <KeyboardAvoidingView style={wa.keyboardWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={wa.modalBackdrop}>
            <Pressable style={absoluteFill} onPress={() => setEditModal(null)} accessibilityRole="button" accessibilityLabel="Close" />
            <View style={[wa.modalCard, wa.modalCardTall]}>
              {editModal ? <EditModalContent
                editModal={editModal}
                saving={editSaving}
                error={editError}
                onCancel={() => setEditModal(null)}
                onSubmit={submitEdit}
                onCancelWaiting={cancelWaiting}
                onLoadDownloads={loadDownloadsSwitch}
                downloadsBehind={downloadsBehind}
              /> : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Request deletion */}
      <Modal visible={Boolean(deleteModal)} transparent animationType="fade" onRequestClose={() => setDeleteModal(null)}>
        <KeyboardAvoidingView style={wa.keyboardWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={wa.modalBackdrop}>
            <Pressable style={absoluteFill} onPress={() => setDeleteModal(null)} accessibilityRole="button" accessibilityLabel="Close" />
            <View style={wa.modalCard}>
              <View style={wa.modalHeader}>
                <Text style={wa.modalHeaderText} accessibilityRole="header">Request deletion</Text>
                <Pressable onPress={() => setDeleteModal(null)} style={wa.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><CloseIcon size={16} /></Pressable>
              </View>
              {deleteModal ? (
                <Text style={wa.modalNote}>“{deleteModal.title}” will be hidden from the site right away. An admin still has to confirm the actual removal — you can cancel this request any time before then.</Text>
              ) : null}
              <Text style={wa.label}>Reason — required</Text>
              <TextInput
                style={wa.textarea}
                value={deleteReason}
                onChangeText={setDeleteReason}
                multiline
                numberOfLines={3}
                placeholderTextColor={colors.inkFaint}
                accessibilityLabel="Reason for the removal"
              />
              {deleteError ? <Text style={wa.errorText} accessibilityRole="alert">{deleteError}</Text> : null}
              <View style={wa.modalActions}>
                <Pressable style={[wa.primaryBtn, deleteSaving && wa.btnDisabled]} disabled={deleteSaving} onPress={requestDeletion} accessibilityRole="button">
                  <Text style={wa.primaryBtnText}>{deleteSaving ? 'Submitting…' : 'Request deletion'}</Text>
                </Pressable>
                <Pressable style={wa.secondaryBtn} onPress={() => setDeleteModal(null)} disabled={deleteSaving} accessibilityRole="button">
                  <Text style={wa.secondaryBtnText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );

  return { run, openMenu, element, copiedId, errors, notices, busy, extract };
}

// One ⋯ item: the icon, the rules' words, its state or price on the right
// ("On" / "Off", "$3.99 · 20% off"), and "On the website" under the ones
// the app hands to the site.
function MenuItem({ item, onPress }) {
  const Icon = MENU_ICON[item.key];
  const tint = item.danger ? colors.danger : colors.ink;
  return (
    <Pressable
      style={({ pressed }) => [ss.actionRow, wa.menuRow, pressed && ss.actionRowPressed]}
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityLabel={[item.label, item.detail, item.web ? ON_WEBSITE : ''].filter(Boolean).join(', ')}
    >
      <View style={ss.actionIcon}>
        {DOLLAR_KEYS.has(item.key) ? <Text style={wa.dollar}>$</Text> : Icon ? <Icon size={16} color={tint} /> : null}
      </View>
      <View style={wa.menuText}>
        <Text style={[ss.actionText, item.danger && { color: colors.danger }]}>{item.label}</Text>
        {item.web ? (
          <View style={wa.webLine}>
            <ExternalLinkIcon size={11} color={colors.inkDim} />
            <Text style={ss.actionNote}>{ON_WEBSITE}</Text>
          </View>
        ) : null}
      </View>
      {item.detail ? <Text style={wa.menuDetail} numberOfLines={1}>{item.detail}</Text> : null}
    </Pressable>
  );
}

// The title, description and notes box (the website's
// components/RequestEditModal.js): each field does what the field policy
// says for a title of the creator's own — on a live title it waits for
// approval, on one that has never been live it applies at once — the
// changes already waiting are listed with Cancel and the boxes start from
// them, only what changed is sent, and the Save label says what goes to
// review. Before migration 122 a live title's notes have nowhere to wait:
// the box is greyed with the reason. "Contains flashing lights" (Jose,
// 2026-11-13) rides on the same save: ticking it applies at once, a live
// title included; once a live title has it the box is ticked and greyed
// with "Only the team can remove this warning from a live title."
// "Allow downloads in the app" (Jose, 2026-11-14; a film or a short has no
// episode editor in the app, so its switch is here): the box shows once the
// title's own read has answered, for a title that can be downloaded (never
// a podcast), and rides on the same save — it applies at once, a live title
// included. On a database without migration 123 it is greyed with the
// server's line, from the read or from a save that found out.
const NOTES_122_LINE = 'Notes need a database update (migration 122).';
const DONE_WORDS = { title: 'the title', description: 'the description', pageNotes: 'the notes', hasFlashingLights: 'the flashing-lights warning', downloadsAllowed: 'downloads in the app' };
function listOf(fields) {
  const named = fields.map((f) => DONE_WORDS[f]).filter(Boolean);
  return named.length <= 1 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

function EditModalContent({ editModal, saving, error, onCancel, onSubmit, onCancelWaiting, onLoadDownloads, downloadsBehind = null }) {
  const cv = editModal.currentValues || {};
  const isEpisode = editModal.type === 'episode';
  const waitingStart = {
    title: typeof cv.pendingTitle === 'string' && cv.pendingTitle.trim() ? cv.pendingTitle : null,
    description: typeof cv.pendingDescription === 'string' && cv.pendingDescription.trim() ? cv.pendingDescription : null,
    pageNotes: typeof cv.pendingPageNotes === 'string' ? cv.pendingPageNotes : null
  };
  const start = {
    title: waitingStart.title !== null ? waitingStart.title : cv.title || '',
    description: waitingStart.description !== null ? waitingStart.description : cv.description || '',
    pageNotes: waitingStart.pageNotes !== null ? waitingStart.pageNotes : cv.pageNotes || ''
  };
  const [nameValue, setNameValue] = useState(start.title);
  const [description, setDescription] = useState(start.description);
  const notesShown = isEpisode && cv.notesShown === true;
  const [notes, setNotes] = useState(start.pageNotes);
  const startFlashing = cv.hasFlashingLights === true;
  const [flashing, setFlashing] = useState(startFlashing);
  // { allowed, locked } once the title's own read has answered; `allow` is
  // the box. No box until then, nor for a podcast.
  const downloadable = isEpisode && downloadableKind(cv.contentType);
  const [downloads, setDownloads] = useState(null);
  const [allow, setAllow] = useState(true);
  const loadDownloadsRef = useRef(onLoadDownloads);
  loadDownloadsRef.current = onLoadDownloads;
  useEffect(() => {
    if (!downloadable || !loadDownloadsRef.current) return undefined;
    let closed = false;
    Promise.resolve(loadDownloadsRef.current()).then((d) => {
      if (closed || !d) return;
      setDownloads(d);
      setAllow(d.allowed);
    }).catch(() => {});
    return () => { closed = true; };
  }, [downloadable, cv.id]);
  const downloadsLocked = downloads ? downloadsBehind || downloads.locked : null;
  const [waiting, setWaiting] = useState(waitingStart);
  const [cancelling, setCancelling] = useState(null);
  const [done, setDone] = useState(null);

  const ctx = { isUploader: true, isRunner: true, status: cv.status || 'approved', held: cv.held === true, deletionRequested: cv.deletionRequested === true, withdrawn: Boolean(cv.withdrawnAt) };
  const notes122 = (f) => f === 'pageNotes' && fieldPolicy(f, ctx) === 'staged' && cv.pageNotesWaitReady === false;
  const modeOf = (f) => (notes122(f) ? 'locked' : fieldPolicy(f, ctx));
  const lineOf = (f) => (notes122(f) ? NOTES_122_LINE : fieldPolicyLine(f, ctx));
  const open = (f) => ['direct', 'staged'].includes(modeOf(f));
  const flashingPolicy = isEpisode ? flashingLightsPolicy(ctx, startFlashing) : { mode: 'locked', line: null };
  const changes = [];
  if (nameValue.trim() !== start.title.trim()) changes.push({ field: 'title', mode: modeOf('title') });
  if (description.trim() !== start.description.trim()) changes.push({ field: 'description', mode: modeOf('description') });
  if (notesShown && notes.trim() !== start.pageNotes.trim()) changes.push({ field: 'pageNotes', mode: modeOf('pageNotes') });
  if (isEpisode && flashing !== startFlashing) changes.push({ field: 'hasFlashingLights', mode: 'direct' });
  if (downloads && !downloadsLocked && allow !== downloads.allowed) changes.push({ field: 'downloadsAllowed', mode: 'direct' });
  const summary = saveSummary(changes);
  const liveRules = ['title', 'description', 'pageNotes'].some((f) => modeOf(f) === 'staged');
  const anyWaiting = Object.values(waiting).some((v) => v !== null);

  async function send() {
    const body = {};
    for (const c of changes) {
      if (c.field === 'title') body.title = nameValue.trim();
      if (c.field === 'description') body.description = description.trim();
      if (c.field === 'pageNotes') body.pageNotes = notes.trim();
      if (c.field === 'hasFlashingLights') body.hasFlashingLights = flashing;
      if (c.field === 'downloadsAllowed') body.downloadsAllowed = allow;
    }
    const result = await onSubmit(body);
    if (result) setDone(result);
  }
  async function takeBack(field) {
    setCancelling(field);
    const okNow = await onCancelWaiting(field);
    setCancelling(null);
    if (okNow) setWaiting((w) => ({ ...w, [field]: null }));
  }

  const head = (
    <View style={wa.modalHeader}>
      <Text style={wa.modalHeaderText} accessibilityRole="header">{notesShown ? 'Title, description & notes' : 'Title & description'}</Text>
      <Pressable onPress={onCancel} style={wa.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><CloseIcon size={16} /></Pressable>
    </View>
  );

  if (done) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {head}
        <Text style={wa.doneText} accessibilityLiveRegion="polite">
          {[
            done.staged.length ? `Sent for review: ${listOf(done.staged)}. Visitors see what’s live until we approve it.` : null,
            done.applied.length ? `Saved: ${listOf(done.applied)}.` : null,
            !done.staged.length && !done.applied.length ? done.notices[0] || 'Saved.' : null,
            // The rest went through; the downloads box didn't (no migration 123).
            downloadsBehind ? `Not saved: ${DONE_WORDS.downloadsAllowed}. ${downloadsBehind}` : null
          ].filter(Boolean).join(' ')}
        </Text>
        <Pressable style={wa.primaryBtn} onPress={onCancel} accessibilityRole="button"><Text style={wa.primaryBtnText}>Close</Text></Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {head}
      <Text style={wa.modalNote}>
        {liveRules
          ? 'It’s live, so these go to Studio Tapa for approval before visitors see them — what’s there now stays until then.'
          : 'It isn’t live yet, so these apply as soon as you save.'}
      </Text>
      {anyWaiting ? (
        <View style={wa.waitingBox}>
          <Text style={wa.waitingHead}>Waiting for approval</Text>
          {['title', 'description', 'pageNotes'].filter((f) => waiting[f] !== null).map((f) => (
            <View key={f} style={wa.waitingRow}>
              <Text style={wa.waitingText}>{f === 'pageNotes' && waiting.pageNotes === '' ? 'clearing the notes' : `the new ${f === 'pageNotes' ? 'notes' : f}`}</Text>
              <Pressable style={[wa.waitingCancel, (cancelling === f || saving) && wa.btnDisabled]} disabled={cancelling === f || saving} onPress={() => takeBack(f)} accessibilityRole="button" accessibilityLabel={`Cancel the waiting ${f === 'pageNotes' ? 'notes' : f}`}>
                <Text style={wa.waitingCancelText}>{cancelling === f ? '…' : 'Cancel'}</Text>
              </Pressable>
            </View>
          ))}
          <Text style={wa.waitingFoot}>Visitors see what’s live until we approve it. The boxes below start from what waits.</Text>
        </View>
      ) : null}
      <Text style={wa.label}>{isEpisode ? 'Title' : 'Show name'}</Text>
      <TextInput style={[wa.input, !open('title') && wa.inputOff]} value={nameValue} onChangeText={setNameValue} editable={open('title')} maxLength={200} accessibilityLabel="Title" />
      {!open('title') ? <Text style={wa.notesHelp}>{lineOf('title')}</Text> : null}
      <Text style={wa.label}>Description</Text>
      <TextInput style={[wa.textarea, !open('description') && wa.inputOff]} value={description} onChangeText={setDescription} multiline numberOfLines={4} maxLength={4000} editable={open('description')} accessibilityLabel="Description" />
      {!open('description') ? <Text style={wa.notesHelp}>{lineOf('description')}</Text> : null}
      {notesShown ? (
        <>
          <View style={wa.notesLabelRow}>
            <Text style={[wa.label, wa.notesLabel]}>Notes for the title’s page <Text style={wa.notesHint}>optional · blank lines make paragraphs</Text></Text>
            <Text style={[wa.notesCount, notes.length > PAGE_NOTES_MAX && wa.notesCountOver]}>{notes.length.toLocaleString('en-US')} / {PAGE_NOTES_MAX.toLocaleString('en-US')}</Text>
          </View>
          <TextInput
            style={[wa.textarea, wa.notesInput, !open('pageNotes') && wa.inputOff]}
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={PAGE_NOTES_MAX}
            editable={open('pageNotes')}
            placeholder="How it was made, who’s in it, the story behind a scene."
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Notes for the title’s page"
          />
          <Text style={wa.notesHelp}>
            Shown on the title’s page in place of the description.{' '}
            {!open('pageNotes') ? lineOf('pageNotes') : modeOf('pageNotes') === 'staged' ? 'Waits for approval like the description.' : 'Saved at once: it isn’t live yet.'}
          </Text>
        </>
      ) : null}
      {isEpisode ? (
        <FlashingLightsField
          checked={flashing}
          onChange={setFlashing}
          locked={flashingPolicy.mode === 'locked' ? flashingPolicy.line : null}
          style={{ marginTop: 12 }}
        />
      ) : null}
      {downloads ? (
        <DownloadsAllowedField
          checked={downloadsLocked ? downloads.allowed : allow}
          onChange={setAllow}
          locked={downloadsLocked}
          style={{ marginTop: 6 }}
        />
      ) : null}
      {summary.note ? <Text style={wa.notesHelp}>{summary.note}.</Text> : null}
      {error ? <Text style={wa.errorText} accessibilityRole="alert">{error}</Text> : null}
      <View style={wa.modalActions}>
        <Pressable style={[wa.primaryBtn, (saving || changes.length === 0) && wa.btnDisabled]} disabled={saving || changes.length === 0} onPress={send} accessibilityRole="button">
          <Text style={wa.primaryBtnText}>{saving ? 'Sending…' : summary.label}</Text>
        </Pressable>
        <Pressable style={wa.secondaryBtn} onPress={onCancel} disabled={saving} accessibilityRole="button">
          <Text style={wa.secondaryBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const wa = StyleSheet.create({
  menuRow: { minHeight: 48 },
  menuText: { flex: 1, minWidth: 0, gap: 2 },
  menuDetail: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkDim, maxWidth: '45%' },
  webLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dollar: { fontFamily: fonts.monoBold, fontSize: 15, color: colors.olive },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: colors.surface1, borderRadius: 14, padding: 18, width: '100%', maxWidth: 420 },
  // The edit card with a notes box can be taller than the screen: it
  // scrolls (EditModalContent's ScrollView) inside this height.
  modalCardTall: { maxHeight: '88%' },
  keyboardWrap: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 },
  modalHeaderText: { color: colors.ink, fontSize: 16, fontFamily: fonts.displayBold, flexShrink: 1 },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  modalNote: { color: colors.inkDim, fontSize: 12.5, lineHeight: 18, marginBottom: 12, fontFamily: fonts.body },
  label: { color: colors.inkDim, fontSize: 12, fontFamily: fonts.displaySemi, marginBottom: 5, marginTop: 8 },
  input: { backgroundColor: colors.surface2, borderRadius: 8, minHeight: 44, paddingVertical: 9, paddingHorizontal: 11, color: colors.ink, fontSize: 15, fontFamily: fonts.body },
  textarea: { backgroundColor: colors.surface2, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11, color: colors.ink, fontSize: 15, fontFamily: fonts.body, minHeight: 80, textAlignVertical: 'top' },
  inputOff: { opacity: 0.5 },
  notesLabelRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  notesLabel: { flexShrink: 1 },
  notesHint: { fontFamily: fonts.body, color: colors.inkFaint },
  notesCount: { color: colors.inkFaint, fontSize: 11, fontFamily: fonts.mono, marginBottom: 5 },
  notesCountOver: { color: colors.danger },
  notesInput: { minHeight: 120 },
  notesHelp: { color: colors.inkDim, fontSize: 11.5, lineHeight: 16, marginTop: 5, fontFamily: fonts.body },
  // The changes already waiting for approval (the website's .req-edit-waiting).
  waitingBox: { padding: 10, borderRadius: 10, borderWidth: 1, borderColor: oliveTint(0.5), backgroundColor: oliveTint(0.08), marginBottom: 6, gap: 6 },
  waitingHead: { color: colors.olive, fontSize: 12.5, fontFamily: fonts.displaySemi },
  waitingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  waitingText: { color: colors.ink, fontSize: 13, flex: 1, fontFamily: fonts.body },
  waitingCancel: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: oliveTint(0.65), borderRadius: 999, paddingHorizontal: 14 },
  waitingCancelText: { color: colors.olive, fontSize: 12.5, fontFamily: fonts.displaySemi },
  waitingFoot: { color: colors.inkDim, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.body },
  doneText: { color: colors.ok, fontSize: 14, lineHeight: 20, marginBottom: 14, fontFamily: fonts.body },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18, marginTop: 6, marginBottom: 6, fontFamily: fonts.body },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  primaryBtn: { minHeight: 44, backgroundColor: colors.brass, borderRadius: 999, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  primaryBtnText: { color: colors.onBrass, fontSize: 14.5, fontFamily: fonts.displayBold },
  secondaryBtn: { minHeight: 44, borderRadius: 999, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline },
  secondaryBtnText: { color: colors.ink, fontSize: 14.5, fontFamily: fonts.displaySemi },
  btnDisabled: { opacity: 0.5 }
});

