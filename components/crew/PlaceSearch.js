import { useEffect, useRef, useState } from 'react';

// A place box: type a city, pick from the suggestions (/api/crew/geocode),
// or use the browser's location. `value` is { label, lat, lng } or null;
// onChange gets the same. The card editor and the directory's "near"
// filter share it.
export default function PlaceSearch({ value, onChange, placeholder = 'City or neighborhood', id, compact = false, allowLocate = true }) {
  const [text, setText] = useState(value ? value.label : '');
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const timer = useRef(null);
  const wrap = useRef(null);

  useEffect(() => { setText(value ? value.label : ''); }, [value]);

  useEffect(() => {
    function close(e) { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function lookup(q) {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setPlaces([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crew/geocode?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        setPlaces(res.ok ? data.places || [] : []);
        setNote(res.ok ? null : data.error || 'Could not look that up.');
        setOpen(true);
      } catch {
        setPlaces([]);
      }
    }, 350);
  }

  function pick(p) {
    onChange({ label: p.label, city: p.city, region: p.region, country: p.country, lat: p.lat, lng: p.lng });
    setText(p.label);
    setOpen(false);
    setNote(null);
  }

  function clear() {
    onChange(null);
    setText('');
    setPlaces([]);
    setNote(null);
  }

  function locate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setNote('Your browser can’t share a location.'); return; }
    setBusy(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const res = await fetch(`/api/crew/geocode?lat=${pos.coords.latitude.toFixed(4)}&lng=${pos.coords.longitude.toFixed(4)}`);
        const data = await res.json();
        const p = res.ok && data.places && data.places[0];
        if (p) pick(p); else setNote('Couldn’t name that spot — type your city instead.');
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
    <div className={`crew-place${compact ? ' compact' : ''}`} ref={wrap}>
      <div className="crew-place-row">
        <input
          id={id}
          type="text"
          className="crew-input"
          value={text}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => { setText(e.target.value); if (value) onChange(null); lookup(e.target.value); }}
          onFocus={() => { if (places.length) setOpen(true); }}
          aria-label={placeholder}
        />
        {value ? (
          <button type="button" className="crew-btn sm ghost" onClick={clear} aria-label="Clear place">✕</button>
        ) : allowLocate ? (
          <button type="button" className="crew-btn sm" onClick={locate} disabled={busy} title="Use my location">{busy ? '…' : '◎ Near me'}</button>
        ) : null}
      </div>
      {open && places.length > 0 && (
        <ul className="crew-place-list" role="listbox">
          {places.map((p) => (
            <li key={`${p.lat},${p.lng}`}>
              <button type="button" role="option" aria-selected="false" onClick={() => pick(p)}>{p.label}</button>
            </li>
          ))}
        </ul>
      )}
      {!value && text.trim().length >= 2 && !open && places.length === 0 && !note && <span className="crew-mono">Pick a place from the list.</span>}
      {note && <span className="crew-mono crew-note">{note}</span>}
    </div>
  );
}
