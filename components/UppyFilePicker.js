import { useEffect, useState } from 'react';
import { Uppy } from '@uppy/core';
import { Dashboard } from '@uppy/react';

// SCOPING NOTE, worth understanding before touching this file: Uppy is
// used here purely as a polished drag-and-drop file picker and preview —
// it does NOT perform the actual upload. No Tus (or any other) transport
// plugin is registered on this Uppy instance.
//
// Why: this app's actual upload pipeline (contexts/UploadContext.js)
// already handles the specific things that matter for large creator video
// uploads — persisting across page navigation, the friendly ad-blocker/
// firewall error translation, retry without re-picking files, and the
// basic-POST fallback method. That logic is tightly coupled to
// get-upload-url.js and submit-episode.js, and re-plumbing it through
// Uppy's own Tus plugin (which would need the endpoint set dynamically,
// per-file, after our server mints a one-time Cloudflare URL) would mean
// rebuilding all of that against a different API — real risk for a UI
// swap that's supposed to be low-risk. So instead: Uppy hands over the
// raw File the moment it's picked (via the file-added event), and that
// File flows into the exact same startUpload() call as before.
//
// Props:
// - accept: mime pattern for Uppy's restrictions, e.g. "video/*"
// - note: helper text shown in the dropzone
// - onFileSelected(file | null): called with the raw File object, or null
//   if the file is removed from the picker
// - resetKey: change this value (e.g. an incrementing counter) to force
//   the picker to clear — pass a new value from the parent after a
//   successful submit. Implemented via React's key prop remounting the
//   whole component, which is simpler and more reliable than trying to
//   imperatively reset Uppy's internal state.
export default function UppyFilePicker({ accept, note, onFileSelected }) {
  const [uppy] = useState(() => new Uppy({
    restrictions: { maxNumberOfFiles: 1, allowedFileTypes: accept ? [accept] : undefined },
    autoProceed: false
  }));

  useEffect(() => {
    function handleFileAdded(file) {
      onFileSelected(file.data);
    }
    function handleFileRemoved() {
      onFileSelected(null);
    }
    uppy.on('file-added', handleFileAdded);
    uppy.on('file-removed', handleFileRemoved);
    return () => {
      uppy.off('file-added', handleFileAdded);
      uppy.off('file-removed', handleFileRemoved);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uppy]);

  // Uppy instances aren't meant to be torn down and recreated casually —
  // clean up its internal state when this component actually unmounts
  // (which happens on a resetKey change, since the parent remounts us via
  // a changed `key` prop).
  useEffect(() => () => uppy.destroy(), [uppy]);

  return (
    <div style={{ marginBottom: '0.8rem' }}>
      <Dashboard
        uppy={uppy}
        inline
        hideUploadButton
        showProgressDetails={false}
        proudlyDisplayPoweredByUppy={false}
        height={200}
        note={note}
        theme="dark"
      />
    </div>
  );
}
