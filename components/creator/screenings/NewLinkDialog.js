import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AvatarPhoto from '../../AvatarPhoto';
import {
  ACCESS, COUNTRIES, DEFAULT_LINK, DEFAULT_WINDOW, NOTIFY, QUICK_WINDOWS, SCOPES, SCREENING, SCREENING_WORDS,
  againWindow, countriesLine, countryName, fromPacificInput, inviteText, linkActions, linkDashboard,
  toPacificInput, validateLink, whenLabel, windowFor
} from '../../../lib/screeningRules';
import { peopleQuery } from '../../../lib/messageRules';
import { CloseButton, CopyButton, Sheet, callScreenings, emailProblem, errorLine, freshPassword, webText } from './ScreeningBits';

// The New link box (migration 128, 2026-11-21; the canvas's NewLink and
// Ended boards, mockups/private-screenings-contract.md). One box, four ways
// in:
//   mode 'new'    — + New link: who it's for, what it plays (a show: the
//                   whole show, a season, or the episodes picked), when it
//                   works, the password, who can open it, the limits, tell
//                   me → POST /api/screenings → the ready card.
//   mode 'edit'   — Edit settings on a link's page → PATCH { action:
//                   'update' } (what it plays and the password don't
//                   change here: New password is its own button).
//   mode 'window' — Move the end: only When it works → the same PATCH.
//   mode 'again'  — Run it again on an ended link: the summary ("A new
//                   link with the same settings"), Make the new link → POST
//                   /api/screenings/<id>/again, or Change something first →
//                   the whole form prefilled → the same POST with what
//                   changed → the ready card.
// Every word, list and check is lib/screeningRules.js's; the form is checked
// with validateLink before it is sent, and the server's { error, field } is
// shown on the field it names. Dates are typed on the Pacific clock
// (toPacificInput / fromPacificInput).

const enc = (s) => encodeURIComponent(String(s || ''));

const FIELD_IDS = {
  label: 'scn-f-label',
  recipientEmail: 'scn-f-email',
  scope: 'scn-f-scope',
  season: 'scn-f-scope',
  episodeIds: 'scn-f-scope',
  startsAt: 'scn-f-starts',
  endsAt: 'scn-f-ends',
  password: 'scn-f-password',
  access: 'scn-f-access',
  named: 'scn-f-named',
  maxViews: 'scn-f-maxViews',
  perPerson: 'scn-f-perPerson',
  countries: 'scn-f-countries',
  notify: 'scn-f-notify'
};

// Which errors a change to a form key clears.
const CLEARS = {
  label: ['label'],
  recipientEmail: ['recipientEmail'],
  scope: ['scope', 'season', 'episodeIds'],
  season: ['season'],
  episodeIds: ['episodeIds'],
  windowKey: ['startsAt', 'endsAt'],
  starts: ['startsAt', 'endsAt'],
  ends: ['endsAt'],
  password: ['password'],
  access: ['access', 'named'],
  userIds: ['named'],
  emails: ['named'],
  maxViews: ['maxViews'],
  perPerson: ['perPerson'],
  countries: ['countries'],
  countryMode: ['countries'],
  notify: ['notify']
};

function firstSeasonOf(target) {
  const s = target && Array.isArray(target.seasons) && target.seasons[0];
  return s ? s.number : null;
}

function initialForm(mode, link, target, suggestion, now) {
  if (mode === 'new' || !link) {
    const w = windowFor(DEFAULT_WINDOW, now);
    return {
      label: '',
      recipientEmail: '',
      scope: target && target.type === 'series' ? 'show' : 'title',
      season: firstSeasonOf(target),
      episodeIds: [],
      windowKey: DEFAULT_WINDOW,
      starts: toPacificInput(w.startsAt),
      ends: toPacificInput(w.endsAt),
      password: suggestion || '',
      access: DEFAULT_LINK.access,
      userIds: [],
      emails: [],
      maxViews: String(DEFAULT_LINK.maxViews),
      perPerson: String(DEFAULT_LINK.perPerson),
      oneScreen: DEFAULT_LINK.oneScreen,
      countryMode: DEFAULT_LINK.countries.length ? 'only' : 'anywhere',
      countries: [...DEFAULT_LINK.countries],
      notify: DEFAULT_LINK.notify
    };
  }
  const named = link.named || {};
  const countries = Array.isArray(link.countries) ? link.countries : [];
  const base = {
    label: link.label || '',
    recipientEmail: link.recipientEmail || '',
    scope: link.scope || 'title',
    season: link.season == null ? firstSeasonOf(target) : link.season,
    episodeIds: Array.isArray(link.episodeIds) ? link.episodeIds : [],
    access: link.access || DEFAULT_LINK.access,
    userIds: Array.isArray(named.userIds) ? named.userIds : [],
    emails: Array.isArray(named.emails) ? named.emails : [],
    maxViews: String(link.maxViews == null ? DEFAULT_LINK.maxViews : link.maxViews),
    perPerson: link.perPerson ? String(link.perPerson) : '',
    oneScreen: link.oneScreen === true,
    countryMode: countries.length ? 'only' : 'anywhere',
    countries: [...countries],
    notify: link.notify || DEFAULT_LINK.notify,
    windowKey: 'custom'
  };
  if (mode === 'again') {
    const w = againWindow(link, now);
    return { ...base, starts: toPacificInput(w.startsAt), ends: toPacificInput(w.endsAt), password: suggestion || '' };
  }
  return { ...base, starts: toPacificInput(link.startsAt), ends: toPacificInput(link.endsAt), password: '' };
}

function initialNames(link, knownPeople) {
  const map = {};
  for (const p of Array.isArray(knownPeople) ? knownPeople : []) {
    if (p && p.userId && p.name) map[p.userId] = { name: p.name, handle: p.handle || null };
  }
  const people = link && link.named && Array.isArray(link.named.people) ? link.named.people : [];
  for (const p of people) {
    if (p && p.userId && (p.name || p.displayName)) map[p.userId] = { name: p.name || p.displayName, handle: p.handle || null };
  }
  return map;
}

// What the form sends (and what validateLink checks first).
function buildInput(form, mode, isShow) {
  const startsAt = fromPacificInput(form.starts);
  const endsAt = fromPacificInput(form.ends);
  // An end that can't be read goes as '' so validateLink says so, instead
  // of quietly keeping the old one.
  if (mode === 'window') return { ...(startsAt ? { startsAt } : {}), endsAt: endsAt || '' };
  const input = {
    label: form.label,
    recipientEmail: form.recipientEmail.trim(),
    ...(startsAt ? { startsAt } : {}),
    endsAt: endsAt || '',
    access: form.access,
    named: form.access === 'named' ? { userIds: form.userIds, emails: form.emails } : { userIds: [], emails: [] },
    maxViews: form.maxViews === '' ? Number.NaN : Number(form.maxViews),
    perPerson: form.perPerson === '' ? null : Number(form.perPerson),
    oneScreen: form.oneScreen === true,
    countries: form.countryMode === 'only' ? form.countries : [],
    notify: form.notify
  };
  if (mode === 'new' || mode === 'again') input.password = form.password;
  if (mode === 'new' && isShow) {
    input.scope = form.scope;
    if (form.scope === 'season') input.season = form.season;
    if (form.scope === 'episodes') input.episodeIds = form.episodeIds;
  }
  return input;
}

function FieldError({ id, text }) {
  if (!text) return null;
  return <p id={id} className="scn-field-error" role="alert">{text}</p>;
}

function fieldA11y(field, errors) {
  return errors[field] ? { 'aria-invalid': true, 'aria-describedby': `scn-e-${field}` } : {};
}

export default function NewLinkDialog({ mode = 'new', target, link = null, suggestion = '', knownPeople = null, onClose, onSaved }) {
  const t = target || {};
  const isShow = t.type === 'series';
  const [now] = useState(() => Date.now());
  const [form, setForm] = useState(() => initialForm(mode, link, t, suggestion, now));
  const [names, setNames] = useState(() => initialNames(link, knownPeople));
  const [step, setStep] = useState(mode === 'again' ? 'again' : 'form');
  const [made, setMade] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const set = useCallback((patch) => {
    setForm((f) => ({ ...f, ...patch }));
    const keys = Object.keys(patch).flatMap((k) => CLEARS[k] || []);
    if (keys.length) setErrors((e) => {
      if (!keys.some((k) => e[k])) return e;
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });
  }, []);

  const askPassword = useCallback(async () => {
    setPwBusy(true);
    const pw = await freshPassword();
    if (!alive.current) return;
    setPwBusy(false);
    if (pw) set({ password: pw });
  }, [set]);

  // A new link (or one run again) needs a password: the list's suggestion,
  // or a fresh one from the server.
  useEffect(() => {
    if ((mode === 'new' || mode === 'again') && !suggestion) askPassword();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A new step (the form, the ready card) puts focus back on the heading.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const h = document.getElementById('scn-dlg-h');
    if (h) h.focus({ preventScroll: true });
  }, [step]);

  const startLocked = (mode === 'edit' || mode === 'window') && link ? !linkActions(link, now).editStart : false;
  const episodes = Array.isArray(t.episodes) ? t.episodes : [];
  const seasons = Array.isArray(t.seasons) ? t.seasons : [];
  const playsLine = useMemo(() => {
    if (!link) return '';
    const d = linkDashboard({ link, target: t, views: [], refusals: [], now });
    const row = d.settings.find((s) => s.key === 'plays');
    return row ? row.value : '';
  }, [link, t, now]);

  function showError(field, text) {
    const id = FIELD_IDS[field];
    const el = id ? document.getElementById(id) : null;
    if (!el) {
      setFormError(text);
      return;
    }
    setErrors({ [field]: text });
    requestAnimationFrame(() => {
      const again = document.getElementById(id);
      if (!again) return;
      if (typeof again.focus === 'function') again.focus({ preventScroll: true });
      again.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  const close = () => { if (!busy) onClose(made); };

  function pickWindow(key) {
    const w = windowFor(key, Date.now());
    set({ windowKey: key, ends: toPacificInput(w.endsAt), ...(startLocked ? {} : { starts: toPacificInput(w.startsAt) }) });
  }
  function pickCustom() {
    set({ windowKey: 'custom' });
    const el = document.getElementById(startLocked ? 'scn-f-ends' : 'scn-f-starts');
    if (el) el.focus();
  }

  async function finish(r) {
    if (!alive.current) return;
    setBusy(false);
    if (!r.ok || !r.data || !r.data.link) {
      if (r.data && r.data.field && FIELD_IDS[r.data.field]) {
        if (step !== 'form') {
          setStep('form');
          setTimeout(() => showError(r.data.field, r.data.error || errorLine(r)), 0);
        } else showError(r.data.field, r.data.error || errorLine(r));
      } else setFormError(errorLine(r));
      return;
    }
    if (onSaved) onSaved(r.data.link);
    if (mode === 'new' || mode === 'again') {
      setMade(r.data.link);
      setStep('ready');
    } else onClose(r.data.link);
  }

  async function submit(e) {
    if (e) e.preventDefault();
    if (busy) return;
    setFormError(null);
    if (mode === 'new' && isShow && !episodes.length) {
      setFormError(webText('nothingToPlay'));
      return;
    }
    const input = buildInput(form, mode, isShow);
    // A link that has started keeps its start (validateLink does too).
    if (startLocked) delete input.startsAt;
    const existing = mode === 'edit' || mode === 'window' ? link : null;
    const vt = mode === 'new'
      ? { type: t.type, seasons: seasons.map((s) => s.number), episodeIds: episodes.map((ep) => ep.id) }
      : { type: 'episode' };
    const v = validateLink(input, { now: Date.now(), target: vt, existing });
    if (!v.ok) {
      showError(v.field, v.error);
      return;
    }
    setBusy(true);
    let r;
    if (mode === 'new') r = await callScreenings('/api/screenings', { method: 'POST', body: { target: { type: t.type, id: t.id }, ...input } });
    else if (mode === 'again') r = await callScreenings(`/api/screenings/${enc(link.id)}/again`, { method: 'POST', body: input });
    else r = await callScreenings(`/api/screenings/${enc(link.id)}`, { method: 'PATCH', body: { action: 'update', ...input } });
    finish(r);
  }

  // Run it again, as it was: a new address, the password shown, the window
  // the server works out (againWindow).
  async function makeAgainNow() {
    if (busy) return;
    setFormError(null);
    setBusy(true);
    const r = await callScreenings(`/api/screenings/${enc(link.id)}/again`, { method: 'POST', body: form.password ? { password: form.password } : {} });
    finish(r);
  }

  // Enter in a text field never sends the form by accident; the button does.
  function blockEnter(e) {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (el && el.tagName === 'INPUT' && !['checkbox', 'radio', 'submit', 'button'].includes(el.type)) e.preventDefault();
  }

  const kicker = `${t.title || ''} · ${SCREENING_WORDS.tab}`;
  const title = step === 'ready' ? SCREENING_WORDS.readyHead
    : mode === 'again' ? SCREENING_WORDS.againHead
      : mode === 'edit' ? SCREENING_WORDS.editSettings
        : mode === 'window' ? webText('moveEnd')
          : webText('newLinkTitle');
  const submitLabel = mode === 'new' ? SCREENING_WORDS.makeLink : mode === 'again' ? SCREENING_WORDS.makeAgain : SCREENING_WORDS.save;

  return (
    <Sheet labelledBy="scn-dlg-h" onClose={close} className={mode === 'window' || step === 'again' ? 'mid' : ''}>
      <div className="scn-sheet-head">
        <div className="scn-sheet-head-text">
          <span className={`scn-k${step === 'ready' ? ' ok' : step === 'again' ? ' brass' : ''}`}>{step === 'again' ? SCREENING_WORDS.runAgain : kicker}</span>
          <h2 id="scn-dlg-h" className="scn-sheet-title" tabIndex={-1} data-autofocus>{title}</h2>
        </div>
        <CloseButton onClick={close} disabled={busy} />
      </div>

      {step === 'ready' && made && <Ready made={made} target={t} onDone={() => onClose(made)} />}

      {step === 'again' && link && (
        <>
          <div className="scn-sheet-body">
            <div className="scn-again">
              <dl className="scn-set">
                <dt className="scn-k">{webText('againFor')}</dt><dd>{link.label}</dd>
                <dt className="scn-k">{webText('againWindow')}</dt><dd>{webText('againNow', { end: whenLabel(againWindow(link, now).endsAt, { now }) })}</dd>
                <dt className="scn-k">{webText('againPassword')}</dt><dd>{form.password ? <span className="scn-mono">{form.password}</span> : webText('againNew')}</dd>
                <dt className="scn-k">{webText('againAddress')}</dt><dd>{webText('againAddressLine')}</dd>
                <dt className="scn-k">{webText('againRest')}</dt><dd>{webText('againRestLine')}</dd>
              </dl>
              <p className="scn-hint">{SCREENING_WORDS.againLine}</p>
              {formError && <p className="scn-error" role="alert">{formError}</p>}
            </div>
          </div>
          <div className="scn-sheet-foot">
            <button type="button" className="scn-btn" onClick={() => { setFormError(null); setStep('form'); }} disabled={busy}>{SCREENING_WORDS.changeFirst}</button>
            <button type="button" className="scn-btn primary" onClick={makeAgainNow} disabled={busy || pwBusy} aria-busy={busy || undefined}>{SCREENING_WORDS.makeAgain}</button>
          </div>
        </>
      )}

      {step === 'form' && (
        <form className="scn-form" onSubmit={submit} onKeyDown={blockEnter} noValidate>
          <div className="scn-sheet-body">
            {mode !== 'window' && (
              <section className="scn-sec" aria-labelledby="scn-s-for">
                <h3 id="scn-s-for" className="scn-sec-h">{webText('forHead')}</h3>
                <div className="scn-fld">
                  <label htmlFor="scn-f-label" className="scn-lbl">{webText('labelLabel')} <em>· {webText('labelNote')}</em></label>
                  <input id="scn-f-label" className="scn-field" type="text" value={form.label} maxLength={SCREENING.labelMax} placeholder={webText('labelPlaceholder')} autoComplete="off" onChange={(e) => set({ label: e.target.value })} {...fieldA11y('label', errors)} />
                  <FieldError id="scn-e-label" text={errors.label} />
                </div>
                <div className="scn-fld">
                  <label htmlFor="scn-f-email" className="scn-lbl">{webText('emailLabel')} <em>· {webText('emailNote')}</em></label>
                  <input id="scn-f-email" className="scn-field" type="email" inputMode="email" value={form.recipientEmail} maxLength={SCREENING.emailMax} placeholder={webText('emailPlaceholder')} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => set({ recipientEmail: e.target.value })} {...fieldA11y('recipientEmail', errors)} />
                  <FieldError id="scn-e-recipientEmail" text={errors.recipientEmail} />
                </div>
              </section>
            )}

            {mode !== 'window' && (
              <section className="scn-sec" aria-labelledby="scn-s-plays">
                <h3 id="scn-s-plays" className="scn-sec-h">{webText('playsHead')}</h3>
                {mode === 'new' && !isShow && <p className="scn-plain">{webText('playsTitle', { title: t.title })}</p>}
                {mode !== 'new' && <p className="scn-plain">{webText('playsTitle', { title: playsLine })}</p>}
                {mode === 'new' && isShow && (
                  <>
                    <p className="scn-hint">{SCREENING_WORDS.showNote}</p>
                    {!episodes.length ? (
                      <p className="scn-warn-line">{webText('nothingToPlay')}</p>
                    ) : (
                      <>
                        <div id="scn-f-scope" className="scn-chips" role="group" aria-labelledby="scn-s-plays" tabIndex={-1}>
                          <button type="button" className="scn-chip" aria-pressed={form.scope === 'show'} onClick={() => set({ scope: 'show' })}>{SCOPES.find((s) => s.key === 'show').label}</button>
                          {seasons.map((s) => (
                            <button key={s.number} type="button" className="scn-chip" aria-pressed={form.scope === 'season' && form.season === s.number} onClick={() => set({ scope: 'season', season: s.number })}>
                              {s.label || `Season ${s.number}`}
                            </button>
                          ))}
                          <button type="button" className="scn-chip" aria-pressed={form.scope === 'episodes'} onClick={() => set({ scope: 'episodes' })}>{SCOPES.find((s) => s.key === 'episodes').label}</button>
                        </div>
                        {form.scope === 'episodes' && (
                          <EpisodePicker
                            episodes={episodes}
                            picked={form.episodeIds}
                            onChange={(ids) => set({ episodeIds: ids })}
                          />
                        )}
                        <FieldError id="scn-e-season" text={errors.season} />
                        <FieldError id="scn-e-episodeIds" text={errors.episodeIds} />
                      </>
                    )}
                  </>
                )}
              </section>
            )}

            <section className="scn-sec" aria-labelledby="scn-s-when">
              <h3 id="scn-s-when" className="scn-sec-h">{SCREENING_WORDS.whenItWorks}</h3>
              <div className="scn-chips" role="group" aria-labelledby="scn-s-when">
                {QUICK_WINDOWS.map((q) => (
                  <button key={q.key} type="button" className="scn-chip" aria-pressed={form.windowKey === q.key} onClick={() => pickWindow(q.key)}>{q.label}</button>
                ))}
                <button type="button" className="scn-chip" aria-pressed={form.windowKey === 'custom'} onClick={pickCustom}>{webText('custom')}</button>
              </div>
              <div className="scn-row2">
                <div className="scn-fld">
                  <label htmlFor="scn-f-starts" className="scn-lbl">{webText('starts')}</label>
                  <input id="scn-f-starts" className="scn-field" type="datetime-local" value={form.starts} disabled={startLocked} onChange={(e) => set({ starts: e.target.value, windowKey: 'custom' })} {...fieldA11y('startsAt', errors)} />
                  {startLocked && <p className="scn-hint">{webText('startLocked')}</p>}
                  <FieldError id="scn-e-startsAt" text={errors.startsAt} />
                </div>
                <div className="scn-fld">
                  <label htmlFor="scn-f-ends" className="scn-lbl">{webText('ends')}</label>
                  <input id="scn-f-ends" className="scn-field" type="datetime-local" value={form.ends} onChange={(e) => set({ ends: e.target.value, windowKey: 'custom' })} {...fieldA11y('endsAt', errors)} />
                  <FieldError id="scn-e-endsAt" text={errors.endsAt} />
                </div>
              </div>
              <p className="scn-hint">{SCREENING_WORDS.windowHint}</p>
            </section>

            {(mode === 'new' || mode === 'again') && (
              <section className="scn-sec" aria-labelledby="scn-s-pw">
                <h3 id="scn-s-pw" className="scn-sec-h"><label htmlFor="scn-f-password">{webText('passwordHead')}</label></h3>
                <div className="scn-inline">
                  <input id="scn-f-password" className="scn-field mono" type="text" value={form.password} maxLength={SCREENING.passwordMax} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => set({ password: e.target.value })} {...fieldA11y('password', errors)} />
                  <button type="button" className="scn-btn" onClick={askPassword} disabled={pwBusy} aria-busy={pwBusy || undefined}>{webText('newOne')}</button>
                </div>
                <FieldError id="scn-e-password" text={errors.password} />
                <p className="scn-hint">{SCREENING_WORDS.passwordHint}</p>
              </section>
            )}

            {mode !== 'window' && (
              <section className="scn-sec" aria-labelledby="scn-s-who">
                <h3 id="scn-s-who" className="scn-sec-h">{webText('whoHead')}</h3>
                <div id="scn-f-access" className="scn-opts" role="radiogroup" aria-labelledby="scn-s-who" tabIndex={-1}>
                  {ACCESS.map((a) => (
                    <label key={a.key} className={`scn-opt${form.access === a.key ? ' on' : ''}`}>
                      <input type="radio" name="scn-access" value={a.key} checked={form.access === a.key} onChange={() => set({ access: a.key })} />
                      <span className="scn-dot" aria-hidden="true" />
                      <span className="scn-opt-text"><b>{a.label}</b><span>{a.blurb}</span></span>
                    </label>
                  ))}
                </div>
                <FieldError id="scn-e-access" text={errors.access} />
                {form.access === 'named' && (
                  <NamedPeople
                    userIds={form.userIds}
                    emails={form.emails}
                    names={names}
                    error={errors.named}
                    onAddPerson={(p) => {
                      if (form.userIds.includes(p.userId)) return;
                      setNames((n) => ({ ...n, [p.userId]: { name: p.name, handle: p.handle } }));
                      set({ userIds: [...form.userIds, p.userId] });
                    }}
                    onAddEmail={(email) => { if (!form.emails.includes(email)) set({ emails: [...form.emails, email] }); }}
                    onRemoveUser={(id) => set({ userIds: form.userIds.filter((x) => x !== id) })}
                    onRemoveEmail={(email) => set({ emails: form.emails.filter((x) => x !== email) })}
                  />
                )}
              </section>
            )}

            {mode !== 'window' && (
              <section className="scn-sec" aria-labelledby="scn-s-limits">
                <h3 id="scn-s-limits" className="scn-sec-h">{webText('limitsHead')}</h3>
                <div className="scn-row2">
                  <div className="scn-fld">
                    <label htmlFor="scn-f-maxViews" className="scn-lbl">{webText('opensTotal')}</label>
                    <input id="scn-f-maxViews" className="scn-field" type="number" inputMode="numeric" min={mode === 'edit' && link ? Math.max(1, link.views || 0) : 1} max={SCREENING.maxOpens} step={1} value={form.maxViews} onChange={(e) => set({ maxViews: e.target.value })} {...fieldA11y('maxViews', errors)} />
                    <FieldError id="scn-e-maxViews" text={errors.maxViews} />
                  </div>
                  <div className="scn-fld">
                    <label htmlFor="scn-f-perPerson" className="scn-lbl">{webText('perPersonLabel')}</label>
                    <select id="scn-f-perPerson" className="scn-field" value={form.perPerson} onChange={(e) => set({ perPerson: e.target.value })} {...fieldA11y('perPerson', errors)}>
                      <option value="">{webText('noLimitEach')}</option>
                      {Array.from({ length: SCREENING.perPersonMax }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={String(n)}>{n === 1 ? webText('oneTime') : webText('nTimes', { n })}</option>
                      ))}
                    </select>
                    <FieldError id="scn-e-perPerson" text={errors.perPerson} />
                  </div>
                </div>
                <div className="scn-switch-row">
                  <div className="scn-switch-text">
                    <span id="scn-one-l" className="scn-switch-label">{SCREENING_WORDS.oneScreenLabel}</span>
                    <p id="scn-one-d" className="scn-hint">{SCREENING_WORDS.oneScreenLine}</p>
                  </div>
                  <button type="button" role="switch" aria-checked={form.oneScreen} aria-labelledby="scn-one-l" aria-describedby="scn-one-d" className="scn-switch" onClick={() => set({ oneScreen: !form.oneScreen })}>
                    <span aria-hidden="true" />
                  </button>
                </div>
                <CountryPicker
                  mode={form.countryMode}
                  countries={form.countries}
                  error={errors.countries}
                  onMode={(m) => set({ countryMode: m })}
                  onAdd={(c) => { if (!form.countries.includes(c) && form.countries.length < SCREENING.maxCountries) set({ countries: [...form.countries, c] }); }}
                  onRemove={(c) => set({ countries: form.countries.filter((x) => x !== c) })}
                />
              </section>
            )}

            {mode !== 'window' && (
              <section className="scn-sec" aria-labelledby="scn-s-notify">
                <h3 id="scn-s-notify" className="scn-sec-h">{webText('notifyHead')}</h3>
                <div id="scn-f-notify" className="scn-chips" role="group" aria-labelledby="scn-s-notify" tabIndex={-1}>
                  {NOTIFY.map((n) => (
                    <button key={n.key} type="button" className="scn-chip" aria-pressed={form.notify === n.key} onClick={() => set({ notify: n.key })}>{n.label}</button>
                  ))}
                </div>
                <FieldError id="scn-e-notify" text={errors.notify} />
                <p className="scn-hint">{SCREENING_WORDS.notifyHint}</p>
              </section>
            )}

            {formError && <p className="scn-error" role="alert">{formError}</p>}
          </div>
          <div className="scn-sheet-foot">
            <button type="button" className="scn-btn" onClick={close} disabled={busy}>{SCREENING_WORDS.cancel}</button>
            <button type="submit" className="scn-btn primary" disabled={busy} aria-busy={busy || undefined}>{submitLabel}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

// The episodes a show's link can play, ticked one by one (kept as picked).
function EpisodePicker({ episodes, picked, onChange }) {
  const label = SCOPES.find((s) => s.key === 'episodes').label;
  function toggle(id, on) {
    onChange(on ? [...picked, id] : picked.filter((x) => x !== id));
  }
  return (
    <div className="scn-eps-wrap">
      <ul className="scn-eps" aria-label={label}>
        {episodes.map((ep) => {
          const on = picked.includes(ep.id);
          return (
            <li key={ep.id}>
              <label className={`scn-ep${on ? ' on' : ''}`}>
                <input type="checkbox" checked={on} onChange={(e) => toggle(ep.id, e.target.checked)} />
                {ep.code && <span className="scn-ep-code">{ep.code}</span>}
                <span className="scn-ep-title">{ep.title}</span>
                {ep.status && ep.status !== 'approved' && <span className="scn-ep-tag">{webText('inReview')}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <p className="scn-k">{webText('picked', { n: picked.length })}</p>
    </div>
  );
}

const SEARCH_WAIT_MS = 300;

function personOf(p) {
  if (!p || !p.userId) return null;
  const avatar = p.avatar || (p.avatarUrl ? { url: p.avatarUrl, position: p.avatarPosition || null, zoom: p.avatarZoom || null } : null);
  return { userId: p.userId, name: p.name || p.displayName || '', handle: p.handle || null, avatar };
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Face({ person, className = '' }) {
  const a = person && person.avatar;
  if (a && a.url) return <AvatarPhoto url={a.url} position={a.position} zoom={a.zoom} className={`scn-face${className ? ` ${className}` : ''}`} />;
  return <span className={`scn-face initials${className ? ` ${className}` : ''}`} aria-hidden="true">{initials(person && person.name)}</span>;
}

// "Only people I name": accounts found by name or @handle
// (/api/messages/people?q=), and emails they must sign in with.
function NamedPeople({ userIds, emails, names, error, onAddPerson, onAddEmail, onRemoveUser, onRemoveEmail }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ q: '', people: null, error: null });
  const [email, setEmail] = useState('');
  const [emailErr, setEmailErr] = useState(null);
  const latest = useRef('');
  const inFlight = useRef(false);
  const timer = useRef(null);
  const { ready } = peopleQuery(q);

  const ask = useCallback(async () => {
    if (inFlight.current) return;
    const want = latest.current;
    if (!want) return;
    inFlight.current = true;
    let answer = { q: want, people: [], error: null };
    try {
      const res = await fetch(`/api/messages/people?q=${encodeURIComponent(want)}`);
      const data = await res.json().catch(() => ({}));
      answer = res.ok
        ? { q: want, people: (Array.isArray(data.people) ? data.people : []).map(personOf).filter(Boolean), error: null }
        : { q: want, people: [], error: data.error || webText('couldNot') };
    } catch {
      answer = { q: want, people: [], error: webText('offline') };
    }
    inFlight.current = false;
    if (latest.current === want) setFound(answer);
    else if (latest.current) ask();
  }, []);

  useEffect(() => {
    latest.current = ready ? q.trim() : '';
    clearTimeout(timer.current);
    if (!ready) return undefined;
    timer.current = setTimeout(ask, SEARCH_WAIT_MS);
    return () => clearTimeout(timer.current);
  }, [q, ready, ask]);

  const total = userIds.length + emails.length;
  const full = total >= SCREENING.maxNamed;
  const typing = q.trim().length > 0;
  const people = found.q === q.trim() ? found.people : null;
  const list = (people || []).filter((p) => !userIds.includes(p.userId)).slice(0, 8);

  function pick(p) {
    onAddPerson(p);
    setQ('');
    setFound({ q: '', people: null, error: null });
  }
  function addEmail() {
    const s = email.trim().toLowerCase();
    if (!s) return;
    const problem = emailProblem(s);
    if (problem) {
      setEmailErr(problem);
      return;
    }
    setEmailErr(null);
    onAddEmail(s);
    setEmail('');
  }

  const nameOf = (id) => (names[id] && names[id].name) || webText('namedAccount');

  return (
    <div id="scn-f-named" className="scn-named" tabIndex={-1}>
      <div className="scn-fld">
        <label htmlFor="scn-named-q" className="scn-lbl">{webText('namedFind')}</label>
        <input
          id="scn-named-q"
          className="scn-field"
          type="search"
          value={q}
          disabled={full}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (list[0]) pick(list[0]); } }}
          aria-describedby="scn-named-found"
        />
        <div id="scn-named-found" className="scn-found" aria-live="polite">
          {typing && !ready && <p className="scn-hint">{webText('namedTypeMore')}</p>}
          {typing && ready && people === null && <p className="scn-hint">{webText('namedSearching')}</p>}
          {typing && ready && people !== null && (found.error
            ? <p className="scn-hint">{found.error}</p>
            : list.length === 0
              ? <p className="scn-hint">{webText('namedNoMatch')}</p>
              : (
                <ul className="scn-picks">
                  {list.map((p) => (
                    <li key={p.userId}>
                      <button type="button" className="scn-pick" onClick={() => pick(p)}>
                        <Face person={p} />
                        <span className="scn-pick-text"><b>{p.name}</b>{p.handle && <span>@{p.handle}</span>}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
        </div>
      </div>
      <div className="scn-fld">
        <label htmlFor="scn-named-email" className="scn-lbl">{webText('namedEmail')}</label>
        <div className="scn-inline">
          <input
            id="scn-named-email"
            className="scn-field"
            type="email"
            inputMode="email"
            value={email}
            disabled={full}
            maxLength={SCREENING.emailMax}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => { setEmail(e.target.value); setEmailErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
            aria-invalid={emailErr ? true : undefined}
            aria-describedby={emailErr ? 'scn-named-email-e' : undefined}
          />
          <button type="button" className="scn-btn" onClick={addEmail} disabled={full || !email.trim()}>{webText('add')}</button>
        </div>
        {emailErr && <p id="scn-named-email-e" className="scn-field-error" role="alert">{emailErr}</p>}
      </div>
      {total === 0 ? (
        <p className="scn-hint">{webText('namedNobody')}</p>
      ) : (
        <ul className="scn-tags">
          {userIds.map((id) => (
            <li key={`u:${id}`} className="scn-tag">
              <span>{nameOf(id)}{names[id] && names[id].handle ? <em> @{names[id].handle}</em> : null}</span>
              <button type="button" onClick={() => onRemoveUser(id)} aria-label={webText('remove', { name: nameOf(id) })}>×</button>
            </li>
          ))}
          {emails.map((e) => (
            <li key={`e:${e}`} className="scn-tag">
              <span>{e}</span>
              <button type="button" onClick={() => onRemoveEmail(e)} aria-label={webText('remove', { name: e })}>×</button>
            </li>
          ))}
        </ul>
      )}
      <p className="scn-k">{webText('namedCount', { n: total, max: SCREENING.maxNamed })}</p>
      <FieldError id="scn-e-named" text={error} />
    </div>
  );
}

const plainCase = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// The countries a search matches (names first that start with it), or the
// first few of the list before anything is typed.
function matchCountries(q, picked) {
  const s = plainCase(q.trim());
  const pool = COUNTRIES.filter(([c]) => !picked.includes(c));
  if (!s) return pool.slice(0, 8);
  const first = [];
  const rest = [];
  for (const row of pool) {
    const name = plainCase(row[1]);
    if (row[0].toLowerCase() === s || name.startsWith(s)) first.push(row);
    else if (name.includes(s)) rest.push(row);
  }
  return [...first, ...rest].slice(0, 8);
}

// Where it can be opened: Anywhere, or only in the countries picked (a
// searchable list of chips; no city limit — Jose chose a country only).
function CountryPicker({ mode, countries, error, onMode, onAdd, onRemove }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => matchCountries(q, countries), [q, countries]);
  const full = countries.length >= SCREENING.maxCountries;
  return (
    <div id="scn-f-countries" className="scn-fld scn-countries" tabIndex={-1}>
      <span id="scn-countries-l" className="scn-lbl">{webText('whereLabel')}</span>
      <div className="scn-chips" role="group" aria-labelledby="scn-countries-l">
        <button type="button" className="scn-chip" aria-pressed={mode === 'anywhere'} onClick={() => onMode('anywhere')}>{webText('anywhere')}</button>
        <button type="button" className="scn-chip" aria-pressed={mode === 'only'} onClick={() => onMode('only')}>{webText('onlyIn')}</button>
      </div>
      {mode === 'only' && (
        <div className="scn-country-box">
          {countries.length > 0 && (
            <ul className="scn-tags">
              {countries.map((c) => (
                <li key={c} className="scn-tag">
                  <span>{countryName(c)}</span>
                  <button type="button" onClick={() => onRemove(c)} aria-label={webText('remove', { name: countryName(c) })}>×</button>
                </li>
              ))}
            </ul>
          )}
          {full ? (
            <p className="scn-hint">{webText('countryMax', { max: SCREENING.maxCountries })}</p>
          ) : (
            <>
              <input
                className="scn-field"
                type="search"
                value={q}
                placeholder={webText('countryFind')}
                aria-label={webText('countryFind')}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (list[0]) { onAdd(list[0][0]); setQ(''); } } }}
              />
              {list.length ? (
                <ul className="scn-country-picks">
                  {list.map(([code, name]) => (
                    <li key={code}>
                      <button type="button" className="scn-chip" onClick={() => { onAdd(code); setQ(''); }}>+ {name}</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="scn-hint">{webText('countryNone')}</p>
              )}
            </>
          )}
        </div>
      )}
      <p className="scn-plain" aria-live="polite">{countriesLine(mode === 'only' ? countries : [])}</p>
      <FieldError id="scn-e-countries" text={error} />
      <p className="scn-hint">{SCREENING_WORDS.placeHint}</p>
    </div>
  );
}

// After Make the link: the address, the password, the invite.
function Ready({ made, target, onDone }) {
  const [withPw, setWithPw] = useState(false);
  const invite = inviteText({
    title: target.title,
    ownerName: target.ownerName,
    url: made.url,
    startsAt: made.startsAt,
    endsAt: made.endsAt,
    password: made.password,
    includePassword: withPw
  });
  const to = /^[^@\s,?&;]+@[^@\s,?&;]+$/.test(made.recipientEmail || '') ? made.recipientEmail : '';
  const mailto = `mailto:${to}?subject=${encodeURIComponent(webText('emailSubject', { title: target.title }))}&body=${encodeURIComponent(invite)}`;
  return (
    <>
      <div className="scn-sheet-body">
        <div className="scn-ready">
          <dl className="scn-ready-rows">
            <dt className="scn-lbl">{webText('readyLink')}</dt>
            <dd className="scn-mono">{made.url}</dd>
            <dd className="scn-ready-copy"><CopyButton text={made.url} label={webText('copy')} ariaLabel={SCREENING_WORDS.copyLink} /></dd>
            {made.password && (
              <>
                <dt className="scn-lbl">{webText('readyPassword')}</dt>
                <dd className="scn-mono">{made.password}</dd>
                <dd className="scn-ready-copy"><CopyButton text={made.password} label={webText('copy')} ariaLabel={SCREENING_WORDS.copyPassword} /></dd>
              </>
            )}
          </dl>
          {made.password && (
            <label className="scn-check">
              <input type="checkbox" checked={withPw} onChange={(e) => setWithPw(e.target.checked)} />
              <span>{SCREENING_WORDS.includePassword}</span>
            </label>
          )}
          <p className="scn-hint">{SCREENING_WORDS.readyLine}</p>
        </div>
      </div>
      <div className="scn-sheet-foot">
        <CopyButton className="scn-btn primary" text={invite} label={SCREENING_WORDS.copyInvite} />
        <a className="scn-btn" href={mailto}>{SCREENING_WORDS.emailLink}</a>
        <button type="button" className="scn-btn" onClick={onDone}>{webText('done')}</button>
      </div>
    </>
  );
}
