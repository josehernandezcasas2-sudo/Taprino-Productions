import Link from 'next/link';
import { useCallback } from 'react';
import { universityPageProps } from '../../../lib/universityPage';
import { getLessonPage } from '../../../lib/university';
import UniversityShell, { accountFromProps } from '../../../components/university/UniversityShell';
import { LessonRow, DoneButton, useDoneMap, needsLabel } from '../../../components/university/LessonBits';
import VideoPlayer from '../../../components/VideoPlayer';

// One lesson. Left: the player (same signed Cloudflare playback as
// episodes, no ads) or the PDF inline with a Download button. Right: the
// exercise(s) that use it, the attached document, and what's next.
export async function getServerSideProps(ctx) {
  const { topic, lesson } = ctx.params;
  return universityPageProps(ctx, () => getLessonPage(topic, lesson));
}

export default function LessonPage(props) {
  const { topic, lesson, total, playback, attachment, exercises, next, previous } = props;
  const [done, toggleDone] = useDoneMap();

  const refreshSrc = useCallback(async () => {
    try {
      const res = await fetch('/api/university/stream-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId: lesson.id })
      });
      const data = await res.json();
      return data && data.src ? data.src : null;
    } catch (err) {
      return null;
    }
  }, [lesson.id]);

  const kicker = [topic.name, `lesson ${lesson.number} of ${total}`, lesson.kind === 'video' ? lesson.duration : lesson.documentPages ? `${lesson.documentPages} pages` : 'document']
    .filter(Boolean)
    .join(' · ');

  return (
    <UniversityShell title={lesson.title} description={lesson.description} account={accountFromProps(props)} mainGenres={props.mainGenres} wide>
      <nav className="uni-crumbs" aria-label="Breadcrumb">
        <Link href="/university">Film University</Link><span>/</span><Link href={`/university/${topic.slug}`}>{topic.name}</Link>
      </nav>

      <div className="uni-lesson-layout">
        <div>
          {lesson.kind === 'video' ? (
            <div className="uni-player">
              {playback && playback.src ? (
                <VideoPlayer
                  episode={{ id: lesson.id, title: lesson.title, src: playback.src, poster: lesson.thumbnailUrl }}
                  adsEnabled={false}
                  signedPlayback={Boolean(playback.signed)}
                  refreshSrc={refreshSrc}
                />
              ) : (
                <div className="uni-player-empty">This video is still being prepared — check back in a few minutes.</div>
              )}
            </div>
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
                <div className="uni-player-empty">This document isn&rsquo;t uploaded yet.</div>
              )}
            </div>
          )}
          <span className="uni-eyebrow" style={{ marginTop: '1rem', display: 'block' }}>{kicker}</span>
          <h1 className="uni-h1 uni-h1-sm">{lesson.title}</h1>
          {lesson.description && <p className="uni-lead" style={{ marginBottom: 0 }}>{lesson.description}</p>}
        </div>

        <aside className="uni-side">
          {exercises.map((ex) => (
            <div key={ex.id} className="uni-box uni-box-ex">
              <span className="uni-eyebrow uni-eyebrow-olive">Exercise{ex.minutes ? ` · ${ex.minutes} min` : ''}</span>
              <h4><Link href={ex.href}>{ex.title}</Link></h4>
              {ex.summary && <p>{ex.summary}</p>}
              {needsLabel(ex.needs) && <p className="uni-meta">{needsLabel(ex.needs)}</p>}
              <div className="uni-actions" style={{ marginTop: '0.7rem' }}>
                <DoneButton slug={ex.slug} done={Boolean(done[ex.slug])} onToggle={toggleDone} />
                <Link href={ex.href} className="uni-btn ghost sm">Steps →</Link>
              </div>
            </div>
          ))}
          {attachment && (
            <div className="uni-box">
              <span className="uni-eyebrow">Attached document</span>
              <h4>{attachment.title}</h4>
              {attachment.description && <p>{attachment.description}</p>}
              <a href={attachment.documentUrl} className="uni-btn sm" target="_blank" rel="noopener" download>Download PDF</a>
            </div>
          )}
          {next && (
            <div className="uni-box">
              <span className="uni-eyebrow">Up next</span>
              <LessonRow lesson={next} />
            </div>
          )}
          {previous && (
            <div className="uni-box uni-box-plain">
              <span className="uni-eyebrow">Before this</span>
              <LessonRow lesson={previous} />
            </div>
          )}
          {!next && (
            <div className="uni-box uni-box-plain">
              <span className="uni-eyebrow">That&rsquo;s the last one in {topic.name}</span>
              <Link href="/university" className="uni-btn ghost sm" style={{ marginTop: '0.5rem' }}>Back to the Workshop →</Link>
            </div>
          )}
        </aside>
      </div>
    </UniversityShell>
  );
}
