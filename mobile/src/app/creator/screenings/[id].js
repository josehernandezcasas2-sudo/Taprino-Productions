import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../lib/stableAuth';
import {
  REFUSALS, SCREENING_WORDS, SCREENING_WORDS_APP, VIEWER_WORDS,
  agoLabel, inviteText, linkDashboard, positionLabel, screeningHref, screeningText, targetTabHref, yourOpensLine
} from '../../../lib/screeningRules';
import { TITLE_WORDS } from '../../../lib/titleDashRules';
import { colors, fonts, inkTint } from '../../../lib/theme';
import { AccountFrame } from '../../../components/account/AccountBits';
import { Avatar } from '../../../components/CrewBits';
import { Tiles } from '../../../components/dashboard/DashSections';
import { SwitchRow } from '../../../components/show/EditorBits';
import { WarningIcon } from '../../../components/WorkIcons';
import { hrefToRoute } from '../../../components/PushListener';
import NewLinkSheet from '../../../components/screenings/NewLinkSheet';
import { Btn, LoadState, StatePill, TonePill, WindowBar, idPart, sb, screeningCall, upperFirst, useCopy, useNow } from '../../../components/screenings/ScreeningBits';

// A private screening link's own screen in the app (2026-11-21; the canvas
// board AppLink, mockups/private-screenings-contract.md "App"). In the
// board's order, from lib/screeningRules.js linkDashboard: the Back pill to
// the Private screenings tab it came from, the state and "watching" pills,
// who it's for and what it plays, Share the invite / Copy password / Copy
// link, the window as a bar (opens as white dots, turned-away tries as red
// ones), the four numbers two across, Who watched (watching now, the
// two-cities heads-up, how much each person watched), Turned away, Where it
// was opened, Settings (Edit settings → the New link sheet; New password),
// and End it now… (asked first). An ended link has Run it again (the sheet
// again, with a new address and password) and Discard… (asked first).
//
// GET /api/screenings/<id> → { link, target, views, refusals }; read on
// every visit, every 30 s while it's in front, after every change and when
// pulled to refresh. A screening plays on the website only: nothing here
// opens the viewer's page.
//
// Params: id (the link's uuid).

const first = (v) => (Array.isArray(v) ? v[0] : v);
const LINK_ID = /^[0-9a-f-]{36}$/i;
const POLL_MS = 30000;

export default function ScreeningRoute() {
  const { id } = useLocalSearchParams();
  return <ScreeningScreen key={String(first(id) || '')} />;
}

function ScreeningScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = String(first(params.id) || '');
  const validId = LINK_ID.test(id);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const enabled = Boolean(isLoaded && isSignedIn && validId);
  const [box, setBox] = useState({ state: 'loading', data: null, error: null, code: null });
  const [now, setNow] = useNow(POLL_MS);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState(null); // 'edit' | 'again'
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [withPassword, setWithPassword] = useState(false);
  const { copied, copy } = useCopy();
  const seq = useRef(0);
  const openNext = useRef(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const mine = ++seq.current;
    const r = await screeningCall('GET', `/api/screenings/${idPart(id)}`, null, getToken);
    if (mine !== seq.current) return;
    setNow(Date.now());
    if (r.ok && r.data && r.data.link) setBox({ state: 'ok', data: r.data, error: null, code: null });
    else if (r.ok) setBox({ state: 'failed', data: null, error: SCREENING_WORDS_APP.notFound, code: null });
    // A failed re-read keeps what was on screen (a refusal or a 404 doesn't).
    else setBox((b) => (b.state === 'ok' && ![403, 404, 503].includes(r.status) ? b : { state: 'failed', data: null, error: r.status === 404 ? SCREENING_WORDS_APP.notFound : r.error, code: r.code }));
  }, [enabled, id, getToken, setNow]);

  useFocusEffect(useCallback(() => {
    if (!enabled) return undefined;
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, load]));

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const data = box.data;
  const link = data ? data.link : null;
  const target = data ? data.target : null;
  const views = data && Array.isArray(data.views) ? data.views : [];
  const refusals = data && Array.isArray(data.refusals) ? data.refusals : [];
  const dash = useMemo(() => (link ? linkDashboard({ link, target, views, refusals, now }) : null), [link, target, views, refusals, now]);
  // The names of the accounts that opened it, for the Edit sheet's named people.
  const names = useMemo(() => {
    const out = {};
    for (const v of views) if (v && v.userId && v.name) out[v.userId] = v.name;
    return out;
  }, [views]);

  // Back to the tab it was made on (the title's or the show's).
  const tabRoute = link ? ((hrefToRoute(targetTabHref(link.target)) || {}).route || null) : null;
  const back = tabRoute ? { href: tabRoute, label: SCREENING_WORDS.tab } : { href: '/account/my-work', label: TITLE_WORDS.back };
  const dashboard = !isLoaded ? null : { isSignedIn: Boolean(isSignedIn) };

  const frame = (children) => (
    <AccountFrame
      title={null}
      dashboard={dashboard}
      back={back}
      refreshControl={enabled ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brass} /> : undefined}
    >
      {children}
    </AccountFrame>
  );

  if (!validId) return frame(<View style={sb.card}><Text style={sb.small}>{SCREENING_WORDS_APP.notFound}</Text></View>);
  if (box.state !== 'ok' || !dash) {
    const final = box.code === 'migration-128' || box.code === 'not-yours' || box.error === SCREENING_WORDS_APP.notFound;
    return frame(
      <View style={sb.card}>
        <LoadState state={box.state === 'loading' ? 'loading' : 'failed'} error={box.error} onRetry={final ? null : () => { setBox((b) => ({ ...b, state: 'loading' })); load(); }} />
      </View>
    );
  }

  const actions = dash.actions;
  const ended = dash.state.key === 'ended';
  const invite = () => inviteText({ title: target ? target.title : '', ownerName: target ? target.ownerName : '', url: link.url, startsAt: link.startsAt, endsAt: link.endsAt, password: link.password, includePassword: withPassword, now });

  async function act(key, method, path, body) {
    setBusy(key);
    setNotice(null);
    const r = await screeningCall(method, path, body, getToken);
    setBusy(null);
    if (!r.ok) {
      setNotice({ tone: 'error', text: r.error });
      if (r.code === 'ended' || r.code === 'not-ended') load();
      return null;
    }
    return r.data || {};
  }

  async function newPassword() {
    const d = await act('password', 'PATCH', `/api/screenings/${idPart(link.id)}`, { action: 'password' });
    if (d && d.link) {
      setBox((b) => ({ ...b, data: { ...b.data, link: d.link } }));
      if (d.link.password) setNotice({ tone: 'ok', text: `${VIEWER_WORDS.password_label}: ${d.link.password}` });
    }
  }

  function endNow() {
    Alert.alert(screeningText('endAsk', { label: link.label }), SCREENING_WORDS.endLine, [
      { text: SCREENING_WORDS.keep, style: 'cancel' },
      {
        text: SCREENING_WORDS.endYes,
        style: 'destructive',
        onPress: async () => {
          const d = await act('end', 'PATCH', `/api/screenings/${idPart(link.id)}`, { action: 'end' });
          if (d && d.link) setBox((b) => ({ ...b, data: { ...b.data, link: d.link } }));
          load();
        }
      }
    ]);
  }

  function discard() {
    Alert.alert(screeningText('discardAsk', { label: link.label }), SCREENING_WORDS.discardLine, [
      { text: SCREENING_WORDS.keep, style: 'cancel' },
      {
        text: SCREENING_WORDS.discardYes,
        style: 'destructive',
        onPress: async () => {
          const d = await act('discard', 'DELETE', `/api/screenings/${idPart(link.id)}`, {});
          if (d) router.dismissTo(back.href);
        }
      }
    ]);
  }

  // The sheet closed: after Run it again, the new link's screen takes this
  // one's place (Back still goes to the tab); otherwise read it again.
  function closeSheet() {
    setSheet(null);
    const next = openNext.current;
    openNext.current = null;
    if (next) router.replace(screeningHref(next));
    else load();
  }

  const tiles = dash.tiles.map((t) => ({ key: t.key, label: t.label, value: t.of ? `${t.value} ${t.of}` : t.value, sub: t.sub || null }));
  const dots = dash.timeline.opens.length + dash.timeline.refused.length > 0;

  return frame(
    <View style={st.body}>
      <View style={sb.wrap}>
        <StatePill state={dash.state} />
        {dash.watchingLine ? <TonePill label={dash.watchingLine} tone="brass" dot /> : null}
      </View>
      <View style={{ gap: 4 }}>
        <Text style={st.h1} accessibilityRole="header">{dash.label}</Text>
        <Text style={sb.small}>{dash.sub}</Text>
      </View>

      {actions.copy ? (
        <View style={{ gap: 8 }}>
          <View style={sb.wrap}>
            <Btn label={SCREENING_WORDS.shareInvite} kind="primary" grow onPress={() => Share.share({ message: invite() }).catch(() => {})} />
            {link.password ? <Btn label={copied === 'pw' ? SCREENING_WORDS.copied : SCREENING_WORDS.copyPassword} grow onPress={() => copy('pw', link.password)} /> : null}
            <Btn label={copied === 'link' ? SCREENING_WORDS.copied : SCREENING_WORDS.copyLink} grow onPress={() => copy('link', link.url)} />
          </View>
          {link.password ? <SwitchRow title={SCREENING_WORDS.includePassword} on={withPassword} onChange={setWithPassword} /> : null}
        </View>
      ) : null}

      {notice ? <Text style={notice.tone === 'error' ? sb.error : sb.ok} accessibilityLiveRegion="polite">{notice.text}</Text> : null}

      {/* The window */}
      <View style={sb.card} accessible accessibilityLabel={`${SCREENING_WORDS.whenItWorks}: ${dash.timeline.startLabel} → ${dash.timeline.endLabel}. ${dash.timeline.leftLabel}`}>
        <Text style={[st.left, ended && { color: colors.inkDim }]}>{dash.timeline.leftLabel}</Text>
        <WindowBar thick progress={dash.timeline.progress} opens={dash.timeline.opens} refused={dash.timeline.refused} />
        <View style={st.ends}>
          <Text style={[sb.k, st.endLeft]}>{dash.timeline.startLabel}</Text>
          <Text style={[sb.k, st.endRight]}>{dash.timeline.endLabel}</Text>
        </View>
        {dots ? <Text style={sb.fine}>{SCREENING_WORDS.timelineKey}</Text> : null}
      </View>

      <Tiles tiles={tiles} />

      {/* Who watched */}
      <View style={[sb.card, { gap: 0 }]}>
        <View style={[sb.between, { paddingBottom: 8 }]}>
          <Text style={sb.label} accessibilityRole="header">{SCREENING_WORDS.whoWatched}</Text>
          {dash.people.length > 1 ? <Text style={sb.k}>{SCREENING_WORDS.newestFirst}</Text> : null}
        </View>
        {!dash.people.length ? <Text style={sb.small}>{SCREENING_WORDS.nobodyYet}</Text> : null}
        {dash.people.map((p) => <PersonRow key={p.key} person={p} link={link} now={now} />)}
      </View>

      {/* Turned away */}
      {dash.refusals.length ? (
        <View style={[sb.card, { gap: 8 }]}>
          <Text style={sb.label} accessibilityRole="header">{`${SCREENING_WORDS.turnedAway} · ${dash.numbers.refused}`}</Text>
          <Text style={sb.fine}>{SCREENING_WORDS.turnedAwayLine}</Text>
          {dash.refusals.map((r) => (
            <View key={`${r.key}-${r.at}`} style={[st.refusal]}>
              <Text style={st.refusalWhat}>{[r.what, r.who !== 'Guest' ? r.who : null, r.place, r.outcome].filter(Boolean).join(' · ')}</Text>
              <Text style={sb.fine}>{[r.when, r.device].filter(Boolean).join(' · ')}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Where it was opened */}
      {dash.places.length ? (
        <View style={[sb.card, { gap: 6 }]}>
          <Text style={sb.label} accessibilityRole="header">{SCREENING_WORDS.whereOpened}</Text>
          {dash.places.map((pl) => (
            <View key={pl.place} style={[sb.between, st.placeRow]}>
              <Text style={[st.placeName, pl.turnedAway && { color: colors.warn }]} numberOfLines={2}>{pl.place}</Text>
              <Text style={[sb.k, pl.turnedAway && { color: colors.warn }]}>{pl.line}</Text>
            </View>
          ))}
          <Text style={sb.fine}>{SCREENING_WORDS.placeNote}</Text>
        </View>
      ) : null}

      {/* Settings */}
      <View style={[sb.card, { gap: 8 }]}>
        <Text style={sb.label} accessibilityRole="header">{SCREENING_WORDS.settings}</Text>
        {dash.settings.map((row) => (
          <View key={row.key} style={st.settingRow}>
            <Text style={sb.k}>{row.label}</Text>
            <Text style={[st.settingV, row.mono && st.mono]} selectable={row.key === 'password'}>{row.value}</Text>
          </View>
        ))}
        {actions.edit || actions.newPassword ? (
          <>
            <View style={sb.wrap}>
              {actions.edit ? <Btn label={SCREENING_WORDS.editSettings} grow onPress={() => setSheet('edit')} /> : null}
              {actions.newPassword ? <Btn label={SCREENING_WORDS.newPassword} grow busy={busy === 'password'} onPress={newPassword} /> : null}
            </View>
            <Text style={sb.fine}>{SCREENING_WORDS.newPasswordLine}</Text>
          </>
        ) : null}
      </View>

      {actions.end ? <Btn label={SCREENING_WORDS.endNow} kind="danger" busy={busy === 'end'} onPress={endNow} /> : null}
      {ended ? (
        <View style={[sb.card, { gap: 10 }]}>
          <Text style={sb.small}>{SCREENING_WORDS.endedLine}</Text>
          <View style={sb.wrap}>
            {actions.runAgain ? <Btn label={SCREENING_WORDS.runAgain} kind="primary" grow onPress={() => setSheet('again')} /> : null}
            {actions.discard ? <Btn label={SCREENING_WORDS.discard} kind="danger" grow busy={busy === 'discard'} onPress={discard} /> : null}
          </View>
        </View>
      ) : null}

      {target ? (
        <NewLinkSheet
          visible={Boolean(sheet)}
          mode={sheet || 'edit'}
          link={link}
          target={target}
          names={names}
          getToken={getToken}
          onClose={closeSheet}
          onSaved={(saved) => {
            if (sheet === 'again' && saved && saved.id) openNext.current = saved.id;
            else if (saved) setBox((b) => ({ ...b, data: { ...b.data, link: saved } }));
          }}
          onOpenLink={() => closeSheet()}
        />
      ) : null}
    </View>
  );
}

// One person on Who watched: their photo (focal point and zoom), name,
// where, on what, when and how many of their opens; the two-cities
// heads-up; how much they watched, or where they are now.
function PersonRow({ person: p, link, now }) {
  const color = p.watchingNow ? colors.brass : p.percent >= 95 ? colors.mint : colors.olive;
  const opens = link.perPerson ? yourOpensLine(p.opens, link.perPerson) : null;
  return (
    <View style={st.person}>
      {p.guest ? (
        <View style={st.guest}><Text style={st.guestText}>{p.initials}</Text></View>
      ) : (
        <Avatar userId={p.userId} name={p.name} src={p.avatar ? p.avatar.url : null} position={p.avatar ? p.avatar.position : null} zoom={p.avatar ? p.avatar.zoom : 1} size={36} />
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={st.personName} numberOfLines={1}>{p.handle ? `${p.name} · @${p.handle}` : p.name}</Text>
        {p.twoCities ? (
          <View style={st.warnRow}>
            <WarningIcon size={13} color={colors.warn} />
            <Text style={[st.personSub, { color: colors.warn, flex: 1 }]}>{[p.placeLine, p.twoCitiesLine].filter(Boolean).join(' · ')}</Text>
          </View>
        ) : null}
        <Text style={st.personSub}>{[p.twoCities ? null : p.placeLine, p.device, agoLabel(p.lastAt, now), opens].filter(Boolean).join(' · ')}</Text>
        {p.maxedOut ? <Text style={[st.personSub, { color: colors.warn }]}>{REFUSALS.person_opens}</Text> : null}
        <View style={st.watchBar}><View style={[st.watchFill, { width: `${Math.max(0, Math.min(100, p.percent))}%`, backgroundColor: color }]} /></View>
        <Text style={[st.personSub, p.watchingNow && { color: colors.brass }]}>
          {p.watchingNow ? `● ${SCREENING_WORDS_APP.watchingNow}${p.position != null ? ` · ${positionLabel(p.position)}` : ''}` : upperFirst(p.watchedLine)}
        </Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  body: { gap: 14 },
  h1: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 29, color: colors.ink },
  left: { fontFamily: fonts.displaySemi, fontSize: 15, color: colors.ink },
  ends: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  endLeft: { flex: 1 },
  endRight: { flex: 1, textAlign: 'right' },

  person: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  guest: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  guestText: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.inkDim },
  personName: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.ink },
  personSub: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.inkDim },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  watchBar: { height: 4, borderRadius: 999, backgroundColor: colors.surface3, overflow: 'hidden', marginTop: 4 },
  watchFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999 },

  refusal: { gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  refusalWhat: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink },
  placeRow: { minHeight: 32, borderTopWidth: 1, borderTopColor: inkTint(0.08), paddingTop: 6 },
  placeName: { flex: 1, minWidth: 0, fontFamily: fonts.display, fontSize: 14, color: colors.ink },

  settingRow: { gap: 2, paddingVertical: 6, borderTopWidth: 1, borderTopColor: inkTint(0.08) },
  settingV: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  mono: { fontFamily: fonts.mono, fontSize: 14, letterSpacing: 0.4 }
});
