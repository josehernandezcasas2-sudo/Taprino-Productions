import Link from 'next/link';
import { useRouter } from 'next/router';
import ProductionShell, { shellProps } from '../../../components/productions/ProductionShell';
import ProductionForm from '../../../components/productions/ProductionForm';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { getProduction } from '../../../lib/productions';
import { ownProjectOptions } from '../../../lib/projectLink';

export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let data = null;
  let notFound = false;
  try {
    data = await getProduction(String(params.id), { viewerId: account.userId || null, isAdmin: account.isAdmin });
    if (!data.canEdit) notFound = true;
  } catch (err) {
    if (err.status === 404 || err.status === 503 || err.status === 403) notFound = true; else throw err;
  }
  const projects = data && !notFound ? await ownProjectOptions(data.production.owner.userId).catch(() => []) : [];
  return { props: { ...shellProps(account, episodes), production: data && !notFound ? JSON.parse(JSON.stringify(data.production)) : null, notFound, projects } };
}

export default function EditProduction(props) {
  const router = useRouter();
  const { production, notFound, projects } = props;
  return (
    <ProductionShell title={production ? `Edit ${production.title}` : 'Edit'} {...props}>
      <div className="crew-crumbs"><Link href="/productions">Productions</Link><span>/</span>{production && <><Link href={`/productions/${production.id}`}>{production.title}</Link><span>/</span></>}<span>Edit</span></div>
      {notFound || !production ? (
        <div className="crew-panel crew-empty">That production isn’t yours to edit.<br /><Link href="/productions" className="crew-btn sm" style={{ marginTop: '0.6rem' }}>Back to productions</Link></div>
      ) : (
        <div className="crew-card-grid">
          <ProductionForm initial={production} projects={projects} cancelHref={`/productions/${production.id}`} onSaved={() => router.push(`/productions/${production.id}`)} />
          <aside className="crew-aside">
            <div className="crew-panel crew-wc-side">
              <h3>Status, crew and days</h3>
              <p className="crew-muted" style={{ margin: 0 }}>Those live on the production page itself — change the status there, add people, add shoot days, link the release.</p>
            </div>
          </aside>
        </div>
      )}
    </ProductionShell>
  );
}
