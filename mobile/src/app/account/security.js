import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { apiPost, API_BASE_URL } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import { signOutEverywhere } from '../../lib/signOut';
import { AccountFrame, useAccountData, Row, styles } from '../../components/account/AccountBits';

// Security (option B, 2026-10-29; mirrors pages/account/security.js):
// sign-in settings (email, password, two-step, signed-in devices are
// Clerk's and live on the website's Security page — there's no in-app
// equivalent of its modal), log out of this device, and the delete
// request. The hub's "Delete account…" line opens the confirm box
// straight away (?delete=1).
export default function AccountSecurity() {
  const { delete: deleteParam } = useLocalSearchParams();
  const { dashboard, retry, withToken, getToken, signOut } = useAccountData({ withProfile: false });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(deleteParam === '1');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteRequesting, setDeleteRequesting] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  useEffect(() => { if (deleteParam === '1') setDeleteConfirmOpen(true); }, [deleteParam]);

  async function handleRequestDeletion() {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    setDeleteRequesting(true);
    setDeleteError(null);
    try {
      const token = await withToken();
      await apiPost('/api/account/request-deletion', {}, token);
      setDeleteRequested(true);
      setDeleteConfirmOpen(false);
      setDeleteConfirmText('');
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteRequesting(false);
    }
  }

  const openWebSecurity = () => Linking.openURL(`${API_BASE_URL}/account/security`).catch(() => {});

  const signedIn = Boolean(dashboard && dashboard.isSignedIn && !dashboard.loadError);
  const body = signedIn ? (
    <>
      <View style={styles.card}>
        <Text style={styles.subheading}>Sign-in</Text>
        <Row label="Email & password" detail={`${dashboard.email ? `${dashboard.email} · ` : ''}Change your email or reset your password on the website.`}>
          <Pressable style={styles.btnSmall} onPress={openWebSecurity}>
            <Text style={styles.btnSmallText}>Manage</Text>
          </Pressable>
        </Row>
        <Row label="Two-step verification" detail="An authenticator app on top of your password. Set it up on the website." divider>
          <Pressable style={styles.btnSmall} onPress={openWebSecurity}>
            <Text style={styles.btnSmallText}>Manage</Text>
          </Pressable>
        </Row>
        <Row label="Signed-in devices" detail="See every phone and browser signed in, and sign any of them out." divider>
          <Pressable style={styles.btnSmall} onPress={openWebSecurity}>
            <Text style={styles.btnSmallText}>Manage</Text>
          </Pressable>
        </Row>
      </View>

      <View style={styles.card}>
        <Text style={styles.subheading}>This device</Text>
        <Row label="Log out" detail="Sign out of Studio Tapa TV on this phone. Push notifications stop with it.">
          <Pressable style={styles.btnSmall} onPress={() => signOutEverywhere(signOut, getToken).catch(() => {})}>
            <Text style={styles.btnSmallText}>Log out</Text>
          </Pressable>
        </Row>
      </View>

      <View style={[styles.card, styles.cardDanger]}>
        <Text style={[styles.subheading, { color: colors.danger }]}>Delete account</Text>
        <Row label="Delete account" labelDanger detail="Permanently removes your profile, wishlist, and viewing history. This can’t be undone.">
          {!deleteConfirmOpen && !deleteRequested ? (
            <Pressable style={styles.btnDanger} onPress={() => setDeleteConfirmOpen(true)}>
              <Text style={styles.btnDangerText}>Delete account…</Text>
            </Pressable>
          ) : null}
        </Row>
        {deleteConfirmOpen ? (
          <View style={styles.deleteBox}>
            <Text style={styles.deleteText}>
              This sends a deletion request to our team, who will action it and confirm by email — it doesn’t delete anything
              instantly. Type <Text style={{ fontFamily: fonts.bodyBold }}>DELETE</Text> to confirm.
            </Text>
            {deleteError ? <Text style={styles.errorInline}>{deleteError}</Text> : null}
            <TextInput
              style={[styles.input, { marginBottom: 10 }]}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="characters"
            />
            <View style={styles.inlineRow}>
              <Pressable
                style={[styles.btnDanger, (deleteRequesting || deleteConfirmText.trim().toUpperCase() !== 'DELETE') && { opacity: 0.6 }]}
                disabled={deleteRequesting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                onPress={handleRequestDeletion}
              >
                <Text style={styles.btnDangerText}>{deleteRequesting ? 'Sending…' : 'Confirm request'}</Text>
              </Pressable>
              <Pressable style={styles.btnSmall} onPress={() => { setDeleteConfirmOpen(false); setDeleteConfirmText(''); setDeleteError(null); }}>
                <Text style={styles.btnSmallText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {deleteRequested ? <Text style={styles.okText}>Request sent — our team will follow up by email to confirm.</Text> : null}
      </View>
    </>
  ) : null;

  return (
    <AccountFrame title="Security" dashboard={dashboard} onRetry={retry}>
      {body}
    </AccountFrame>
  );
}
