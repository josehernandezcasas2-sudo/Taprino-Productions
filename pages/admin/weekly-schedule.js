import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { listWeeklySchedule } from '../../lib/weeklySchedule';
import { hasCapability } from '../../lib/capabilities';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
const DAY_LABELS_FULL = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' };

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  // Same gate as the existing loop scheduler (admin/channel.js) — a
  // sub-admin who can manage one can manage the other.
  if (!account.canAccessAdmin || !hasCapability(account, 'manage_schedule')) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const [episodes, schedule] = await Promise.all([getPublicEpisodes(), listWeeklySchedule()]);
  return {
    props: {
      availableEpisodes: episodes.filter((e) => e.tier === 'free'),
      initialSchedule: schedule,
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function WeeklyScheduleAdmin({ availableEpisodes, initialSchedule, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [schedule, setSchedule] = useState(initialSchedule);
  const [activeDay, setActiveDay] = useState('monday');
  const [showAddForm, setShowAddForm] = useState(false);
  const [slotType, setSlotType] = useState('episode');
  const [startTime, setStartTime] = useState('');
  const [episodeId, setEpisodeId] = useState('');
  const [adMinutes, setAdMinutes] = useState('2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copyTarget, setCopyTarget] = useState('');

  async function reload() {
    const res = await fetch('/api/admin/weekly-schedule');
    const data = await res.json();
    setSchedule(data);
  }

  async function handleAddSlot(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/weekly-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayOfWeek: activeDay,
          startTime,
          slotType,
          episodeId: slotType === 'episode' ? episodeId : undefined,
          adDurationSeconds: slotType === 'ad_break' ? Number(adMinutes) * 60 : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add that slot.');
      await reload();
      setShowAddForm(false);
      setStartTime('');
      setEpisodeId('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(slotId) {
    if (!window.confirm('Remove this slot from the schedule?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/weekly-schedule', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not remove that slot.');
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!copyTarget) return;
    if (!window.confirm(`Replace ${DAY_LABELS_FULL[copyTarget]}'s entire lineup with ${DAY_LABELS_FULL[activeDay]}'s? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/weekly-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'copy_day', fromDay: activeDay, toDay: copyTarget })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not copy that day.');
      await reload();
      setCopyTarget('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const daySlots = schedule[activeDay] || [];

  return (
    <>
      <Head>
        <title>Weekly Schedule — Admin — {SITE.name}</title>
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main className="stage stage-single stage-wide">
        <h1 style={{ fontSize: '1.3rem', marginBottom: '0.3rem' }}>Weekly Schedule Builder</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1.2rem' }}>
          Day/time schedule for the Live TV channel. Times are fixed to Pacific — every viewer sees the
          same lineup, like a real broadcast channel, not personalized per timezone. Any hour with no
          slot scheduled falls back to the regular looping playlist, so the channel is never dead.
        </p>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.2rem' }}>
          {DAYS.map((day) => (
            <button
              key={day}
              className={day === activeDay ? 'account-btn-primary' : 'account-btn-secondary'}
              style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
              onClick={() => setActiveDay(day)}
            >
              {DAY_LABELS[day]}
            </button>
          ))}
        </div>

        <h2 style={{ fontSize: '1.05rem', marginBottom: '0.8rem' }}>{DAY_LABELS_FULL[activeDay]}</h2>

        {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '0.8rem' }}>{error}</p>}

        {daySlots.length === 0 && (
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
            Nothing scheduled for {DAY_LABELS_FULL[activeDay]} yet — the regular loop plays all day.
          </p>
        )}

        <div style={{ marginBottom: '1.2rem' }}>
          {daySlots.map((slot) => (
            <div
              key={slot.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.8rem 1rem',
                marginBottom: '0.5rem',
                borderRadius: '10px',
                background: slot.slotType === 'ad_break' ? 'var(--sky)' : 'var(--surface-2)',
                color: slot.slotType === 'ad_break' ? '#161425' : 'var(--ink)'
              }}
            >
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '0.92rem' }}>
                  {slot.slotType === 'ad_break' ? 'Ad break' : slot.episode?.title || 'Missing episode'}
                </div>
                <div style={{ fontSize: '0.78rem', opacity: 0.8 }}>
                  {slot.slotType === 'ad_break' ? `${Math.round(slot.durationSeconds / 60)} min · house ads` : `${slot.episode?.genre || ''}`}
                  {slot.gapAfterSeconds > 0 && ` — ${Math.round(slot.gapAfterSeconds / 60)} min gap after this before the next slot`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                  <div>{slot.startLabel}</div>
                  <div style={{ opacity: 0.7 }}>{slot.endLabel}</div>
                </div>
                <button
                  onClick={() => handleRemove(slot.id)}
                  disabled={busy}
                  style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.6, cursor: 'pointer', fontSize: '1.1rem' }}
                  aria-label="Remove slot"
                >
                  &times;
                </button>
              </div>
            </div>
          ))}
        </div>

        {!showAddForm ? (
          <button className="account-btn-secondary" style={{ width: 'auto', marginBottom: '1rem' }} onClick={() => setShowAddForm(true)}>
            + Add slot to {DAY_LABELS_FULL[activeDay]}
          </button>
        ) : (
          <form onSubmit={handleAddSlot} style={{ border: '1px solid rgba(234,231,221,0.15)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
            <label>Slot type</label>
            <select value={slotType} onChange={(e) => setSlotType(e.target.value)}>
              <option value="episode">Episode</option>
              <option value="ad_break">Ad break</option>
            </select>

            <label>Start time (Pacific)</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />

            {slotType === 'episode' ? (
              <>
                <label>Episode</label>
                <select value={episodeId} onChange={(e) => setEpisodeId(e.target.value)} required>
                  <option value="">Choose a free-tier episode…</option>
                  {availableEpisodes.map((ep) => (
                    <option key={ep.id} value={ep.id}>{ep.title} — {ep.runtime}</option>
                  ))}
                </select>
                <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>
                  Only free-tier, published episodes can go on the schedule — same rule as the looping
                  playlist, since premium content can't be exposed on the open channel.
                </p>
              </>
            ) : (
              <>
                <label>Duration (minutes)</label>
                <input type="number" min="1" max="30" value={adMinutes} onChange={(e) => setAdMinutes(e.target.value)} required />
              </>
            )}

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
              <button type="submit" className="account-btn-primary" style={{ width: 'auto' }} disabled={busy}>
                {busy ? 'Saving…' : 'Add slot'}
              </button>
              <button type="button" className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setShowAddForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div style={{ borderTop: '1px solid rgba(234,231,221,0.1)', paddingTop: '1rem' }}>
          <label>Copy {DAY_LABELS_FULL[activeDay]}&rsquo;s lineup to another day</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={copyTarget} onChange={(e) => setCopyTarget(e.target.value)} style={{ flex: 1 }}>
              <option value="">Choose a day…</option>
              {DAYS.filter((d) => d !== activeDay).map((d) => (
                <option key={d} value={d}>{DAY_LABELS_FULL[d]}</option>
              ))}
            </select>
            <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={handleCopy} disabled={!copyTarget || busy}>
              Copy
            </button>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '0.4rem' }}>
            This replaces the target day&rsquo;s entire lineup — it doesn&rsquo;t merge with whatever&rsquo;s already there.
          </p>
        </div>

        <p style={{ marginTop: '1.5rem' }}>
          <Link href="/admin/channel">← Looping playlist (the other channel scheduler)</Link>
        </p>
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
