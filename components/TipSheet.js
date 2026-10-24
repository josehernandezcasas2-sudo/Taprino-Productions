import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import Link from 'next/link';
import { CloseIcon, usePlayerIconOverrides } from './PlayerIcons';
import AvatarPhoto from './AvatarPhoto';
import { tipQuote, parseTipAmount, validateTipInput, MAX_NOTE_CHARS, MIN_TIP_CENTS, DEFAULT_TIP_MAX_CENTS, TIP_PRESETS_CENTS } from '../lib/tipRules';
import { dollars } from '../lib/purchaseRules';
import { SITE } from '../lib/siteConfig';

// Tips, the fan's side (mockup 2026-10-24, decisions the same day): the
// sheet, the buttons that open it, the end-of-episode card and the banner
// back from Checkout. `tipping` comes from lib/tips.js getTipping:
//   { enabled, creatorId, creatorName, creatorAvatar, cutPercent, maxCents,
//     minCents, presets, fiscalSponsor }
// and is { enabled: false } when the creator's Stripe account can't take
// charges yet, for your own profile, or for someone who isn't a creator;
// every button here renders nothing then. The fan covers the card fee on
// top of the tip so the creator keeps more; the note is optional and
// moderated; "Show my name" is on by default (off = "A fan").
// mobile/src/components/TipSheet.js mirrors it.

const short = (name) => (name || 'the creator').trim().split(/\s+/)[0];
const whole = (cents) => dollars(cents).replace(/\.00$/, '');

export function TipSheet({ tipping, initialAmountCents = 500, onClose }) {
  const router = useRouter();
  const iconOverrides = usePlayerIconOverrides();
  const presets = tipping.presets || TIP_PRESETS_CENTS;
  const [amountCents, setAmountCents] = useState(initialAmountCents);
  const [custom, setCustom] = useState(!presets.includes(initialAmountCents));
  const [customInput, setCustomInput] = useState(presets.includes(initialAmountCents) ? '25' : (initialAmountCents / 100).toFixed(2).replace(/\.00$/, ''));
  const [note, setNote] = useState('');
  const [showName, setShowName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const name = short(tipping.creatorName);
  const maxCents = tipping.maxCents || DEFAULT_TIP_MAX_CENTS;
  const minCents = tipping.minCents || MIN_TIP_CENTS;
  const cents = custom ? parseTipAmount(customInput) : amountCents;
  const check = validateTipInput({ amountCents: cents, note, showName }, { maxCents });
  const quote = check.ok ? tipQuote(check.amountCents, tipping.cutPercent) : null;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send() {
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tips/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: tipping.creatorId, amountCents: check.amountCents, note: check.note, showName: check.showName, returnTo: router.asPath.split('?')[0] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start the tip.');
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const initial = (tipping.creatorName || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-card tip-modal" role="dialog" aria-modal="true" aria-labelledby="tip-sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header tip-head">
          <div className="tip-head-id">
            <AvatarPhoto className="tip-avatar" url={tipping.creatorAvatar ? tipping.creatorAvatar.url : null} position={tipping.creatorAvatar ? tipping.creatorAvatar.position : null} zoom={tipping.creatorAvatar ? tipping.creatorAvatar.zoom : 1}>
              {initial}
            </AvatarPhoto>
            <div>
              <span className="tip-kicker">Fan support</span>
              <h3 className="tip-title" id="tip-sheet-title">Tip {tipping.creatorName}</h3>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><CloseIcon size={16} src={iconOverrides.close} /></button>
        </div>

        <div className="tip-presets" role="group" aria-label="Amount">
          {presets.map((p) => (
            <button key={p} type="button" className={`tip-preset${!custom && amountCents === p ? ' on' : ''}`} aria-pressed={!custom && amountCents === p} onClick={() => { setCustom(false); setAmountCents(p); setError(null); }}>
              {whole(p)}
            </button>
          ))}
          <button type="button" className={`tip-preset${custom ? ' on' : ''}`} aria-pressed={custom} onClick={() => { setCustom(true); setError(null); }}>Custom</button>
        </div>
        {custom && (
          <label className="tip-field">
            Your amount, {whole(minCents)} to {whole(maxCents)}
            <input type="text" inputMode="decimal" value={customInput} onChange={(e) => { setCustomInput(e.target.value); setError(null); }} autoFocus />
          </label>
        )}

        <label className="tip-field">
          <span className="tip-count"><span>Say something (optional)</span><small>{MAX_NOTE_CHARS - note.length}</small></span>
          <textarea rows={2} maxLength={MAX_NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`what you loved about ${name}’s work`} />
        </label>

        <div className="tip-math" aria-live="polite">
          <div><span>{name} receives</span><b>{quote ? dollars(quote.creatorCents) : '—'}</b></div>
          <div><span>{SITE.name} ({tipping.cutPercent}%)</span><b>{quote ? dollars(quote.cutCents) : '—'}</b></div>
          <div><span>Card processing, covered by you so {name} keeps more</span><b>{quote ? dollars(quote.feeCents) : '—'}</b></div>
          <div className="total"><span>You pay</span><b>{quote ? dollars(quote.totalCents) : '—'}</b></div>
        </div>

        <label className="tip-check">
          <span>Show my name to {name} <span style={{ color: 'var(--ink-faint)' }}>· otherwise &ldquo;a fan&rdquo;</span></span>
          <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
        </label>

        {error && <p className="tip-error" role="alert">{error}</p>}
        <button type="button" className="tip-go" onClick={send} disabled={busy || !check.ok}>
          {busy ? 'Opening Stripe…' : `Tip ${quote ? whole(quote.amountCents) : ''} →`}
        </button>
        <p className="tip-fine">
          Opens Stripe Checkout. A tip is a thank-you, not a purchase and not a donation: it buys nothing, isn&rsquo;t tax-deductible and is final unless the studio refunds it. Your note is moderated; be kind. <Link href="/terms#tips" target="_blank" rel="noopener">The rules</Link>.
          {tipping.fiscalSponsor && tipping.fiscalSponsor.url && (
            <> Prefer a tax-deductible donation? {name}&rsquo;s work is fiscally sponsored by <a href={tipping.fiscalSponsor.url} target="_blank" rel="noopener noreferrer">{tipping.fiscalSponsor.name || 'a nonprofit'}</a>; give through them.</>
          )}
        </p>
      </div>
    </div>
  );
}

// Opens the sheet; signed-out viewers get the sign-in modal first. Renders
// nothing when the creator can't be tipped. `children` is the label.
export function TipButton({ tipping, isSignedIn, className = '', presetCents = 500, children, title }) {
  const router = useRouter();
  const { openSignIn } = useClerk();
  const [open, setOpen] = useState(false);
  if (!tipping || !tipping.enabled) return null;
  function click() {
    if (!isSignedIn) {
      openSignIn({ redirectUrl: router.asPath });
      return;
    }
    setOpen(true);
  }
  return (
    <>
      <button type="button" className={className} onClick={click} title={title}>{children || `Tip ${short(tipping.creatorName)}`}</button>
      {open && <TipSheet tipping={tipping} initialAmountCents={presetCents} onClose={() => setOpen(false)} />}
    </>
  );
}

// Once per title (localStorage), over the player after the credits
// start. `onNext` + `nextTitle`: a series' next episode, which also
// counts down (the autoplay the page did before this card existed).
const SEEN_KEY = 'tip_end_seen';
export function tipEndCardSeen(episodeId) {
  try {
    const seen = JSON.parse(window.localStorage.getItem(SEEN_KEY) || '[]');
    return seen.includes(episodeId);
  } catch { return false; }
}
export function markTipEndCardSeen(episodeId) {
  try {
    const seen = JSON.parse(window.localStorage.getItem(SEEN_KEY) || '[]');
    if (!seen.includes(episodeId)) window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, episodeId].slice(-200)));
  } catch { /* private mode */ }
}

export function TipEndCard({ tipping, title, isSignedIn, onNext, nextSeconds = 10, onClose }) {
  const router = useRouter();
  const { openSignIn } = useClerk();
  const iconOverrides = usePlayerIconOverrides();
  const [sheet, setSheet] = useState(null);
  const [left, setLeft] = useState(onNext ? nextSeconds : null);
  useEffect(() => {
    if (!onNext || sheet) return undefined;
    if (left <= 0) { onNext(); return undefined; }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onNext, sheet]);
  if (!tipping || !tipping.enabled) return null;
  const name = short(tipping.creatorName);
  function tip(cents) {
    if (!isSignedIn) {
      openSignIn({ redirectUrl: router.asPath });
      return;
    }
    setSheet(cents);
  }
  return (
    <div className="tip-end-card" role="dialog" aria-label={`Tip ${name}`}>
      <div className="tip-end-inner">
        <button type="button" className="modal-close tip-end-close" onClick={onClose} aria-label="Close"><CloseIcon size={16} src={iconOverrides.close} /></button>
        <span className="tip-kicker">That was {title}</span>
        <h3>Liked it? Tip {name}.</h3>
        <p>Tips go straight to {name}&rsquo;s Stripe account. $3 covers a coffee; $10 covers a hard drive&rsquo;s worth of footage.</p>
        <div className="tip-end-actions">
          <button type="button" className="tip-end-btn" onClick={() => tip(300)}>Tip $3</button>
          <button type="button" className="tip-end-btn" onClick={() => tip(500)}>Tip $5</button>
          {onNext && (
            <button type="button" className="tip-end-btn ghost" onClick={onNext}>Next episode{left != null && !sheet ? ` in ${left}s` : ''} →</button>
          )}
        </div>
      </div>
      {sheet && <TipSheet tipping={tipping} initialAmountCents={sheet} onClose={() => { setSheet(null); setLeft(null); }} />}
    </div>
  );
}

// Back from Checkout with ?tipped=<id> (or =cancelled) on the page the fan
// tipped from. Reads the tip so the thank-you names the real amount; the
// query is stripped so a reload doesn't repeat it.
export function TippedBanner({ email }) {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [tip, setTip] = useState(null);
  useEffect(() => {
    if (!router.isReady) return;
    const v = router.query.tipped;
    if (!v) return;
    setState(v === 'cancelled' ? 'cancelled' : 'done');
    if (v !== 'cancelled') {
      fetch(`/api/tips?id=${encodeURIComponent(v)}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && d.tip && setTip(d.tip)).catch(() => {});
    }
    const { tipped, ...rest } = router.query;
    router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true, scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);
  if (!state) return null;
  if (state === 'cancelled') return <div className="tipped-banner cancelled">No tip was sent and nothing was charged.</div>;
  const name = tip ? short(tip.creatorName) : 'the creator';
  const settled = tip && tip.status === 'completed';
  return (
    <div className="tipped-banner" role="status">
      <b>{tip ? (settled ? `Thank you. ${name} gets ${dollars(tip.creatorCents)}.` : `Thank you. Your ${whole(tip.amountCents)} tip to ${name} is going through.`) : 'Thank you.'}</b>
      <p>
        {settled ? `It’s in ${name}’s Stripe account now.` : `It lands in ${name}’s Stripe account the moment the card clears.`}
        {tip && tip.note ? ` ${name} will see your note${tip.showName ? ' and your name' : ' from “a fan”'}.` : tip ? (tip.showName ? ` ${name} will see your name.` : ` ${name} sees it from “a fan”.`) : ''}
        {email ? ` Receipt from Stripe to ${email}.` : ' Stripe emailed a receipt.'} Your tips are listed under Account → <Link href="/account#purchases">Your purchases</Link>.
      </p>
    </div>
  );
}
