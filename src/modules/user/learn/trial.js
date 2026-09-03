import { Enrollment } from '../payments/enrollment.model.js'
import { Package } from '../skillbuild/package.model.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { courseAccess } from './courseAccess.js'

/**
 * The 1-week free trial of Nirmaan — Introduction + Week 1, then the door shuts.
 *
 * Deliberately built out of parts that already exist rather than a parallel
 * "preview mode": the trial is a real Enrollment against a real (unbuyable)
 * Package, so the drip schedule, the play limit, the task flow and the expiry
 * rules all apply to a trial student exactly as they apply to a paying one.
 * That is the whole point — what they try has to be the real thing.
 *
 * The content gate is the phase gate, unchanged. `phaseOfSession` cuts the 24
 * weeks into `phasesTotal` equal blocks, so a package of 24 phases makes each
 * block one week wide, and one unlocked phase means Week 1 (plus the
 * introduction, which belongs to no phase and is always in the first one). The
 * remaining 23 weeks stay listed and locked, which is the part that sells.
 */
export const TRIAL_SKU = 'nirmaan-trial'
export const TRIAL_PRODUCT = 'nirmaan'
export const TRIAL_DAYS = 7

const DAY_MS = 86_400_000

/**
 * The trial package, created on first use.
 *
 * It lives here rather than in the seed script because it is not a product
 * decision anyone edits — it is the mechanical description of this feature, and
 * a deployment where the seed had not been re-run would otherwise hand every
 * new sign-up a 500. `active: false` keeps it out of the pricing page and every
 * other catalog listing, which read only active packages; nothing can buy it.
 */
async function trialPackage() {
  const parent = await SkillBuild.findOne({ slug: TRIAL_PRODUCT })
  if (!parent) throw Object.assign(new Error('Nirmaan course not found'), { status: 404 })

  return Package.findOneAndUpdate(
    { sku: TRIAL_SKU },
    {
      $setOnInsert: {
        skillBuild: parent._id,
        sku: TRIAL_SKU,
        name: 'Nirmaan — 1-week free trial',
        // Rank 1 clears every session's tier (all Nirmaan sessions are tier 1),
        // because the trial is limited by TIME and PHASE, not by tier.
        order: 1,
        price: 0,
        durationDays: TRIAL_DAYS,
        paymentMode: 'per-phase',
        phases: 24, // one phase per week — see the note at the top of this file
        active: false, // never offered for sale
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
}

/**
 * What is this student's standing with Nirmaan right now? Drives which call to
 * action the public page shows them, so it answers for signed-in users only.
 *
 *   'none'    — nothing yet; offer the trial.
 *   'trial'   — a live trial; send them to the course.
 *   'owned'   — they bought it; send them to the course.
 *   'used'    — their trial ran out and they never bought; offer the packages.
 *   'expired' — a purchase whose year is over; that is the record screen's job.
 */
export async function nirmaanStanding(userId) {
  const rows = await Enrollment.find({ user: userId, product: TRIAL_PRODUCT })
  if (!rows.length) return { state: 'none', daysLeft: null }

  const access = await courseAccess(userId, TRIAL_PRODUCT)
  const onTrial = rows.some((r) => r.trial && r.status === 'active')
  const bought = rows.some((r) => !r.trial && ['active', 'upgraded'].includes(r.status))

  if (access.state === 'active') return { state: onTrial && !bought ? 'trial' : 'owned', daysLeft: access.daysLeft }
  // Not active any more. A student who only ever had the trial is a lead, not a
  // lapsed customer, so they get a different answer from someone who paid.
  return { state: bought ? 'expired' : 'used', daysLeft: access.daysLeft }
}

/**
 * Grant the trial. Idempotent and one-per-student: ANY existing Nirmaan
 * enrollment — a live trial, a spent one, a purchase, even a refunded row —
 * means this is not a new prospect, and a second free week is not on offer.
 */
export async function startTrial(userId) {
  const existing = await Enrollment.findOne({ user: userId, product: TRIAL_PRODUCT })
  if (existing) {
    const standing = await nirmaanStanding(userId)
    return { started: false, ...standing }
  }

  const pkg = await trialPackage()
  const startsAt = new Date()
  try {
    await Enrollment.create({
      user: userId,
      product: TRIAL_PRODUCT,
      packageId: pkg.sku,
      packageName: pkg.name,
      trial: true,
      paymentMode: 'per-phase',
      phasesUnlocked: 1,
      phasesTotal: pkg.phases,
      startsAt,
      expiresAt: new Date(startsAt.getTime() + TRIAL_DAYS * DAY_MS),
    })
  } catch (err) {
    // A trial has no order, and a database still carrying the OLD plain unique
    // index on `order` counts every missing value as the same null — so the
    // first trial inserts and every one after it collides on an order that
    // neither row has. That is a deployment step left undone, not a student
    // doing anything wrong, so say which step rather than returning a 500 that
    // reads as "the trial is broken".
    if (err?.code === 11000 && 'order' in (err.keyPattern || {})) {
      throw Object.assign(
        new Error('The free trial is not available just yet. Please try again shortly, or write to us and we will set it up for you.'),
        { status: 503, code: 'TRIAL_INDEX_PENDING' },
      )
    }
    throw err
  }

  return { started: true, state: 'trial', daysLeft: TRIAL_DAYS }
}
