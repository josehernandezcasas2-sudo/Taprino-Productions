import { useEffect, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { apiGet } from '../../lib/api';
import { colors } from '../../lib/theme';
import { signOutEverywhere } from '../../lib/signOut';
import { dollars } from '../../lib/creatorMoneyRules';
import PositionedImage from '../../components/PositionedImage';
import { PushPrompt } from '../../components/PushPrompt';
import { AccountFrame, useAccountData, membershipTileLines, roleBadgeFor, memberBadgeFor, styles } from '../../components/account/AccountBits';

// The account hub (option B of the "Account page" canvas, 2026-10-29;
// mirrors pages/account.js): the identity card, six tiles that carry
// their own state and open their own screen — Membership, Profile,
// Money (creator/money, with Payouts on top), Purchases, Preferences,
// Security — then Log out and a quiet line to the delete request on the
// Security screen. Until 2026-10-29 this was one long scroll of nine
// cards; those live on as account/{membership,profile,preferences,
// security}.js, sharing components/account/AccountBits.js.

function TileIcon({ kind }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'membership') return <Svg {...common} stroke={colors.olive}><Path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" /></Svg>;
  if (kind === 'profile') return <Svg {...common} stroke={colors.brass}><Circle cx="12" cy="8" r="4" /><Path d="M4 21a8 8 0 0 1 16 0" /></Svg>;
  if (kind === 'money') return <Svg {...common} stroke={colors.ok}><Circle cx="12" cy="12" r="8" /><Path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 0 1 0 3h-2a1.5 1.5 0 0 0 0 3H15" /></Svg>;
  if (kind === 'purchases') return <Svg {...common} stroke={colors.inkDim}><Path d="M4 8h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z" /><Path d="M12 8v12" /></Svg>;
  if (kind === 'preferences') return <Svg {...common} stroke={colors.inkDim}><Path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><Circle cx="16" cy="7" r="2.5" /><Circle cx="10" cy="17" r="2.5" /></Svg>;
  return <Svg {...common} stroke={colors.inkDim}><Path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /><Path d="M9 12l2 2 4-4" /></Svg>;
}

const FIRST_LINE_COLOR = { membership: colors.olive, money: colors.ok };

function Tile({ width, kind, title, lines, cta, onPress }) {
  return (
    <Pressable style={({ pressed }) => [styles.tile, { width }, pressed && styles.tilePressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}: ${cta}`}>
      <TileIcon kind={kind} />
      <Text style={styles.tileTitle}>{title}</Text>
      <View style={styles.tileLines}>
        {lines.filter(Boolean).map((l, i) => (
          <Text key={i} style={[styles.tileLine, i === 0 && styles.tileLineFirst, i === 0 && FIRST_LINE_COLOR[kind] && { color: FIRST_LINE_COLOR[kind] }]} numberOfLines={1}>{l}</Text>
        ))}
      </View>
      <Text style={styles.tileCta}>{cta} ›</Text>
    </Pressable>
  );
}

export default function Account() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  // The old deep link (BottomNav's Membership row and the website's
  // /account#membership until 2026-10-29): the Membership screen.
  const { section } = useLocalSearchParams();
  useEffect(() => { if (section === 'membership') router.replace('/account/membership'); }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  const { dashboard, profile, retry, getToken, signOut } = useAccountData({ refreshOnFocus: true });
  const signedIn = Boolean(dashboard && dashboard.isSignedIn && !dashboard.loadError);
  const isCreator = Boolean(dashboard && (dashboard.isCreator || dashboard.isAdmin));

  // The tiles' own numbers: what they own and tipped, and the creator's
  // month (the same reads the website's hub makes).
  const [purchases, setPurchases] = useState(null);
  const [tipsSent, setTipsSent] = useState(null);
  const [money, setMoney] = useState(null);
  useEffect(() => {
    if (!signedIn) return undefined;
    let cancelled = false;
    (async () => {
      const token = await getToken().catch(() => null);
      apiGet('/api/purchases', token).then((d) => { if (!cancelled) setPurchases(Array.isArray(d.items) ? d.items : []); }).catch(() => { if (!cancelled) setPurchases([]); });
      apiGet('/api/tips?mine=1', token).then((d) => { if (!cancelled) setTipsSent(Array.isArray(d.tips) ? d.tips : []); }).catch(() => { if (!cancelled) setTipsSent([]); });
      if (isCreator) apiGet('/api/creator/money', token).then((d) => { if (!cancelled) setMoney(d && !d.error ? d : false); }).catch(() => { if (!cancelled) setMoney(false); });
    })();
    return () => { cancelled = true; };
  }, [signedIn, isCreator, dashboard]); // eslint-disable-line react-hooks/exhaustive-deps

  // Two across on a phone, three on a tablet (the website's 900px step).
  const cols = width >= 900 ? 3 : 2;
  const tileW = Math.floor((width - 19 * 2 - 10 * (cols - 1)) / cols);

  let body = null;
  if (signedIn) {
    const avatarLetter = dashboard.email && dashboard.email[0] ? dashboard.email[0].toUpperCase() : '?';
    const roleBadge = roleBadgeFor(dashboard);
    const memberBadgeLabel = memberBadgeFor(dashboard);
    const avatarSrc = profile && (profile.avatarBase64 || profile.avatarUrl);
    const displayName = (profile && profile.displayName) || dashboard.email || 'Your account';
    const handle = profile && profile.handle ? `@${profile.handle}` : null;
    const ownedCount = purchases ? purchases.length : null;
    const tipCount = tipsSent ? tipsSent.length : null;
    const nextPayout = money && money.top && money.top.nextPayout;

    body = (
      <>
        {/* .account-identity */}
        <LinearGradient colors={[colors.surface2, colors.surface1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.identity}>
          <View style={styles.identityTop}>
            <PositionedImage uri={avatarSrc} position={profile && profile.avatarPosition} zoom={(profile && profile.avatarZoom) || 1} style={styles.identityAvatar}>
              {!avatarSrc ? <Text style={styles.identityAvatarLetter}>{avatarLetter}</Text> : null}
            </PositionedImage>
            <View style={styles.identityMeta}>
              <View style={styles.nameRow}>
                <Text style={styles.identityName}>{displayName}</Text>
                {roleBadge ? <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{roleBadge}</Text></View> : null}
                {memberBadgeLabel ? <View style={styles.tierBadge}><Text style={styles.tierBadgeText}>{memberBadgeLabel}</Text></View> : null}
              </View>
              <Text style={styles.identitySub}>
                {handle ? <Text style={styles.identityHandle}>{handle}</Text> : null}
                {handle && dashboard.email ? ' · ' : ''}
                {dashboard.email || 'Signed in'}
              </Text>
            </View>
          </View>
          {dashboard.userId ? (
            <Pressable style={[styles.btnSecondary, { marginBottom: 0 }]} onPress={() => router.push(`/profile/${(profile && profile.handle) || dashboard.userId}`)}>
              <Text style={styles.btnSecondaryText}>View public profile {'→'}</Text>
            </Pressable>
          ) : null}
        </LinearGradient>

        {/* Push notifications (2026-10-24): our own ask, once; the switch
            lives on the Preferences screen. */}
        <PushPrompt getToken={getToken} />

        <View style={styles.tiles} accessibilityRole="menu">
          <Tile width={tileW} kind="membership" title="Membership" cta="Manage" lines={membershipTileLines(dashboard)} onPress={() => router.push('/account/membership')} />
          <Tile
            width={tileW}
            kind="profile"
            title="Profile"
            cta="Edit"
            lines={[
              profile ? `${displayName}${handle ? ` · ${handle}` : ''}` : 'Loading…',
              'Visible to anyone',
              isCreator && profile ? (profile.aiSeal !== false ? 'Not for AI training seal on' : 'Seal off') : null
            ]}
            onPress={() => router.push('/account/profile')}
          />
          {isCreator ? (
            <Tile
              width={tileW}
              kind="money"
              title="Money"
              cta="Open"
              lines={[
                money === null ? 'Loading…' : money ? `${money.periodLabel || 'This month'} ${dollars(money.top.monthCents)}` : 'Every lane that pays you',
                money ? (nextPayout && nextPayout.willPay ? `Owed ${dollars(money.top.owedCents)} · pays on the 1st` : `Owed ${dollars(money.top.owedCents)}`) : null,
                money && money.payouts ? (money.payouts.availableCents == null ? 'Payouts: set up in Stripe' : `${dollars(money.payouts.availableCents)} in your Stripe balance`) : 'Payouts and the full history'
              ]}
              onPress={() => router.push('/creator/money')}
            />
          ) : null}
          <Tile
            width={tileW}
            kind="purchases"
            title="Purchases"
            cta="See all"
            lines={[
              ownedCount === null ? 'Loading…' : ownedCount === 0 ? 'No titles bought yet' : `${ownedCount} title${ownedCount === 1 ? '' : 's'} you own`,
              tipCount === null ? null : tipCount === 0 ? 'No tips sent' : `${tipCount} tip${tipCount === 1 ? '' : 's'} sent`,
              'Receipts and refunds'
            ]}
            onPress={() => router.push('/account/purchases')}
          />
          <Tile
            width={tileW}
            kind="preferences"
            title="Preferences"
            cta="Change"
            lines={[
              `Newsletter ${dashboard.newsletterStatus === 'subscribed' ? 'on' : dashboard.newsletterStatus === 'opted_out' ? 'off' : 'not chosen'}`,
              profile ? `Start in Stream ${profile.stayInStream ? 'on' : 'off'}` : 'Start in Stream',
              'Push notifications'
            ]}
            onPress={() => router.push('/account/preferences')}
          />
          <Tile
            width={tileW}
            kind="security"
            title="Security"
            cta="Manage"
            lines={[dashboard.email || 'Email & password', 'Two-step, devices', 'Log out, delete']}
            onPress={() => router.push('/account/security')}
          />
        </View>

        <View style={styles.hubFoot}>
          <Pressable style={[styles.btnSecondary, { marginBottom: 0, alignSelf: 'flex-start', paddingHorizontal: 22 }]} onPress={() => signOutEverywhere(signOut, getToken).catch(() => {})}>
            <Text style={styles.btnSecondaryText}>Log out of this device</Text>
          </Pressable>
          <View style={styles.deleteLine}>
            <Pressable onPress={() => router.push('/account/security?delete=1')} hitSlop={6} accessibilityRole="link">
              <Text style={styles.deleteLink}>Delete account…</Text>
            </Pressable>
            <Text style={styles.deleteNote}>Removes your profile, wishlist and viewing history for good.</Text>
          </View>
        </View>
      </>
    );
  }

  return (
    <AccountFrame dashboard={dashboard} onRetry={retry} back="stream">
      {body}
    </AccountFrame>
  );
}
