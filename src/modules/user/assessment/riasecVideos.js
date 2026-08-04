/**
 * RIASEC → pre-recorded explanation video mapping (SRS: the platform auto-picks
 * one of ~5-10 report-explanation videos based on the student's dominant RIASEC
 * type). The dominant type is the FIRST letter of the report's RIASEC code
 * (e.g. 'RIA' → 'R' = Realistic).
 *
 * URLs are intentionally blank until the team uploads the real videos (S3 /
 * CloudFront). Fill them here (or set them per-report from the admin panel).
 * A missing URL just means the Career Report shows the PDF + code without a
 * video — nothing breaks.
 */
export const RIASEC_TYPES = {
  R: { name: 'Realistic', video: process.env.MINDLER_VIDEO_R || '' },
  I: { name: 'Investigative', video: process.env.MINDLER_VIDEO_I || '' },
  A: { name: 'Artistic', video: process.env.MINDLER_VIDEO_A || '' },
  S: { name: 'Social', video: process.env.MINDLER_VIDEO_S || '' },
  E: { name: 'Enterprising', video: process.env.MINDLER_VIDEO_E || '' },
  C: { name: 'Conventional', video: process.env.MINDLER_VIDEO_C || '' },
}

/** Dominant RIASEC letter from a code like 'RIA'. */
export const dominantType = (code) => String(code || '').trim().toUpperCase().charAt(0) || null

/** { letter, name, video } for a code, or null if it isn't a valid type. */
export function riasecInfo(code) {
  const letter = dominantType(code)
  const type = letter && RIASEC_TYPES[letter]
  if (!type) return null
  return { letter, name: type.name, video: type.video || null }
}
