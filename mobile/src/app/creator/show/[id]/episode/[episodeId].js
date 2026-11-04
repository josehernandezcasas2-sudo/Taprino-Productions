import { useLocalSearchParams } from 'expo-router';
import EpisodeEditor from '../../../../../components/show/EpisodeEditor';

// The episode editor (the series revamp, slice 5): /creator/show/<id>/
// episode/<episodeId>, `?draft=1` for a draft (an episode not sent yet),
// `?sent=1` right after a draft went for review. The screen is
// components/show/EpisodeEditor.js (DraftEditor.js for a draft).
export default function EpisodeEditorScreen() {
  const params = useLocalSearchParams();
  const showId = String(params.id || '');
  const episodeId = String(params.episodeId || '');
  const isDraft = params.draft === '1';
  return <EpisodeEditor key={`${showId}/${episodeId}/${isDraft ? 'd' : 'e'}`} showId={showId} episodeId={episodeId} isDraft={isDraft} sent={params.sent === '1'} />;
}
