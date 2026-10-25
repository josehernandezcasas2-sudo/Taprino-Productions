import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost, freshToken } from '../../lib/api';
import { colors } from '../../lib/theme';
import TopNav from '../../components/TopNav';
import { crew } from '../../components/CrewBits';
import { ProductionForm } from '../../components/ProductionBits';

// Start a production (pages/productions/new on the web).
export default function NewProduction() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const tokenRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      tokenRef.current = signedIn ? await freshToken(getToken) : null;
      if (tokenRef.current) {
        try { const p = await apiGet('/api/crew/my-projects', tokenRef.current); if (alive) setProjects(p.projects || []); } catch (err) { /* optional */ }
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [signedIn])); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(body) {
    setBusy(true);
    setError(null);
    try {
      const data = await apiPost('/api/productions', body, await freshToken(getToken));
      router.replace(`/productions/${data.production.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.push('/productions')} hitSlop={8}><Text style={crew.mono}>‹ Productions</Text></Pressable>
        <Text style={[crew.eyebrow, { marginTop: 10 }]}>Productions</Text>
        <Text style={crew.h1}>Start a production</Text>
        {!signedIn ? (
          <View style={crew.panel}>
            <Text style={crew.lead}>Give the shoot a page: post calls for it, book places under it, keep the call sheet, and hand out credits when it’s released.</Text>
            <Pressable style={[crew.btn, crew.btnPrimary, { alignSelf: 'flex-start' }]} onPress={() => router.push('/account')}><Text style={[crew.btnText, crew.btnPrimaryText]}>Sign in or create an account</Text></Pressable>
          </View>
        ) : loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : (
          <>
            <ProductionForm projects={projects} busy={busy} error={error} onSubmit={submit} onCancel={() => router.back()} />
            <Text style={[crew.muted, { marginTop: 12 }]}>Crew calls posted for it put people on its crew list when you book them. Location bookings land on the call sheet as shoot days. After the last day you confirm who worked; link the released title and everyone confirmed gets the credit with their role.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
