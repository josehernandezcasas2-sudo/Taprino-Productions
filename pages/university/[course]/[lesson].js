import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { universityPageProps } from '../../../lib/universityPage';
import { getLessonPage } from '../../../lib/university';
import { useProgress } from '../../../lib/universityProgress';
import UniversityShell, { accountFromProps } from '../../../components/university/UniversityShell';
import BackButton from '../../../components/BackButton';
import { Syllabus, FileRow, Tabs, UniPlayer, ExamplePlayer } from '../../../components/university/LessonBits';

// One lesson. Left: the player (same signed Cloudflare playback as
// episodes, no ads) or the reading inline with a download button, then
// tabs: Overview, Files, Examples, Assignment (only the ones with
// content). Right: the course syllabus in miniature and "Mark done · next".
export async function getServerSideProps(ctx) {
  const { course, lesson } = ctx.params;
  return universityPageProps(ctx, (account) => getLessonPage(course, lesson, { userId: account.userId || null }));
}

export default function LessonPage(props) {
  const { course, lesson, moduleTitle, total, playback, files, examples, syllabus, next, previous } = props;
  const router = useRouter();
  const { isDone, toggle } = useProgress({ isSignedIn: props.isSignedIn, serverIds: props.doneIds });
  const [playing, setPlaying] = useState(null);
  const tabs = [
    { key: 'overview', label: 'Overview' },
    ...(files.length ? [{ key: 'files', label: 'Files', count: files.length }] : []),
    ...(examples.length ? [{ key: 'examples', label: 'Examples', count: examples.length }] : []),
    ...(lesson.assignment ? [{ key: 'assignment', label: 'Assignment' }] : [])
  ];
  const [tab, setTab] = useState('overview');
  const done = isDone(lesson.id);
  const doneCount = syllabus.reduce((n, g) => n + g.lessons.filter((l) => isDone(l.id)).length, 0);

  function markDoneAndNext() {
    if (!done) toggle(lesson.id);
    if (next) router.push(next.href);
    else router.push(course.href);
  }

  const kicker = [course.title, moduleTitle, `lesson ${lesson.number} of ${total}`, lesson.kind === 'video' ? lesson.duration : lesson.documentPages ? `${lesson.documentPages} pages` : 'reading'].filter(Boolean).join(' · ');

  return (
    <UniversityShell title={lesson.title} description={lesson.description} account={accountFromProps(props)} mainGenres={props.mainGenres} wide>
      <div className="uni-topbar">
        <BackButton fallbackHref={course.href} />
        <nav className="uni-crumbs" aria-label="Breadcrumb">
          <Link href="/university">Film University</Link><span>/</span><Link href={course.href}>{course.title}</Link><span>/</span><span>Lesson {lesson.number} of {total}</span>
        </nav>
      </div>

      <div className="uni-lesson-layout">
        <div>
          {lesson.kind === 'video' ? (
            <UniPlayer id={lesson.id} title={lesson.title} src={playback && playback.src} poster={lesson.thumbnailUrl} signed={playback && playback.signed} />
          ) : (
            <div className="uni-reader">
              {lesson.documentUrl ? (
                <>
                  <iframe src={`${lesson.documentUrl}#view=FitH`} title={lesson.title} className="uni-pdf" />
                  <div className="uni-actions" style={{ marginTop: '0.7rem' }}>
                    <a href={lesson.documentUrl} className="uni-btn primary sm" target="_blank" rel="noopener" download>Download PDF</a>
                    <a href={lesson.documentUrl} className="uni-btn ghost sm" target="_blank" rel="noopener">Open in a new tab</a>
                  </div>
                </>
              ) : (
                <div className="uni-player-empty">This reading isn&rsquo;t uploaded yet.</div>
              )}
            </div>
          )}
          <span className="uni-eyebrow" style={{ marginTop: '1rem', display: 'block' }}>{kicker}</span>
          <h1 className="uni-h1 uni-h1-sm">{lesson.title}</h1>

          <Tabs tabs={tabs} active={tab} onPick={setTab} />
          {tab === 'overview' && (
            <>
              {lesson.description ? <p className="uni-lead" style={{ marginBottom: '0.9rem' }}>{lesson.description}</p> : <p className="uni-meta">No notes for this lesson.</p>}
              {lesson.assignment && (
                <div className="uni-box uni-box-ex">
                  <span className="uni-eyebrow uni-eyebrow-olive">Assignment{lesson.assignment.minutes ? ` · ${lesson.assignment.minutes} min` : ''}</span>
                  <h4>{lesson.assignment.title}</h4>
                  <p>{lesson.assignment.summary}</p>
                  {lesson.assignment.steps.length > 0 && <button type="button" className="uni-btn ghost sm" style={{ marginTop: '0.5rem' }} onClick={() => setTab('assignment')}>Steps →</button>}
                </div>
              )}
              {files.length > 0 && <div className="uni-filelist" style={{ marginTop: '0.7rem' }}>{files.slice(0, 2).map((f) => <FileRow key={f.id} file={f} compact onPlay={setPlaying} />)}</div>}
            </>
          )}
          {tab === 'files' && <div className="uni-filelist">{files.map((f) => <FileRow key={f.id} file={f} onPlay={setPlaying} />)}</div>}
          {tab === 'examples' && (
            <div className="uni-filelist">
              {playing && <ExamplePlayer file={playing} onClose={() => setPlaying(null)} />}
              {examples.map((f) => <FileRow key={f.id} file={f} onPlay={setPlaying} />)}
            </div>
          )}
          {tab === 'assignment' && lesson.assignment && (
            <div className="uni-box uni-box-ex">
              <span className="uni-eyebrow uni-eyebrow-olive">Assignment{lesson.assignment.minutes ? ` · ${lesson.assignment.minutes} min` : ''}</span>
              <h4>{lesson.assignment.title}</h4>
              <p>{lesson.assignment.summary}</p>
              {lesson.assignment.steps.length > 0 && (
                <ol className="uni-steps" style={{ marginTop: '0.8rem' }}>
                  {lesson.assignment.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              )}
              <div className="uni-actions" style={{ marginTop: '0.6rem' }}>
                <button type="button" className={`uni-btn${done ? '' : ' primary'}`} onClick={() => toggle(lesson.id)}>{done ? 'Done ✓ · undo' : 'Mark done ✓'}</button>
              </div>
            </div>
          )}
        </div>

        <aside className="uni-side">
          <div className="uni-box" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="uni-mod" style={{ background: 'transparent' }}>{course.title} · {doneCount} of {total} done</div>
            <Syllabus syllabus={syllabus} isDone={isDone} currentId={lesson.id} compact />
          </div>
          <button type="button" className={`uni-btn block${done ? '' : ' primary'}`} onClick={markDoneAndNext}>
            {done ? (next ? 'Next lesson →' : 'Back to the course →') : next ? 'Mark done · next lesson →' : 'Mark done · finish course ✓'}
          </button>
          {done && <button type="button" className="uni-btn ghost sm block" onClick={() => toggle(lesson.id)}>Un-mark this lesson</button>}
          {previous && <Link href={previous.href} className="uni-btn ghost sm block">← {previous.title}</Link>}
        </aside>
      </div>
    </UniversityShell>
  );
}
