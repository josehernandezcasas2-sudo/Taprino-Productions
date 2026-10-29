import { useEffect, useState } from 'react';
import HeaderNav from './HeaderNav';
import MobileTabBar from './MobileTabBar';

// The site header and tab bar on the 404 and 500 pages (Jose, 2026-10-28:
// every page gets the nav bar). Those two pages are static — no
// getServerSideProps, so no account bundle to hand HeaderNav — so who is
// signed in is asked from /api/account/dashboard-info once the page is
// up, and until it answers (or when it can't, which on a 500 it may well
// not) the header draws its signed-out shape. Nothing here can turn the
// error page itself into an error: the fetch's failure is caught, and the
// header is the same component every other page already renders.
export default function ErrorPageNav() {
  const [account, setAccount] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/dashboard-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setAccount(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const a = account || {};
  return (
    <>
      <HeaderNav
        activeType="All"
        mainGenres={[]}
        isSignedIn={Boolean(a.isSignedIn)}
        isSubscriber={Boolean(a.isSubscriber)}
        email={a.email || null}
        isAdmin={Boolean(a.isAdmin)}
        isCreator={Boolean(a.isCreator)}
      />
      <MobileTabBar />
    </>
  );
}
