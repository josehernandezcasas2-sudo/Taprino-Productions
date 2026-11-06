import Link from 'next/link';
import { EyeIcon, ArrowRightIcon } from './PlayerIcons';
import { NoEyeIcon } from './show/roomBits';

// The owner's private preview (decision 2, amendment 5; board V3 of the
// series revamp canvas): a full-bleed bar under the header on a series,
// episode or podcast page that isn't public yet. `preview` comes from the
// server (lib/seriesHub.js / lib/episodePage.js / lib/podcastShowHub.js):
// { strong, text, linkHref, linkLabel } — the words are
// lib/showRules.js previewBarWords, so the page and the app say the same.
export default function PreviewBar({ preview }) {
  if (!preview) return null;
  return (
    <div className="pvbar" role="note" aria-label="Preview">
      <div className="pvbar-inner">
        <span className="pvbar-icon" aria-hidden="true"><EyeIcon size={18} /></span>
        <div className="pvbar-body">
          <p className="pvbar-line"><strong>{preview.strong}</strong> {preview.text}</p>
          {preview.linkHref && (
            <Link href={preview.linkHref} className="pvbar-link">
              {preview.linkLabel || 'Open show page'} <ArrowRightIcon size={13} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// The line at the foot of the page's main column.
export function PreviewFootnote() {
  return (
    <p className="pvbar-foot">
      <NoEyeIcon size={14} />
      <span>Hidden from search (noindex). Anyone else gets “not found”. Your plays here don’t count as views.</span>
    </p>
  );
}
