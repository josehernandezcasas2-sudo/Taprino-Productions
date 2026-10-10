import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import VideoPlayer from '../VideoPlayer';

// Shared pieces for the Film University pages (pages/university/*).

export function LessonThumb({ lesson, small = false }) {
  const reading = lesson.kind === 'reading';
  const cls = `uni-thumb${small ? ' uni-thumb-sm' : ''}${reading ? ' uni-thumb-doc' : ''}`;
  if (lesson.thumbnailUrl) {
    return (
      <span className={cls} style={{ backgroundImage: `url(${lesson.thumbnailUrl})` }}>
        {!reading && lesson.duration && <span className="uni-thumb-badge">▶ {lesson.duration}</span>}
        {reading && <span className="uni-thumb-badge">¶ Reading{lesson.documentPages ? ` · ${lesson.documentPages} p` : ''}</span>}
      </span>
    );
  }
  return (
    <span className={cls}>
      <span className="uni-thumb-glyph">{reading ? '¶' : '▶'}</span>
      {!reading && lesson.duration && <span className="uni-thumb-badge">▶ {lesson.duration}</span>}
    </span>
  );
}

// A course as a catalogue card: cover, department · level, title, blurb,
// facts, Start / Continue, and a progress bar once started.
export function CourseCard({ course, doneCount = 0 }) {
  const started = doneCount > 0;
  const finished = started && doneCount >= course.lessonCount;
  const pct = course.lessonCount ? Math.round((doneCount / course.lessonCount) * 100) : 0;
  return (
    <Link href={course.href} className="uni-course">
      <span className="uni-course-cover" style={course.coverUrl ? { backgroundImage: `url(${course.coverUrl})` } : { background: `linear-gradient(160deg, ${course.accentColor}66, var(--surface-2))` }} />
      <span className="uni-course-body">
        <span className="uni-eyebrow uni-eyebrow-olive">
          {course.topicName} · <span className={`uni-lvl${course.level === 'start' ? ' start' : ''}`}>{course.levelLabel}</span>
        </span>
        <span className="uni-course-title">{course.title}</span>
        {course.description && <span className="uni-course-desc">{course.description}</span>}
        {started && <span className="uni-prog"><i style={{ width: `${pct}%` }} /></span>}
        <span className="uni-course-foot">
          <span className="uni-facts">
            <span>{course.lessonCount} lesson{course.lessonCount === 1 ? '' : 's'}</span>
            {course.length && <span>{course.length}</span>}
            {course.materialCount > 0 && <span>¶ {course.materialCount} file{course.materialCount === 1 ? '' : 's'}</span>}
          </span>
          <span className={`uni-btn sm${started && !finished ? ' primary' : ''}`}>{finished ? 'Done ✓' : started ? 'Continue' : 'Start'}</span>
        </span>
      </span>
    </Link>
  );
}

export function DepartmentChips({ departments, active, onPick }) {
  return (
    <div className="uni-depts">
      <button type="button" className={`uni-dept${!active ? ' on' : ''}`} onClick={() => onPick(null)}>
        <i style={{ background: 'var(--brass)' }} />All
      </button>
      {departments.map((d) => (
        <button key={d.id} type="button" className={`uni-dept${active === d.id ? ' on' : ''}`} onClick={() => onPick(d.id)}>
          <i style={{ background: d.accentColor }} />{d.name} <small>{d.courseCount}</small>
        </button>
      ))}
    </div>
  );
}

const FILE_LABEL = { pdf: 'PDF', xlsx: 'XLSX', csv: 'CSV', docx: 'DOCX', txt: 'TXT', fdx: 'FDX', pptx: 'PPTX', zip: 'ZIP', img: 'IMG', lut: 'LUT', audio: 'AUD', project: 'PRJ', video: 'VID', other: 'FILE' };

export function FileIcon({ file }) {
  const t = file.kind === 'video' ? 'video' : file.fileType || 'other';
  return <span className={`uni-file-ic t-${t}`} data-k={FILE_LABEL[t] || 'FILE'} />;
}

// A downloadable file (or a video example) as a row. Videos open an
// inline player via onPlay; files download.
export function FileRow({ file, showCourse = false, onPlay, compact = false }) {
  const meta = [showCourse ? file.topicName : null, file.meta, file.lessonTitle && !compact ? `“${file.lessonTitle}”` : null].filter(Boolean).join(' · ');
  const body = (
    <>
      {file.thumbnailUrl ? <span className="uni-file-thumb" style={{ backgroundImage: `url(${file.thumbnailUrl})` }} /> : <FileIcon file={file} />}
      <span className="uni-file-body">
        <span className="uni-file-title">{file.title}</span>
        <span className="uni-meta">{meta}</span>
        {file.description && !compact && <span className="uni-file-desc">{file.description}</span>}
      </span>
    </>
  );
  if (file.kind === 'video') {
    return (
      <button type="button" className="uni-file" onClick={() => onPlay && onPlay(file)}>
        {body}
        <span className="uni-btn sm">▶ Watch</span>
      </button>
    );
  }
  return (
    <a className="uni-file" href={file.fileUrl} target="_blank" rel="noopener" download>
      {body}
      <span className="uni-btn sm">Download</span>
    </a>
  );
}

// The syllabus: modules → numbered lesson rows with a tick, the amber
// "you are here" ring, length and type. `current` is the lesson in view
// (lesson page) or the one to continue (course page).
export function Syllabus({ syllabus, isDone, currentId, compact = false }) {
  return (
    <div className={`uni-syl${compact ? ' uni-syl-compact' : ''}`}>
      {syllabus.map((group, gi) => (
        <div key={group.id || `g${gi}`}>
          {group.title && <div className="uni-mod">{group.title}</div>}
          {group.lessons.map((l) => {
            const done = isDone(l.id);
            const now = l.id === currentId;
            return (
              <Link key={l.id} href={l.href} className={`uni-srow${done ? ' done' : ''}${now ? ' now' : ''}`}>
                <span className={`uni-cb${done ? ' on' : now ? ' now' : ''}`}>{done ? '✓' : now ? '●' : ''}</span>
                <span className="uni-srow-body">
                  <span className="uni-srow-t">{compact ? l.title : `${String(l.number).padStart(2, '0')}  ${l.title}`}</span>
                  {!compact && <span className="uni-meta">{l.meta}</span>}
                </span>
                <span className="uni-srow-k">{compact ? (l.kind === 'video' ? l.duration || '▶' : '¶') : now ? 'up next' : done ? 'done' : l.kind === 'video' ? '▶' : '¶'}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return <span className="uni-prog"><i style={{ width: `${pct}%` }} /></span>;
}

// Inline player for a video lesson or a video example, with the signed
// token refreshed through /api/university/stream-token.
export function UniPlayer({ id, kind = 'lesson', title, src, poster, signed }) {
  const refreshSrc = useCallback(async () => {
    try {
      const res = await fetch('/api/university/stream-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'file' ? { fileId: id } : { lessonId: id })
      });
      const data = await res.json();
      return data && data.src ? data.src : null;
    } catch (err) {
      return null;
    }
  }, [id, kind]);
  if (!src) return <div className="uni-player-empty">This video is still being prepared — check back in a few minutes.</div>;
  return (
    <div className="uni-player">
      <VideoPlayer episode={{ id, title, src, poster }} adsEnabled={false} signedPlayback={Boolean(signed)} refreshSrc={refreshSrc} />
    </div>
  );
}

// Plays a video example on demand (fetches its signed src on first play).
export function ExamplePlayer({ file, onClose }) {
  const [playback, setPlayback] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setPlayback(null);
    setError(null);
    fetch('/api/university/stream-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: file.id }) })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) (d && d.src ? setPlayback(d) : setError(d.error || 'Could not start playback.')); })
      .catch(() => { if (!cancelled) setError('Could not start playback.'); });
    return () => { cancelled = true; };
  }, [file.id]);
  return (
    <div className="uni-example">
      <div className="uni-example-head">
        <span><span className="uni-eyebrow uni-eyebrow-mint">Example</span><strong>{file.title}</strong>{file.description ? <span className="uni-meta">{file.description}</span> : null}</span>
        <button type="button" className="uni-btn ghost sm" onClick={onClose}>Close ×</button>
      </div>
      {error ? <div className="uni-player-empty">{error}</div> : playback ? <UniPlayer id={file.id} kind="file" title={file.title} src={playback.src} poster={file.thumbnailUrl} signed={playback.signed} /> : <div className="uni-player-empty">Loading…</div>}
    </div>
  );
}

export function Tabs({ tabs, active, onPick }) {
  return (
    <div className="uni-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key} className={`uni-tab${active === t.key ? ' on' : ''}`} onClick={() => onPick(t.key)}>
          {t.label}{t.count != null ? <small> · {t.count}</small> : null}
        </button>
      ))}
    </div>
  );
}
