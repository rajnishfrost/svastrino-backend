import { MentoringBooking } from './booking.model.js'

/**
 * Slot engine for counselling/mentoring bookings. All rules are IST-based:
 *
 *  - First bookable day = today + 3 (spec example: 21 Jul → bookable from 24 Jul)
 *  - Advance bookings up to 2 months from today
 *  - Slots are 2 hours; start times 9:00 AM … 4:00 PM (last ends 6:00 PM)
 *  - Start times on a 30-minute grid (9:00, 9:30, …)
 *  - 30-minute breather around every existing booking (ends 2:00 → next 2:30)
 *  - Sunday: only slots that END by 1:00 PM · Monday: fully closed
 */
const IST_OFFSET_MIN = 330 // +05:30, no DST
export const SLOT_MINS = 120
export const BUFFER_MINS = 30
const GRID_MINS = 30
const FIRST_START = 9 * 60 // 09:00
const LAST_START = 16 * 60 // 16:00 (ends 18:00)
const SUNDAY_END_CUTOFF = 13 * 60 // Sunday: slot must END by 13:00
const MIN_LEAD_DAYS = 3
const MAX_AHEAD_MONTHS = 2

/* ---------- IST date helpers (dates as 'YYYY-MM-DD' IST calendar days) ---------- */
const pad = (n) => String(n).padStart(2, '0')

export function parseDateStr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
  if (!m) return null
  const y = +m[1], mo = +m[2] - 1, d = +m[3]
  const t = new Date(Date.UTC(y, mo, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo || t.getUTCDate() !== d) return null
  return { y, mo, d }
}
const toStr = ({ y, mo, d }) => `${y}-${pad(mo + 1)}-${pad(d)}`

function istTodayParts(now = new Date()) {
  const t = new Date(now.getTime() + IST_OFFSET_MIN * 60_000)
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate() }
}
const addDays = (p, n) => {
  const t = new Date(Date.UTC(p.y, p.mo, p.d + n))
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate() }
}
const addMonths = (p, n) => {
  const t = new Date(Date.UTC(p.y, p.mo + n, p.d))
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate() }
}

/** Bookable range as IST date strings (inclusive). */
export function bookingWindow(now = new Date()) {
  const today = istTodayParts(now)
  return { minDate: toStr(addDays(today, MIN_LEAD_DAYS)), maxDate: toStr(addMonths(today, MAX_AHEAD_MONTHS)) }
}

/** 0=Sunday … 6=Saturday for an IST calendar date. */
export const dayOfWeek = (dateStr) => {
  const p = parseDateStr(dateStr)
  return new Date(Date.UTC(p.y, p.mo, p.d)).getUTCDay()
}

/** The UTC instant of `minutes` past IST-midnight of `dateStr`. */
export function slotUtc(dateStr, minutes) {
  const p = parseDateStr(dateStr)
  return new Date(Date.UTC(p.y, p.mo, p.d) - IST_OFFSET_MIN * 60_000 + minutes * 60_000)
}

export const fmtHM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`

/**
 * PURE core: candidate start-minutes for a date given that day's existing
 * bookings (as IST minutes). Testable without a DB.
 */
export function slotsForDate(dateStr, existing = [], now = new Date()) {
  const { minDate, maxDate } = bookingWindow(now)
  if (!parseDateStr(dateStr) || dateStr < minDate || dateStr > maxDate) return []

  const dow = dayOfWeek(dateStr)
  if (dow === 1) return [] // Monday — weekly off

  const out = []
  for (let start = FIRST_START; start <= LAST_START; start += GRID_MINS) {
    const end = start + SLOT_MINS
    if (dow === 0 && end > SUNDAY_END_CUTOFF) continue // Sunday closes at 1 PM
    const clashes = existing.some(
      (b) => !(end + BUFFER_MINS <= b.startMin || start >= b.endMin + BUFFER_MINS),
    )
    if (!clashes) out.push(start)
  }
  return out
}

/** That IST day's booked appointments, converted to IST minutes-of-day. */
export async function existingForDate(dateStr) {
  const dayStart = slotUtc(dateStr, 0)
  const dayEnd = slotUtc(dateStr, 24 * 60)
  // Pull a little wider than the day so cross-midnight math can't miss anything.
  const booked = await MentoringBooking.find({
    status: 'booked',
    startAt: { $gte: new Date(dayStart.getTime() - 6 * 3_600_000), $lt: dayEnd },
    endAt: { $gt: dayStart },
  })
  return booked.map((b) => ({
    startMin: Math.round((b.startAt.getTime() - dayStart.getTime()) / 60_000),
    endMin: Math.round((b.endAt.getTime() - dayStart.getTime()) / 60_000),
  }))
}

/** Full availability payload for one date. */
export async function availableSlots(dateStr, now = new Date()) {
  const window = bookingWindow(now)
  const p = parseDateStr(dateStr)
  if (!p) {
    const err = new Error('Invalid date — use YYYY-MM-DD')
    err.status = 400
    throw err
  }
  const existing = await existingForDate(dateStr)
  const mins = slotsForDate(dateStr, existing, now)
  return {
    date: dateStr,
    window,
    closed: dayOfWeek(dateStr) === 1,
    slots: mins.map((m) => ({
      start: fmtHM(m),
      end: fmtHM(m + SLOT_MINS),
      startAt: slotUtc(dateStr, m).toISOString(),
    })),
  }
}

/** Is (dateStr, 'HH:MM') bookable right now? Used server-side before creating. */
export async function isSlotAvailable(dateStr, startHM, now = new Date()) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(startHM || ''))
  if (!m) return false
  const minutes = +m[1] * 60 + +m[2]
  const existing = await existingForDate(dateStr)
  return slotsForDate(dateStr, existing, now).includes(minutes)
}
