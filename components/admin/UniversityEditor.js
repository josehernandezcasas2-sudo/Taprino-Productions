import { useCallback, useEffect, useRef, useState } from 'react';
import * as tus from 'tus-js-client';

// The Film University editor (pages/admin/university.js). Two tabs:
//   Lessons   — topics on the left (add / rename / reorder / publish),
//               the selected topic's lessons on the right (add a video via
//               the same resumable Cloudflare upload episodes use, or a
//               PDF straight to Supabase Storage; title, description,
//               attached document, template flag, order, published).
//   Exercises — the Workshop's front door: title, topic, minutes, what it
//               needs, steps, the lessons that teach it, the template to
//               use with it, an optional pin to a date, published.
// Everything saves through /api/admin/university.

async function call(method, body) {
  const res = await fetch('/api/admin/university', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const EMPTY_LESSON = { title: '', kind: 'video', description: '', cloudflareUid: '', durationSeconds: '', documentUrl: '', documentPages: '', isTemplate: false, attachmentLessonId: '', published: false };
const EMPTY_EXERCISE = { title: '', topicId: '', summary: '', steps: '', minutes: '', needs: [], lessonId: '', extraLessonIds: [], templateLessonId: '', pinnedOn: '', published: false };

export default function UniversityEditor() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('lessons');
  const [topicId, setTopicId] = useState(null);
  const [editingTopic, setEditingTopic] = useState(null); // null | 'new' | topic
  const [editingLesson, setEditingLesson] = useState(null); // null | 'new' | lesson
  const [editingExercise, setEditingExercise] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await call('GET');
      setData(next);
      setError(null);
      setTopicId((current) => (current && next.topics.some((t) => t.id === current) ? current : next.topics[0] ? next.topics[0].id : null));
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function move(table, list, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const ids = list.map((x) => x.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await act(() => call('PUT', { table, ids }));
  }

  if (error && !data) return <div className="house-ad-error">{error}</div>;
  if (!data) return <p className="ca-sub">Loading…</p>;

  const topics = data.topics;
  const topic = topics.find((t) => t.id === topicId) || null;
  const lessons = data.lessons.filter((l) => l.topicId === topicId);
  const documents = data.lessons.filter((l) => l.kind === 'document');

  return (
    <div className="uadm">
      <div className="sch-seg" role="tablist" style={{ marginBottom: '1rem' }}>
        <button type="button" role="tab" aria-selected={tab === 'lessons'} onClick={() => setTab('lessons')}>Topics &amp; lessons</button>
        <button type="button" role="tab" aria-selected={tab === 'exercises'} onClick={() => setTab('exercises')}>Exercises · {data.exercises.length}</button>
      </div>
      {error && <div className="house-ad-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {tab === 'lessons' && (
        <div className="uadm-split">
          <aside className="uadm-topics">
            <div className="uadm-col-head">Topics</div>
            {topics.map((t, i) => {
              const count = data.lessons.filter((l) => l.topicId === t.id).length;
              return (
                <div key={t.id} className={`uadm-topic${t.id === topicId ? ' on' : ''}${t.published ? '' : ' draft'}`}>
                  <button type="button" className="uadm-topic-name" onClick={() => { setTopicId(t.id); setEditingLesson(null); }}>
                    <span className="uadm-dot" style={{ background: t.accentColor }} />
                    {t.name} <small>{count}</small>
                    {!t.published && <small> · hidden</small>}
                  </button>
                  <span className="uadm-topic-tools">
                    <button type="button" title="Move up" disabled={busy || i === 0} onClick={() => move('uni_topics', topics, i, -1)}>↑</button>
                    <button type="button" title="Move down" disabled={busy || i === topics.length - 1} onClick={() => move('uni_topics', topics, i, 1)}>↓</button>
                    <button type="button" title="Edit topic" onClick={() => setEditingTopic(t)}>✎</button>
                  </span>
                </div>
              );
            })}
            <button type="button" className="uadm-add" onClick={() => setEditingTopic('new')}>+ Add topic</button>
            {editingTopic && (
              <TopicForm
                topic={editingTopic === 'new' ? null : editingTopic}
                accents={data.accents}
                busy={busy}
                onCancel={() => setEditingTopic(null)}
                onSave={async (fields) => {
                  const ok = await act(async () => {
                    const { saved } = await call('POST', { type: 'topic', ...fields });
                    if (saved && saved.id) setTopicId(saved.id);
                  });
                  if (ok) setEditingTopic(null);
                }}
                onDelete={async (id) => {
                  const count = data.lessons.filter((l) => l.topicId === id).length;
                  if (!window.confirm(`Delete this topic${count ? ` and its ${count} lesson${count === 1 ? '' : 's'}` : ''}? This can't be undone.`)) return;
                  const ok = await act(() => call('DELETE', { type: 'topic', id }));
                  if (ok) setEditingTopic(null);
                }}
              />
            )}
          </aside>

          <section className="uadm-lessons">
            {!topic ? (
              <p className="ca-sub">Add a topic to start adding lessons.</p>
            ) : (
              <>
                <div className="uadm-col-head">
                  {topic.name} · {lessons.length} lesson{lessons.length === 1 ? '' : 's'}
                  <a href={`/university/${topic.slug}`} target="_blank" rel="noopener" className="uadm-view">view ↗</a>
                </div>
                <div className="uni-list">
                  {lessons.map((l, i) => (
                    <div key={l.id} className={`uni-row uadm-row${l.published ? '' : ' draft'}`}>
                      <span className="uni-row-n">{String(i + 1).padStart(2, '0')}</span>
                      <span>
                        <span className="uni-row-t">{l.title}</span>
                        <span className="uni-meta">
                          {l.meta}{l.kind === 'video' && !l.hasVideo ? ' · no video yet' : ''}{l.kind === 'document' && !l.documentUrl ? ' · no PDF yet' : ''} · {l.published ? 'published' : 'draft'}
                        </span>
                      </span>
                      <span className="uadm-topic-tools">
                        <button type="button" title="Move up" disabled={busy || i === 0} onClick={() => move('uni_lessons', lessons, i, -1)}>↑</button>
                        <button type="button" title="Move down" disabled={busy || i === lessons.length - 1} onClick={() => move('uni_lessons', lessons, i, 1)}>↓</button>
                        <button type="button" className="sch-btn" onClick={() => setEditingLesson(l)}>Edit</button>
                      </span>
                    </div>
                  ))}
                  {lessons.length === 0 && <div className="uni-row" style={{ gridTemplateColumns: '1fr' }}><span className="uni-meta">No lessons yet.</span></div>}
                </div>
                <button type="button" className="uadm-add" onClick={() => setEditingLesson('new')}>+ Add lesson · video or document</button>
                {editingLesson && (
                  <LessonForm
                    key={editingLesson === 'new' ? 'new' : editingLesson.id}
                    lesson={editingLesson === 'new' ? null : editingLesson}
                    topicId={topic.id}
                    documents={documents.filter((d) => !editingLesson || d.id !== editingLesson.id)}
                    busy={busy}
                    onCancel={() => setEditingLesson(null)}
                    onSave={async (fields) => {
                      const ok = await act(() => call('POST', { type: 'lesson', ...fields }));
                      if (ok) setEditingLesson(null);
                    }}
                    onDelete={async (id) => {
                      if (!window.confirm('Delete this lesson? Exercises that point at it keep working, just without it.')) return;
                      const ok = await act(() => call('DELETE', { type: 'lesson', id }));
                      if (ok) setEditingLesson(null);
                    }}
                  />
                )}
              </>
            )}
          </section>
        </div>
      )}

      {tab === 'exercises' && (
        <section>
          <div className="uadm-col-head">
            Exercises · the Workshop rotates through the published ones, one per day
            <a href="/university" target="_blank" rel="noopener" className="uadm-view">view ↗</a>
          </div>
          <div className="uni-list">
            {data.exercises.map((e, i) => (
              <div key={e.id} className={`uni-row uadm-row${e.published ? '' : ' draft'}`}>
                <span className="uni-row-n">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <span className="uni-row-t">{e.title}</span>
                  <span className="uni-meta">
                    {[e.topicName, e.minutes ? `${e.minutes} min` : null, e.lesson ? `teaches: ${e.lesson.title}` : 'no lesson linked', e.pinnedOn ? `pinned ${e.pinnedOn}` : null, e.published ? 'published' : 'draft'].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="uadm-topic-tools">
                  <button type="button" title="Move up" disabled={busy || i === 0} onClick={() => move('uni_exercises', data.exercises, i, -1)}>↑</button>
                  <button type="button" title="Move down" disabled={busy || i === data.exercises.length - 1} onClick={() => move('uni_exercises', data.exercises, i, 1)}>↓</button>
                  <button type="button" className="sch-btn" onClick={() => setEditingExercise(e)}>Edit</button>
                </span>
              </div>
            ))}
            {data.exercises.length === 0 && <div className="uni-row" style={{ gridTemplateColumns: '1fr' }}><span className="uni-meta">No exercises yet — the Workshop page shows lessons by topic until there is one.</span></div>}
          </div>
          <button type="button" className="uadm-add" onClick={() => setEditingExercise('new')}>+ Add exercise</button>
          {editingExercise && (
            <ExerciseForm
              key={editingExercise === 'new' ? 'new' : editingExercise.id}
              exercise={editingExercise === 'new' ? null : editingExercise}
              topics={topics}
              lessons={data.lessons}
              needs={data.needs}
              busy={busy}
              onCancel={() => setEditingExercise(null)}
              onSave={async (fields) => {
                const ok = await act(() => call('POST', { type: 'exercise', ...fields }));
                if (ok) setEditingExercise(null);
              }}
              onDelete={async (id) => {
                if (!window.confirm('Delete this exercise?')) return;
                const ok = await act(() => call('DELETE', { type: 'exercise', id }));
                if (ok) setEditingExercise(null);
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}

function TopicForm({ topic, accents, busy, onCancel, onSave, onDelete }) {
  const [f, setF] = useState({ name: topic ? topic.name : '', description: topic ? topic.description : '', accent: topic ? topic.accent : 'brass', published: topic ? topic.published : true });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <form className="uadm-form" onSubmit={(e) => { e.preventDefault(); onSave({ id: topic ? topic.id : undefined, ...f }); }}>
      <div className="uadm-form-title">{topic ? 'Edit topic' : 'New topic'}</div>
      <label className="sch-field"><span>Name</span><input value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} required /></label>
      <label className="sch-field"><span>One line about it</span><input value={f.description} maxLength={300} onChange={(e) => set('description', e.target.value)} /></label>
      <label className="sch-field"><span>Card accent</span>
        <select value={f.accent} onChange={(e) => set('accent', e.target.value)}>{accents.map((a) => <option key={a} value={a}>{a}</option>)}</select>
      </label>
      <label className="uadm-check"><input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} /> Shown on the site</label>
      <div className="uni-actions">
        <button type="submit" className="sch-btn primary" disabled={busy || !f.name.trim()}>{busy ? 'Saving…' : 'Save topic'}</button>
        <button type="button" className="sch-btn" onClick={onCancel}>Cancel</button>
        {topic && <button type="button" className="sch-btn danger" disabled={busy} onClick={() => onDelete(topic.id)}>Delete</button>}
      </div>
    </form>
  );
}

function LessonForm({ lesson, topicId, documents, busy, onCancel, onSave, onDelete }) {
  const [f, setF] = useState(lesson ? {
    title: lesson.title,
    kind: lesson.kind,
    description: lesson.description,
    cloudflareUid: '',
    durationSeconds: lesson.durationSeconds || '',
    documentUrl: lesson.documentUrl || '',
    documentPages: lesson.documentPages || '',
    isTemplate: lesson.isTemplate,
    attachmentLessonId: lesson.attachmentLessonId || '',
    published: lesson.published
  } : EMPTY_LESSON);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const hasMedia = f.kind === 'video' ? Boolean(f.cloudflareUid || (lesson && lesson.hasVideo)) : Boolean(f.documentUrl);

  return (
    <form className="uadm-form" onSubmit={(e) => { e.preventDefault(); onSave({ id: lesson ? lesson.id : undefined, topicId, ...f }); }}>
      <div className="uadm-form-title">{lesson ? `Edit lesson` : 'New lesson'}</div>
      <div className="uadm-grid">
        <label className="sch-field" style={{ gridColumn: '1 / -1' }}><span>Title</span><input value={f.title} maxLength={140} onChange={(e) => set('title', e.target.value)} required /></label>
        <label className="sch-field"><span>Kind</span>
          <select value={f.kind} onChange={(e) => set('kind', e.target.value)} disabled={Boolean(lesson)}>
            <option value="video">Video</option>
            <option value="document">Document (PDF)</option>
          </select>
        </label>
        {f.kind === 'video' ? (
          <label className="sch-field"><span>Length (seconds, filled in after upload)</span><input type="number" min={0} value={f.durationSeconds} onChange={(e) => set('durationSeconds', e.target.value)} /></label>
        ) : (
          <label className="sch-field"><span>Pages</span><input type="number" min={0} value={f.documentPages} onChange={(e) => set('documentPages', e.target.value)} /></label>
        )}
      </div>

      {f.kind === 'video' ? (
        <div className="sch-field">
          <span>{lesson && lesson.hasVideo ? 'Video (uploaded — pick a file to replace it)' : 'Video'}</span>
          <VideoUpload onReady={({ uid, duration }) => { set('cloudflareUid', uid); if (duration && !f.durationSeconds) set('durationSeconds', Math.round(duration)); }} />
        </div>
      ) : (
        <div className="sch-field">
          <span>{f.documentUrl ? 'PDF (uploaded — pick a file to replace it)' : 'PDF'}</span>
          <DocumentUpload onReady={({ publicUrl }) => set('documentUrl', publicUrl)} />
          {f.documentUrl && <a href={f.documentUrl} target="_blank" rel="noopener" className="uni-meta">{f.documentUrl}</a>}
        </div>
      )}

      <label className="sch-field"><span>What it covers</span><textarea rows={4} value={f.description} maxLength={2000} onChange={(e) => set('description', e.target.value)} /></label>

      {f.kind === 'video' && (
        <label className="sch-field"><span>Attached document (shows beside the player)</span>
          <select value={f.attachmentLessonId} onChange={(e) => set('attachmentLessonId', e.target.value)}>
            <option value="">None</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.title}{d.topicName ? ` (${d.topicName})` : ''}</option>)}
          </select>
        </label>
      )}
      {f.kind === 'document' && (
        <label className="uadm-check"><input type="checkbox" checked={f.isTemplate} onChange={(e) => set('isTemplate', e.target.checked)} /> Template — goes on the download shelf and can be an exercise&rsquo;s &ldquo;use with&rdquo;</label>
      )}
      <label className="uadm-check"><input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} /> Published {!hasMedia && <small className="uni-meta" style={{ display: 'inline' }}>(upload the {f.kind === 'video' ? 'video' : 'PDF'} first or it shows as unavailable)</small>}</label>
      <div className="uni-actions">
        <button type="submit" className="sch-btn primary" disabled={busy || !f.title.trim()}>{busy ? 'Saving…' : 'Save lesson'}</button>
        <button type="button" className="sch-btn" onClick={onCancel}>Cancel</button>
        {lesson && <button type="button" className="sch-btn danger" disabled={busy} onClick={() => onDelete(lesson.id)}>Delete</button>}
      </div>
    </form>
  );
}

function ExerciseForm({ exercise, topics, lessons, needs, busy, onCancel, onSave, onDelete }) {
  const [f, setF] = useState(exercise ? {
    title: exercise.title,
    topicId: exercise.topicId || '',
    summary: exercise.summary,
    steps: exercise.steps.join('\n'),
    minutes: exercise.minutes || '',
    needs: exercise.needs,
    lessonId: exercise.lessonId || '',
    extraLessonIds: exercise.extraLessonIds,
    templateLessonId: exercise.templateLessonId || '',
    pinnedOn: exercise.pinnedOn || '',
    published: exercise.published
  } : EMPTY_EXERCISE);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleIn = (k, v) => setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));
  const documents = lessons.filter((l) => l.kind === 'document');
  const lessonLabel = (l) => `${l.title}${l.topicName ? ` (${l.topicName})` : ''}${l.published ? '' : ' · draft'}`;

  return (
    <form className="uadm-form" onSubmit={(e) => { e.preventDefault(); onSave({ id: exercise ? exercise.id : undefined, ...f }); }}>
      <div className="uadm-form-title">{exercise ? 'Edit exercise' : 'New exercise'}</div>
      <div className="uadm-grid">
        <label className="sch-field" style={{ gridColumn: '1 / -1' }}><span>Title</span><input value={f.title} maxLength={140} onChange={(e) => set('title', e.target.value)} required /></label>
        <label className="sch-field"><span>Topic</span>
          <select value={f.topicId} onChange={(e) => set('topicId', e.target.value)}>
            <option value="">None</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="sch-field"><span>Minutes</span><input type="number" min={0} value={f.minutes} onChange={(e) => set('minutes', e.target.value)} /></label>
      </div>
      <label className="sch-field"><span>The brief (one paragraph)</span><textarea rows={3} value={f.summary} maxLength={1000} onChange={(e) => set('summary', e.target.value)} /></label>
      <label className="sch-field"><span>Steps, one per line</span><textarea rows={5} value={f.steps} onChange={(e) => set('steps', e.target.value)} placeholder={'Pick a scene, any length.\nWrite the start state in one sentence.'} /></label>
      <div className="sch-field"><span>What it needs</span>
        <div className="uadm-checks">
          {needs.map((n) => (
            <label key={n.value} className="uadm-check"><input type="checkbox" checked={f.needs.includes(n.value)} onChange={() => toggleIn('needs', n.value)} /> {n.label}</label>
          ))}
        </div>
      </div>
      <div className="uadm-grid">
        <label className="sch-field"><span>Watch to do it (main lesson)</span>
          <select value={f.lessonId} onChange={(e) => set('lessonId', e.target.value)}>
            <option value="">None</option>
            {lessons.map((l) => <option key={l.id} value={l.id}>{lessonLabel(l)}</option>)}
          </select>
        </label>
        <label className="sch-field"><span>Use with (a document)</span>
          <select value={f.templateLessonId} onChange={(e) => set('templateLessonId', e.target.value)}>
            <option value="">None</option>
            {documents.map((l) => <option key={l.id} value={l.id}>{lessonLabel(l)}</option>)}
          </select>
        </label>
      </div>
      {lessons.length > 0 && (
        <div className="sch-field"><span>More lessons that help</span>
          <div className="uadm-checks">
            {lessons.filter((l) => l.id !== f.lessonId).map((l) => (
              <label key={l.id} className="uadm-check"><input type="checkbox" checked={f.extraLessonIds.includes(l.id)} onChange={() => toggleIn('extraLessonIds', l.id)} /> {lessonLabel(l)}</label>
            ))}
          </div>
        </div>
      )}
      <div className="uadm-grid">
        <label className="sch-field"><span>Pin as today&rsquo;s exercise on (optional)</span><input type="date" value={f.pinnedOn} onChange={(e) => set('pinnedOn', e.target.value)} /></label>
        <label className="uadm-check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} /> Published</label>
      </div>
      <div className="uni-actions">
        <button type="submit" className="sch-btn primary" disabled={busy || !f.title.trim()}>{busy ? 'Saving…' : 'Save exercise'}</button>
        <button type="button" className="sch-btn" onClick={onCancel}>Cancel</button>
        {exercise && <button type="button" className="sch-btn danger" disabled={busy} onClick={() => onDelete(exercise.id)}>Delete</button>}
      </div>
    </form>
  );
}

// Resumable upload to Cloudflare Stream, then a poll until it's playable.
// Same shape as components/CloudflareHouseAdImport.js, minus the MP4
// download stage lessons don't need.
function VideoUpload({ onReady }) {
  const [stage, setStage] = useState('idle'); // idle | uploading | transcoding | ready | error
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);
  const polls = useRef(0);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function poll(uid) {
    const tick = async () => {
      if (polls.current++ > 200) { setStage('error'); setMsg('Gave up waiting for Cloudflare — check the video in your Cloudflare dashboard.'); return; }
      try {
        const res = await fetch(`/api/admin/university-video-status?uid=${encodeURIComponent(uid)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lost track of the upload.');
        if (data.stage === 'error') { setStage('error'); setMsg(data.error); return; }
        if (data.stage === 'ready') { setStage('ready'); onReady({ uid, duration: data.duration }); return; }
        if (typeof data.pctComplete === 'number') setPct(data.pctComplete);
        timer.current = setTimeout(tick, 3000);
      } catch (err) {
        setStage('error');
        setMsg(err.message);
      }
    };
    tick();
  }

  async function handleFile(file) {
    if (!file) return;
    setStage('uploading');
    setPct(0);
    setMsg(file.name);
    try {
      const urlRes = await fetch('/api/admin/university-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileSize: file.size, fileName: file.name })
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Could not start the upload.');
      await new Promise((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: urlData.uploadUrl,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          metadata: { filename: file.name, filetype: file.type },
          onError: reject,
          onProgress: (up, total) => setPct(Math.round((up / total) * 100)),
          onSuccess: resolve
        });
        upload.start();
      });
      setStage('transcoding');
      setPct(0);
      polls.current = 0;
      poll(urlData.uid);
    } catch (err) {
      setStage('error');
      setMsg(err.message || 'The upload failed.');
    }
  }

  return (
    <div className="cf-import-status" style={{ marginTop: 0 }}>
      {stage === 'idle' && <input type="file" accept="video/*" onChange={(e) => handleFile(e.target.files[0])} />}
      {stage !== 'idle' && <div className="cf-import-file">{msg}</div>}
      {stage === 'uploading' && <div className="cf-import-stage">Uploading to Cloudflare… {pct}%</div>}
      {stage === 'transcoding' && <div className="cf-import-stage">Cloudflare is processing the video…</div>}
      {(stage === 'uploading' || stage === 'transcoding') && <div className="upload-widget-bar"><div className="upload-widget-bar-fill" style={{ width: `${pct}%` }} /></div>}
      {stage === 'ready' && <div className="cf-import-done">✓ Video ready — save the lesson to attach it.</div>}
      {stage === 'error' && (<><div className="house-ad-error">{msg}</div><button type="button" className="sch-btn" style={{ marginTop: '0.5rem' }} onClick={() => setStage('idle')}>Try again</button></>)}
    </div>
  );
}

// PDF straight to Supabase Storage via a one-time signed upload URL
// (lib/universityDocs.js) — the file never passes through our server.
function DocumentUpload({ onReady }) {
  const [stage, setStage] = useState('idle');
  const [msg, setMsg] = useState(null);

  async function handleFile(file) {
    if (!file) return;
    setStage('uploading');
    setMsg(file.name);
    try {
      const res = await fetch('/api/admin/university-document-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, fileSize: file.size })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the upload.');
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', file);
      const put = await fetch(data.uploadUrl, { method: 'PUT', body: form, headers: { 'x-upsert': 'false' } });
      if (!put.ok) {
        const text = await put.text().catch(() => '');
        throw new Error(`Storage refused the file (${put.status}). ${text.slice(0, 160)}`);
      }
      setStage('ready');
      onReady({ publicUrl: data.publicUrl });
    } catch (err) {
      setStage('error');
      setMsg(err.message || 'The upload failed.');
    }
  }

  return (
    <div className="cf-import-status" style={{ marginTop: 0 }}>
      {stage === 'idle' && <input type="file" accept="application/pdf,.pdf" onChange={(e) => handleFile(e.target.files[0])} />}
      {stage === 'uploading' && <div className="cf-import-stage">Uploading {msg}…</div>}
      {stage === 'ready' && <div className="cf-import-done">✓ PDF uploaded — save the lesson to attach it.</div>}
      {stage === 'error' && (<><div className="house-ad-error">{msg}</div><button type="button" className="sch-btn" style={{ marginTop: '0.5rem' }} onClick={() => setStage('idle')}>Try again</button></>)}
    </div>
  );
}
