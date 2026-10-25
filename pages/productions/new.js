import Link from 'next/link';
import { useRouter } from 'next/router';
import { SignInButton } from '@clerk/nextjs';
import ProductionShell, { shellProps } from '../../components/productions/ProductionShell';
import ProductionForm from '../../components/productions/ProductionForm';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { ownProjectOptions } from '../../lib/projectLink';
import { MAX_OPEN_PRODUCTIONS } from '../../lib/productionRules';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  const projects = account.isSignedIn ? await ownProjectOptions(account.userId).catch(() => []) : [];
  return { props: { ...shellProps(account, episodes), projects } };
}

export default function NewProduction(props) {
  const router = useRouter();
  const { isSignedIn, projects } = props;
  return (
    <ProductionShell title="Start a production" {...props}>
      <div className="crew-crumbs"><Link href="/productions">Productions</Link><span>/</span><span>Start one</span></div>
      {!isSignedIn ? (
        <div className="crew-panel crew-signin">
          <span className="crew-eyebrow">Productions</span>
          <h1>Start a production</h1>
          <p>Give the shoot a page: post calls for it, book places under it, keep the call sheet, and hand out credits when it’s released.</p>
          <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in or create an account</button></SignInButton>
        </div>
      ) : (
        <div className="crew-card-grid">
          <ProductionForm projects={projects} cancelHref="/productions" onSaved={(data) => router.push(`/productions/${data.production.id}`)} />
          <aside className="crew-aside">
            <div className="crew-panel crew-wc-side">
              <h3>What a production does</h3>
              <ul className="cc-rules">
                <li>Crew calls posted for it put people on its crew list the moment you book them.</li>
                <li>Location bookings for it land on the call sheet as shoot days, with the address and house rules.</li>
                <li>After the last day you confirm who worked. When the title is out on Studio Tapa, link it — everyone confirmed gets the credit with their role.</li>
                <li>Up to {MAX_OPEN_PRODUCTIONS} live at a time. Archive what’s done.</li>
              </ul>
            </div>
          </aside>
        </div>
      )}
    </ProductionShell>
  );
}
