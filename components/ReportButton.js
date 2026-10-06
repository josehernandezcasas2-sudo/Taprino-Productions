import { useRef, useState } from 'react';
import { REPORT_REASONS } from '../lib/reportReasons';

// A small "Report" link that opens a dialog of reasons. Signed-in viewers
// only (the API says so if not). One report per account per title.
export default function ReportButton({ targetType, targetId, title, className = '' }) {
  const dialogRef = useRef(null);
  const [reason, setReason] = useState('copyright');
  const [state, setState] = useState(null); // null | 'sending' | 'sent' | error message

  function open() {
    setState(null);
    if (dialogRef.current && dialogRef.current.showModal) dialogRef.current.showModal();
  }

  async function send(e) {
    e.preventDefault();
    setState('sending');
    try {
      const res = await fetch('/api/report-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, reason })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send that report.');
      setState('sent');
    } catch (err) {
      setState(err.message);
    }
  }

  return (
    <>
      <button type="button" className={`report-link ${className}`} onClick={open}>
        <span aria-hidden="true">⚑</span> Report
      </button>
      <dialog ref={dialogRef} className="report-dialog" aria-label={`Report ${title || 'this'}`}>
        {state === 'sent' ? (
          <div className="report-body">
            <h3>Thanks, we got it</h3>
            <p>We look at reports in order. You won&rsquo;t see a change right away.</p>
            <div className="report-acts">
              <button type="button" className="sch-btn primary" onClick={() => dialogRef.current.close()}>Close</button>
            </div>
          </div>
        ) : (
          <form className="report-body" onSubmit={send}>
            <div className="tv-info-eyebrow">Report</div>
            <h3>{title || 'This title'}</h3>
            <fieldset className="report-reasons">
              <legend>What&rsquo;s wrong?</legend>
              {Object.entries(REPORT_REASONS).map(([key, label]) => (
                <label key={key}>
                  <input type="radio" name="report-reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
                  {label}
                </label>
              ))}
            </fieldset>
            {state && state !== 'sending' && <div className="house-ad-error" role="alert">{state}</div>}
            <div className="report-acts">
              <button type="button" className="sch-btn" onClick={() => dialogRef.current.close()}>Cancel</button>
              <button type="submit" className="sch-btn primary" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send report'}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
