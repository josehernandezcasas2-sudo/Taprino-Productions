import Link from 'next/link';
import { useState } from 'react';
import { universityPageProps } from '../../../lib/universityPage';
import { getTopicPage, formatDuration } from '../../../lib/university';
import UniversityShell, { accountFromProps } from '../../../components/university/UniversityShell';
import BackButton from '../../../components/BackButton';

// A topic: its lessons as a numbered path, videos and documents mixed in
// the order the admin set, with chips to show just one kind.
export async function getServerSideProps(ctx) {
  const slug = ctx.params.topic;
  return universityPageProps(ctx, () => getTopicPage(slug));
}

export default function TopicPage(props) {
  const { topic, lessons, videoCount, documentCount, totalSeconds } = props;
  const [kind, setKind] = useState('all');
  const visible = kind === 'all' ? lessons : lessons.filter((l) => l.kind === kind);
  const hours = totalSeconds >= 3600 ? `about ${Math.round(totalSeconds / 3600 * 2) / 2} hours of video` : totalSeconds > 0 ? `${formatDuration(totalSeconds)} of video` : null;
  const summary = [
    `${lessons.length} lesson${lessons.length === 1 ? '' : 's'}`,
    hours,
    documentCount ? `${documentCount} document${documentCount === 1 ? '' : 's'} you'll keep using` : null
  ].filter(Boolean).join(', ');

  return (
    <UniversityShell title={topic.name} description={topic.description} account={accountFromProps(props)} mainGenres={props.mainGenres}>
      <div className="uni-topbar">
        <BackButton fallbackHref="/university" />
        <nav className="uni-crumbs" aria-label="Breadcrumb">
          <Link href="/university">Film University</Link><span>/</span><span>{topic.name}</span>
        </nav>
      </div>
      <h1 className="uni-h1" style={{ '--uni-accent': topic.accentColor }}>{topic.name}</h1>
      <p className="uni-lead">{topic.description ? `${topic.description} ` : ''}{summary}.</p>

      <div className="uni-chips">
        <button type="button" className={`uni-chip${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>All {lessons.length}</button>
        {videoCount > 0 && <button type="button" className={`uni-chip${kind === 'video' ? ' on' : ''}`} onClick={() => setKind('video')}>Videos {videoCount}</button>}
        {documentCount > 0 && <button type="button" className={`uni-chip${kind === 'document' ? ' on' : ''}`} onClick={() => setKind('document')}>Documents {documentCount}</button>}
      </div>

      {lessons.length === 0 ? (
        <div className="uni-empty">No lessons in this topic yet.</div>
      ) : (
        <div className="uni-list">
          {visible.map((l) => (
            <Link key={l.id} href={l.href} className="uni-row">
              <span className="uni-row-n">{String(l.number).padStart(2, '0')}</span>
              <span>
                <span className="uni-row-t">{l.title}</span>
                <span className="uni-meta">
                  {l.meta}
                  {l.exerciseCount > 0 ? ` · exercise${l.exerciseCount === 1 ? '' : 's'} included` : ''}
                </span>
              </span>
              <span className="uni-row-k">{l.kind === 'video' ? '▶ Watch' : '¶ Read'}</span>
            </Link>
          ))}
        </div>
      )}
    </UniversityShell>
  );
}
