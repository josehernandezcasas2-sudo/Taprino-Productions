import { useLocalSearchParams } from 'expo-router';
import LiveChannelScreen from '../../components/LiveChannelScreen';

// /live/<channel>: any other public channel.
export default function LiveChannel() {
  const { slug } = useLocalSearchParams();
  return <LiveChannelScreen initialSlug={slug ? String(slug) : null} />;
}
