import { useEffect, useState } from 'react';
import Link from 'next/link';
import { dashboardTabs } from '../../lib/creatorDashboardRules';

// The row of tabs across the creator pages (2026-11-14, with the
// Dashboard): Overview · Your work · Numbers · Money · Pitches, and
// Creator Studio until Jose decides whether the Dashboard replaces it.
// Which tabs a person gets is lib/creatorDashboardRules.js dashboardTabs;
// someone with only Overview (a host on the Money page) gets no row.
//
// A page passes what it already knows (isCreator, isAdmin). Whether a
// sub-admin is looking is asked from /api/my-role only when neither is
// true, so a creator's page makes no extra request.
export default function DashboardTabs({ current, isCreator = false, isAdmin = false, canAccessAdmin = null }) {
  const [team, setTeam] = useState(canAccessAdmin === true);
  const known = canAccessAdmin != null || isCreator || isAdmin;
  useEffect(() => {
    if (known) return undefined;
    let on = true;
    fetch('/api/my-role')
      .then((r) => r.json())
      .then((d) => { if (on) setTeam(Boolean(d && d.canAccessAdmin)); })
      .catch(() => {});
    return () => { on = false; };
  }, [known]);

  const tabs = dashboardTabs({ isCreator, isAdmin, canAccessAdmin: canAccessAdmin != null ? canAccessAdmin : team });
  if (tabs.length < 2) return null;
  return (
    <nav className="dash-tabs" aria-label="Creator pages">
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} className={`dash-tab${tab.key === current ? ' on' : ''}`} aria-current={tab.key === current ? 'page' : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
