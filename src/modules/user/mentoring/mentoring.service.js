import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { Package } from '../skillbuild/package.model.js'
import { Enrollment } from '../payments/enrollment.model.js'
import { User } from '../credentials/credentials.model.js'
import { MentoringBooking } from './booking.model.js'
import { sendBookingEmail } from '../../../utils/mailer.js'
import { availableSlots, isSlotAvailable, slotUtc, SLOT_MINS, bookingWindow } from './slots.js'

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

/** Best-effort confirmation email — a mail failure must never fail the booking. */
async function dispatchBookingEmail(userId, pkg, booking, rescheduled = false) {
  try {
    const u = await User.findById(userId)
    if (!u?.email) return
    await sendBookingEmail(u.email, {
      name: u.name,
      programName: pkg.name, // the program (Bull's Eye/Bloom/…), not the category

      sessionNumber: booking.sessionNumber,
      sessionsTotal: pkg.sessionsCount || 1,
      startAt: booking.startAt,
      endAt: booking.endAt,
      rescheduled,
    })
  } catch (err) {
    console.error('✗ Failed to send booking email:', err.message)
  }
}

/**
 * Counselling & Mentoring catalog: ONE parent SkillBuild (kind 'mentoring') —
 * the category — with each program (Bull's Eye / Bloom / Breakthrough) as a
 * Package under it. Payments treats every program as an independent product
 * (product = the package SKU, see getPackageBySku), so owning one program never
 * upgrades/blocks another. The program is paid once (first booking); each
 * session is then booked here against that enrollment.
 */

/** Every program package under a "Services" sub-category, with its parent. */
async function mentoringPackages({ activeOnly = true } = {}) {
  const parents = await SkillBuild.find({ kind: 'mentoring' }).sort({ order: 1 })
  if (!parents.length) return []
  const byId = new Map(parents.map((p) => [String(p._id), p]))
  const q = { skillBuild: { $in: parents.map((p) => p._id) } }
  if (activeOnly) q.active = true
  const pkgs = await Package.find(q).sort({ order: 1 })
  // Attach the parent sub-category and sort by (sub-category order, program order).
  return pkgs
    .map((pkg) => ({ pkg, parent: byId.get(String(pkg.skillBuild)) }))
    .filter((x) => x.parent)
    .sort((a, b) => (a.parent.order - b.parent.order) || ((a.pkg.order || 0) - (b.pkg.order || 0)))
}

const programDTO = ({ pkg, parent }) => ({
  slug: pkg.slug,
  name: pkg.name,
  tagline: pkg.tagline,
  sku: pkg.sku,
  price: pkg.price,
  earlyBird: pkg.earlyBird,
  sessions: pkg.sessionsCount || 1,
  sessionMins: pkg.sessionMins || SLOT_MINS,
  buyMode: pkg.buyMode || 'self-serve',
  features: pkg.features,
  featured: pkg.featured,
  badge: pkg.badge,
  cta: pkg.cta,
  // The "Services" sub-category this program belongs to.
  category: { slug: parent.slug, name: parent.name, tagline: parent.tagline },
})

/** Flat catalog with each program's sub-category attached. */
export async function listPrograms() {
  const rows = await mentoringPackages()
  return rows.map(programDTO)
}

/** Same catalog grouped by sub-category — powers the Services landing + nav. */
export async function listCategories() {
  const rows = await mentoringPackages()
  const out = []
  const idx = new Map()
  for (const row of rows) {
    const key = row.parent.slug
    if (!idx.has(key)) {
      idx.set(key, out.length)
      out.push({ slug: row.parent.slug, name: row.parent.name, tagline: row.parent.tagline, order: row.parent.order, programs: [] })
    }
    out[idx.get(key)].programs.push(programDTO(row))
  }
  return out
}

async function programBySku(sku) {
  const pkg = await Package.findOne({ sku, active: true }).populate('skillBuild', 'name slug kind')
  if (!pkg || pkg.skillBuild?.kind !== 'mentoring') throw httpError('Unknown program', 404)
  return pkg
}

/** Does this user own the program (paid, active)? Mentoring product = the SKU. */
async function requireEnrollment(userId, pkg) {
  const enr = await Enrollment.findOne({ user: userId, product: pkg.sku, status: 'active' })
  if (!enr) throw httpError('Please purchase this program first', 403, 'NOT_ENROLLED')
  return enr
}

/** Availability for a date (public — the calendar page needs it pre-login). */
export function slotsFor(dateStr) {
  return availableSlots(dateStr)
}

/**
 * Book the next session of an owned program into (date, start). The slot is
 * re-validated server-side against every rule at booking time.
 */
export async function createBooking(userId, { sku, date, start }) {
  const pkg = await programBySku(sku)
  await requireEnrollment(userId, pkg)

  const total = pkg.sessionsCount || 1
  const used = await MentoringBooking.countDocuments({
    user: userId,
    programSku: sku,
    status: { $ne: 'cancelled' },
  })
  if (used >= total) throw httpError(`All ${total} sessions of this program are already booked`, 409)

  if (!(await isSlotAvailable(date, start))) {
    throw httpError('That slot is no longer available — please pick another', 409, 'SLOT_TAKEN')
  }

  const [h, m] = start.split(':').map(Number)
  const startAt = slotUtc(date, h * 60 + m)
  const endAt = new Date(startAt.getTime() + SLOT_MINS * 60_000)

  const booking = await MentoringBooking.create({
    user: userId,
    programSku: sku,
    sessionNumber: used + 1,
    startAt,
    endAt,
  })
  dispatchBookingEmail(userId, pkg, booking) // fire-and-forget
  // TODO(Phase C): push to Svastrino's Google Calendar → save gcalEventId.
  return booking
}

const RESCHEDULE_MIN_LEAD_MS = 2 * 24 * 60 * 60 * 1000 // allowed until T-2 days

/** Move a booked session to a new slot (allowed until 2 days before it). */
export async function rescheduleBooking(userId, bookingId, { date, start }) {
  const booking = await MentoringBooking.findOne({ _id: bookingId, user: userId })
  if (!booking) throw httpError('Booking not found', 404)
  if (booking.status !== 'booked') throw httpError('Only upcoming bookings can be rescheduled', 400)
  if (booking.startAt.getTime() - Date.now() < RESCHEDULE_MIN_LEAD_MS) {
    throw httpError('Rescheduling closes 2 days before the session — please contact us', 400)
  }

  if (!(await isSlotAvailable(date, start))) {
    throw httpError('That slot is not available — please pick another', 409, 'SLOT_TAKEN')
  }

  const [h, m] = start.split(':').map(Number)
  booking.startAt = slotUtc(date, h * 60 + m)
  booking.endAt = new Date(booking.startAt.getTime() + SLOT_MINS * 60_000)
  await booking.save()
  const pkg = await programBySku(booking.programSku)
  dispatchBookingEmail(userId, pkg, booking, true) // fire-and-forget
  // TODO(Phase C): update the Google Calendar event too.
  return booking
}

/**
 * Dashboard data: every owned program with its full session table —
 * Session # · Appointment date/time · Session update · Tasks.
 */
export async function myMentoring(userId) {
  // Program enrollments carry product = the package SKU (independent purchases).
  const pkgs = await mentoringPackages({ activeOnly: false })
  const enrollments = await Enrollment.find({
    user: userId,
    product: { $in: pkgs.map((p) => p.sku) },
    status: 'active',
  })
  if (!enrollments.length) return { programs: [] }

  const programs = []
  for (const enr of enrollments) {
    const pkg = pkgs.find((p) => p.sku === enr.product)
    const total = pkg?.sessionsCount || 1
    const bookings = await MentoringBooking.find({
      user: userId,
      programSku: pkg?.sku,
      status: { $ne: 'cancelled' },
    }).sort({ sessionNumber: 1 })

    programs.push({
      slug: pkg?.slug,
      name: pkg?.name || enr.packageName,
      sku: pkg?.sku,
      sessionsTotal: total,
      sessionsBooked: bookings.length,
      sessionsRemaining: Math.max(0, total - bookings.length),
      window: bookingWindow(),
      // The dashboard table, one row per session slot of the program.
      sessions: Array.from({ length: total }, (_, i) => {
        const b = bookings.find((x) => x.sessionNumber === i + 1)
        return {
          sessionNumber: i + 1,
          bookingId: b?._id || null,
          startAt: b?.startAt || null,
          endAt: b?.endAt || null,
          status: b ? b.status : 'unbooked',
          update: b?.update || '',
          tasks: b?.tasks || [],
        }
      }),
    })
  }
  return { programs }
}
