import Link from 'next/link';
import { useCallback } from 'react';
import { universityPageProps } from '../../../lib/universityPage';
import { getExercisePage } from '../../../lib/university';
import UniversityShell, { accountFromProps } from '../../../components/university/UniversityShell';
import { LessonRow, DoneButton, useDoneMap, needsLabel, ExerciseCard } from '../../../components/university/LessonBits';
import VideoPlayer from '../../../components/VideoPlayer';

// One exercise: the steps, the lesson that teaches it played right here,
// the template to use with it, and "I did it".
export async function getServerSideProps(ctx) {
  const slug = ctx.params.slug;
  return universityPageProps(ctx, () => getExercisePage(slug));
}

export default function ExercisePage(props) {
  const { exercise, playback, others = [] } = props;
  const [done, toggleDone] = useDoneMap();

  const refreshSrc = useCallback(async () => {
    if (!exercise.lesson) return null;
    try {
      const res = await fetch('/api/university/stream-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId: exercise.lesson.id })
      });
      const data = await res.json();
      return data && data.src ? data.src : null;
    } catch (err) {
      return null;
    }
  }, [exercise.lesson]);

  const more = others.slice(0, 3);

  return (
    <UniversityShell title={exercise.title} description={exercise.summary} account={accountFromProps(props)} mainGenres={props.mainGenres}>
      <nav className="uni-crumbs" aria-label="Breadcrumb">
        <Link href="/university">Workshop</Link>
        {exercise.topicSlug && (<><span>/</span><Link href={`/university/${exercise.topicSlug}`}>{exercise.topicName}</Link></>)}
      </nav>

      <div className="uni-lesson-layout">
        <div>
          <span className="uni-eyebrow uni-eyebrow-olive">
            {[exercise.topicName, exercise.minutes ? `${exercise.minutes} min` : null].filter(Boolean).join(' · ') || 'Exercise'}
          </span>
          <h1 className="uni-h1">{exercise.title}</h1>
          {exercise.summary && <p className="uni-lead">{exercise.summary}</p>}
          {exercise.steps.length > 0 && (
            <ol className="uni-steps">
              {exercise.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
          {needsLabel(exercise.needs) && <div className="uni-meta" style={{ marginBottom: '1rem' }}>{needsLabel(exercise.needs)}</div>}
          <div className="uni-actions">
            <DoneButton slug={exercise.slug} done={Boolean(done[exercise.slug])} onToggle={toggleDone} />
          </div>

          {exercise.lesson && (
            <section className="uni-watch">
              <div className="uni-label">Watch to do it</div>
              {exercise.lesson.kind === 'video' && playback && playback.src ? (
                <div className="uni-player">
                  <VideoPlayer
                    episode={{ id: exercise.lesson.id, title: exercise.lesson.title, src: playback.src, poster: exercise.lesson.thumbnailUrl }}
                    adsEnabled={false}
                    signedPlayback={Boolean(playback.signed)}
                    refreshSrc={refreshSrc}
                  />
                </div>
              ) : null}
              <LessonRow lesson={exercise.lesson} label={exercise.lesson.kind === 'video' ? 'Lesson' : 'Read'} />
              {exercise.extraLessons.map((l) => <LessonRow key={l.id} lesson={l} label="Also" />)}
            </section>
          )}
        </div>

        <aside className="uni-side">
          {exercise.template && (
            <div className="uni-box">
              <span className="uni-eyebrow">Use with</span>
              <h4>{exercise.template.title}</h4>
              <p>{exercise.template.meta}</p>
              <a href={exercise.template.documentUrl} className="uni-btn sm" target="_blank" rel="noopener" download>Download PDF</a>
            </div>
          )}
          {!exercise.lesson && exercise.extraLessons.length > 0 && (
            <div className="uni-box">
              <span className="uni-eyebrow">Watch to do it</span>
              {exercise.extraLessons.map((l) => <LessonRow key={l.id} lesson={l} />)}
            </div>
          )}
          {more.length > 0 && (
            <div className="uni-box uni-box-plain">
              <span className="uni-eyebrow">More exercises</span>
              <div className="uni-stack">
                {more.map((e) => <ExerciseCard key={e.id} exercise={e} done={Boolean(done[e.slug])} />)}
              </div>
              <Link href="/university" className="uni-btn ghost sm" style={{ marginTop: '0.6rem' }}>All exercises →</Link>
            </div>
          )}
        </aside>
      </div>
    </UniversityShell>
  );
}
