import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { getPitchesForCreator } from '../../../lib/pitches';
import { getAuth } from '@clerk/nextjs/server';
import HeaderNav from '../../../components/HeaderNav';
import Footer from '../../../components/Footer';
import MobileTabBar from '../../../components/MobileTabBar';
import DashboardTabs from '../../../components/creator/DashboardTabs';
import PayoutsCard from '../../../components/creator/PayoutsCard';
import PitchEarnings from '../../../components/creator/PitchEarnings';
import { getEarningsForCreator } from '../../../lib/pitchDonations';
import { SITE } from '../../../lib/siteConfig';
import StartSheet from '../../../components/productions/StartSheet';
import { productionsForPitches } from '../../../lib/productions';
import { channelClock } from '../../../lib/channelEngine';
import { pitchBox } from '../../../lib/productionDashRules';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const { userId } = getAuth(req);
  const [episodes, pitches] = await Promise.all([getPublicEpisodes(), getPitchesForCreator(userId)]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  // Paid backings per project (lib/pitchDonations.js) — empty before any —
  // and the production each approved pitch grew into (2026-11-19). A read
  // that fails leaves the production boxes out rather than offering a
  // second production.
  const [earnings, productions] = await Promise.all([
    getEarningsForCreator(userId, pitches),
    productionsForPitches(pitches.filter((p) => p.status === 'approved').map((p) => p.id), { viewerId: userId, isAdmin: account.isAdmin }).catch((err) => { console.error('pitch dashboard productions:', err && err.message); return null; })
  ]);

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      pitches,
      earnings,
      productions,
      today: channelClock().date
    }
  };
}

function PitchUpdateForm({ pitchId, onPosted }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/creator/pitch-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId, title, body })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not post update.');
      setTitle('');
      setBody('');
      onPosted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: '0.8rem' }}>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <input type="text" placeholder="Update title" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ marginBottom: '0.4rem' }} />
      <textarea placeholder="What's new?" value={body} onChange={(e) => setBody(e.target.value)} rows={2} required style={{ width: '100%', boxSizing: 'border-box', marginBottom: '0.4rem' }} />
      <button className="account-btn-secondary" type="submit" disabled={saving} style={{ width: 'auto' }}>
        {saving ? 'Posting…' : 'Post update'}
      </button>
    </form>
  );
}

export default function PitchDashboard({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres, pitches, earnings = {}, productions = null, today = null }) {
  const [openUpdateFor, setOpenUpdateFor] = useState(null);
  const [postedFlash, setPostedFlash] = useState(null);
  const [starting, setStarting] = useState(null);

  return (
    <>
      <Head>
        <title>Your pitches — {SITE.name}</title>
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main className="stage stage-single">
        <div className="ca-head">
          <div>
            <div className="eyebrow">Pitch Room</div>
            <h1>Your pitches</h1>
            <p className="ca-sub">Track status, post progress updates, and see your live project pages.</p>
          </div>
          <Link href="/creator/pitch/new" className="account-btn-primary" style={{ width: 'auto', textDecoration: 'none' }}>
            + Submit a project
          </Link>
        </div>

        <DashboardTabs current="pitches" isCreator={isCreator} isAdmin={isAdmin} />

        <div style={{ marginBottom: '1rem' }}><PayoutsCard returnTo="/creator/pitch/dashboard" /></div>

        {pitches.length === 0 ? (
          <p>Nothing submitted yet.</p>
        ) : (
          pitches.map((p) => (
            <div key={p.id} className="account-card" style={{ maxWidth: 'none', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3 style={{ marginBottom: '0.2rem' }}>{p.title}</h3>
                  <span style={{ fontSize: 12, textTransform: 'uppercase', opacity: 0.65 }}>
                    {p.status === 'pending' && '⏳ Pending review'}
                    {p.status === 'approved' && '● Live'}
                    {p.status === 'rejected' && '✕ Not approved'}
                  </span>
                </div>
                {p.status === 'approved' && (
                  <Link href={`/pitches/${p.id}`} className="account-btn-secondary" style={{ width: 'auto', textDecoration: 'none' }}>
                    View live page →
                  </Link>
                )}
              </div>
              <p style={{ fontSize: '0.86rem', opacity: 0.8, marginTop: '0.6rem' }}>{p.logline}</p>
              {p.status === 'approved' && (p.funding_enabled || earnings[p.id]) && <PitchEarnings pitch={p} earnings={earnings[p.id]} />}
              {productions && (() => {
                const box = pitchBox({ pitch: p, production: productions[p.id] || null, today });
                if (!box) return null;
                return box.kind === 'start' ? (
                  <div className="pitch-ready" data-pitch={p.id}>
                    <b className="pitch-ready-title">{box.title}</b>
                    <span className="pitch-ready-line">{box.line}</span>
                    <button type="button" className="pitch-ready-go" onClick={() => setStarting(p)}>{box.button.label}</button>
                  </div>
                ) : (
                  <div className="pitch-ready running" data-pitch={p.id}>
                    <span className="pitch-ready-top"><span className="pitch-ready-pill">{box.pill}</span><span className="pitch-ready-line">{box.line}</span></span>
                    <Link href={box.button.href} className="pitch-ready-open">{box.button.label} ›</Link>
                  </div>
                );
              })()}

              {p.status === 'approved' && (
                <>
                  {openUpdateFor === p.id ? (
                    <PitchUpdateForm pitchId={p.id} onPosted={() => { setOpenUpdateFor(null); setPostedFlash(p.id); }} />
                  ) : (
                    <button className="account-btn-secondary" style={{ width: 'auto', marginTop: '0.6rem' }} onClick={() => setOpenUpdateFor(p.id)}>
                      + Post an update
                    </button>
                  )}
                  {postedFlash === p.id && <p style={{ color: 'var(--brass)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Update posted — everyone who saved this project has been notified.</p>}
                </>
              )}
              {p.status === 'pending' && (
                <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '0.6rem' }}>
                  Studio Tapa hasn't reviewed this yet — check back soon.
                </p>
              )}
            </div>
          ))
        )}
      </main>
      <Footer />
      <MobileTabBar />
      {starting && <StartSheet pitch={{ id: starting.id, title: starting.title, logline: starting.logline, tag: starting.tag }} backers={(earnings[starting.id] && earnings[starting.id].backers) || 0} onClose={() => setStarting(null)} />}
    </>
  );
}
