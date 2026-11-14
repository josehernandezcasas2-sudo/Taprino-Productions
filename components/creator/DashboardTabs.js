import Link from 'next/link';
import { dashboardTabs } from '../../lib/creatorDashboardRules';

// The row of tabs across the creator pages (2026-11-14, with the
// Dashboard): Overview · Your work · Numbers · Money · Pitches, and
// Creator Studio until Jose decides whether the Dashboard replaces it.
// Which tabs a person gets is lib/creatorDashboardRules.js dashboardTabs;
// someone with only Overview (a host on the Money page) gets no row.
//
// A page passes what it already knows (isCreator, isAdmin), so the row
// costs no request.
export default function DashboardTabs({ current, isCreator = false, isAdmin = false, canAccessAdmin = false }) {
  const tabs = dashboardTabs({ isCreator, isAdmin, canAccessAdmin });
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
