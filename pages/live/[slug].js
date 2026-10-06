import LiveChannelsPage from '../../components/LiveChannelsPage';
import { getLivePageProps } from '../../lib/livePageProps';

// /live/<channel> — any other public channel.
export async function getServerSideProps(ctx) {
  return getLivePageProps({ req: ctx.req, res: ctx.res, slug: String(ctx.params.slug) });
}

export default LiveChannelsPage;
