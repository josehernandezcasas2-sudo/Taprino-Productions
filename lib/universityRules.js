// Pure helpers the Film University pages use in the browser. They used to
// live in lib/university.js, which imports the Supabase client and the
// upload code — importing them from there pulled all of that into the
// catalogue page's bundle (133 kB of page JS for one function).

export function formatMinutes(seconds) {
  if (!seconds) return null;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

// The "Continue" strip: the first course the viewer has started but not
// finished, with the next unticked lesson and how long is left.
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
