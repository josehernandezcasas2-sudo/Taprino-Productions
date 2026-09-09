import { useEffect } from 'react';

// Shared shell for every "Add X" popup — backdrop, centered card, header
// with a close button, and Escape-to-close. The actual form content
// (CreatorSubmissionForm with a locked type, or AddSeriesForm) is passed
// in as children, so this component knows nothing about episodes,
// series, or any submission logic at all.
export default function SubmissionModal({ title, icon, onClose, children }) {
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{icon} {title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
