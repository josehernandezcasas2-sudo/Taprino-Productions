import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readDone, setDone } from '../../lib/universityDone';

// Small shared pieces for the Film University pages.

// A lesson as a thumbnail + title row ("Watch to do it", "Up next").
export function LessonRow({ lesson, label }) {
  if (!lesson) return null;
  return (
    <Link href={lesson.href || '#'} className="uni-lesson-row">
      <LessonThumb lesson={lesson} small />
      <span>
        {label && <span className="uni-eyebrow">{label}</span>}
        <span className="uni-lesson-row-title">{lesson.title}</span>
        <span className="uni-meta">{lesson.meta}</span>
      </span>
    </Link>
  );
}

export function LessonThumb({ lesson, small = false }) {
  const cls = `uni-thumb${small ? ' uni-thumb-sm' : ''}${lesson.kind === 'document' ? ' uni-thumb-doc' : ''}`;
  if (lesson.kind === 'video' && lesson.thumbnailUrl) {
    return (
      <span className={cls} style={{ backgroundImage: `url(${lesson.thumbnailUrl})` }}>
        {lesson.duration && <span className="uni-thumb-badge">▶ {lesson.duration}</span>}
      </span>
    );
  }
  return (
    <span className={cls}>
      <span className="uni-thumb-glyph">{lesson.kind === 'document' ? '¶' : '▶'}</span>
      {lesson.kind === 'video' && lesson.duration && <span className="uni-thumb-badge">▶ {lesson.duration}</span>}
    </span>
  );
}

// A lesson card for grids (templates shelf, topic cards' lessons).
export function LessonCard({ lesson }) {
  return (
    <Link href={lesson.href || '#'} className="uni-lesson-card">
      <LessonThumb lesson={lesson} />
      <span className="uni-lesson-card-body">
        <span className="uni-lesson-card-title">{lesson.title}</span>
        <span className="uni-meta">
          {lesson.topicName ? `${lesson.topicName} · ` : ''}
          {lesson.meta}
        </span>
      </span>
    </Link>
  );
}

export function TopicCard({ topic }) {
  const count = `${topic.lessonCount} lesson${topic.lessonCount === 1 ? '' : 's'}`;
  const detail =
    topic.videoCount && topic.documentCount
      ? `${count} · ${topic.videoCount} video${topic.videoCount === 1 ? '' : 's'} · ${topic.documentCount} doc${topic.documentCount === 1 ? '' : 's'}`
      : count;
  return (
    <Link href={topic.href} className="uni-topic" style={{ '--uni-accent': topic.accentColor }}>
      <span className="uni-eyebrow">{topic.name}</span>
      <span className="uni-topic-name">{topic.name}</span>
      {topic.description && <span className="uni-topic-desc">{topic.description}</span>}
      <span className="uni-meta">{detail}</span>
    </Link>
  );
}

export function needsLabel(needs) {
  const map = { nothing: 'Needs nothing', phone: 'Needs a phone', camera: 'Needs a camera', scene: 'Needs a scene you wrote', person: 'Needs another person', footage: 'Needs footage to cut' };
  if (!needs || needs.length === 0) return null;
  if (needs.length === 1) return map[needs[0]] || null;
  const words = needs.map((n) => (map[n] || '').replace(/^Needs (a |another )?/, '')).filter(Boolean);
  return `Needs ${words.join(' + ')}`;
}

// The exercise as a card: topic · minutes, title, summary, what it needs,
// the lesson that teaches it.
export function ExerciseCard({ exercise, done }) {
  return (
    <Link href={exercise.href} className={`uni-excard${done ? ' is-done' : ''}`}>
      <span className="uni-eyebrow uni-eyebrow-olive">
        {[exercise.topicName, exercise.minutes ? `${exercise.minutes} min` : null].filter(Boolean).join(' · ') || 'Exercise'}
        {done && <span className="uni-done-tick"> · done ✓</span>}
      </span>
      <span className="uni-excard-title">{exercise.title}</span>
      {exercise.summary && <span className="uni-excard-summary">{exercise.summary}</span>}
      {needsLabel(exercise.needs) && <span className="uni-meta">{needsLabel(exercise.needs)}</span>}
      {exercise.lesson && (
        <span className="uni-teach">
          <LessonThumb lesson={exercise.lesson} small />
          <span>{exercise.lesson.title}{exercise.lesson.duration ? ` · ${exercise.lesson.duration}` : ''}</span>
        </span>
      )}
    </Link>
  );
}

// Reads the device's "I did it" list once mounted (never during SSR, so
// the server and first client render agree).
export function useDoneMap() {
  const [done, setDoneMap] = useState({});
  useEffect(() => {
    setDoneMap(readDone());
  }, []);
  function toggle(slug) {
    setDoneMap(setDone(slug, !done[slug]));
  }
  return [done, toggle];
}

export function DoneButton({ slug, done, onToggle, block = false }) {
  return (
    <button type="button" className={`uni-btn${done ? '' : ' primary'}${block ? ' block' : ''}`} onClick={() => onToggle(slug)}>
      {done ? 'Done ✓ · undo' : 'I did it ✓'}
    </button>
  );
}
