import Link from 'next/link';
import { useMemo, useState } from 'react';
import { universityPageProps } from '../../lib/universityPage';
import { getUniversityFeed, continueFrom } from '../../lib/university';
import { useProgress } from '../../lib/universityProgress';
import UniversityShell, { accountFromProps } from '../../components/university/UniversityShell';
import { CourseCard, DepartmentChips, FileRow } from '../../components/university/LessonBits';

// Film University — the course catalogue (mockups/film-university-v3.html,
// signed off 2026-10-10). "Continue" first when something's been started,
// then departments as a filter, courses as cards, a short Library shelf.
export async function getServerSideProps(ctx) {
  return universityPageProps(ctx, async (account) => ({ feed: await getUniversityFeed({ userId: account.userId || null }) }));
}

const INITIAL_COURSES = 6;

export default function UniversityHome(props) {
  const feed = props.feed || { departments: [], courses: [], library: [], lessonIndex: [], doneIds: null, continue: null, libraryCount: 0 };
  const { doneIds, isDone } = useProgress({ isSignedIn: props.isSignedIn, serverIds: feed.doneIds });
  const [dept, setDept] = useState(null);
  const [showAll, setShowAll] = useState(false);

  // Signed in: the server already worked out where to continue. Signed
  // out: the device's ticks decide, once the hook has read them.
  const cont = useMemo(() => {
    if (props.isSignedIn) return feed.continue;
    if (!doneIds.length) return null;
    const lessons = feed.lessonIndex.map((l) => ({ ...l, courseId: l.courseId }));
    const c = continueFrom(feed.courses, lessons, doneIds);
    if (!c) return null;
    const course = feed.courses.find((x) => x.id === c.course.id);
    return { ...c, lesson: { ...c.lesson, href: `/university/${course.slug}/${c.lesson.slug}` } };
  }, [props.isSignedIn, feed, doneIds]);

  const doneCountFor = (course) => feed.lessonIndex.filter((l) => l.courseId === course.id && isDone(l.id)).length;
  const matching = dept ? feed.courses.filter((c) => c.topicId === dept) : feed.courses;
  const visible = showAll ? matching : matching.slice(0, INITIAL_COURSES);
  const hidden = matching.length - visible.length;

  return (
    <UniversityShell title={null} account={accountFromProps(props)} mainGenres={props.mainGenres} wide>
      <div className="uni-hero">
        <span className="uni-eyebrow uni-eyebrow-pink">Studio Tapa · Free</span>
        <h1>Film University</h1>
        <p className="uni-lead">Short courses on making films, writing them, and getting them seen. Each one comes with the files you&rsquo;ll use on a real shoot. Free to take, free to keep.</p>
      </div>

      {props.loadError && <div className="uni-empty">Film University isn&rsquo;t set up yet — the admin needs to run migrations 078 and 079.</div>}
      {!props.loadError && feed.courses.length === 0 && <div className="uni-empty">No courses published yet — the first ones are on their way.</div>}

      {cont && (
        <section className="uni-cont" aria-label="Continue">
          <Link href={cont.lesson.href || `/university/${cont.course.slug}/${cont.lesson.slug}`} className="uni-cont-thumb" style={cont.course.coverUrl ? { backgroundImage: `url(${cont.course.coverUrl})` } : undefined}>
            <span className="uni-thumb-badge">Lesson {cont.index} of {cont.total}</span>
          </Link>
          <div>
            <span className="uni-eyebrow uni-eyebrow-olive">Continue · {cont.course.title}</span>
            <h2>{cont.lesson.title}</h2>
            <p>You&rsquo;re {cont.doneCount} of {cont.total} lessons in{cont.remaining ? `. About ${cont.remaining} left.` : '.'}</p>
            <span className="uni-prog" style={{ maxWidth: 320 }}><i style={{ width: `${Math.round((cont.doneCount / cont.total) * 100)}%` }} /></span>
          </div>
          <Link href={cont.lesson.href || `/university/${cont.course.slug}/${cont.lesson.slug}`} className="uni-btn primary">Continue →</Link>
        </section>
      )}

      {feed.departments.length > 0 && (
        <>
          <div className="uni-label">Departments <small>{feed.departments.length} · {feed.courses.length} course{feed.courses.length === 1 ? '' : 's'}</small></div>
          <DepartmentChips departments={feed.departments} active={dept} onPick={(id) => { setDept(id); setShowAll(false); }} />
        </>
      )}

      {feed.courses.length > 0 && (
        <section>
          <div className="uni-label">Courses <small>start anywhere, finish at your pace</small></div>
          <div className="uni-courses">
            {visible.map((c) => <CourseCard key={c.id} course={c} doneCount={doneCountFor(c)} />)}
          </div>
          {visible.length === 0 && <div className="uni-empty">No courses in this department yet.</div>}
          {hidden > 0 && <div className="uni-more"><button type="button" className="uni-btn" onClick={() => setShowAll(true)}>See {hidden} more course{hidden === 1 ? '' : 's'}</button></div>}
          {showAll && matching.length > INITIAL_COURSES && <div className="uni-more"><button type="button" className="uni-btn ghost sm" onClick={() => setShowAll(false)}>Show fewer</button></div>}
        </section>
      )}

      {feed.library.length > 0 && (
        <section>
          <div className="uni-label">Library <small>every file from every course</small><Link href="/university/library">Open the library →</Link></div>
          <div className="uni-files">
            {feed.library.map((f) => <FileRow key={f.id} file={f} showCourse compact />)}
          </div>
        </section>
      )}
    </UniversityShell>
  );
}
