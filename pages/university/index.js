import Link from 'next/link';
import { useMemo, useState } from 'react';
import { universityPageProps } from '../../lib/universityPage';
import { getUniversityFeed } from '../../lib/university';
import UniversityShell, { accountFromProps } from '../../components/university/UniversityShell';
import { ExerciseCard, LessonRow, LessonCard, TopicCard, DoneButton, useDoneMap, needsLabel } from '../../components/university/LessonBits';

// Film University — the Workshop (direction D, signed off 2026-10-09).
// The exercise is the front door: one thing to try today, the lessons
// that teach it beside it, then every exercise with filters, then the
// lessons by topic and the templates shelf. Free, no sign-in.
export async function getServerSideProps(ctx) {
  return universityPageProps(ctx, async () => ({ feed: await getUniversityFeed() }));
}

const TIME_FILTERS = [
  { key: 'short', label: 'Under 15 min', test: (m) => m != null && m < 15 },
  { key: 'mid', label: '15–30 min', test: (m) => m != null && m >= 15 && m <= 30 },
  { key: 'long', label: '30+ min', test: (m) => m != null && m > 30 }
];
const NEED_FILTERS = [
  { key: 'nothing', label: 'Needs nothing' },
  { key: 'phone', label: 'A phone' },
  { key: 'camera', label: 'A camera' },
  { key: 'scene', label: 'A scene' },
  { key: 'person', label: 'Another person' },
  { key: 'footage', label: 'Footage' }
];

export default function UniversityHome(props) {
  const feed = props.feed || { today: null, exercises: [], topics: [], templates: [] };
  const [done, toggleDone] = useDoneMap();
  const [filter, setFilter] = useState({ kind: 'all', value: null });
  // "Show me another" walks the other exercises, starting somewhere
  // random so two visits on the same day don't always show the same pair.
  const [todayIndex, setTodayIndex] = useState(-1);

  const today = useMemo(() => {
    if (!feed.today) return null;
    if (todayIndex < 0) return feed.today;
    const others = feed.exercises.filter((e) => e.id !== feed.today.id);
    return others.length ? others[todayIndex % others.length] : feed.today;
  }, [feed, todayIndex]);

  function showAnother() {
    setTodayIndex((i) => (i < 0 ? Math.floor(Math.random() * Math.max(1, feed.exercises.length - 1)) : i + 1));
  }

  const topicsInUse = feed.topics.filter((t) => feed.exercises.some((e) => e.topicId === t.id));
  const needsInUse = NEED_FILTERS.filter((n) => feed.exercises.some((e) => e.needs.includes(n.key)));
  const timesInUse = TIME_FILTERS.filter((t) => feed.exercises.some((e) => t.test(e.minutes)));

  const visible = feed.exercises.filter((e) => {
    if (filter.kind === 'all') return true;
    if (filter.kind === 'time') return TIME_FILTERS.find((t) => t.key === filter.value).test(e.minutes);
    if (filter.kind === 'need') return e.needs.includes(filter.value);
    if (filter.kind === 'topic') return e.topicId === filter.value;
    return true;
  });

  const chip = (kind, value, label) => (
    <button
      key={`${kind}-${value}`}
      type="button"
      className={`uni-chip${filter.kind === kind && filter.value === value ? ' on' : ''}`}
      onClick={() => setFilter({ kind, value })}
    >
      {label}
    </button>
  );

  const empty = feed.exercises.length === 0 && feed.topics.length === 0;

  return (
    <UniversityShell title="Workshop" account={accountFromProps(props)} mainGenres={props.mainGenres} wide>
      <div className="uni-hero">
        <span className="uni-eyebrow uni-eyebrow-pink">Film University · Free</span>
        <h1>Workshop</h1>
        <p className="uni-lead">Pick an exercise, do it today, watch what you need along the way. Free to watch, free to download, free to practice with.</p>
      </div>

      {props.loadError && <div className="uni-empty">Film University isn&rsquo;t set up yet — the admin needs to run migration 078.</div>}
      {!props.loadError && empty && <div className="uni-empty">Nothing here yet — the first lessons and exercises are on their way.</div>}

      {today && (
        <section className="uni-today" aria-label="Today's exercise">
          <div>
            <span className="uni-eyebrow uni-eyebrow-olive">
              {todayIndex < 0 ? "Today's exercise" : 'Another exercise'}
              {today.topicName ? ` · ${today.topicName}` : ''}
              {today.minutes ? ` · ${today.minutes} min` : ''}
            </span>
            <h2><Link href={today.href}>{today.title}</Link></h2>
            {today.summary && <p>{today.summary}</p>}
            {today.steps.length > 0 && (
              <ol className="uni-steps">
                {today.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            )}
            {needsLabel(today.needs) && <div className="uni-meta" style={{ marginBottom: '0.9rem' }}>{needsLabel(today.needs)}</div>}
            <div className="uni-actions">
              <DoneButton slug={today.slug} done={Boolean(done[today.slug])} onToggle={toggleDone} />
              {feed.exercises.length > 1 && <button type="button" className="uni-btn" onClick={showAnother}>Show me another</button>}
              <Link href={today.href} className="uni-btn ghost">Open →</Link>
            </div>
          </div>
          <div className="uni-today-side">
            {(today.lesson || today.extraLessons.length > 0) && (
              <>
                <span className="uni-eyebrow">Watch to do it</span>
                {today.lesson && (
                  <Link href={today.lesson.href} className="uni-today-video">
                    <span
                      className={`uni-thumb${today.lesson.kind === 'document' ? ' uni-thumb-doc' : ''}`}
                      style={today.lesson.thumbnailUrl ? { backgroundImage: `url(${today.lesson.thumbnailUrl})` } : undefined}
                    >
                      <span className="uni-thumb-badge">
                        {today.lesson.kind === 'video' ? `▶ ${today.lesson.duration || 'Watch'}` : '¶ Read'} · {today.lesson.title}
                      </span>
                    </span>
                  </Link>
                )}
                {today.extraLessons.map((l) => <LessonRow key={l.id} lesson={l} />)}
              </>
            )}
            {today.template && (
              <>
                <span className="uni-eyebrow" style={{ marginTop: '0.8rem' }}>Use with</span>
                <a href={today.template.documentUrl} className="uni-use-with" target="_blank" rel="noopener">
                  ¶ {today.template.title} · download PDF
                </a>
              </>
            )}
            {!today.lesson && today.extraLessons.length === 0 && !today.template && (
              <p className="uni-meta">No lesson attached yet — this one stands on its own.</p>
            )}
          </div>
        </section>
      )}

      {feed.exercises.length > 0 && (
        <section>
          <div className="uni-label">All exercises <small>{feed.exercises.length}</small></div>
          <div className="uni-chips">
            {chip('all', null, `All ${feed.exercises.length}`)}
            {timesInUse.map((t) => chip('time', t.key, t.label))}
            {needsInUse.map((n) => chip('need', n.key, n.label))}
            {topicsInUse.map((t) => chip('topic', t.id, t.name))}
          </div>
          <div className="uni-exgrid">
            {visible.map((e) => <ExerciseCard key={e.id} exercise={e} done={Boolean(done[e.slug])} />)}
          </div>
          {visible.length === 0 && <div className="uni-empty">No exercises match that filter yet.</div>}
        </section>
      )}

      {feed.topics.length > 0 && (
        <section>
          <div className="uni-label">Lessons by topic <small>{feed.topics.length} topics · {feed.lessonCount} lessons</small></div>
          <div className="uni-topics">
            {feed.topics.map((t) => <TopicCard key={t.id} topic={t} />)}
          </div>
        </section>
      )}

      {feed.templates.length > 0 && (
        <section>
          <div className="uni-label">Templates <small>download, fill in, shoot</small></div>
          <div className="uni-lesson-grid">
            {feed.templates.map((l) => <LessonCard key={l.id} lesson={l} />)}
          </div>
        </section>
      )}
    </UniversityShell>
  );
}
