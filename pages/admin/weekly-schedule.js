import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { hasCapability } from '../../lib/capabilities';
import { SITE } from '../../lib/siteConfig';

// The old day-of-week schedule. Its slots became TapaTV's default schedule
// (supabase/migrations/072_live_channels.sql), which the channel scheduler
// edits from now on.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.canAccessAdmin || !hasCapability(account, 'manage_schedule')) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  return { props: {} };
}

export default function WeeklyScheduleMoved() {
  return (
    <>
      <Head>
        <title>{`Weekly Schedule — Admin — ${SITE.name}`}</title>
      </Head>
      <main className="stage stage-single">
        <div className="ca-empty" style={{ marginTop: '2rem' }}>
          <b>The weekly schedule moved</b>
          Its slots are now TapaTV&rsquo;s default schedule, which the new channel scheduler edits.
          Until that ships, TapaTV keeps playing them, and the loop fills the rest of the day.
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/live" className="account-btn-secondary">See TapaTV</Link>
            <Link href="/admin/channel" className="account-btn-secondary">Edit the loop</Link>
          </div>
        </div>
      </main>
    </>
  );
}
