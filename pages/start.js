import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { getRoleContext } from '../lib/roles';
import { readAccountTypes, suggestedTypesFor } from '../lib/accountTypes';
import { safeNext } from '../lib/privateBetaRules';
import { TYPE_WORDS, TYPE_LABELS, askCards, askDue, continueLabel, makeMain, normalizeMain, orderedTypes, toggleType } from '../lib/accountTypeRules';
import { SITE } from '../lib/siteConfig';
import { MainChips, TickIcon, TypeIcon, TYPE_TINTS, announceAccountTypes, postAccountTypes } from '../components/account/AccountTypeBits';

// "What brings you here?" (Jose, 2026-11-18; the Main board of the canvas
// https://claude.ai/artifact/GxAa8Qj57oQRuBF7c5xo4q; migration 126). Asked
// once, on the way into a brand-new account (/signed-in sends a sign-in
// whose person never answered here, with where they were going as ?next=;
// the account hub has a nudge for the rest). Pick any of Creator, Crew,
// Cast and Studio, the first one ticked is the main; or skip, which leaves
// a viewer. Every word and rule is lib/accountTypeRules.js.
//
// No site header and no tab bar: the beta door's brand strip with Skip at
// its right, the cards, the button. A person who already answered (or has
// a type) is sent straight on to `next`.
export async function getServerSideProps({ req, res, query }) {
  // noindex is the page's own meta tag: an X-Robots-Tag set here would
  // replace the middleware's (noai, noimageai on every response).
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const next = safeNext(typeof query.next === 'string' ? query.next : '/');
  const rc = await getRoleContext(req);
  if (!rc.userId) return { redirect: { destination: '/account', permanent: false } };
  const state = await readAccountTypes(rc.userId);
  if (!askDue({ signedIn: true, state })) return { redirect: { destination: next, permanent: false } };
  const isCreator = Boolean(rc.isCreator);
  // What they already have on the site (the creator role, a working card,
  // a performer card) is ticked to begin with; nothing is saved until
  // Continue. The first is the main.
  const suggested = await suggestedTypesFor(rc.userId, { isCreator }).catch(() => []);
  return { props: { next, suggested: Array.isArray(suggested) ? suggested : [], isCreator } };
}

export default function Start({ next = '/', suggested = [] }) {
  const router = useRouter();
  const [pick, setPick] = useState(() => ({ types: orderedTypes(suggested, suggested[0]), main: normalizeMain(suggested, suggested[0]) }));
  const [busy, setBusy] = useState(null); // null | 'save' | 'skip'
  const [error, setError] = useState(null);
  const cards = askCards(pick);
  const ticked = cards.filter((c) => c.checked);

  async function send(body, kind) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    const r = await postAccountTypes(body);
    if (r.ok) {
      announceAccountTypes(r.state);
      router.replace(next);
      return;
    }
    // Before migration 126 there is nothing to save: go on as if asked.
    if (r.status === 503 && r.code === 'migration-126') { router.replace(next); return; }
    setBusy(null);
    setError(TYPE_WORDS.failed);
  }

  const save = () => send({ types: orderedTypes(pick.types, pick.main), main: pick.main }, 'save');
  const skip = () => send({ skip: true }, 'skip');

  return (
    <>
      <Head>
        <title>{`${TYPE_WORDS.askTitle} — ${SITE.name}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="welcome atp-start">
        <header className="welcome-bar atp-start-bar">
          <span className="welcome-brand">{SITE.nameUpper}</span>
          <button type="button" className="atp-start-skip" onClick={skip} disabled={Boolean(busy)}>{TYPE_WORDS.skip}</button>
        </header>

        <main id="main-content" className="atp-start-main">
          <h1 className="atp-start-title">{TYPE_WORDS.askTitle}</h1>
          <p className="atp-start-intro">{TYPE_WORDS.askIntro}</p>

          <div className="atp-cards" role="group" aria-label={TYPE_WORDS.askTitle}>
            {cards.map((c) => (
              <button
                key={c.type}
                type="button"
                className={`atp-card${c.checked ? ' on' : ''}${c.main ? ' main' : ''}`}
                aria-pressed={c.checked}
                data-type={c.type}
                onClick={() => setPick((p) => toggleType(p, c.type))}
              >
                <span className={`atp-card-icon tint-${TYPE_TINTS[c.type]}`} aria-hidden="true"><TypeIcon type={c.type} /></span>
                <span className="atp-card-text">
                  <span className="atp-card-label">
                    {c.label}
                    {c.main && <span className="atp-main-pill">{TYPE_WORDS.mainChip}</span>}
                  </span>
                  <span className="atp-card-blurb">{c.blurb}</span>
                </span>
                <span className="atp-tick" aria-hidden="true">{c.checked && <TickIcon />}</span>
              </button>
            ))}
          </div>

          {ticked.length > 1 && (
            <div className="atp-start-main-row">
              <span id="atp-start-main-label" className="atp-start-main-label">{TYPE_WORDS.main}</span>
              <MainChips
                items={ticked.map((c) => ({ type: c.type, label: TYPE_LABELS[c.type], main: c.main }))}
                labelledBy="atp-start-main-label"
                className="atp-chips"
                chipClass="atp-chip"
                onPick={(type) => setPick((p) => makeMain(p, type))}
              />
            </div>
          )}

          <p className="atp-start-note">{TYPE_WORDS.askSkipNote}</p>
        </main>

        <div className="atp-start-foot">
          {error && <p className="atp-error" role="alert">{error}</p>}
          <button type="button" className="atp-continue" onClick={save} disabled={ticked.length === 0 || Boolean(busy)}>
            {busy === 'save' ? TYPE_WORDS.saving : continueLabel(pick.types, pick.main)}
          </button>
          <button type="button" className="atp-start-skip-long" onClick={skip} disabled={Boolean(busy)}>{TYPE_WORDS.skipLong}</button>
        </div>
      </div>
    </>
  );
}
