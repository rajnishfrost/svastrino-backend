import { Enrollment } from '../payments/enrollment.model.js'
import { Package } from '../skillbuild/package.model.js'
import { istDaysBetween } from '../../../utils/schedule.js'

/**
 * The one-year rule for a Skill-Build course, kept in one place.
 *
 * A course is sold for a fixed stretch of time — 365 days for every Nirmaan
 * plan. Inside it everything works. Once it is over the videos and the tasks
 * close, whether or not the student finished; what they keep is the right to
 * download their own work. That right lasts three more years, and after that
 * all they can see is which course they once took.
 *
 * Nothing here writes to the database. It is a reading of dates only — see the
 * note on `courseAccess` for why that matters.
 */

/** How long the student may still download their work after the year is up. */
export const RECORD_YEARS = 3

const DAY_MS = 24 * 60 * 60 * 1000

/** The same clock time, `days` later. */
function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS)
}

/** The same date, `years` later, counted in calendar years. */
function addYears(date, years) {
  const d = new Date(date.getTime())
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d
}

/**
 * Which enrolment starts the student's year?
 *
 * The plans sheet says validity runs "from date of 1st enrolment", so the year
 * is anchored on the EARLIEST enrolment the student holds for this course —
 * never on the newest one. This is the part a future reader is most likely to
 * get wrong, so: a pay-as-you-use student holds one enrolment per phase they
 * have paid for, and each earlier one is marked 'upgraded' as the next phase is
 * bought. If we anchored on the newest row, buying phase 4 would quietly hand
 * them a whole new year and the one-year rule would mean nothing. That is why
 * 'upgraded' rows count here exactly as much as the live 'active' one.
 *
 * A 'revoked' row is a refund — that purchase was undone, so it cannot start
 * anyone's year.
 */
async function anchorEnrollment(userId, productSlug) {
  const enrollments = await Enrollment.find({
    user: userId,
    product: productSlug,
    status: { $in: ['active', 'upgraded'] },
  })
  if (!enrollments.length) return null

  const startedOn = (e) => new Date(e.startsAt || e.createdAt || 0).getTime()
  return enrollments.reduce((earliest, e) => (startedOn(e) < startedOn(earliest) ? e : earliest))
}

/**
 * The end date an enrolment row is really judged by.
 *
 * Most rows carry their own expiresAt, written when the course was paid for.
 * Older rows do not, so the plan's own length is applied to the day they
 * started. A row whose plan has no length at all is a genuine lifetime
 * enrolment and has no end date, which is why null is a real answer here.
 *
 * This is exported because more than one place has to agree with it. When an
 * admin reopens a locked course from a ticket, the rows it moves have to be the
 * same rows this file would judge as shut — a second copy of the rule would
 * eventually drift, and the student would be told their course was open while
 * it stayed locked.
 */
export async function effectiveExpiry(e) {
  if (e.expiresAt) return new Date(e.expiresAt)

  const startedOn = e.startsAt || e.createdAt
  if (!startedOn) return null
  const pkg = await Package.findOne({ sku: e.packageId })
  if (!pkg?.durationDays) return null
  return addDays(new Date(startedOn), pkg.durationDays)
}

/**
 * What may this student do with this course right now?
 *
 *   'none'     — they own nothing here.
 *   'active'   — inside the year; everything works as usual.
 *   'expired'  — the year is over. Videos and tasks are shut. This is the state
 *                whether or not they finished: finishing changes what we SAY to
 *                them, not what they may open.
 *   'archived' — three years past that. Only the fact of the course remains.
 *
 * This function deliberately does not save anything. Flipping the enrolment's
 * status to 'expired' as we pass the date would be easy to add here and would
 * be a mistake: when an admin resolves a ticket and gives a student more time,
 * they move the enrolment's end date forward, and a status left behind from an
 * earlier read would then fight that new date. The dates are the truth; the
 * status is not.
 */
export async function courseAccess(userId, productSlug) {
  const anchor = await anchorEnrollment(userId, productSlug)
  if (!anchor) {
    return { state: 'none', enrolledAt: null, expiresAt: null, recordUntil: null, daysLeft: null }
  }

  const enrolledAt = anchor.startsAt || anchor.createdAt || null

  // The end date the anchor row is judged by — its own, or the plan's length
  // applied to the day it started. See effectiveExpiry above.
  const expiresAt = await effectiveExpiry(anchor)

  // A plan with no end date never closes, so there is nothing to archive either.
  if (!expiresAt) {
    return { state: 'active', enrolledAt, expiresAt: null, recordUntil: null, daysLeft: null }
  }

  const recordUntil = addYears(expiresAt, RECORD_YEARS)
  const now = new Date()
  const state = now < expiresAt ? 'active' : now < recordUntil ? 'expired' : 'archived'

  return {
    state,
    enrolledAt,
    expiresAt,
    recordUntil,
    // Whole days left, counted in IST calendar days like every other date on
    // the course. It turns negative once the year has gone by.
    daysLeft: istDaysBetween(now, expiresAt),
  }
}
