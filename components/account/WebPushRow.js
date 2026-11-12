import { useEffect, useState } from 'react';
import { SITE } from '../../lib/siteConfig';
import { HOME_SCREEN_LINE, MIGRATION_LINE, NOT_SET_UP_LINE, unblockSteps } from '../../lib/webPushRules';
import { fetchPushStatus, readPushState, turnOffPush, turnOnPush } from '../../lib/webPushClient';

// "Notifications on this browser" on /account/preferences (Jose,
// 2026-11-12: web push; lib/webPushClient.js does the work). The browser
// is asked only after the switch is clicked. What the row says follows
// lib/webPushRules.js browserPushState: iPhone/iPad outside the Home
// Screen, a browser that can't, not set up yet (no keys in Vercel),
// migration 122 not run, blocked (with how to undo it), on, off.
export default function WebPushRow({ Switch }) {
  const [status, setStatus] = useState(null);
  const [state, setState] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchPushStatus();
        const read = await readPushState(s);
        if (!cancelled) {
          setStatus(s);
          setState(read.state);
        }
      } catch (err) {
        if (!cancelled) {
          setState('error');
          setError('Couldn’t check this browser just now. Reload the page to try again.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function toggle() {
    if (busy || !status) return;
    setBusy(true);
    setError(null);
    try {
      // turnOnPush asks the browser first thing, still inside the click.
      const result = state === 'on' ? await turnOffPush({ reason: 'switched-off' }) : await turnOnPush(status);
      setState(result.state);
      if (result.error) setError(result.error);
    } catch (err) {
      setState('off');
      setError('Couldn’t turn notifications on in this browser. Try again.');
    }
    setBusy(false);
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const detail = {
    loading: 'Checking this browser…',
    error: null,
    'home-screen': HOME_SCREEN_LINE(SITE.name),
    unsupported: 'This browser can’t show notifications from websites.',
    'not-set-up': NOT_SET_UP_LINE,
    migration: MIGRATION_LINE,
    blocked: `Blocked in this browser’s settings. ${unblockSteps(ua)}`,
    on: 'On — messages, calls and payouts show up here, even with the site closed.',
    off: 'Off — turn it on to get messages, calls and payouts here, even with the site closed. Your browser asks first.'
  }[state];
  const showSwitch = state === 'on' || state === 'off' || state === 'loading';

  return (
    <div className="account-row">
      <div>
        <div className="account-row-label">On this browser</div>
        {detail && <div className="account-row-detail">{detail}</div>}
        {error && <div className="account-row-detail" role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
      </div>
      {showSwitch && <Switch on={state === 'on'} onToggle={toggle} label="Notifications on this browser" busy={busy || state === 'loading'} />}
    </div>
  );
}
