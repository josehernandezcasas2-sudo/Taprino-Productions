import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { apiPost } from '../../lib/api';
import { colors } from '../../lib/theme';
import { updateOwnProfileCache } from '../../components/TopNav';
import { rememberStayInStream } from '../../lib/stayInStream';
import { PushRow } from '../../components/PushPrompt';
import { AccountFrame, useAccountData, Row, styles } from '../../components/account/AccountBits';

// Preferences (option B, 2026-10-29; mirrors pages/account/preferences.js):
// the newsletter, "Here only for the stream?" and the push switch
// (components/PushPrompt.js PushRow). Each saves at once.
export default function AccountPreferences() {
  const { dashboard, setDashboard, retry, profile, setProfile, withToken, getToken } = useAccountData();
  const [newsletterLoading, setNewsletterLoading] = useState(false);

  async function toggleNewsletter(action) {
    setNewsletterLoading(true);
    try {
      const token = await withToken();
      const data = await apiPost('/api/newsletter-preference', { action }, token);
      setDashboard((d) => ({ ...d, newsletterStatus: data.newsletter }));
    } catch {
      // Silently ignore, same as web.
    }
    setNewsletterLoading(false);
  }

  async function toggleStayInStream() {
    const next = !(profile && profile.stayInStream);
    setProfile((p) => ({ ...p, stayInStream: next }));
    updateOwnProfileCache({ stayInStream: next });
    rememberStayInStream(next);
    try {
      const token = await withToken();
      await apiPost('/api/account/profile', { stayInStream: next }, token);
    } catch {
      setProfile((p) => ({ ...p, stayInStream: !next }));
      updateOwnProfileCache({ stayInStream: !next });
      rememberStayInStream(!next);
    }
  }

  const signedIn = Boolean(dashboard && dashboard.isSignedIn && !dashboard.loadError);
  const body = signedIn ? (
    <>
      <View style={styles.card}>
        <Text style={styles.subheading}>Email</Text>
        <Row
          label="Newsletter"
          detail={
            dashboard.newsletterStatus === 'subscribed' ? "You're subscribed to new episode and creator-update emails."
              : dashboard.newsletterStatus === 'opted_out' ? "You've opted out — you won't be asked again unless you opt back in."
              : "You haven't chosen yet — the signup panel will keep showing until you do."
          }
        >
          <Pressable style={styles.btnSmall} onPress={() => toggleNewsletter(dashboard.newsletterStatus === 'subscribed' ? 'optOut' : 'optIn')} disabled={newsletterLoading}>
            <Text style={styles.btnSmallText}>{newsletterLoading ? 'Updating…' : dashboard.newsletterStatus === 'subscribed' ? 'Opt out' : 'Opt in'}</Text>
          </Pressable>
        </Row>
      </View>

      <View style={styles.card}>
        <Text style={styles.subheading}>The app</Text>
        {profile ? (
          <Row
            label="Here only for the stream?"
            detail={profile.stayInStream ? 'On: the app opens on Stream, skipping the Studio Tapa TV homepage.' : 'Off: the app opens on the Studio Tapa TV homepage.'}
          >
            <Switch
              value={!!profile.stayInStream}
              onValueChange={toggleStayInStream}
              trackColor={{ false: colors.surface3, true: colors.brass }}
              thumbColor={colors.ink}
              ios_backgroundColor={colors.surface3}
              accessibilityLabel="Here only for the stream"
            />
          </Row>
        ) : <Text style={styles.cardP}>Loading…</Text>}
        {/* Push notifications (2026-10-24): the switch; the hub's card
            asks first. */}
        <PushRow getToken={getToken} Row={Row} />
      </View>
    </>
  ) : null;

  return (
    <AccountFrame title="Preferences" dashboard={dashboard} onRetry={retry}>
      {body}
    </AccountFrame>
  );
}
