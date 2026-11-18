import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PlaceSearch from './PlaceSearch';
import { CloseIcon, LocateIcon } from './CrewDirectory';
import { keepScrollInside } from '../../lib/menuScroll';
import { CREW_ROLES, CAST_ROLES, GEAR_CATEGORIES, UNION_STATUS } from '../../lib/crewOptions';
import { PAY_TYPES } from '../../lib/crewCallRules';
import { CREW_WORDS, WITHIN_STEPS, DEFAULT_WITHIN, withinLabel, showButton, moreLabel, urgentChip } from '../../lib/crewDirectoryRules';

// The one Filters component of /crew (Crew Call, simpler, 2026-11-18;
// mockups/crew-call-simpler-contract.md, board "Filters, open (People)").
// Under 900px a bottom sheet (a modal dialog, portalled to <body>); from
// 900px the same content as a panel dropping under the chip row, closed by
// a click outside or Escape. Filters apply live, as the list's own read
// does; "Show N …" only closes it. Focus goes into it and back to the chip
// that opened it, and the page behind never scrolls (keepScrollInside).

const ROLES_SHOWN = 10;

function Section({ id, label, children }) {
  return (
    <div className="ccx-fsec" data-section={id}>
      <span className="ccx-fsec-label" tabIndex={-1}>{label}</span>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children, disabled = false, dashed = false }) {
  return (
    <button type="button" className={`ccx-fchip${dashed ? ' more' : ''}`} aria-pressed={dashed ? undefined : Boolean(on)} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function Switch({ label, line, on, onChange }) {
  return (
    <label className="ccx-switch-row">
      <span className="ccx-switch-text"><span>{label}</span><small>{line}</small></span>
      <input type="checkbox" role="switch" className="ccx-switch" checked={Boolean(on)} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

// The roles as chips: the first ten (and any already picked), then
// "+ N more" opens the rest. `multi` = People's pick-any; else one role.
function RoleChips({ list, picked, multi, onPick }) {
  const [all, setAll] = useState(false);
  const isOn = (r) => (multi ? picked.includes(r) : picked === r);
  const shown = all ? list : list.filter((r, i) => i < ROLES_SHOWN || isOn(r));
  const hidden = list.length - shown.length;
  return (
    <div className="ccx-fchips wrap">
      {!multi && <Chip on={!picked} onClick={() => onPick('')}>{CREW_WORDS.roleAny}</Chip>}
      {shown.map((r) => <Chip key={r} on={isOn(r)} onClick={() => onPick(r)}>{r}</Chip>)}
      {hidden > 0 && <Chip dashed onClick={() => setAll(true)}>{moreLabel(hidden)}</Chip>}
    </div>
  );
}

function NearSection({ f, onChange }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const setNear = (p) => onChange({ near: p, within: p && !f.within ? DEFAULT_WITHIN : f.within });

  function locate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setNote('Your browser can’t share a location.'); return; }
    setBusy(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const res = await fetch(`/api/crew/geocode?lat=${pos.coords.latitude.toFixed(4)}&lng=${pos.coords.longitude.toFixed(4)}`);
        const data = await res.json();
        const p = res.ok && data.places && data.places[0];
        if (p) setNear({ label: p.label, lat: p.lat, lng: p.lng });
        else setNote('Couldn’t name that spot — type your city instead.');
      } catch {
        setNote('Couldn’t name that spot — type your city instead.');
      } finally {
        setBusy(false);
      }
    }, () => {
      setBusy(false);
      setNote('Location was blocked — type your city instead.');
    }, { timeout: 10000, maximumAge: 600000 });
  }

  return (
    <Section id="near" label={CREW_WORDS.near}>
      <div className="ccx-near">
        <PlaceSearch value={f.near} onChange={setNear} placeholder={CREW_WORDS.nearPlaceholder} compact allowLocate={false} />
        <button type="button" className="ccx-locate" onClick={locate} disabled={busy} aria-label={CREW_WORDS.useMyLocation} title={CREW_WORDS.useMyLocation}>
          <LocateIcon />
        </button>
      </div>
      {note && <span className="ccx-fnote" role="status">{note}</span>}
      <div className="ccx-fchips" role="group" aria-label="Distance">
        {WITHIN_STEPS.map((n) => (
          <Chip key={n} on={Boolean(f.near) && Number(f.within) === n} disabled={!f.near} onClick={() => onChange({ within: n })}>{withinLabel(n)}</Chip>
        ))}
      </div>
    </Section>
  );
}

function Sections({ tab, f, hasCard, onChange }) {
  const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const switches = (
    <div className="ccx-switches">
      <Switch label={CREW_WORDS.freeNowLong} line={CREW_WORDS.freeNowLine} on={f.free} onChange={(v) => onChange({ free: v })} />
      <Switch label={CREW_WORDS.openToWork} line={CREW_WORDS.openToWorkLine} on={f.open} onChange={(v) => onChange({ open: v })} />
      <Switch label={CREW_WORDS.verified} line={CREW_WORDS.verifiedLine} on={f.verified} onChange={(v) => onChange({ verified: v })} />
    </div>
  );

  if (tab === 'calls') {
    return (
      <>
        <NearSection f={f} onChange={onChange} />
        <Section id="kind" label={CREW_WORDS.kind}>
          <div className="ccx-fchips">
            {Object.entries(CREW_WORDS.kinds).map(([k, label]) => (
              <Chip key={k || 'all'} on={f.kind === k} onClick={() => onChange({ kind: k, callRole: k === 'cast' && f.callRole && !CAST_ROLES.includes(f.callRole) ? '' : f.callRole })}>{label}</Chip>
            ))}
          </div>
        </Section>
        <Section id="role" label={CREW_WORDS.role}>
          <RoleChips key={f.kind} list={f.kind === 'cast' ? CAST_ROLES : CREW_ROLES} picked={f.callRole} multi={false} onPick={(r) => onChange({ callRole: r })} />
        </Section>
        <Section id="pay" label={CREW_WORDS.pay}>
          <div className="ccx-fchips wrap">
            {Object.entries(PAY_TYPES).map(([k, label]) => <Chip key={k} on={f.pay.includes(k)} onClick={() => onChange({ pay: toggleIn(f.pay, k) })}>{label}</Chip>)}
          </div>
        </Section>
        <div className="ccx-switches" data-section="switches">
          <Switch label={urgentChip(0)} line={CREW_WORDS.urgentLine} on={f.urgent} onChange={(v) => onChange({ urgent: v })} />
          {hasCard && <Switch label={CREW_WORDS.matches} line={CREW_WORDS.matchesLine} on={f.matches} onChange={(v) => onChange({ matches: v })} />}
          <Switch label={CREW_WORDS.remote} line={CREW_WORDS.remoteLine} on={f.remote} onChange={(v) => onChange({ remote: v })} />
        </div>
      </>
    );
  }
  if (tab === 'people') {
    return (
      <>
        <NearSection f={f} onChange={onChange} />
        <Section id="role" label={CREW_WORDS.rolePickAny}>
          <RoleChips list={CREW_ROLES} picked={f.roles} multi onPick={(r) => onChange({ roles: toggleIn(f.roles, r) })} />
        </Section>
        <Section id="gear" label={CREW_WORDS.hasGear}>
          <div className="ccx-fchips wrap">
            <Chip on={!f.gear} onClick={() => onChange({ gear: '' })}>{CREW_WORDS.anyGear}</Chip>
            {GEAR_CATEGORIES.map((c) => <Chip key={c} on={f.gear === c} onClick={() => onChange({ gear: c })}>{c}</Chip>)}
          </div>
        </Section>
        {switches}
      </>
    );
  }
  if (tab === 'cast') {
    return (
      <>
        <NearSection f={f} onChange={onChange} />
        <Section id="age" label={CREW_WORDS.playingAge}>
          <div className="ccx-age">
            <input type="number" inputMode="numeric" min="0" max="110" className="ccx-finput" placeholder={CREW_WORDS.ageFrom} aria-label={`${CREW_WORDS.playingAge} ${CREW_WORDS.ageFrom}`} value={f.ageMin} onChange={(e) => onChange({ ageMin: e.target.value })} />
            <span aria-hidden="true">–</span>
            <input type="number" inputMode="numeric" min="0" max="110" className="ccx-finput" placeholder={CREW_WORDS.ageTo} aria-label={`${CREW_WORDS.playingAge} ${CREW_WORDS.ageTo}`} value={f.ageMax} onChange={(e) => onChange({ ageMax: e.target.value })} />
          </div>
        </Section>
        <Section id="union" label={CREW_WORDS.union}>
          <div className="ccx-fchips wrap">
            <Chip on={!f.union} onClick={() => onChange({ union: '' })}>{CREW_WORDS.unionAny}</Chip>
            {Object.entries(UNION_STATUS).map(([k, label]) => <Chip key={k} on={f.union === k} onClick={() => onChange({ union: k })}>{label}</Chip>)}
          </div>
        </Section>
        {switches}
      </>
    );
  }
  return <NearSection f={f} onChange={onChange} />;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// opener: the chip that opened it (focus goes back there). section: the
// part to bring into view ('near', 'role', 'pay', 'age', 'union', …).
export default function CrewFilters({ tab, f, hasCard, total, section, wide, opener, onChange, onClear, onClose }) {
  const panelRef = useRef(null);
  const backRef = useRef(null);
  const bodyRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Into view, and focus into the panel (the section's label, so a
  // phone's keyboard doesn't open by itself).
  useEffect(() => {
    if (!mounted) return;
    const body = bodyRef.current;
    if (!body) return;
    const el = section ? body.querySelector(`[data-section="${section}"]`) : null;
    if (el) body.scrollTop = Math.max(0, el.offsetTop - 6);
    else body.scrollTop = 0;
    const target = (el && el.querySelector('.ccx-fsec-label')) || panelRef.current;
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }, [mounted, section, tab]);

  // The page behind never scrolls.
  useEffect(() => {
    if (!mounted) return undefined;
    const el = wide ? panelRef.current : backRef.current;
    return keepScrollInside(el);
  }, [mounted, wide]);

  // Escape closes; Tab stays inside the sheet on a phone; on a laptop a
  // click (or focus) outside closes it.
  useEffect(() => {
    if (!mounted) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(true); return; }
      if (e.key !== 'Tab' || wide) return;
      const panel = panelRef.current;
      if (!panel) return;
      const list = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const outside = (target) => panelRef.current && !panelRef.current.contains(target) && !(opener && opener.contains && opener.contains(target));
    const onDown = (e) => { if (wide && outside(e.target)) closeRef.current(false); };
    const onFocus = (e) => { if (wide && e.target && e.target !== document.body && outside(e.target)) closeRef.current(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('focusin', onFocus);
    };
  }, [mounted, wide, opener]);

  const inner = (
    <>
      {!wide && <span className="ccx-grab" aria-hidden="true" />}
      <div className="ccx-sheet-head">
        <h2 id="ccx-filters-title">{CREW_WORDS.filters}</h2>
        <div className="ccx-sheet-head-acts">
          <button type="button" className="ccx-clear-all" onClick={onClear}>{CREW_WORDS.clearAll}</button>
          <button type="button" className="ccx-x" onClick={() => onClose(true)} aria-label={CREW_WORDS.close}><CloseIcon /></button>
        </div>
      </div>
      <div className="ccx-sheet-body" ref={bodyRef}>
        <Sections tab={tab} f={f} hasCard={hasCard} onChange={onChange} />
      </div>
      <div className="ccx-sheet-foot">
        <button type="button" className="ccx-show" onClick={() => onClose(true)}>{showButton(tab, total)}</button>
      </div>
    </>
  );

  if (wide) {
    return (
      <section ref={panelRef} className="ccx-panel" role="dialog" aria-modal="false" aria-labelledby="ccx-filters-title" tabIndex={-1}>
        {inner}
      </section>
    );
  }
  if (!mounted) return null;
  return createPortal(
    <div ref={backRef} className="ccx-sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(true); }}>
      <section ref={panelRef} className="ccx-sheet" role="dialog" aria-modal="true" aria-labelledby="ccx-filters-title" tabIndex={-1}>
        {inner}
      </section>
    </div>,
    document.body
  );
}
