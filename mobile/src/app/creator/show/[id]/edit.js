import { useLocalSearchParams } from 'expo-router';
import ShowEditor from '../../../../components/show/ShowEditor';

// Edit show (the series revamp, slice 5): /creator/show/<id>/edit, `?tab=art`
// opens the Art tab. The screen is components/show/ShowEditor.js.
export default function ShowEditScreen() {
  const params = useLocalSearchParams();
  const showId = String(params.id || '');
  return <ShowEditor key={showId} showId={showId} tab={params.tab === 'art' ? 'art' : 'details'} />;
}
