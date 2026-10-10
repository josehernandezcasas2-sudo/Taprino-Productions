import Link from 'next/link';
import { useState } from 'react';
import { universityPageProps } from '../../../lib/universityPage';
import { getCoursePage } from '../../../lib/university';
import { useProgress } from '../../../lib/universityProgress';
import UniversityShell, { accountFromProps } from '../../../components/university/UniversityShell';
import BackButton from '../../../components/BackButton';
import { Syllabus, FileRow, Tabs, ExamplePlayer, ProgressBar } from '../../../components/university/LessonBits';

// A course: the syllabus (grouped by module) with ticks and the "up next"
// ring; Materials and Examples as tabs beside it (Examples only when the
// course has some); course facts and the course that follows.
export async function getServerSideProps(ctx) {
  const slug = ctx.params.course;
  return universityPageProps(ctx, (account) => getCoursePage(slug, { userId: account.userId || null }));
}

export default function CoursePage(props) {
  const { course, syllabus, lessons, materials, examples, nextCourse } = props;
  const { isDone } = useProgress({ isSignedIn: props.isSignedIn, serverIds: props.doneIds });
  const [tab, setTab] = useState('syllabus');
  const [playing, setPlaying] = useState(null);

  const doneCount = lessons.filter((l) => isDone(l.id)).length;
  const next = lessons.find((l) => !isDone(l.id)) || null;
  const finished = lessons.length > 0 && !next;
  const kicker = [course.topicName, course.levelLabel, `${lessons.length} lesson${lessons.length === 1 ? '' : 's'}`, course.length].filter(Boolean).join(' · ');
  const tabs = [
    { key: 'syllabus', label: 'Syllabus' },
    { key: 'materials', label: 'Materials', count: materials.length },
    ...(examples.length ? [{ key: 'examples', label: 'Examples', count: examples.length }] : [])
  ];

  return (
    <UniversityShell title={course.title} description={course.description} account={accountFromProps(props)} mainGenres={props.mainGenres} wide>
      <div className="uni-topbar">
        <BackButton fallbackHref="/university" />
        <nav className="uni-crumbs" aria-label="Breadcrumb">
          <Link href="/university">Film University</Link><span>/</span><span>{course.topicName}</span><span>/</span><span>{course.title}</span>
        </nav>
      </div>

      <div className="uni-course-layout">
        <div>
          <span className="uni-eyebrow uni-eyebrow-olive">{kicker}</span>
          <h1 className="uni-h1" style={{ fontSize: '1.9rem' }}>{course.title}</h1>
          {course.description && <p className="uni-lead">{course.description}</p>}
          <div className="uni-actions" style={{ marginBottom: '1.1rem' }}>
            {next ? (
              <Link href={next.href} className="uni-btn primary">{doneCount ? `Continue · lesson ${next.number} →` : 'Start the course →'}</Link>
            ) : lessons.length ? (
              <Link href={lessons[0].href} className="uni-btn">Watch again from lesson 1</Link>
            ) : null}
            {lessons.length > 0 && <span className="uni-meta" style={{ margin: 0 }}>{finished ? 'All done ✓' : `${doneCount} of ${lessons.length} done`}</span>}
          </div>

          <Tabs tabs={tabs} active={tab} onPick={setTab} />
          {tab === 'syllabus' && (lessons.length ? <Syllabus syllabus={syllabus} isDone={isDone} currentId={next ? next.id : null} /> : <div className="uni-empty">No lessons published yet.</div>)}
          {tab === 'materials' && (
            materials.length ? (
              <div className="uni-filelist">
                {materials.map((f) => <FileRow key={f.id} file={f} onPlay={setPlaying} />)}
              </div>
            ) : <div className="uni-empty">No files for this course yet.</div>
          )}
          {tab === 'examples' && (
            <div className="uni-filelist">
              {playing && <ExamplePlayer file={playing} onClose={() => setPlaying(null)} />}
              {examples.map((f) => <FileRow key={f.id} file={f} onPlay={setPlaying} />)}
            </div>
          )}
        </div>

        <aside className="uni-side">
          {materials.length > 0 && tab !== 'materials' && (
            <div className="uni-box">
              <span className="uni-eyebrow uni-eyebrow-mint">Course materials · {materials.length} file{materials.length === 1 ? '' : 's'}</span>
              <div className="uni-filelist" style={{ marginTop: '0.6rem' }}>
                {materials.slice(0, 4).map((f) => <FileRow key={f.id} file={f} compact onPlay={setPlaying} />)}
              </div>
              {materials.length > 4 && <button type="button" className="uni-btn ghost sm" style={{ marginTop: '0.5rem' }} onClick={() => setTab('materials')}>All {materials.length} files →</button>}
            </div>
          )}
          <div className="uni-box">
            <span className="uni-eyebrow">About this course</span>
            <div className="uni-fact"><span>Level</span><b>{course.levelLabel}</b></div>
            <div className="uni-fact"><span>Length</span><b>{[course.length ? `${course.length} of video` : null, course.pages ? `${course.pages} page${course.pages === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || `${lessons.length} lessons`}</b></div>
            {course.needs && <div className="uni-fact"><span>You&rsquo;ll need</span><b>{course.needs}</b></div>}
            {course.assignmentCount > 0 && <div className="uni-fact"><span>Assignments</span><b>{course.assignmentCount}</b></div>}
            {lessons.length > 0 && <div className="uni-fact"><span>Your progress</span><b>{doneCount} of {lessons.length}</b></div>}
            {lessons.length > 0 && <ProgressBar done={doneCount} total={lessons.length} />}
          </div>
          {nextCourse && (
            <Link href={nextCourse.href} className="uni-box uni-box-plain" style={{ display: 'block', textDecoration: 'none' }}>
              <span className="uni-eyebrow">After this</span>
              <h4>{nextCourse.title}</h4>
              {nextCourse.description && <p>{nextCourse.description}</p>}
            </Link>
          )}
        </aside>
      </div>
    </UniversityShell>
  );
}
