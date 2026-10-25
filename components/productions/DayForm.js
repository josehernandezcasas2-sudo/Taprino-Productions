import { useState } from 'react';

// Add or edit a shoot day on a production's call sheet (owner / admin).
// Used on the production page (add) and the call sheet page (edit).
// `api(url, body, method)` is the page's fetch wrapper; it returns the
// JSON or null after setting the page's error.
export default function DayForm({ productionId, initial = null, busy, api, bookedPlaces = [], defaultDate = null, onDone, onCancel }) {
  const [form, setForm] = useState({
    shootOn: initial ? initial.shootOn : defaultDate || '',
    callTime: initial ? initial.callTime : '07:00',
    wrapTime: initial ? initial.wrapTime : '19:00',
    locationId: initial && initial.locationId ? initial.locationId : '',
    placeLabel: initial ? initial.placeLabel : '',
    address: initial ? initial.address || '' : '',
    parking: initial ? initial.parking || '' : '',
    scenes: initial ? initial.scenes || '' : '',
    notes: initial ? initial.notes || '' : ''
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const placeOptions = [...bookedPlaces];
  if (form.locationId && !placeOptions.some((b) => b.value === form.locationId)) placeOptions.unshift({ value: form.locationId, label: initial && initial.listing ? initial.listing.title : 'Booked place' });

  async function submit(e) {
    e.preventDefault();
    const r = await api(`/api/productions/${productionId}/days`, { ...form, dayId: initial ? initial.id : undefined, locationId: form.locationId || null }, 'PUT');
    if (r && onDone) onDone(r);
  }

  return (
    <form className="prod-add" onSubmit={submit}>
      <div className="crew-row2">
        <label className="crew-field"><span>Date</span><input type="date" className="crew-input" value={form.shootOn} onChange={(e) => set({ shootOn: e.target.value })} required /></label>
        <div className="crew-row2">
          <label className="crew-field"><span>Call</span><input type="time" className="crew-input" value={form.callTime} onChange={(e) => set({ callTime: e.target.value })} /></label>
          <label className="crew-field"><span>Wrap</span><input type="time" className="crew-input" value={form.wrapTime} onChange={(e) => set({ wrapTime: e.target.value })} /></label>
        </div>
      </div>
      <div className="crew-field"><span>Where</span>
        {placeOptions.length > 0 && (
          <select className="crew-select" value={form.locationId} onChange={(e) => set({ locationId: e.target.value })}>
            <option value="">A place you type in</option>
            {placeOptions.map((b) => <option key={b.value} value={b.value}>Booked · {b.label}</option>)}
          </select>
        )}
        {!form.locationId && (
          <>
            <input type="text" className="crew-input" value={form.placeLabel} onChange={(e) => set({ placeLabel: e.target.value })} placeholder="Place name (Marta’s garage, Echo Park)" maxLength={120} />
            <input type="text" className="crew-input" value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="Street address — the crew sees this, nobody else" maxLength={300} />
          </>
        )}
        {form.locationId && <span className="crew-mono">The address, access notes and house rules come from the listing.</span>}
      </div>
      <label className="crew-field"><span>Parking & arrival</span><input type="text" className="crew-input" value={form.parking} onChange={(e) => set({ parking: e.target.value })} placeholder="Street parking on Fargo; load in through the side gate." maxLength={600} /></label>
      <label className="crew-field"><span>Scenes / what we’re shooting</span><input type="text" className="crew-input" value={form.scenes} onChange={(e) => set({ scenes: e.target.value })} placeholder="Sc. 4, 7, 12 — kitchen day interiors" maxLength={1000} /></label>
      <label className="crew-field"><span>Notes</span><textarea className="crew-input" rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Weather, meals, wardrobe, anything the crew needs to know." /></label>
      <div className="crew-actions">
        <button type="submit" className="crew-btn sm primary" disabled={busy || !form.shootOn}>{initial ? 'Save the day' : 'Add the day'}</button>
        {onCancel && <button type="button" className="crew-btn sm ghost" onClick={onCancel}>Cancel</button>}
        <span className="crew-mono">The crew is told when a day goes up or changes.</span>
      </div>
    </form>
  );
}

