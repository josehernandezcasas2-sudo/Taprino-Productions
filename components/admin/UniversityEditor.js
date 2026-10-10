import { useCallback, useEffect, useRef, useState } from 'react';
import * as tus from 'tus-js-client';

// The Film University editor (pages/admin/university.js). Three levels:
//   departments (left) → courses (middle list) → the selected course's
//   syllabus (modules + lessons) and its files drawer (materials and
//   examples, attached to the course or to one lesson).
// Lesson videos and example clips go to Cloudflare Stream (resumable
// upload, same as episodes); files go straight to Supabase Storage with a
// signed upload URL (any supported type, 50MB). Everything else saves
// through /api/admin/university.

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

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export default function UniversityEditor() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [topicId, setTopicId] = useState(null);
  const [courseId, setCourseId] = useState(null);
  const [editing, setEditing] = useState(null); // { type, item } — item null = new
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await call('GET');
      setData(next);
      setError(null);
      setTopicId((cur) => (cur && next.topics.some((t) => t.id === cur) ? cur : next.topics[0] ? next.topics[0].id : null));
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Keep the selected course valid as departments change.
  useEffect(() => {
    if (!data) return;
    const inTopic = data.courses.filter((c) => c.topicId === topicId);
    if (!courseId || !inTopic.some((c) => c.id === courseId)) setCourseId(inTopic[0] ? inTopic[0].id : null);
  }, [data, topicId, courseId]);

  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      await load();
      return result || true;
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

  async function save(type, fields, after) {
    const ok = await act(async () => {
      const { saved } = await call('POST', { type, ...fields });
      if (after) after(saved);
      return saved;
    });
    if (ok) setEditing(null);
  }

  async function remove(type, id, message) {
    if (!window.confirm(message)) return;
    const ok = await act(() => call('DELETE', { type, id }));
    if (ok) setEditing(null);
  }

  if (error && !data) return <div className="house-ad-error">{error}</div>;
  if (!data) return <p className="ca-sub">Loading…</p>;

  const topics = data.topics;
  const courses = data.courses.filter((c) => c.topicId === topicId);
  const course = data.courses.find((c) => c.id === courseId) || null;
  const modules = course ? data.modules.filter((m) => m.courseId === course.id) : [];
  const lessons = course ? data.lessons.filter((l) => l.courseId === course.id) : [];
  const files = course ? data.files.filter((f) => f.courseId === course.id) : [];
  const grouped = modules.length
    ? [{ id: null, title: null, lessons: lessons.filter((l) => !l.moduleId || !modules.some((m) => m.id === l.moduleId)) }, ...modules.map((m) => ({ ...m, lessons: lessons.filter((l) => l.moduleId === m.id) }))].filter((g) => g.title || g.lessons.length)
    : [{ id: null, title: null, lessons }];

  const open = (type, item = null) => setEditing({ type, item });
  const tools = (table, list, i, onEdit) => (
    <span className="uadm-topic-tools">
      <button type="button" title="Move up" disabled={busy || i === 0} onClick={() => move(table, list, i, -1)}>↑</button>
      <button type="button" title="Move down" disabled={busy || i === list.length - 1} onClick={() => move(table, list, i, 1)}>↓</button>
      <button type="button" className="sch-btn" onClick={onEdit}>Edit</button>
    </span>
  );

  return (
    <div className="uadm">
      {error && <div className="house-ad-error" style={{ marginBottom: '1rem' }}>{error}</div>}
      <div className="uadm-split">
        <aside className="uadm-topics">
          <div className="uadm-col-head">Departments</div>
          {topics.map((t, i) => (
            <div key={t.id} className={`uadm-topic${t.id === topicId ? ' on' : ''}${t.published ? '' : ' draft'}`}>
              <button type="button" className="uadm-topic-name" onClick={() => { setTopicId(t.id); setEditing(null); }}>
                <span className="uadm-dot" style={{ background: t.accentColor }} />
                {t.name} <small>{data.courses.filter((c) => c.topicId === t.id).length}</small>
                {!t.published && <small> · hidden</small>}
              </button>
              <span className="uadm-topic-tools">
                <button type="button" title="Move up" disabled={busy || i === 0} onClick={() => move('uni_topics', topics, i, -1)}>↑</button>
                <button type="button" title="Move down" disabled={busy || i === topics.length - 1} onClick={() => move('uni_topics', topics, i, 1)}>↓</button>
                <button type="button" title="Edit department" onClick={() => open('topic', t)}>✎</button>
              </span>
            </div>
          ))}
          <button type="button" className="uadm-add" onClick={() => open('topic')}>+ Department</button>
          {editing && editing.type === 'topic' && (
            <TopicForm
              topic={editing.item}
              accents={data.accents}
              busy={busy}
              onCancel={() => setEditing(null)}
              onSave={(fields) => save('topic', fields, (saved) => saved && saved.id && setTopicId(saved.id))}
              onDelete={(id) => remove('topic', id, 'Delete this department and every course, lesson and file in it? This can’t be undone.')}
            />
          )}
        </aside>

        <section className="uadm-lessons">
          {!topicId ? (
            <p className="ca-sub">Add a department to start.</p>
          ) : (
            <>
              <div className="uadm-col-head">Courses in {topics.find((t) => t.id === topicId)?.name}</div>
              <div className="uni-list">
                {courses.map((c, i) => (
                  <div key={c.id} className={`uni-row uadm-row${c.published ? '' : ' draft'}${c.id === courseId ? ' on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => { setCourseId(c.id); setEditing(null); }}>
                    <span className="uni-row-n">{String(i + 1).padStart(2, '0')}</span>
                    <span>
                      <span className="uni-row-t">{c.title}</span>
                      <span className="uni-meta">{[c.levelLabel, `${c.lessonCount} lesson${c.lessonCount === 1 ? '' : 's'}`, c.materialCount ? `¶ ${c.materialCount} file${c.materialCount === 1 ? '' : 's'}` : null, c.exampleCount ? `${c.exampleCount} example${c.exampleCount === 1 ? '' : 's'}` : null, c.published ? 'published' : 'draft'].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span onClick={(e) => e.stopPropagation()}>{tools('uni_courses', courses, i, () => open('course', c))}</span>
                  </div>
                ))}
                {courses.length === 0 && <div className="uni-row" style={{ gridTemplateColumns: '1fr' }}><span className="uni-meta">No courses in this department yet.</span></div>}
              </div>
              <button type="button" className="uadm-add" onClick={() => open('course')}>+ Course</button>
              {editing && editing.type === 'course' && (
                <CourseForm
                  key={editing.item ? editing.item.id : 'new'}
                  course={editing.item}
                  topicId={topicId}
                  topics={topics}
                  courses={data.courses}
                  levels={data.levels}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(fields) => save('course', fields, (saved) => saved && saved.id && setCourseId(saved.id))}
                  onDelete={(id) => remove('course', id, 'Delete this course with all its lessons and files? This can’t be undone.')}
                />
              )}

              {course && (
                <>
                  <div className="uadm-col-head" style={{ marginTop: '1.4rem' }}>
                    {course.title} · syllabus
                    <a href={course.href} target="_blank" rel="noopener" className="uadm-view">view ↗</a>
                  </div>
                  <div className="uni-list">
                    {grouped.map((g) => (
                      <div key={g.id || 'loose'}>
                        {g.title && (
                          <div className="uni-mod uadm-mod">
                            <span>{g.title}</span>
                            <span className="uadm-topic-tools">
                              {(() => { const i = modules.findIndex((m) => m.id === g.id); return (<>
                                <button type="button" title="Move up" disabled={busy || i === 0} onClick={() => move('uni_modules', modules, i, -1)}>↑</button>
                                <button type="button" title="Move down" disabled={busy || i === modules.length - 1} onClick={() => move('uni_modules', modules, i, 1)}>↓</button>
                                <button type="button" title="Edit module" onClick={() => open('module', modules[i])}>✎</button>
                              </>); })()}
                            </span>
                          </div>
                        )}
                        {g.lessons.map((l) => {
                          const i = lessons.findIndex((x) => x.id === l.id);
                          return (
                            <div key={l.id} className={`uni-row uadm-row${l.published ? '' : ' draft'}`}>
                              <span className="uni-row-n">{String(i + 1).padStart(2, '0')}</span>
                              <span>
                                <span className="uni-row-t">{l.title}</span>
                                <span className="uni-meta">{l.meta}{l.kind === 'video' && !l.hasVideo ? ' · no video yet' : ''}{l.kind === 'reading' && !l.documentUrl ? ' · no PDF yet' : ''} · {l.published ? 'published' : 'draft'}</span>
                              </span>
                              {tools('uni_lessons', lessons, i, () => open('lesson', l))}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {lessons.length === 0 && <div className="uni-row" style={{ gridTemplateColumns: '1fr' }}><span className="uni-meta">No lessons yet.</span></div>}
                  </div>
                  <div className="uni-actions" style={{ marginTop: '0.6rem' }}>
                    <button type="button" className="uadm-add" style={{ width: 'auto', flex: 1 }} onClick={() => open('lesson')}>+ Lesson · video or reading</button>
                    <button type="button" className="uadm-add" style={{ width: 'auto' }} onClick={() => open('module')}>+ Module heading</button>
                  </div>
                  {editing && editing.type === 'module' && (
                    <ModuleForm
                      key={editing.item ? editing.item.id : 'new'}
                      module={editing.item}
                      courseId={course.id}
                      busy={busy}
                      onCancel={() => setEditing(null)}
                      onSave={(fields) => save('module', fields)}
                      onDelete={(id) => remove('module', id, 'Remove this module heading? Its lessons stay in the course.')}
                    />
                  )}
                  {editing && editing.type === 'lesson' && (
                    <LessonForm
                      key={editing.item ? editing.item.id : 'new'}
                      lesson={editing.item}
                      courseId={course.id}
                      modules={modules}
                      busy={busy}
                      onCancel={() => setEditing(null)}
                      onSave={(fields) => save('lesson', fields)}
                      onDelete={(id) => remove('lesson', id, 'Delete this lesson? Files attached to it stay with the course.')}
                    />
                  )}

                  <div className="uadm-col-head" style={{ marginTop: '1.4rem' }}>Course files · {files.length}</div>
                  <div className="uni-list">
                    {files.map((f, i) => (
                      <div key={f.id} className={`uni-row uadm-row${f.published ? '' : ' draft'}`}>
                        <span className="uni-row-n">{f.role === 'example' ? '◎' : '¶'}</span>
                        <span>
                          <span className="uni-row-t">{f.title}</span>
                          <span className="uni-meta">{[f.role === 'example' ? 'example' : 'material', f.meta, f.lessonTitle ? `lesson: ${f.lessonTitle}` : 'course-wide', f.kind === 'file' && !f.fileUrl ? 'no file yet' : null, f.kind === 'video' && !f.hasVideo ? 'no video yet' : null, f.published ? null : 'hidden'].filter(Boolean).join(' · ')}</span>
                        </span>
                        {tools('uni_files', files, i, () => open('file', f))}
                      </div>
                    ))}
                    {files.length === 0 && <div className="uni-row" style={{ gridTemplateColumns: '1fr' }}><span className="uni-meta">No files yet. Materials are downloads (templates, worksheets); examples are things to look at (sample scripts, example clips) and get their own tab.</span></div>}
                  </div>
                  <button type="button" className="uadm-add" onClick={() => open('file')}>+ Add file or example · PDF, XLSX, DOCX, ZIP, video…</button>
                  {editing && editing.type === 'file' && (
                    <FileForm
                      key={editing.item ? editing.item.id : 'new'}
                      file={editing.item}
                      courseId={course.id}
                      lessons={lessons}
                      busy={busy}
                      onCancel={() => setEditing(null)}
                      onSave={(fields) => save('file', fields)}
                      onDelete={(id) => remove('file', id, 'Delete this file?')}
                    />
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CoverField({ kind, value, onChange }) {
  const preview = value.coverBase64 || (!value.removeCover && value.coverUrl) || null;
  async function pick(file) {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { window.alert('Please use an image under 6MB.'); return; }
    const dataUrl = await readAsDataUrl(file);
    onChange({ coverBase64: dataUrl, coverFileName: file.name, removeCover: false });
  }
  return (
    <div className="sch-field">
      <span>{kind === 'course' ? 'Cover image (the course card)' : kind === 'reading' ? 'Cover image (shows in lists and the library)' : 'Cover image (optional — replaces Cloudflare’s auto still)'}</span>
      <div className="uadm-cover">
        {preview
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={preview} alt="" className="uadm-cover-img" />
          : <div className="uadm-cover-img uadm-cover-empty">{kind === 'reading' ? '¶' : '▶'}</div>}
        <div className="uni-actions">
          <label className="admin-media-action">
            {preview ? 'Replace image…' : 'Upload JPG/PNG…'}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files[0])} />
          </label>
          {preview && <button type="button" className="admin-media-undo" onClick={() => onChange({ coverBase64: null, coverFileName: null, removeCover: true })}>Remove</button>}
        </div>
      </div>
    </div>
  );
}

function FormShell({ title, onSubmit, children }) {
  return (
    <form className="uadm-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <div className="uadm-form-title">{title}</div>
      {children}
    </form>
  );
}

function FormActions({ busy, label, onCancel, onDelete, canSave = true }) {
  return (
    <div className="uni-actions">
      <button type="submit" className="sch-btn primary" disabled={busy || !canSave}>{busy ? 'Saving…' : label}</button>
      <button type="button" className="sch-btn" onClick={onCancel}>Cancel</button>
      {onDelete && <button type="button" className="sch-btn danger" disabled={busy} onClick={onDelete}>Delete</button>}
    </div>
  );
}

function TopicForm({ topic, accents, busy, onCancel, onSave, onDelete }) {
  const [f, setF] = useState({ name: topic ? topic.name : '', description: topic ? topic.description : '', accent: topic ? topic.accent : 'brass', published: topic ? topic.published : true });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <FormShell title={topic ? 'Edit department' : 'New department'} onSubmit={() => onSave({ id: topic ? topic.id : undefined, ...f })}>
      <label className="sch-field"><span>Name</span><input value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} required /></label>
      <label className="sch-field"><span>One line about it</span><input value={f.description} maxLength={300} onChange={(e) => set('description', e.target.value)} /></label>
      <label className="sch-field"><span>Accent colour</span>
        <select value={f.accent} onChange={(e) => set('accent', e.target.value)}>{accents.map((a) => <option key={a} value={a}>{a}</option>)}</select>
      </label>
      <label className="uadm-check"><input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} /> Shown on the site</label>
      <FormActions busy={busy} label="Save department" onCancel={onCancel} onDelete={topic ? () => onDelete(topic.id) : null} canSave={Boolean(f.name.trim())} />
    </FormShell>
  );
}

function CourseForm({ course, topicId, topics, courses, levels, busy, onCancel, onSave, onDelete }) {
  const [f, setF] = useState(course ? {
    title: course.title, description: course.description, topicId: course.topicId, level: course.level, needs: course.needs, nextCourseId: course.nextCourseId || '', published: course.published,
    coverUrl: course.coverUrl || '', coverBase64: null, coverFileName: null, removeCover: false
  } : { title: '', description: '', topicId, level: 'start', needs: '', nextCourseId: '', published: false, coverUrl: '', coverBase64: null, coverFileName: null, removeCover: false });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <FormShell title={course ? 'Edit course' : 'New course'} onSubmit={() => onSave({ id: course ? course.id : undefined, ...f })}>
      <div className="uadm-grid">
        <label className="sch-field" style={{ gridColumn: '1 / -1' }}><span>Title</span><input value={f.title} maxLength={140} placeholder="Writing 101: from a sentence to a script" onChange={(e) => set('title', e.target.value)} required /></label>
        <label className="sch-field"><span>Department</span>
          <select value={f.topicId} onChange={(e) => set('topicId', e.target.value)}>{topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </label>
        <label className="sch-field"><span>Level</span>
          <select value={f.level} onChange={(e) => set('level', e.target.value)}>{levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
        </label>
      </div>
      <label className="sch-field"><span>What it covers</span><textarea rows={3} value={f.description} maxLength={1000} onChange={(e) => set('description', e.target.value)} /></label>
      <div className="uadm-grid">
        <label className="sch-field"><span>You’ll need (shown on the course page)</span><input value={f.needs} maxLength={200} placeholder="Nothing to start · a scene by lesson 3" onChange={(e) => set('needs', e.target.value)} /></label>
        <label className="sch-field"><span>After this course, suggest</span>
          <select value={f.nextCourseId} onChange={(e) => set('nextCourseId', e.target.value)}>
            <option value="">Nothing</option>
            {courses.filter((c) => !course || c.id !== course.id).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
      </div>
      <CoverField kind="course" value={f} onChange={(patch) => setF((s) => ({ ...s, ...patch }))} />
      <label className="uadm-check"><input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} /> Published</label>
      <FormActions busy={busy} label="Save course" onCancel={onCancel} onDelete={course ? () => onDelete(course.id) : null} canSave={Boolean(f.title.trim())} />
    </FormShell>
  );
}

function ModuleForm({ module, courseId, busy, onCancel, onSave, onDelete }) {
  const [title, setTitle] = useState(module ? module.title : '');
  return (
    <FormShell title={module ? 'Edit module heading' : 'New module heading'} onSubmit={() => onSave({ id: module ? module.id : undefined, courseId, title })}>
      <label className="sch-field"><span>Heading</span><input value={title} maxLength={120} placeholder="Module 1 · The idea" onChange={(e) => setTitle(e.target.value)} required /></label>
      <p className="uni-meta">Lessons choose their module in the lesson form. A course with no modules shows a plain numbered list.</p>
      <FormActions busy={busy} label="Save heading" onCancel={onCancel} onDelete={module ? () => onDelete(module.id) : null} canSave={Boolean(title.trim())} />
    </FormShell>
  );
}

function LessonForm({ lesson, courseId, modules, busy, onCancel, onSave, onDelete }) {
  const [f, setF] = useState(lesson ? {
    title: lesson.title, kind: lesson.kind, description: lesson.description, moduleId: lesson.moduleId || '',
    cloudflareUid: '', durationSeconds: lesson.durationSeconds || '', documentUrl: lesson.documentUrl || '', documentPages: lesson.documentPages || '',
    assignmentTitle: lesson.assignment ? lesson.assignment.title : '', assignmentText: lesson.assignment ? lesson.assignment.text : '', assignmentMinutes: lesson.assignment && lesson.assignment.minutes ? lesson.assignment.minutes : '',
    published: lesson.published, coverUrl: lesson.thumbnailUrl || '', coverBase64: null, coverFileName: null, removeCover: false
  } : { title: '', kind: 'video', description: '', moduleId: '', cloudflareUid: '', durationSeconds: '', documentUrl: '', documentPages: '', assignmentTitle: '', assignmentText: '', assignmentMinutes: '', published: false, coverUrl: '', coverBase64: null, coverFileName: null, removeCover: false });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const hasMedia = f.kind === 'video' ? Boolean(f.cloudflareUid || (lesson && lesson.hasVideo)) : Boolean(f.documentUrl);
  return (
    <FormShell title={lesson ? 'Edit lesson' : 'New lesson'} onSubmit={() => onSave({ id: lesson ? lesson.id : undefined, courseId, ...f })}>
      <div className="uadm-grid">
        <label className="sch-field" style={{ gridColumn: '1 / -1' }}><span>Title</span><input value={f.title} maxLength={140} onChange={(e) => set('title', e.target.value)} required /></label>
        <label className="sch-field"><span>Kind</span>
          <select value={f.kind} onChange={(e) => set('kind', e.target.value)} disabled={Boolean(lesson)}>
            <option value="video">Video</option>
            <option value="reading">Reading (PDF)</option>
          </select>
        </label>
        {modules.length > 0 && (
          <label className="sch-field"><span>Module</span>
            <select value={f.moduleId} onChange={(e) => set('moduleId', e.target.value)}>
              <option value="">No module</option>
              {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </label>
        )}
        {f.kind === 'video'
          ? <label className="sch-field"><span>Length (seconds, filled in after upload)</span><input type="number" min={0} value={f.durationSeconds} onChange={(e) => set('durationSeconds', e.target.value)} /></label>
          : <label className="sch-field"><span>Pages</span><input type="number" min={0} value={f.documentPages} onChange={(e) => set('documentPages', e.target.value)} /></label>}
      </div>

      {f.kind === 'video' ? (
        <div className="sch-field">
          <span>{lesson && lesson.hasVideo ? 'Video (uploaded — pick a file to replace it)' : 'Video'}</span>
          <VideoUpload onReady={({ uid, duration }) => { set('cloudflareUid', uid); if (duration && !f.durationSeconds) set('durationSeconds', Math.round(duration)); }} />
        </div>
      ) : (
        <div className="sch-field">
          <span>{f.documentUrl ? 'PDF (uploaded — pick a file to replace it)' : 'PDF'}</span>
          <FileUpload accept="application/pdf,.pdf" onReady={({ publicUrl }) => set('documentUrl', publicUrl)} />
          {f.documentUrl && <a href={f.documentUrl} target="_blank" rel="noopener" className="uni-meta">{f.documentUrl}</a>}
        </div>
      )}

      <label className="sch-field"><span>Notes (the Overview tab)</span><textarea rows={4} value={f.description} maxLength={2000} onChange={(e) => set('description', e.target.value)} /></label>
      <CoverField kind={f.kind} value={f} onChange={(patch) => setF((s) => ({ ...s, ...patch }))} />

      <div className="uadm-form-title" style={{ marginTop: '0.4rem', fontSize: '0.9rem' }}>Assignment (optional)</div>
      <div className="uadm-grid">
        <label className="sch-field"><span>Title</span><input value={f.assignmentTitle} maxLength={140} placeholder="Find the turn" onChange={(e) => set('assignmentTitle', e.target.value)} /></label>
        <label className="sch-field"><span>Minutes</span><input type="number" min={0} value={f.assignmentMinutes} onChange={(e) => set('assignmentMinutes', e.target.value)} /></label>
      </div>
      <label className="sch-field"><span>Brief, then a blank line, then the steps one per line</span><textarea rows={5} value={f.assignmentText} maxLength={4000} placeholder={'Take any scene you’ve written…\n\nPick a scene, any length.\nWrite the start state in one sentence.'} onChange={(e) => set('assignmentText', e.target.value)} /></label>

      <label className="uadm-check"><input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} /> Published {!hasMedia && <small className="uni-meta" style={{ display: 'inline' }}>(upload the {f.kind === 'video' ? 'video' : 'PDF'} first or it shows as unavailable)</small>}</label>
      <FormActions busy={busy} label="Save lesson" onCancel={onCancel} onDelete={lesson ? () => onDelete(lesson.id) : null} canSave={Boolean(f.title.trim())} />
    </FormShell>
  );
}

function FileForm({ file, courseId, lessons, busy, onCancel, onSave, onDelete }) {
  const [f, setF] = useState(file ? {
    title: file.title, description: file.description, role: file.role, kind: file.kind, lessonId: file.lessonId || '',
    fileUrl: file.fileUrl || '', fileType: file.fileType || '', sizeBytes: file.sizeBytes || '', pages: file.pages || '',
    cloudflareUid: '', durationSeconds: file.durationSeconds || '', published: file.published,
    coverUrl: file.thumbnailUrl || '', coverBase64: null, coverFileName: null, removeCover: false
  } : { title: '', description: '', role: 'material', kind: 'file', lessonId: '', fileUrl: '', fileType: '', sizeBytes: '', pages: '', cloudflareUid: '', durationSeconds: '', published: true, coverUrl: '', coverBase64: null, coverFileName: null, removeCover: false });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <FormShell title={file ? 'Edit file' : 'New file or example'} onSubmit={() => onSave({ id: file ? file.id : undefined, courseId, ...f })}>
      <div className="uadm-grid">
        <label className="sch-field" style={{ gridColumn: '1 / -1' }}><span>Title</span><input value={f.title} maxLength={140} placeholder="Scene beat worksheet" onChange={(e) => set('title', e.target.value)} required /></label>
        <label className="sch-field"><span>Shown as</span>
          <select value={f.role} onChange={(e) => set('role', e.target.value)}>
            <option value="material">Material — a download to use (Materials tab, Library)</option>
            <option value="example">Example — something to look at (Examples tab)</option>
          </select>
        </label>
        <label className="sch-field"><span>What it is</span>
          <select value={f.kind} onChange={(e) => set('kind', e.target.value)} disabled={Boolean(file)}>
            <option value="file">A file (PDF, spreadsheet, script, zip…)</option>
            <option value="video">A video clip (Cloudflare)</option>
          </select>
        </label>
        <label className="sch-field" style={{ gridColumn: '1 / -1' }}><span>Belongs to</span>
          <select value={f.lessonId} onChange={(e) => set('lessonId', e.target.value)}>
            <option value="">The whole course</option>
            {lessons.map((l) => <option key={l.id} value={l.id}>Lesson: {l.title}</option>)}
          </select>
        </label>
      </div>

      {f.kind === 'file' ? (
        <div className="sch-field">
          <span>{f.fileUrl ? 'File (uploaded — pick another to replace it)' : 'File · up to 50MB'}</span>
          <FileUpload onReady={({ publicUrl, fileType, sizeBytes }) => setF((s) => ({ ...s, fileUrl: publicUrl, fileType, sizeBytes }))} />
          {f.fileUrl && <a href={f.fileUrl} target="_blank" rel="noopener" className="uni-meta">{f.fileUrl}</a>}
        </div>
      ) : (
        <div className="sch-field">
          <span>{file && file.hasVideo ? 'Clip (uploaded — pick a file to replace it)' : 'Clip'}</span>
          <VideoUpload onReady={({ uid, duration }) => { set('cloudflareUid', uid); if (duration) set('durationSeconds', Math.round(duration)); }} />
        </div>
      )}
      <div className="uadm-grid">
        {f.kind === 'file' && <label className="sch-field"><span>Pages (optional)</span><input type="number" min={0} value={f.pages} onChange={(e) => set('pages', e.target.value)} /></label>}
        <label className="sch-field" style={{ gridColumn: f.kind === 'file' ? 'auto' : '1 / -1' }}><span>One line about it (optional)</span><input value={f.description} maxLength={300} placeholder="One page you fill in per scene" onChange={(e) => set('description', e.target.value)} /></label>
      </div>
      <CoverField kind={f.kind === 'video' ? 'video' : 'reading'} value={f} onChange={(patch) => setF((s) => ({ ...s, ...patch }))} />
      <label className="uadm-check"><input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} /> Shown on the site</label>
      <FormActions busy={busy} label="Save file" onCancel={onCancel} onDelete={file ? () => onDelete(file.id) : null} canSave={Boolean(f.title.trim())} />
    </FormShell>
  );
}

/* ------------------------------------------------------------------ */

// Resumable upload to Cloudflare Stream, then a poll until it's playable.
function VideoUpload({ onReady }) {
  const [stage, setStage] = useState('idle');
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
      const urlRes = await fetch('/api/admin/university-upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileSize: file.size, fileName: file.name }) });
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
      {stage === 'ready' && <div className="cf-import-done">✓ Video ready — save to attach it.</div>}
      {stage === 'error' && (<><div className="house-ad-error">{msg}</div><button type="button" className="sch-btn" style={{ marginTop: '0.5rem' }} onClick={() => setStage('idle')}>Try again</button></>)}
    </div>
  );
}

// Any supported file straight to Supabase Storage via a one-time signed
// upload URL (lib/universityDocs.js) — the bytes never pass our server.
function FileUpload({ accept, onReady }) {
  const [stage, setStage] = useState('idle');
  const [msg, setMsg] = useState(null);

  async function handleFile(file) {
    if (!file) return;
    setStage('uploading');
    setMsg(file.name);
    try {
      const res = await fetch('/api/admin/university-document-upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, fileSize: file.size }) });
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
      onReady({ publicUrl: data.publicUrl, fileType: data.fileType, sizeBytes: file.size });
    } catch (err) {
      setStage('error');
      setMsg(err.message || 'The upload failed.');
    }
  }

  return (
    <div className="cf-import-status" style={{ marginTop: 0 }}>
      {stage === 'idle' && <input type="file" accept={accept} onChange={(e) => handleFile(e.target.files[0])} />}
      {stage === 'uploading' && <div className="cf-import-stage">Uploading {msg}…</div>}
      {stage === 'ready' && <div className="cf-import-done">✓ Uploaded — save to attach it.</div>}
      {stage === 'error' && (<><div className="house-ad-error">{msg}</div><button type="button" className="sch-btn" style={{ marginTop: '0.5rem' }} onClick={() => setStage('idle')}>Try again</button></>)}
    </div>
  );
}
