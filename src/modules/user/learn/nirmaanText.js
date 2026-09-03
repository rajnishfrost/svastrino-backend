/**
 * How a week from the course sheet turns into the text a student reads.
 *
 * Shared because TWO scripts write it: ingestNirmaan (which also transcodes the
 * videos) and syncNirmaanTasks (text only). They must produce the same strings —
 * when they drifted apart, a text-only re-sync silently renamed every week.
 */

/** A readable title. The sheet has written these as `"Knowing Yourself" Challenge` and as `Challenge: Knowing Yourself`. */
export function titleFor(w) {
  const clean = String(w.title || '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim()
  return clean ? `Week ${w.week} — ${clean}` : `Week ${w.week}`
}

/** What the student reads under the video. */
export function descriptionFor(w) {
  if (w.note) return w.note
  return w.rule ? `Rule of the week: ${w.rule}` : ''
}

/** The worksheet panel: the week's rule, then its six days. */
export function worksheetFor(w) {
  return {
    title: w.rule ? `Rule of the week: ${w.rule}` : 'This week',
    tasks: (w.days || []).map((d) => `Day ${d.day}: ${d.task}`),
  }
}
