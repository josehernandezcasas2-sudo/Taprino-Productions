import { useState } from 'react';
import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import { Card, Chip, Tile } from '../../components/admin/SecurityBits';
import { CHECKIN_DAYS, GRACE_DAYS, MAX_DEVICES, MAX_TITLES_PER_DEVICE, MEMBER_MAX_DAYS, KEEP_AFTER_END_DAYS } from '../../lib/downloadRules';
import { ADMIN_DOWNLOAD_WORDS, UNLOCK_WORD, adminDay, lockedLine } from '../../lib/downloadSiteRules';

// Admin → Downloads (Jose, 2026-11-14: "a section in admin to toggle this
// feature on and off, with an eventual lock on. That only admin or me can
// do. Sub admin accounts should not be able to unlock it or change it").
// The switch for downloads in the app (site_settings.downloads_enabled,
// migration 123; off until a full admin turns it on), its lock, and three
// numbers. Full admins only: adminPageProps with no capabilities, and the
// route (/api/admin/downloads) refuses a sub-admin whatever they hold.
// The rules are lib/downloadRules.js, the words lib/downloadSiteRules.js.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, {
    extra: async () => {
      const { getDownloadsAdmin } = await import('../../lib/downloads');
      return { data: await getDownloadsAdmin() };
    }
  });
}

const who = (email) => (typeof email === 'string' && email ? email.split('@')[0] : null);

export default function AdminDownloads({ account, mainGenres, data }) {
  const [view, setView] = useState(data);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  const [word, setWord] = useState('');

  const sw = view.switch;
  const ready = sw.available;
  const on = sw.enabled;

  async function change(body, key) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch('/api/admin/downloads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const next = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(next.error || 'Couldn’t save that.');
      setView(next);
      setUnlocking(false);
      setWord('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const changed = sw.changedAt ? `Last switched ${adminDay(sw.changedAt)}${who(sw.changedBy) ? ` by ${who(sw.changedBy)}` : ''}.` : null;

  return (
    <AdminShell account={account} mainGenres={mainGenres} title="Downloads" crumbs={['Site']}
      intro="Whether people can keep titles in the app to watch offline. The switch saves the moment you flip it, goes in the audit log and sends a security alert.">
      {!ready && (
        <p className="sec-banner" role="note">
          {sw.readFailed ? 'The settings couldn’t be read just now. Reload the page in a minute.' : ADMIN_DOWNLOAD_WORDS.banner}
        </p>
      )}
      <div className="sec-tiles">
        <Tile label="Downloads" value={on ? 'On' : 'Off'} tone={on ? 'ok' : 'plain'} />
        <Tile label="Phones" value={String(view.numbers.phones)} />
        <Tile label="Copies on phones" value={String(view.numbers.copies)} />
        <Tile label="Titles switched off" value={String(view.numbers.titlesOff)} />
      </div>

      <div className="sec-grid">
        <Card eyebrow="The app" title={ADMIN_DOWNLOAD_WORDS.title} id="dl-switch">
          <div className="sec-row first" data-testid="switch-downloads">
            <div className="sec-row-text">
              <p className="sec-row-title">
                <span>Downloads</span>
                <Chip tone={busy === 'enabled' ? 'muted' : on ? 'on' : 'muted'}>{busy === 'enabled' ? 'Saving…' : on ? 'On' : 'Off'}</Chip>
                {sw.locked && <Chip tone="warn">Locked</Chip>}
              </p>
              <p className="sec-p" data-testid="downloads-words">{on ? ADMIN_DOWNLOAD_WORDS.on : ADMIN_DOWNLOAD_WORDS.off}</p>
              {changed && <p className="sec-p small">{changed}</p>}
              {!ready && !sw.readFailed && <p className="sec-note">This switch needs a database update first (migration 123).</p>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label="Downloads in the app"
              className={`sec-switch${on ? ' on' : ''}`}
              disabled={!ready || sw.locked || Boolean(busy)}
              onClick={() => change({ enabled: !on }, 'enabled')}
            >
              <span aria-hidden="true" />
            </button>
          </div>

          <div className="sec-row" data-testid="lock-downloads">
            <div className="sec-row-text">
              <p className="sec-row-title"><span>The lock</span></p>
              {sw.locked ? (
                <p className="sec-p" data-testid="downloads-locked-line">{lockedLine(sw)}</p>
              ) : (
                <p className="sec-p">Locked, the switch stays as it is: nobody can flip it until a full admin unlocks it.</p>
              )}
              {sw.locked && unlocking && (
                <form
                  className="dl-unlock"
                  onSubmit={(e) => { e.preventDefault(); change({ locked: false, confirm: word.trim() }, 'locked'); }}
                >
                  <label className="sec-p small" htmlFor="dl-unlock-word">Type {UNLOCK_WORD} to unlock it.</label>
                  <div className="dl-unlock-row">
                    <input id="dl-unlock-word" className="dl-unlock-input" type="text" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus />
                    <button type="submit" className="sec-btn" disabled={Boolean(busy) || word.trim() !== UNLOCK_WORD}>{busy === 'locked' ? 'Unlocking…' : 'Unlock'}</button>
                    <button type="button" className="sec-btn" onClick={() => { setUnlocking(false); setWord(''); setError(null); }}>Cancel</button>
                  </div>
                </form>
              )}
              {sw.locked && !unlocking && (
                <div><button type="button" className="sec-btn" disabled={!ready || Boolean(busy)} onClick={() => { setUnlocking(true); setError(null); }}>{ADMIN_DOWNLOAD_WORDS.unlock}</button></div>
              )}
              {!sw.locked && (
                <div><button type="button" className="sec-btn" disabled={!ready || Boolean(busy)} onClick={() => change({ locked: true }, 'locked')}>{busy === 'locked' ? 'Locking…' : ADMIN_DOWNLOAD_WORDS.lock}</button></div>
              )}
              {error && <p className="sec-error" role="alert">{error}</p>}
            </div>
          </div>
        </Card>

        <Card eyebrow="The rules" title="Who can download, and for how long" id="dl-rules">
          <div className="sec-kv first"><p className="sec-p small"><b>Who.</b> Premium and Sponsor members (the team counts as Premium), and anyone who bought the title. Standard and Basic see &ldquo;Downloads come with Premium&rdquo;.</p></div>
          <div className="sec-kv"><p className="sec-p small"><b>A member&rsquo;s copy</b> plays offline until the end of the paid month plus {GRACE_DAYS} days, and never longer than {MEMBER_MAX_DAYS + GRACE_DAYS} days without the phone connecting. After a membership ends the files stay {KEEP_AFTER_END_DAYS} days, locked, in case they rejoin.</p></div>
          <div className="sec-kv"><p className="sec-p small"><b>A bought title</b> needs no plan; the phone connects at least every {CHECKIN_DAYS} days.</p></div>
          <div className="sec-kv"><p className="sec-p small"><b>Limits.</b> {MAX_TITLES_PER_DEVICE} titles on a phone, {MAX_DEVICES} phones an account. The app only; podcasts aren&rsquo;t downloaded.</p></div>
          <div className="sec-kv"><p className="sec-p small"><b>Creators</b> can switch downloads off for any title of theirs (&ldquo;Allow downloads in the app&rdquo; in the episode editor). Copies on phones are removed the next time they connect.</p></div>
        </Card>

        <Card eyebrow="Creators" title="Titles with downloads switched off" id="dl-titles" wide>
          {view.titlesOff.length === 0 ? (
            <p className="sec-p">No creator has switched downloads off for a title.</p>
          ) : (
            <>
              <p className="sec-p">{view.numbers.titlesOff === 1 ? 'One title' : `${view.numbers.titlesOff} titles`} can’t be downloaded because {view.numbers.titlesOff === 1 ? 'its maker' : 'their makers'} (or the team) switched it off.{view.numbers.titlesOff > view.titlesOff.length ? ` The first ${view.titlesOff.length} are listed.` : ''}</p>
              <ul className="sec-events" data-testid="downloads-titles-off">
                {view.titlesOff.map((t) => (
                  <li key={t.id}><Link href={`/admin/library?edit=${encodeURIComponent(t.id)}`}>{t.title || t.id}</Link></li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}
