import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../lib/theme';

// The Account screen's plan picker — the app's twin of
// components/MembershipPlans.js (mockups/membership-tiers.html, section 3):
// Basic plus every plan on sale (dashboard-info `plans`), the viewer's own
// plan marked, Join → Stripe Checkout in the in-app browser, Manage
// subscription → Stripe's portal (where switching plans happens).
// Tier copy mirrors lib/membershipTiers.js on the web.
const TIER_ORDER = ['basic', 'standard', 'premium', 'sponsor'];
const PAID = ['standard', 'premium', 'sponsor'];
const INFO = {
  basic: { label: 'Basic', tagline: 'with ads', perks: ['The free library, with ads', 'Live TV'], missing: ['Premium titles', 'Early screenings'] },
  standard: { label: 'Standard', tagline: 'with ads', perks: ['Everything in Basic', 'Premium titles and gated films', 'Early screenings, one day after Premium'], missing: ['Ad-free'] },
  premium: { label: 'Premium', tagline: 'no ads', flag: 'Most complete', perks: ['Everything in Standard', 'Ad-free on-demand viewing', 'Same-day early screenings', '5% off the Studio Tapa shop (soon)'], missing: [] },
  sponsor: { label: 'Sponsor', tagline: 'no ads · everything in Premium', flag: 'Launch offer · limited time', perks: ['Everything in Premium', 'Keep this price for as long as you stay', 'Sponsor badge on your profile', '5% off the Studio Tapa shop (soon)'], missing: [] }
};

const money = (plan) => new Intl.NumberFormat('en-US', { style: 'currency', currency: (plan.currency || 'usd').toUpperCase() }).format((plan.amountCents || 0) / 100);
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function MembershipPlans({ plans = [], tier = 'basic', subscriptionDetails = null, onJoin, onPortal, joiningTier = null, portalLoading = false }) {
  const paid = PAID.includes(tier);
  const byTier = Object.fromEntries(plans.map((p) => [p.tier, p]));
  let tiers = ['basic', ...TIER_ORDER.filter((t) => t !== 'basic' && byTier[t])];
  if (paid) tiers = [tier, ...tiers.filter((t) => t !== tier)];

  return (
    <View>
      {!paid ? <Text style={styles.lede}>Pick how you want to watch. Switch or cancel any time from Manage subscription.</Text> : null}
      <View style={styles.grid}>
        {tiers.map((t) => {
          const info = INFO[t];
          const plan = byTier[t] || null;
          const current = t === tier;
          const flag = current ? 'Your plan' : info.flag;
          const flagColor = current ? colors.ok : t === 'sponsor' ? colors.brass : colors.olive;
          const sub = current && subscriptionDetails;
          const accent = t === 'sponsor' ? 'brass' : t === 'premium' ? 'primary' : null;
          return (
            <View key={t} style={[styles.plan, current && styles.planCurrent, t === 'premium' && !current && styles.planFeatured, t === 'sponsor' && styles.planSponsor]}>
              {flag ? <View style={[styles.flag, { borderColor: flagColor }]}><Text style={[styles.flagText, { color: flagColor }]}>{flag}</Text></View> : null}
              <Text style={[styles.name, flag && { marginTop: 8 }]}>{plan && !plan.legacy ? plan.name : info.label}</Text>
              <Text style={styles.price}>{plan ? money(plan) : t === 'basic' ? 'Free' : '—'}{plan ? <Text style={styles.per}>  / {plan.interval || 'month'}</Text> : null}</Text>
              <Text style={styles.tag}>{sub ? `${sub.cancelsAtPeriodEnd ? 'Ends' : 'Renews'} ${fmtDate(sub.renewsAt)}` : info.tagline}</Text>
              <View style={styles.perks}>
                {info.perks.map((p) => <Text key={p} style={styles.perk}><Text style={styles.tick}>✓  </Text>{p}</Text>)}
                {info.missing.map((p) => <Text key={p} style={[styles.perk, styles.perkNo]}><Text style={styles.dash}>–  </Text>{p}</Text>)}
              </View>
              {current && paid ? (
                <Pressable style={[styles.btn, portalLoading && styles.disabled]} onPress={onPortal} disabled={portalLoading}>
                  {portalLoading ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.btnText}>Manage subscription</Text>}
                </Pressable>
              ) : null}
              {current && !paid ? <View style={[styles.btn, styles.ghost]}><Text style={styles.ghostText}>Current plan</Text></View> : null}
              {!current && t === 'basic' ? <View style={[styles.btn, styles.ghost]}><Text style={styles.ghostText}>Cancel in Manage subscription</Text></View> : null}
              {!current && t !== 'basic' ? (
                <Pressable
                  style={[styles.btn, accent === 'primary' && styles.btnPrimary, accent === 'brass' && styles.btnBrass, (joiningTier || portalLoading) && styles.disabled]}
                  disabled={Boolean(joiningTier) || portalLoading}
                  onPress={() => (paid ? onPortal() : onJoin(t))}
                >
                  {joiningTier === t
                    ? <ActivityIndicator color={accent ? '#241a05' : colors.ink} />
                    : <Text style={[styles.btnText, accent && styles.btnAccentText]}>{paid ? `Switch to ${info.label}` : t === 'sponsor' ? 'Become a Sponsor' : `Join ${info.label}`}</Text>}
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      <Text style={styles.fine}>
        {paid
          ? '“Manage subscription” opens Stripe’s own secure page — switch plans, cancel, update your card, or view invoices there.'
          : 'Live channels run ads on every plan. Payment and cancellation are handled by Stripe.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lede: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkDim, marginBottom: 6 },
  grid: { gap: 18, marginTop: 14 },
  plan: { backgroundColor: colors.surface0, borderWidth: 1, borderColor: 'rgba(251,232,211,0.1)', borderRadius: 8, paddingTop: 20, paddingHorizontal: 16, paddingBottom: 18 },
  planCurrent: { borderColor: 'rgba(132,205,152,0.5)' },
  planFeatured: { borderColor: colors.olive },
  planSponsor: { borderColor: colors.brass, backgroundColor: '#1a1424' },
  flag: { position: 'absolute', top: -11, left: 12, backgroundColor: colors.surface1, borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 9 },
  flagText: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase' },
  name: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink },
  price: { fontFamily: fonts.displayBold, fontSize: 25, color: colors.ink, marginTop: 5, fontVariant: ['tabular-nums'] },
  per: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkFaint },
  tag: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkFaint, marginTop: 2, marginBottom: 12 },
  perks: { gap: 6, marginBottom: 14 },
  perk: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim },
  perkNo: { color: colors.inkFaint },
  tick: { fontFamily: fonts.mono, color: colors.ok },
  dash: { fontFamily: fonts.mono, color: colors.inkFaint },
  btn: { borderWidth: 1, borderColor: 'rgba(251,232,211,0.2)', borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.olive, borderColor: colors.olive },
  btnBrass: { backgroundColor: colors.brass, borderColor: colors.brass },
  btnText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.ink },
  btnAccentText: { color: '#241a05' },
  ghost: { borderStyle: 'dashed' },
  ghostText: { fontFamily: fonts.displaySemi, fontSize: 14, color: colors.inkFaint },
  disabled: { opacity: 0.6 },
  fine: { fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 17, color: colors.inkFaint, marginTop: 14 }
});
