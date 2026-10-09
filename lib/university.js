import { getSupabase } from './supabase';
import { signedSrcForStoredUrl } from './videoSigning';
import { cloudflarePlaybackUrl, cloudflareThumbnailUrl, cloudflareUidFromUrl } from './cloudflareUpload';

// Film University (migration 078): topics hold ordered lessons (a video on
// Cloudflare Stream or a PDF in storage); exercises are the Workshop front
// door and link to the lessons that teach them. Everything public here
// filters published = true; the admin helpers at the bottom see it all.
// Read by pages/university/*, pages/api/university/* (the mobile app) and
// pages/admin/university.js.

// Topic card accents, keyed by name so the admin picker and both apps
// agree. Hex values are the site palette (styles/globals.css :root).
export const TOPIC_ACCENTS = {
  brass: '#f85f73',
  olive: '#e7a255',
  sky: '#8499dc',
  mint: '#93d0a4',
  'brass-deep': '#811826',
  ocean: '#283c63',
  rust: '#c85924'
};

// What an exercise needs, as filter chips. Stored values are the keys.
export const EXERCISE_NEEDS = [
  { value: 'nothing', label: 'Nothing' },
  { value: 'phone', label: 'A phone' },
  { value: 'camera', label: 'A camera' },
  { value: 'scene', label: 'A scene you wrote' },
  { value: 'person', label: 'Another person' },
  { value: 'footage', label: 'Footage to cut' }
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

function shapeLesson(row, topic) {
  const kind = row.kind === 'document' ? 'document' : 'video';
  return {
    id: row.id,
    topicId: row.topic_id,
    topicSlug: topic ? topic.slug : null,
    topicName: topic ? topic.name : null,
    slug: row.slug,
    title: row.title,
    description: row.description || '',
    kind,
    // The stored manifest URL is never sent to the browser — the lesson
    // page and the app get a short-lived signed src instead (see
    // signedSrcForLesson). Only its presence is exposed.
    hasVideo: Boolean(row.video_src),
    durationSeconds: row.duration_seconds || null,
    duration: formatDuration(row.duration_seconds),
    thumbnailUrl: row.thumbnail_url || null,
    documentUrl: kind === 'document' ? row.document_url || null : null,
    documentPages: row.document_pages || null,
    isTemplate: Boolean(row.is_template),
    attachmentLessonId: row.attachment_lesson_id || null,
    sortOrder: row.sort_order || 0,
    published: Boolean(row.published),
    href: topic ? `/university/${topic.slug}/${row.slug}` : null
  };
}

// A one-line summary of a lesson for cards, "Watch to do it" rows and the
// mobile app: kind, length, where it lives.
function lessonMeta(lesson) {
  if (!lesson) return '';
  const parts = [lesson.kind === 'video' ? 'Video' : 'Document'];
  if (lesson.kind === 'video' && lesson.duration) parts.push(lesson.duration);
  if (lesson.kind === 'document' && lesson.documentPages) {
    parts.push(`${lesson.documentPages} page${lesson.documentPages === 1 ? '' : 's'}`);
  }
  if (lesson.isTemplate) parts.push('template');
  return parts.join(' · ');
}

function shapeExercise(row, { topicsById, lessonsById }) {
  const topic = row.topic_id ? topicsById[row.topic_id] : null;
  const lesson = row.lesson_id ? lessonsById[row.lesson_id] : null;
  const extra = (row.extra_lesson_ids || []).map((id) => lessonsById[id]).filter(Boolean);
  const template = row.template_lesson_id ? lessonsById[row.template_lesson_id] : null;
  const steps = Array.isArray(row.steps) ? row.steps.filter((s) => typeof s === 'string' && s.trim()) : [];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    topicId: row.topic_id || null,
    topicSlug: topic ? topic.slug : null,
    topicName: topic ? topic.name : null,
    summary: row.summary || '',
    steps,
    minutes: row.minutes || null,
    needs: Array.isArray(row.needs) ? row.needs : [],
    lessonId: row.lesson_id || null,
    extraLessonIds: Array.isArray(row.extra_lesson_ids) ? row.extra_lesson_ids : [],
    templateLessonId: row.template_lesson_id || null,
    lesson: lesson ? { ...lesson, meta: lessonMeta(lesson) } : null,
    extraLessons: extra.map((l) => ({ ...l, meta: lessonMeta(l) })),
    template: template ? { ...template, meta: lessonMeta(template) } : null,
    pinnedOn: row.pinned_on || null,
    sortOrder: row.sort_order || 0,
    published: Boolean(row.published),
    href: `/university/exercise/${row.slug}`
  };
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function loadAll({ includeUnpublished = false } = {}) {
  const supabase = getSupabase();
  let topicsQuery = supabase.from('uni_topics').select('*').order('sort_order').order('name');
  let lessonsQuery = supabase.from('uni_lessons').select('*').order('sort_order').order('created_at');
  let exercisesQuery = supabase.from('uni_exercises').select('*').order('sort_order').order('created_at');
  if (!includeUnpublished) {
    topicsQuery = topicsQuery.eq('published', true);
    lessonsQuery = lessonsQuery.eq('published', true);
    exercisesQuery = exercisesQuery.eq('published', true);
  }
  const [topicsRes, lessonsRes, exercisesRes] = await Promise.all([topicsQuery, lessonsQuery, exercisesQuery]);
  for (const r of [topicsRes, lessonsRes, exercisesRes]) {
    if (r.error) throw new Error(`Film University query failed: ${r.error.message}`);
  }

  const topics = (topicsRes.data || []).map(shapeTopic);
  const topicsById = Object.fromEntries(topics.map((t) => [t.id, t]));
  // Lessons whose topic is unpublished disappear with it on the public side.
  const lessons = (lessonsRes.data || [])
    .filter((row) => includeUnpublished || topicsById[row.topic_id])
    .map((row) => shapeLesson(row, topicsById[row.topic_id]));
  const lessonsById = Object.fromEntries(lessons.map((l) => [l.id, l]));
  const exercises = (exercisesRes.data || []).map((row) => shapeExercise(row, { topicsById, lessonsById }));

  return { topics, topicsById, lessons, lessonsById, exercises };
}

// Today's exercise: an admin pin for the date wins; otherwise the list
// rotates one step per day so every published exercise gets its turn.
export function pickTodayExercise(exercises, date = new Date()) {
  if (!exercises.length) return null;
  const iso = date.toISOString().slice(0, 10);
  const pinned = exercises.find((e) => e.pinnedOn === iso);
  if (pinned) return pinned;
  const day = Math.floor(date.getTime() / 86400000);
  return exercises[day % exercises.length];
}

function withExerciseCounts(lessons, exercises) {
  const counts = {};
  for (const ex of exercises) {
    for (const id of [ex.lessonId, ...ex.extraLessonIds]) {
      if (id) counts[id] = (counts[id] || 0) + 1;
    }
  }
  return lessons.map((l) => ({ ...l, exerciseCount: counts[l.id] || 0, meta: lessonMeta(l) }));
}

// The Workshop landing page (/university and /api/university/feed).
export async function getUniversityFeed() {
  const { topics, lessons, exercises } = await loadAll();
  const lessonsWithCounts = withExerciseCounts(lessons, exercises);
  const topicCards = topics
    .map((t) => {
      const own = lessonsWithCounts.filter((l) => l.topicId === t.id);
      return {
        ...t,
        lessonCount: own.length,
        videoCount: own.filter((l) => l.kind === 'video').length,
        documentCount: own.filter((l) => l.kind === 'document').length,
        href: `/university/${t.slug}`
      };
    })
    .filter((t) => t.lessonCount > 0);
  return {
    today: pickTodayExercise(exercises),
    exercises,
    topics: topicCards,
    templates: lessonsWithCounts.filter((l) => l.kind === 'document' && l.isTemplate && l.documentUrl),
    lessonCount: lessons.length
  };
}

export async function getTopicPage(slug) {
  const { topics, lessons, exercises } = await loadAll();
  const topic = topics.find((t) => t.slug === slug);
  if (!topic) return null;
  const own = withExerciseCounts(lessons, exercises).filter((l) => l.topicId === topic.id);
  return {
    topic,
    lessons: own.map((l, i) => ({ ...l, number: i + 1 })),
    videoCount: own.filter((l) => l.kind === 'video').length,
    documentCount: own.filter((l) => l.kind === 'document').length,
    totalSeconds: own.reduce((sum, l) => sum + (l.durationSeconds || 0), 0)
  };
}

// Signed playback for a video lesson. Lessons are free, so the only gate
// is "published": no tier or age check, unlike episodes.
async function signedSrcForLesson(row) {
  if (!row || !row.video_src) return null;
  const signed = await signedSrcForStoredUrl(row.video_src);
  if (signed) return { src: signed.src, expiresAt: signed.expiresAt, signed: true };
  return { src: row.video_src, expiresAt: null, signed: false };
}

export async function getLessonPlayback(lessonId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('uni_lessons')
    .select('id, video_src, published, kind')
    .eq('id', lessonId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.published || data.kind !== 'video') return null;
  return signedSrcForLesson(data);
}

export async function getLessonPage(topicSlug, lessonSlug) {
  const { topics, lessons, lessonsById, exercises } = await loadAll();
  const topic = topics.find((t) => t.slug === topicSlug);
  if (!topic) return null;
  const own = withExerciseCounts(lessons, exercises).filter((l) => l.topicId === topic.id);
  const index = own.findIndex((l) => l.slug === lessonSlug);
  if (index === -1) return null;
  const lesson = own[index];
  const attachment = lesson.attachmentLessonId ? lessonsById[lesson.attachmentLessonId] : null;
  const playback = lesson.kind === 'video' ? await getLessonPlayback(lesson.id) : null;
  return {
    topic,
    lesson: { ...lesson, number: index + 1 },
    total: own.length,
    playback,
    attachment: attachment && attachment.documentUrl ? { ...attachment, meta: lessonMeta(attachment) } : null,
    exercises: exercises.filter((e) => e.lessonId === lesson.id || e.extraLessonIds.includes(lesson.id)),
    next: own[index + 1] || null,
    previous: own[index - 1] || null
  };
}

export async function getExercisePage(slug) {
  const { exercises } = await loadAll();
  const exercise = exercises.find((e) => e.slug === slug);
  if (!exercise) return null;
  const playback = exercise.lesson && exercise.lesson.kind === 'video' ? await getLessonPlayback(exercise.lesson.id) : null;
  const others = exercises.filter((e) => e.id !== exercise.id);
  return { exercise, playback, others };
}

/* ------------------------------------------------------------------ *
 * Admin (pages/api/admin/university.js) — sees unpublished rows too.
 * ------------------------------------------------------------------ */

export async function getUniversityAdminData() {
  const { topics, lessons, exercises } = await loadAll({ includeUnpublished: true });
  return {
    topics,
    lessons: lessons.map((l) => ({ ...l, meta: lessonMeta(l) })),
    exercises,
    accents: Object.keys(TOPIC_ACCENTS),
    needs: EXERCISE_NEEDS
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

async function uniqueSlug(table, base, { id, topicId } = {}) {
  const supabase = getSupabase();
  const root = slugify(base) || 'item';
  let candidate = root;
  for (let n = 2; n < 50; n++) {
    let query = supabase.from(table).select('id').eq('slug', candidate);
    if (topicId) query = query.eq('topic_id', topicId);
    if (id) query = query.neq('id', id);
    const { data, error } = await query.limit(1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;
    candidate = `${root}-${n}`;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export async function saveTopic(input) {
  const supabase = getSupabase();
  const name = cleanText(input.name, 80);
  if (!name) throw new Error('A topic needs a name.');
  const accent = TOPIC_ACCENTS[input.accent] ? input.accent : 'brass';
  const record = {
    name,
    description: cleanText(input.description, 300),
    accent,
    sort_order: cleanInt(input.sortOrder) ?? 0,
    published: input.published !== false,
    updated_at: new Date().toISOString()
  };
  if (input.id) {
    if (input.slug) record.slug = await uniqueSlug('uni_topics', input.slug, { id: input.id });
    const { data, error } = await supabase.from('uni_topics').update(record).eq('id', input.id).select('*').single();
    if (error) throw new Error(error.message);
    return shapeTopic(data);
  }
  record.slug = await uniqueSlug('uni_topics', input.slug || name);
  const { data, error } = await supabase.from('uni_topics').insert(record).select('*').single();
  if (error) throw new Error(error.message);
  return shapeTopic(data);
}

export async function deleteTopic(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from('uni_topics').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function saveLesson(input) {
  const supabase = getSupabase();
  const title = cleanText(input.title, 140);
  if (!title) throw new Error('A lesson needs a title.');
  if (!input.topicId) throw new Error('Pick a topic for this lesson.');
  const kind = input.kind === 'document' ? 'document' : 'video';
  // A freshly uploaded video arrives as its Cloudflare uid; an existing
  // lesson keeps its stored manifest URL. Either way the row stores the
  // manifest URL, exactly like episodes.src, so lib/videoSigning.js works.
  let videoSrc = kind === 'video' ? cleanText(input.videoSrc, 500) : null;
  if (kind === 'video' && input.cloudflareUid) videoSrc = cloudflarePlaybackUrl(String(input.cloudflareUid).trim()) || videoSrc;
  let thumbnailUrl = cleanText(input.thumbnailUrl, 500);
  if (!thumbnailUrl && videoSrc) thumbnailUrl = cloudflareThumbnailUrl(cloudflareUidFromUrl(videoSrc));
  const record = {
    topic_id: input.topicId,
    title,
    description: cleanText(input.description, 2000),
    kind,
    video_src: videoSrc,
    duration_seconds: kind === 'video' ? cleanInt(input.durationSeconds) : null,
    thumbnail_url: thumbnailUrl,
    document_url: kind === 'document' ? cleanText(input.documentUrl, 500) : null,
    document_pages: kind === 'document' ? cleanInt(input.documentPages) : null,
    is_template: kind === 'document' && Boolean(input.isTemplate),
    attachment_lesson_id: kind === 'video' && input.attachmentLessonId ? input.attachmentLessonId : null,
    sort_order: cleanInt(input.sortOrder) ?? 0,
    published: Boolean(input.published),
    updated_at: new Date().toISOString()
  };
  if (record.attachment_lesson_id && record.attachment_lesson_id === input.id) record.attachment_lesson_id = null;
  if (input.id) {
    if (input.slug) record.slug = await uniqueSlug('uni_lessons', input.slug, { id: input.id, topicId: input.topicId });
    const { data, error } = await supabase.from('uni_lessons').update(record).eq('id', input.id).select('*').single();
    if (error) throw new Error(error.message);
    return shapeLesson(data, null);
  }
  record.slug = await uniqueSlug('uni_lessons', input.slug || title, { topicId: input.topicId });
  const { data, error } = await supabase.from('uni_lessons').insert(record).select('*').single();
  if (error) throw new Error(error.message);
  return shapeLesson(data, null);
}

export async function deleteLesson(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from('uni_lessons').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Reorders lessons within a topic (or topics, or exercises): ids in the
// new order get sort_order 1..n.
export async function reorder(table, ids) {
  if (!['uni_topics', 'uni_lessons', 'uni_exercises'].includes(table)) throw new Error('Unknown table.');
  const supabase = getSupabase();
  await Promise.all(
    ids.map((id, i) => supabase.from(table).update({ sort_order: i + 1 }).eq('id', id).then(({ error }) => {
      if (error) throw new Error(error.message);
    }))
  );
}

export async function saveExercise(input) {
  const supabase = getSupabase();
  const title = cleanText(input.title, 140);
  if (!title) throw new Error('An exercise needs a title.');
  const steps = (Array.isArray(input.steps) ? input.steps : String(input.steps || '').split('\n'))
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 20);
  const allowedNeeds = new Set(EXERCISE_NEEDS.map((n) => n.value));
  const needs = (Array.isArray(input.needs) ? input.needs : []).filter((n) => allowedNeeds.has(n));
  const extra = (Array.isArray(input.extraLessonIds) ? input.extraLessonIds : []).filter(Boolean).slice(0, 10);
  const pinnedOn = /^\d{4}-\d{2}-\d{2}$/.test(input.pinnedOn || '') ? input.pinnedOn : null;
  const record = {
    title,
    topic_id: input.topicId || null,
    summary: cleanText(input.summary, 1000),
    steps,
    minutes: cleanInt(input.minutes),
    needs,
    lesson_id: input.lessonId || null,
    extra_lesson_ids: extra,
    template_lesson_id: input.templateLessonId || null,
    pinned_on: pinnedOn,
    sort_order: cleanInt(input.sortOrder) ?? 0,
    published: Boolean(input.published),
    updated_at: new Date().toISOString()
  };
  if (input.id) {
    if (input.slug) record.slug = await uniqueSlug('uni_exercises', input.slug, { id: input.id });
    const { error } = await supabase.from('uni_exercises').update(record).eq('id', input.id);
    if (error) throw new Error(error.message);
    return { id: input.id };
  }
  record.slug = await uniqueSlug('uni_exercises', input.slug || title);
  const { data, error } = await supabase.from('uni_exercises').insert(record).select('id').single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

export async function deleteExercise(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from('uni_exercises').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
