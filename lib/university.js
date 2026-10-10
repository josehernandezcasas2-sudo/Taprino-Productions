import { getSupabase } from './supabase';
import { signedSrcForStoredUrl } from './videoSigning';
import { cloudflarePlaybackUrl, cloudflareThumbnailUrl, cloudflareUidFromUrl } from './cloudflareUpload';
import { uploadArtworkImage } from './artworkUpload';
import { fileTypeFor } from './universityDocs';

// Film University (migrations 078 + 081). Departments (uni_topics) hold
// courses (uni_courses); a course holds ordered lessons (uni_lessons,
// optionally under uni_modules headings) and files (uni_files: materials
// to download, examples to look at). Progress is a tick per lesson in
// uni_progress for a signed-in viewer. Everything public here filters
// published = true; the admin helpers at the bottom see it all. Read by
// pages/university/*, pages/api/university/* (the app) and the editor.

export const TOPIC_ACCENTS = {
  brass: '#f85f73',
  olive: '#e7a255',
  sky: '#8499dc',
  mint: '#93d0a4',
  'brass-deep': '#811826',
  ocean: '#283c63',
  rust: '#c85924'
};

export const COURSE_LEVELS = [
  { value: 'start', label: 'Start here' },
  { value: '2', label: 'Level 2' },
  { value: '3', label: 'Level 3' }
];

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatMinutes(seconds) {
  if (!seconds) return null;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function formatBytes(bytes) {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

/* ------------------------------------------------------------------ *
 * Row shapes (camelCase, safe to send to the browser / the app)
 * ------------------------------------------------------------------ */

function shapeTopic(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || '',
    accent: row.accent || 'brass',
    accentColor: TOPIC_ACCENTS[row.accent] || TOPIC_ACCENTS.brass,
    sortOrder: row.sort_order || 0,
    published: Boolean(row.published)
  };
}

function shapeCourse(row, topic) {
  const level = COURSE_LEVELS.find((l) => l.value === row.level) || COURSE_LEVELS[0];
  return {
    id: row.id,
    topicId: row.topic_id,
    topicSlug: topic ? topic.slug : null,
    topicName: topic ? topic.name : null,
    accentColor: topic ? topic.accentColor : TOPIC_ACCENTS.brass,
    slug: row.slug,
    title: row.title,
    description: row.description || '',
    level: row.level || 'start',
    levelLabel: level.label,
    coverUrl: row.cover_url || null,
    needs: row.needs || '',
    nextCourseId: row.next_course_id || null,
    sortOrder: row.sort_order || 0,
    published: Boolean(row.published),
    href: `/university/${row.slug}`
  };
}

function shapeModule(row) {
  return { id: row.id, courseId: row.course_id, title: row.title, sortOrder: row.sort_order || 0 };
}

function shapeLesson(row, course) {
  const kind = row.kind === 'document' ? 'reading' : 'video';
  const assignmentText = row.assignment_text || '';
  return {
    id: row.id,
    courseId: row.course_id,
    courseSlug: course ? course.slug : null,
    courseTitle: course ? course.title : null,
    topicName: course ? course.topicName : null,
    moduleId: row.module_id || null,
    slug: row.slug,
    title: row.title,
    description: row.description || '',
    kind,
    // The stored manifest URL never goes to the browser — a short-lived
    // signed src does (see getLessonPlayback).
    hasVideo: Boolean(row.video_src),
    durationSeconds: row.duration_seconds || null,
    duration: formatDuration(row.duration_seconds),
    thumbnailUrl: row.thumbnail_url || null,
    documentUrl: kind === 'reading' ? row.document_url || null : null,
    documentPages: row.document_pages || null,
    assignment: row.assignment_title || assignmentText
      ? {
          title: row.assignment_title || 'Assignment',
          text: assignmentText,
          // Steps are the lines after the first blank line (or every line
          // when there's no summary paragraph).
          steps: assignmentText.includes('\n\n') ? assignmentText.split('\n\n').slice(1).join('\n').split('\n').map((s) => s.trim()).filter(Boolean) : [],
          summary: assignmentText.includes('\n\n') ? assignmentText.split('\n\n')[0].trim() : assignmentText.trim(),
          minutes: row.assignment_minutes || null
        }
      : null,
    sortOrder: row.sort_order || 0,
    published: Boolean(row.published),
    href: course ? `/university/${course.slug}/${row.slug}` : null
  };
}

export function lessonMeta(lesson) {
  if (!lesson) return '';
  const parts = [lesson.kind === 'video' ? 'Video' : 'Reading'];
  if (lesson.kind === 'video' && lesson.duration) parts.push(lesson.duration);
  if (lesson.kind === 'reading' && lesson.documentPages) parts.push(`${lesson.documentPages} page${lesson.documentPages === 1 ? '' : 's'}`);
  if (lesson.assignment) parts.push('assignment');
  if (lesson.fileCount) parts.push(`¶ ${lesson.fileCount} file${lesson.fileCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function shapeFile(row, course, lesson) {
  return {
    id: row.id,
    courseId: row.course_id,
    courseSlug: course ? course.slug : null,
    courseTitle: course ? course.title : null,
    topicName: course ? course.topicName : null,
    lessonId: row.lesson_id || null,
    lessonSlug: lesson ? lesson.slug : null,
    lessonTitle: lesson ? lesson.title : null,
    role: row.role === 'example' ? 'example' : 'material',
    kind: row.kind === 'video' ? 'video' : 'file',
    title: row.title,
    description: row.description || '',
    fileUrl: row.kind === 'video' ? null : row.file_url || null,
    fileType: row.file_type || (row.kind === 'video' ? 'video' : 'other'),
    sizeBytes: row.size_bytes || null,
    size: formatBytes(row.size_bytes),
    pages: row.pages || null,
    hasVideo: Boolean(row.video_src),
    durationSeconds: row.duration_seconds || null,
    duration: formatDuration(row.duration_seconds),
    thumbnailUrl: row.thumbnail_url || null,
    sortOrder: row.sort_order || 0,
    published: Boolean(row.published)
  };
}

export function fileMeta(file) {
  const parts = [];
  if (file.kind === 'video') parts.push(file.duration ? `Video · ${file.duration}` : 'Video');
  else parts.push(String(file.fileType || 'file').toUpperCase());
  if (file.pages) parts.push(`${file.pages} page${file.pages === 1 ? '' : 's'}`);
  if (file.size) parts.push(file.size);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function loadAll({ includeUnpublished = false } = {}) {
  const supabase = getSupabase();
  const q = (table, orders) => {
    let query = supabase.from(table).select('*');
    for (const o of orders) query = query.order(o);
    if (!includeUnpublished && table !== 'uni_modules') query = query.eq('published', true);
    return query;
  };
  const [topicsRes, coursesRes, modulesRes, lessonsRes, filesRes] = await Promise.all([
    q('uni_topics', ['sort_order', 'name']),
    q('uni_courses', ['sort_order', 'created_at']),
    q('uni_modules', ['sort_order', 'created_at']),
    q('uni_lessons', ['sort_order', 'created_at']),
    q('uni_files', ['sort_order', 'created_at'])
  ]);
  for (const r of [topicsRes, coursesRes, modulesRes, lessonsRes, filesRes]) {
    if (r.error) throw new Error(`Film University query failed: ${r.error.message}`);
  }

  const topics = (topicsRes.data || []).map(shapeTopic);
  const topicsById = Object.fromEntries(topics.map((t) => [t.id, t]));
  // A course under an unpublished department disappears with it.
  const courses = (coursesRes.data || [])
    .filter((row) => includeUnpublished || topicsById[row.topic_id])
    .map((row) => shapeCourse(row, topicsById[row.topic_id]));
  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));
  const modules = (modulesRes.data || []).filter((m) => coursesById[m.course_id]).map(shapeModule);
  const lessons = (lessonsRes.data || [])
    .filter((row) => row.course_id && coursesById[row.course_id])
    .map((row) => shapeLesson(row, coursesById[row.course_id]));
  const lessonsById = Object.fromEntries(lessons.map((l) => [l.id, l]));
  const files = (filesRes.data || [])
    .filter((row) => coursesById[row.course_id])
    .map((row) => shapeFile(row, coursesById[row.course_id], row.lesson_id ? lessonsById[row.lesson_id] : null));

  // Counts the cards and syllabus rows show.
  for (const l of lessons) l.fileCount = files.filter((f) => f.lessonId === l.id && f.role === 'material').length;
  for (const l of lessons) l.meta = lessonMeta(l);
  for (const c of courses) {
    const own = lessons.filter((l) => l.courseId === c.id);
    c.lessonCount = own.length;
    c.videoSeconds = own.reduce((s, l) => s + (l.durationSeconds || 0), 0);
    c.length = formatMinutes(c.videoSeconds);
    c.pages = own.reduce((s, l) => s + (l.documentPages || 0), 0);
    c.materialCount = files.filter((f) => f.courseId === c.id && f.role === 'material').length;
    c.exampleCount = files.filter((f) => f.courseId === c.id && f.role === 'example').length;
    c.assignmentCount = own.filter((l) => l.assignment).length;
  }

  return { topics, topicsById, courses, coursesById, modules, lessons, lessonsById, files };
}

/* ------------------------------------------------------------------ *
 * Progress — a tick per lesson for a signed-in viewer
 * ------------------------------------------------------------------ */

export async function getProgress(userId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase.from('uni_progress').select('lesson_id, completed_at').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.lesson_id);
}

export async function setProgress(userId, lessonId, done) {
  const supabase = getSupabase();
  if (done) {
    const { error } = await supabase.from('uni_progress').upsert({ user_id: userId, lesson_id: lessonId }, { onConflict: 'user_id,lesson_id' });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('uni_progress').delete().eq('user_id', userId).eq('lesson_id', lessonId);
    if (error) throw new Error(error.message);
  }
}

// Merges a device's local ticks into the account the first time it signs
// in (the client sends the lesson ids it has stored).
export async function mergeProgress(userId, lessonIds) {
  const ids = (Array.isArray(lessonIds) ? lessonIds : []).filter((id) => typeof id === 'string').slice(0, 500);
  if (ids.length === 0) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from('uni_progress')
    .upsert(ids.map((lesson_id) => ({ user_id: userId, lesson_id })), { onConflict: 'user_id,lesson_id', ignoreDuplicates: true });
  if (error && !/foreign key/i.test(error.message)) throw new Error(error.message);
}

// Where to continue: the first unfinished lesson in the course most
// recently worked on. `doneIds` can come from the server (signed in) or
// the device (the page passes the device's list back in).
export function continueFrom(courses, lessons, doneIds) {
  const done = new Set(doneIds || []);
  const started = courses
    .map((c) => {
      const own = lessons.filter((l) => l.courseId === c.id);
      const doneCount = own.filter((l) => done.has(l.id)).length;
      const next = own.find((l) => !done.has(l.id)) || null;
      return { course: c, lessons: own, doneCount, next };
    })
    .filter((x) => x.doneCount > 0 && x.next);
  if (!started.length) return null;
  const pick = started[0];
  const remaining = pick.lessons.filter((l) => !done.has(l.id)).reduce((s, l) => s + (l.durationSeconds || 0), 0);
  return {
    course: pick.course,
    lesson: pick.next,
    doneCount: pick.doneCount,
    total: pick.lessons.length,
    remaining: formatMinutes(remaining),
    index: pick.lessons.findIndex((l) => l.id === pick.next.id) + 1
  };
}

/* ------------------------------------------------------------------ *
 * Pages
 * ------------------------------------------------------------------ */

// The catalogue (/university and /api/university/feed).
export async function getUniversityFeed({ userId = null } = {}) {
  const { topics, courses, lessons, files } = await loadAll();
  const visibleCourses = courses.filter((c) => c.lessonCount > 0);
  const departments = topics
    .map((t) => ({ ...t, courseCount: visibleCourses.filter((c) => c.topicId === t.id).length }))
    .filter((t) => t.courseCount > 0);
  const doneIds = userId ? await getProgress(userId) : null;
  return {
    departments,
    courses: visibleCourses,
    lessonCount: lessons.length,
    library: files.filter((f) => f.role === 'material' && f.kind === 'file').slice(0, 8).map((f) => ({ ...f, meta: fileMeta(f) })),
    libraryCount: files.filter((f) => f.kind === 'file').length,
    doneIds,
    continue: doneIds ? continueFrom(visibleCourses, lessons, doneIds) : null,
    // The device-side version of `continue` needs the lesson list.
    lessonIndex: lessons.map((l) => ({ id: l.id, courseId: l.courseId, slug: l.slug, title: l.title, durationSeconds: l.durationSeconds || 0 }))
  };
}

function syllabusFor(courseId, modules, lessons) {
  const own = lessons.filter((l) => l.courseId === courseId).map((l, i) => ({ ...l, number: i + 1 }));
  const mods = modules.filter((m) => m.courseId === courseId);
  if (mods.length === 0) return [{ id: null, title: null, lessons: own }];
  const groups = mods.map((m) => ({ id: m.id, title: m.title, lessons: own.filter((l) => l.moduleId === m.id) }));
  const loose = own.filter((l) => !l.moduleId || !mods.some((m) => m.id === l.moduleId));
  if (loose.length) groups.unshift({ id: null, title: null, lessons: loose });
  return groups.filter((g) => g.lessons.length > 0);
}

export async function getCoursePage(slug, { userId = null } = {}) {
  const { courses, coursesById, modules, lessons, files } = await loadAll();
  const course = courses.find((c) => c.slug === slug);
  if (!course) return null;
  const own = lessons.filter((l) => l.courseId === course.id);
  const doneIds = userId ? await getProgress(userId) : null;
  const done = new Set(doneIds || []);
  const next = own.find((l) => !done.has(l.id)) || own[0] || null;
  return {
    course,
    syllabus: syllabusFor(course.id, modules, lessons),
    lessons: own,
    materials: files.filter((f) => f.courseId === course.id && f.role === 'material').map((f) => ({ ...f, meta: fileMeta(f) })),
    examples: files.filter((f) => f.courseId === course.id && f.role === 'example').map((f) => ({ ...f, meta: fileMeta(f) })),
    doneIds,
    continueLesson: next,
    nextCourse: course.nextCourseId && coursesById[course.nextCourseId] ? coursesById[course.nextCourseId] : null
  };
}

// Signed playback for a video lesson or a video example. Free, so the
// only gate is "published".
async function signedSrc(videoSrc) {
  if (!videoSrc) return null;
  const signed = await signedSrcForStoredUrl(videoSrc);
  if (signed) return { src: signed.src, expiresAt: signed.expiresAt, signed: true };
  return { src: videoSrc, expiresAt: null, signed: false };
}

export async function getLessonPlayback(lessonId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('uni_lessons').select('id, video_src, published, kind').eq('id', lessonId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.published || data.kind !== 'video') return null;
  return signedSrc(data.video_src);
}

export async function getFilePlayback(fileId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('uni_files').select('id, video_src, published, kind').eq('id', fileId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.published || data.kind !== 'video') return null;
  return signedSrc(data.video_src);
}

export async function getLessonPage(courseSlug, lessonSlug, { userId = null } = {}) {
  const { courses, modules, lessons, files } = await loadAll();
  const course = courses.find((c) => c.slug === courseSlug);
  if (!course) return null;
  const own = lessons.filter((l) => l.courseId === course.id).map((l, i) => ({ ...l, number: i + 1 }));
  const index = own.findIndex((l) => l.slug === lessonSlug);
  if (index === -1) return null;
  const lesson = own[index];
  const mod = lesson.moduleId ? modules.find((m) => m.id === lesson.moduleId) : null;
  const playback = lesson.kind === 'video' ? await getLessonPlayback(lesson.id) : null;
  const doneIds = userId ? await getProgress(userId) : null;
  return {
    course,
    lesson,
    moduleTitle: mod ? mod.title : null,
    total: own.length,
    playback,
    files: files.filter((f) => f.lessonId === lesson.id && f.role === 'material').map((f) => ({ ...f, meta: fileMeta(f) })),
    examples: files.filter((f) => f.lessonId === lesson.id && f.role === 'example').map((f) => ({ ...f, meta: fileMeta(f) })),
    syllabus: syllabusFor(course.id, modules, lessons),
    next: own[index + 1] || null,
    previous: own[index - 1] || null,
    doneIds
  };
}

export async function getLibrary() {
  const { files, topics } = await loadAll();
  const all = files.filter((f) => f.kind === 'file' && f.fileUrl).map((f) => ({ ...f, meta: fileMeta(f) }));
  const types = [...new Set(all.map((f) => f.fileType))];
  return {
    files: all,
    types: types.map((t) => ({ value: t, count: all.filter((f) => f.fileType === t).length })),
    departments: topics.filter((t) => all.some((f) => f.topicName === t.name)).map((t) => ({ id: t.id, name: t.name, slug: t.slug }))
  };
}

/* ------------------------------------------------------------------ *
 * Admin (pages/api/admin/university.js) — sees unpublished rows too.
 * ------------------------------------------------------------------ */

export async function getUniversityAdminData() {
  const { topics, courses, modules, lessons, files } = await loadAll({ includeUnpublished: true });
  return {
    topics,
    courses,
    modules,
    lessons,
    files: files.map((f) => ({ ...f, meta: fileMeta(f) })),
    accents: Object.keys(TOPIC_ACCENTS),
    levels: COURSE_LEVELS
  };
}

function cleanText(value, max = 2000) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function cleanInt(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

async function uniqueSlug(table, base, { id, scopeColumn, scopeValue } = {}) {
  const supabase = getSupabase();
  const root = slugify(base) || 'item';
  let candidate = root;
  for (let n = 2; n < 50; n++) {
    let query = supabase.from(table).select('id').eq('slug', candidate);
    if (scopeColumn) query = query.eq(scopeColumn, scopeValue);
    if (id) query = query.neq('id', id);
    const { data, error } = await query.limit(1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;
    candidate = `${root}-${n}`;
  }
  return `${root}-${Date.now().toString(36)}`;
}

async function coverFrom(input, title) {
  if (input.removeCover) return null;
  if (input.coverBase64) {
    return uploadArtworkImage({ base64: input.coverBase64, fileName: input.coverFileName, pathPrefix: `university-cover-${slugify(title)}` });
  }
  return cleanText(input.coverUrl || input.thumbnailUrl, 500);
}

export async function saveTopic(input) {
  const supabase = getSupabase();
  const name = cleanText(input.name, 80);
  if (!name) throw new Error('A department needs a name.');
  const record = {
    name,
    description: cleanText(input.description, 300),
    accent: TOPIC_ACCENTS[input.accent] ? input.accent : 'brass',
    sort_order: cleanInt(input.sortOrder) ?? 0,
    published: input.published !== false,
    updated_at: new Date().toISOString()
  };
  if (input.id) {
    const { data, error } = await supabase.from('uni_topics').update(record).eq('id', input.id).select('*').single();
    if (error) throw new Error(error.message);
    return shapeTopic(data);
  }
  record.slug = await uniqueSlug('uni_topics', name);
  const { data, error } = await supabase.from('uni_topics').insert(record).select('*').single();
  if (error) throw new Error(error.message);
  return shapeTopic(data);
}

export async function deleteTopic(id) {
  const { error } = await getSupabase().from('uni_topics').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function saveCourse(input) {
  const supabase = getSupabase();
  const title = cleanText(input.title, 140);
  if (!title) throw new Error('A course needs a title.');
  if (!input.topicId) throw new Error('Pick a department for this course.');
  const record = {
    topic_id: input.topicId,
    title,
    description: cleanText(input.description, 1000),
    level: COURSE_LEVELS.some((l) => l.value === input.level) ? input.level : 'start',
    cover_url: await coverFrom(input, title),
    needs: cleanText(input.needs, 200),
    next_course_id: input.nextCourseId && input.nextCourseId !== input.id ? input.nextCourseId : null,
    sort_order: cleanInt(input.sortOrder) ?? 0,
    published: Boolean(input.published),
    updated_at: new Date().toISOString()
  };
  if (input.id) {
    const { data, error } = await supabase.from('uni_courses').update(record).eq('id', input.id).select('*').single();
    if (error) throw new Error(error.message);
    return shapeCourse(data, null);
  }
  record.slug = await uniqueSlug('uni_courses', input.slug || title);
  const { data, error } = await supabase.from('uni_courses').insert(record).select('*').single();
  if (error) throw new Error(error.message);
  return shapeCourse(data, null);
}

export async function deleteCourse(id) {
  const { error } = await getSupabase().from('uni_courses').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function saveModule(input) {
  const supabase = getSupabase();
  const title = cleanText(input.title, 120);
  if (!title) throw new Error('A module needs a title.');
  if (!input.courseId) throw new Error('A module belongs to a course.');
  const record = { course_id: input.courseId, title, sort_order: cleanInt(input.sortOrder) ?? 0 };
  if (input.id) {
    const { data, error } = await supabase.from('uni_modules').update(record).eq('id', input.id).select('*').single();
    if (error) throw new Error(error.message);
    return shapeModule(data);
  }
  const { data, error } = await supabase.from('uni_modules').insert(record).select('*').single();
  if (error) throw new Error(error.message);
  return shapeModule(data);
}

export async function deleteModule(id) {
  const { error } = await getSupabase().from('uni_modules').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function saveLesson(input) {
  const supabase = getSupabase();
  const title = cleanText(input.title, 140);
  if (!title) throw new Error('A lesson needs a title.');
  if (!input.courseId) throw new Error('A lesson belongs to a course.');
  const kind = input.kind === 'reading' || input.kind === 'document' ? 'document' : 'video';
  let videoSrc = kind === 'video' ? cleanText(input.videoSrc, 500) : null;
  if (kind === 'video' && input.cloudflareUid) videoSrc = cloudflarePlaybackUrl(String(input.cloudflareUid).trim()) || videoSrc;
  let thumbnailUrl = await coverFrom(input, title);
  if (!thumbnailUrl && videoSrc) thumbnailUrl = cloudflareThumbnailUrl(cloudflareUidFromUrl(videoSrc));
  // The course's department is kept on the lesson too (the 078 column).
  const { data: course, error: courseErr } = await supabase.from('uni_courses').select('topic_id').eq('id', input.courseId).single();
  if (courseErr) throw new Error('That course no longer exists.');
  const record = {
    course_id: input.courseId,
    topic_id: course.topic_id,
    module_id: input.moduleId || null,
    title,
    description: cleanText(input.description, 2000),
    kind,
    video_src: videoSrc,
    duration_seconds: kind === 'video' ? cleanInt(input.durationSeconds) : null,
    thumbnail_url: thumbnailUrl,
    document_url: kind === 'document' ? cleanText(input.documentUrl, 500) : null,
    document_pages: kind === 'document' ? cleanInt(input.documentPages) : null,
    assignment_title: cleanText(input.assignmentTitle, 140),
    assignment_text: cleanText(input.assignmentText, 4000),
    assignment_minutes: cleanInt(input.assignmentMinutes),
    sort_order: cleanInt(input.sortOrder) ?? 0,
    published: Boolean(input.published),
    updated_at: new Date().toISOString()
  };
  if (input.id) {
    const { data, error } = await supabase.from('uni_lessons').update(record).eq('id', input.id).select('*').single();
    if (error) throw new Error(error.message);
    return shapeLesson(data, null);
  }
  record.slug = await uniqueSlug('uni_lessons', input.slug || title, { scopeColumn: 'course_id', scopeValue: input.courseId });
  const { data, error } = await supabase.from('uni_lessons').insert(record).select('*').single();
  if (error) throw new Error(error.message);
  return shapeLesson(data, null);
}

export async function deleteLesson(id) {
  const { error } = await getSupabase().from('uni_lessons').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function saveFile(input) {
  const supabase = getSupabase();
  const title = cleanText(input.title, 140);
  if (!title) throw new Error('A file needs a title.');
  if (!input.courseId) throw new Error('A file belongs to a course.');
  const kind = input.kind === 'video' ? 'video' : 'file';
  let videoSrc = kind === 'video' ? cleanText(input.videoSrc, 500) : null;
  if (kind === 'video' && input.cloudflareUid) videoSrc = cloudflarePlaybackUrl(String(input.cloudflareUid).trim()) || videoSrc;
  let thumbnailUrl = await coverFrom(input, title);
  if (!thumbnailUrl && videoSrc) thumbnailUrl = cloudflareThumbnailUrl(cloudflareUidFromUrl(videoSrc));
  const fileUrl = kind === 'file' ? cleanText(input.fileUrl, 500) : null;
  const record = {
    course_id: input.courseId,
    lesson_id: input.lessonId || null,
    role: input.role === 'example' ? 'example' : 'material',
    kind,
    title,
    description: cleanText(input.description, 1000),
    file_url: fileUrl,
    file_type: kind === 'file' ? cleanText(input.fileType, 12) || fileTypeFor(fileUrl) || 'other' : null,
    size_bytes: kind === 'file' ? cleanInt(input.sizeBytes) : null,
    pages: kind === 'file' ? cleanInt(input.pages) : null,
    video_src: videoSrc,
    duration_seconds: kind === 'video' ? cleanInt(input.durationSeconds) : null,
    thumbnail_url: thumbnailUrl,
    sort_order: cleanInt(input.sortOrder) ?? 0,
    published: input.published !== false,
    updated_at: new Date().toISOString()
  };
  if (input.id) {
    const { data, error } = await supabase.from('uni_files').update(record).eq('id', input.id).select('*').single();
    if (error) throw new Error(error.message);
    return shapeFile(data, null, null);
  }
  const { data, error } = await supabase.from('uni_files').insert(record).select('*').single();
  if (error) throw new Error(error.message);
  return shapeFile(data, null, null);
}

export async function deleteFile(id) {
  const { error } = await getSupabase().from('uni_files').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Reorders rows in any of the ordered tables: ids in their new order get
// sort_order 1..n.
export async function reorder(table, ids) {
  if (!['uni_topics', 'uni_courses', 'uni_modules', 'uni_lessons', 'uni_files'].includes(table)) throw new Error('Unknown table.');
  const supabase = getSupabase();
  await Promise.all(
    ids.map((id, i) => supabase.from(table).update({ sort_order: i + 1 }).eq('id', id).then(({ error }) => {
      if (error) throw new Error(error.message);
    }))
  );
}
