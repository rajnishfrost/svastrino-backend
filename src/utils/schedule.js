// Drip-schedule time helpers. All unlocks happen at IST (Asia/Kolkata) midnight
// of the day AFTER an action — e.g. watch a video Monday → the next item opens
// Tuesday 00:00 IST. IST is a fixed UTC+5:30 (no daylight saving), so we can do
// the maths with a constant offset instead of a timezone library.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000 // +05:30

/**
 * UTC instant of the next IST calendar midnight strictly after `after`.
 * (Watched any time on an IST day → returns 00:00 IST of the following day.)
 */
export function nextIstMidnight(after) {
  const ist = new Date(after.getTime() + IST_OFFSET_MS) // wall-clock IST as a UTC date
  const nextMidnightWall = Date.UTC(
    ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1, 0, 0, 0, 0,
  )
  return new Date(nextMidnightWall - IST_OFFSET_MS) // back to the real UTC instant
}

/** IST calendar-day index (days since epoch in IST) — for counting whole days. */
function istDayIndex(date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  return Math.floor(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) / 86_400_000)
}

/** Whole IST calendar days from `a` to `b` (b − a). Same day = 0. */
export function istDaysBetween(a, b) {
  return istDayIndex(b) - istDayIndex(a)
}

/** Has `unlockAt` arrived? (null/undefined = never unlocks yet.) */
export function isUnlocked(unlockAt, now = new Date()) {
  return !!unlockAt && now.getTime() >= new Date(unlockAt).getTime()
}
