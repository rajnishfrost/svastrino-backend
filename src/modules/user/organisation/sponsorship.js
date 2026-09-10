import { Organisation } from './organisation.model.js'
import { Package } from '../skillbuild/package.model.js'
// Registers the model `.populate('skillBuild')` below resolves through. Nothing
// here reads it directly, but without the import this module only works when
// some other module happened to load SkillBuild first — and the password-set
// path reaches this file by dynamic import, so nothing guarantees that.
import '../skillbuild/skillbuild.model.js'
import { Enrollment } from '../payments/enrollment.model.js'
import { Session } from '../learn/session.model.js'
import { Progress } from '../learn/progress.model.js'
import { Answer } from '../learn/answer.model.js'
import { Question } from '../learn/question.model.js'
import { LearnState } from '../learn/learnState.model.js'
import { istDaysBetween } from '../../../utils/schedule.js'

/**
 * Sponsored courses: Skill-Build packages an organisation pays for on behalf of
 * every student it adds. The admin picks them when the organisation is created
 * (and can change them later); the student receives them as ordinary
 * enrollments — the same rows a purchase makes, so every gate in the course
 * (phase, tier, expiry, upgrades) judges them exactly like a paying student.
 *
 * WHEN the grant lands is the one rule that matters here: not when the roster
 * is imported, but the moment the student claims the account — sets the
 * password from the invite, or signs in with Google for the first time. Until
 * then the seat belongs to nobody, and an address that was mistyped or never
 * opened must not burn a year of access.
 */

const httpError = (message, status = 400) => Object.assign(new Error(message), { status })

/**
 * The SKUs an admin typed or ticked, checked against the catalogue: every one
 * must be a live Skill-Build course package. The trial (inactive) and mentoring
 * programs (a different product entirely) are refused by name rather than
 * silently dropped, so a form that ticked the wrong thing hears about it.
 */
export async function normalisePackageSkus(list) {
  if (list == null) return []
  if (!Array.isArray(list)) throw httpError('Sponsored courses must be a list of package SKUs')
  const skus = [...new Set(list.map((s) => String(s || '').trim()).filter(Boolean))]
  if (!skus.length) return []
  // One course per organisation — the same one-package-per-product rule a
  // student lives under; two courses would mean two overlapping enrollments.
  if (skus.length > 1) throw httpError('Pick one sponsored course, not several')

  const rows = await Package.find({ sku: { $in: skus }, active: true })
    .populate('skillBuild', 'kind')
    .select('sku skillBuild')
  const ok = new Set(rows.filter((p) => (p.skillBuild?.kind || 'course') !== 'mentoring').map((p) => p.sku))
  const bad = skus.filter((s) => !ok.has(s))
  if (bad.length) throw httpError(`Not a Skill-Build course package: ${bad.join(', ')}`)
  return skus
}

/** The packages an organisation sponsors, with the names a screen can print. */
export async function sponsoredCourses(org) {
  const skus = org?.packages || []
  if (!skus.length) return []
  const rows = await Package.find({ sku: { $in: skus }, active: true })
    .populate('skillBuild', 'slug name')
    .select('sku name durationDays paymentMode phases skillBuild')
  // Keep the admin's order, drop anything that has since been retired.
  return skus
    .map((sku) => rows.find((p) => p.sku === sku))
    .filter(Boolean)
    .map((p) => ({ sku: p.sku, name: p.name, product: p.skillBuild?.slug || null, pkg: p }))
}

const DAY_MS = 86400000

/**
 * Hand a student every course their organisation sponsors. Called at the
 * moment the account is claimed (and, for a student who already had a live
 * account when the roster was imported, straight away — they have nothing
 * left to claim).
 *
 * Idempotent per product: a student who already holds a real enrollment for
 * the course — bought it, or was granted it before — keeps what they have; a
 * free trial is retired first, exactly as a purchase retires it, so the
 * student's year anchors on the sponsored row and not on a week-old trial.
 * Returns what was granted, for the caller's logs and screens.
 */
export async function grantSponsoredPackages(user) {
  if (!user?.organisation || user.organisationRole !== 'member') return []
  const org = await Organisation.findById(user.organisation).select('packages active')
  if (!org || org.active === false || !org.packages?.length) return []

  const granted = []
  for (const { sku, name, product, pkg } of await sponsoredCourses(org)) {
    if (!product) continue
    const held = await Enrollment.exists({
      user: user._id, product, trial: { $ne: true }, status: { $in: ['active', 'upgraded'] },
    })
    if (held) continue

    await Enrollment.updateMany(
      { user: user._id, product, trial: true, status: { $in: ['active', 'upgraded'] } },
      { status: 'expired' }
    )
    const startsAt = new Date()
    const phasesTotal = pkg.phases || 1
    await Enrollment.create({
      user: user._id,
      product,
      packageId: sku,
      packageName: name,
      paymentMode: pkg.paymentMode || 'one-time',
      // The sponsor pays for the whole course, so a pay-as-you-use plan opens
      // in full — there is nobody to pay phase by phase.
      phasesUnlocked: phasesTotal,
      phasesTotal,
      startsAt,
      expiresAt: pkg.durationDays ? new Date(startsAt.getTime() + pkg.durationDays * DAY_MS) : null,
      sponsoredBy: org._id,
    })
    granted.push({ sku, name })
  }
  return granted
}

/**
 * Where every student stands in the sponsored course, for the organisation's
 * roster — one screen, so one pass over the data rather than a report per row.
 *
 * Progress is sessions finished out of the sessions this package opens. Pace is
 * the learn report's rule at session granularity: the course wants one step a
 * day (a video, then six answers) and steps done are counted the same way — a
 * video watched or an answer written is a step wherever it sits — so a student
 * mid-week is not marked behind for the days of a session they are still in.
 * A day of grace matches the report, which does not count today against them
 * while today's step is still open.
 *
 * Returns a Map keyed by user id. Students with no course row yet, or no
 * sponsored course at all, are simply absent.
 */
export async function rosterCourseProgress(org, userIds) {
  const [course] = await sponsoredCourses(org)
  if (!course?.product || !userIds.length) return new Map()
  const pkg = await Package.findById(course.pkg._id).populate('skillBuild', '_id')
  const sbId = pkg?.skillBuild?._id
  if (!sbId) return new Map()

  const sessions = await Session.find({ skillBuild: sbId, active: true, tier: { $lte: pkg.order || 1 } }).select('_id')
  const total = sessions.length
  // The ceiling on the one-step-a-day clock is the course's step count, not
  // seven days a session: the introduction and the closing week have no tasks,
  // and billing them for six each stretched the clock past the real course.
  // Same rule as the learn report's targetDays, which is where it comes from.
  const totalSteps = total + await Question.countDocuments({
    session: { $in: sessions.map((x) => x._id) }, active: true,
  })
  const [states, progress, answers] = await Promise.all([
    LearnState.find({ user: { $in: userIds }, skillBuild: sbId }).select('user startedAt'),
    Progress.find({ user: { $in: userIds }, skillBuild: sbId }).select('user completed videoDoneAt'),
    Answer.aggregate([
      { $match: { user: { $in: userIds }, skillBuild: sbId } },
      { $group: { _id: '$user', n: { $sum: 1 } } },
    ]),
  ])
  const startedAt = new Map(states.map((l) => [String(l.user), l.startedAt]))
  const done = new Map(); const videos = new Map()
  for (const r of progress) {
    const k = String(r.user)
    if (r.completed) done.set(k, (done.get(k) || 0) + 1)
    if (r.videoDoneAt) videos.set(k, (videos.get(k) || 0) + 1)
  }
  const answered = new Map(answers.map((a) => [String(a._id), a.n]))

  const now = new Date()
  const out = new Map()
  for (const id of userIds) {
    const k = String(id)
    const completed = Math.min(done.get(k) || 0, total)
    const started = startedAt.get(k) || null
    const allDone = total > 0 && completed === total
    const daysElapsed = started ? istDaysBetween(new Date(started), now) + 1 : 0
    const stepsDone = (videos.get(k) || 0) + (answered.get(k) || 0)
    const expected = Math.min(daysElapsed, totalSteps)
    // Positive = ahead of the one-step-a-day clock, negative = behind it.
    const drift = started && !allDone ? stepsDone - expected : 0
    const pace = !started ? 'not-started'
      : allDone ? 'done'
      : drift >= 1 ? 'ahead'
      : drift >= -1 ? 'on-track'   // the day of grace
      : 'behind'
    out.set(k, {
      completed, total, percent: total ? Math.round((completed / total) * 100) : 0,
      startedAt: started, daysElapsed,
      pace, driftDays: Math.abs(drift),
    })
  }
  return out
}
