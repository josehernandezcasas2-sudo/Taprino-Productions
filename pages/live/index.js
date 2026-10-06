import LiveChannelsPage from '../../components/LiveChannelsPage';
import { getLivePageProps } from '../../lib/livePageProps';

// /live — the channel selector, tuned to the main channel (CH 01).
export async function getServerSideProps(ctx) {
  return getLivePageProps({ req: ctx.req, res: ctx.res, slug: null });
}

export default LiveChannelsPage;
