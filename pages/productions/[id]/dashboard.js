import ProductionShell, { shellProps } from '../../../components/productions/ProductionShell';
import ProductionDashboard from '../../../components/productions/ProductionDashboard';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { getProductionDashboard } from '../../../lib/productionDashboard';
import { DASH_WORDS, dashTab, productionHref } from '../../../lib/productionDashRules';

// A production's dashboard (2026-11-19; part B of
// mockups/productions-yearly-contract.md): its owner, a listed producer, or
// a full admin. Anyone else — signed out too — goes to the production page,
// which shows them what it shows everyone (or that it isn't there).
export async function getServerSideProps({ req, res, params, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const id = String(params.id || '');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let data = null;
  try {
    data = await getProductionDashboard(id, { viewerId: account.userId || null, isAdmin: account.isAdmin });
  } catch (err) {
    if (err.extra && err.extra.code === 'not-manager') return { redirect: { destination: productionHref(id), permanent: false } };
    if (err.status === 404) return { notFound: true };
    if (err.status === 503) return { redirect: { destination: productionHref(id), permanent: false } };
    throw err;
  }
  return {
    props: {
      ...shellProps(account, episodes),
      data: JSON.parse(JSON.stringify(data)),
      initialTab: dashTab(typeof query.tab === 'string' ? query.tab : 'overview')
    }
  };
}

export default function ProductionDashboardPage(props) {
  const { data, initialTab } = props;
  return (
    <ProductionShell title={`${data.facts.production.title} · ${DASH_WORDS.link}`} description={DASH_WORDS.kicker} {...props}>
      <ProductionDashboard initialFacts={data.facts} initialTab={initialTab} bookedPlaces={data.bookedPlaces || []} />
    </ProductionShell>
  );
}
