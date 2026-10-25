import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPatch, freshToken } from '../../../lib/api';
import { colors } from '../../../lib/theme';
import TopNav from '../../../components/TopNav';
import { crew } from '../../../components/CrewBits';
import { ProductionForm } from '../../../components/ProductionBits';

// Edit a production's details (pages/productions/<id>/edit on the web).
export default function EditProduction() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { getToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, production: null, projects: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      try {
        const token = await freshToken(getToken);
        const [d, p] = await Promise.all([apiGet(`/api/productions/${id}`, token), apiGet('/api/crew/my-projects', token).catch(() => ({ projects: [] }))]);
        if (!alive) return;
        if (!d.canEdit) setState({ loading: false, error: 'That production isn’t yours to edit.', production: null, projects: [] });
        else setState({ loading: false, error: null, production: d.production, projects: p.projects || [] });
      } catch (err) {
        if (alive) setState({ loading: false, error: err.message, production: null, projects: [] });
      }
    })();
    return () => { alive = false; };
  }, [id])); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(body) {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/productions/${id}`, body, await freshToken(getToken));
      router.replace(`/productions/${id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={crew.screen} edges={['top', 'bottom']}>
      <TopNav />
      <ScrollView contentContainerStyle={crew.stage} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.push(`/productions/${id}`)} hitSlop={8}><Text style={crew.mono}>‹ Back to the production</Text></Pressable>
        <Text style={[crew.eyebrow, { marginTop: 10 }]}>Productions</Text>
        <Text style={crew.h1}>Edit details</Text>
        {state.loading ? <ActivityIndicator color={colors.brass} style={{ marginTop: 24 }} /> : null}
        {state.error ? <Text style={crew.error}>{state.error}</Text> : null}
        {state.production ? <ProductionForm initial={state.production} projects={state.projects} busy={busy} error={error} onSubmit={submit} onCancel={() => router.back()} /> : null}
        {state.production ? <Text style={[crew.muted, { marginTop: 12 }]}>Status, crew, shoot days and the release link live on the production page itself.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
