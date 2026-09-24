import { Assessment } from './assessment.model.js'
import { Enrollment } from '../payments/enrollment.model.js'
import { Package } from '../skillbuild/package.model.js'
import { User } from '../credentials/credentials.model.js'
import * as mindler from './mindler.js'
import { psychometricGuides } from '../../admin/settings/settings.service.js'
import { pageOf, pageResult } from '../../../utils/paginate.js'

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

/**
 * The test belongs to plans that bundle it, not to every plan. It used to come
 * with every package, and this check never caught up with the change: it only
 * asked whether the student was enrolled at all, so a plan without the test
 * could still open one. That cost nothing while opening the test was a link to
 * the white-label site; with Mindler's token login every open is an API call
 * against our account, so it has to be a plan that paid for it.
 *
 * Any active plan for the product counts, so a student who bought the course
 * first and upgraded to a plan with the test is let in — the same rule the
 * course page's gate uses (learn.service.js userRank).
 */
async function requireEntitlement(userId, product) {
  const enrollments = await Enrollment.find({ user: userId, product, status: 'active' }).select('packageId').lean()
  if (!enrollments.length)
    throw httpError('Enrol in this product to take the psychometric test', 403, 'NOT_ENROLLED')
  const withTest = await Package.exists({
    sku: { $in: enrollments.map((e) => e.packageId) },
    includesPsychometric: true,
  })
  if (!withTest)
    throw httpError('Your plan does not include the psychometric test.', 403, 'NOT_INCLUDED')
}

/**
 * What the account still needs before the test can open, in API mode — where
 * we sign the student in on Mindler with their details. The class picks the
 * test (Stream or Career), so without a class from 7 to 12 there is no test to
 * send them to; and the phone goes into their Mindler account, which is how
 * the team reaches them about the report. Handoff mode sends Mindler nothing,
 * so it needs nothing.
 *
 * The card reads this list to open its "add your details" pop-up before the
 * test, rather than letting the click fail.
 */
async function missingForTest(userId) {
  if (!mindler.isApiMode()) return { user: null, needs: [] }
  const user = await User.findById(userId).select('name email phone studentClass').lean()
  const needs = []
  if (!mindler.userTypeFor(user?.studentClass)) needs.push('studentClass')
  if (!user?.phone) needs.push('phone')
  return { user, needs }
}

/** Get (or lazily create) the student's assessment record. */
async function getOrCreate(userId, product) {
  const found = await Assessment.findOne({ user: userId, product })
  if (found) return found
  return Assessment.create({ user: userId, product, provider: 'mindler' })
}

// How often one student's status is asked of Mindler. The course page and the
// psychometric page both read it on load, and every check costs two calls
// against our account (a login token, then the status).
const STATUS_CHECK_EVERY_MS = 60 * 1000

/**
 * Ask Mindler whether the test is finished, and bring our status in line.
 *
 * Mindler's answer is the final word: finished completes it, and "not yet"
 * takes a self-reported `submitted` back to `in_progress` — a student who
 * tapped "I've finished it" at 10% sees the test card again, not a report the
 * test site does not have. A check that fails changes nothing.
 *
 * Only once the student has opened the test (so a Mindler account exists) and
 * before it is completed; `force` skips the throttle, for when the student has
 * just said they are done. Returns Mindler's answer, or null.
 */
async function syncWithMindler(a, user, { force = false } = {}) {
  if (!mindler.isApiMode() || !user) return null
  if (a.status !== 'in_progress' && a.status !== 'submitted') return null
  if (!force && a.providerCheckedAt && Date.now() - a.providerCheckedAt.getTime() < STATUS_CHECK_EVERY_MS) return null

  const result = await mindler.fetchAssessmentStatus(user)
  a.providerCheckedAt = new Date()
  if (result) {
    a.providerStatus = result.completed ? 'completed' : result.percent != null ? `${result.percent}% done` : 'not completed'
    if (result.completed) a.providerPercent = 100
    else if (result.percent != null) a.providerPercent = result.percent
    if (result.completed) {
      a.status = 'completed'
      a.submittedAt = a.submittedAt || new Date()
      a.completedAt = a.completedAt || new Date()
    } else if (a.status === 'submitted') {
      a.status = 'in_progress'
      a.submittedAt = null
    }
  }
  await a.save()
  return result
}

/** The student's details the Mindler calls need, or null outside API mode. */
async function mindlerUser(userId) {
  if (!mindler.isApiMode()) return null
  return User.findById(userId).select('name email phone studentClass').lean()
}

function toDTO(a, needs = [], guides = null) {
  const api = mindler.isApiMode()
  const handoff = mindler.handoffInfo()
  return {
    product: a.product,
    provider: a.provider,
    // 'api': the student is signed in for them, so there is no site to visit,
    // code to copy or steps to follow — the card just says take the test.
    mode: api ? 'api' : 'handoff',
    status: a.status,
    startedAt: a.startedAt,
    submittedAt: a.submittedAt,
    completedAt: a.completedAt,
    externalRef: a.externalRef,
    // Handoff details for the "take the test" step. The student's own Mindler
    // coupon (generated per-student in the partner dashboard) wins over the
    // env-level fallback code.
    testUrl: api ? null : handoff.testUrl,
    accessCode: api ? null : a.couponCode || handoff.accessCode,
    steps: api ? [] : handoff.steps,
    // Profile fields to collect before the test can open: 'studentClass',
    // 'phone'. Always empty in handoff mode.
    needs,
    report: a.status === 'completed' ? reportDTO(a.report) : null,
    // How far through the test the student is, 0–100, as Mindler last told us
    // (API mode). Null until we have asked, and in handoff mode.
    progress: a.status === 'completed' ? 100 : a.providerPercent ?? null,
    // The two guide videos, set in Admin → Settings: `test` plays before the
    // student is sent to the test, `report` before they go to read the report.
    // Null = not set, and the card goes straight on.
    guides: guides || { test: null, report: null },
  }
}

/**
 * Report shape for the student. Mindler's output is a 34-page PDF + top careers
 * (a 5-dimension model, not a simple RIASEC code), so that's what we surface.
 * `riasecCode`/`videoUrl` stay in the schema for a possible later revisit.
 */
function reportDTO(report = {}) {
  return {
    url: report.url || null,
    topCareers: report.topCareers || [],
    summary: report.summary || '',
  }
}

/** Status for the course page card. */
export async function getStatus(userId, product) {
  await requireEntitlement(userId, product)
  const a = await getOrCreate(userId, product)
  const { user, needs } = await missingForTest(userId)
  await syncWithMindler(a, user)
  return toDTO(a, needs, await psychometricGuides())
}

/**
 * Student opened the test. In API mode this is where they get signed in on
 * Mindler: the returned `redirectUrl` is a one-time login link, and the card
 * sends the browser there. It is only marked in progress once Mindler has
 * handed a link back, so a failed call leaves it as it was and the student can
 * simply try again.
 */
export async function start(userId, product) {
  await requireEntitlement(userId, product)
  const a = await getOrCreate(userId, product)

  // Finished: the button is "See your report", and it goes to the report page.
  if (a.status === 'completed') {
    const { reportUrl, loginUrl } = await mindler.reportLinksFor(await mindlerUser(userId))
    return { ...toDTO(a, [], await psychometricGuides()), redirectUrl: reportUrl, loginUrl }
  }

  let redirectUrl = null
  if (mindler.isApiMode()) {
    // The card asks for these before calling here; this is the backstop for a
    // stale page or a direct call, and it keeps a half-filled account from
    // ever reaching Mindler.
    const { user, needs } = await missingForTest(userId)
    if (needs.length) {
      throw httpError(
        'Please add your class and phone number before you take the test.',
        400,
        'PROFILE_INCOMPLETE'
      )
    }
    redirectUrl = await mindler.testUrlFor(user)
  }

  if (a.status === 'not_started') {
    a.status = 'in_progress'
    a.startedAt = new Date()
    await a.save()
  }
  return { ...toDTO(a, [], await psychometricGuides()), redirectUrl }
}

/**
 * Student says they finished the test. In API mode Mindler is asked first: a
 * finished answer completes it, and "not yet" is refused with how far they
 * are, so the weeks do not open on a test that is not done. Only when Mindler
 * cannot be asked (handoff mode, or the check failed) is the student's word
 * recorded as submitted — which unlocks the weeks, as it always has.
 */
export async function markSubmitted(userId, product, externalRef) {
  await requireEntitlement(userId, product)
  const a = await getOrCreate(userId, product)
  const guides = await psychometricGuides()
  if (a.status === 'completed') return toDTO(a, [], guides)

  // Only asks once the test has been opened; see syncWithMindler.
  const result = await syncWithMindler(a, await mindlerUser(userId), { force: true })
  if (a.status === 'completed') return toDTO(a, [], guides)
  if (result && !result.completed) {
    const pct = result.percent ?? 0
    throw httpError(
      `The test site says your test is ${pct}% done. Please finish the remaining sections, then tap “I’ve finished it” again.`,
      409,
      'TEST_NOT_FINISHED'
    )
  }

  a.status = 'submitted'
  a.submittedAt = new Date()
  if (externalRef) a.externalRef = String(externalRef).trim()
  if (!a.startedAt) a.startedAt = new Date()
  await a.save()
  return toDTO(a, [], guides)
}

// ---- Admin ----------------------------------------------------------------

export async function adminList({ status, product, page, limit } = {}) {
  const q = {}
  if (status) q.status = status
  if (product) q.product = product
  const p = pageOf({ page, limit })
  const [items, total] = await Promise.all([
    Assessment.find(q).sort({ updatedAt: -1 }).skip(p.skip).limit(p.limit).populate('user', 'name email'),
    Assessment.countDocuments(q),
  ])
  return pageResult(items, total, p)
}

/**
 * Admin attaches the finished report (read off the Mindler partner portal) and
 * completes the assessment. Passing only some fields patches just those.
 */
export async function adminComplete(assessmentId, { report, notes, externalRef, adminId }) {
  const a = await Assessment.findById(assessmentId)
  if (!a) throw httpError('Assessment not found', 404)

  if (report) {
    if (report.url !== undefined) a.report.url = report.url || null
    if (report.riasecCode !== undefined)
      a.report.riasecCode = report.riasecCode ? String(report.riasecCode).toUpperCase() : null
    if (report.videoUrl !== undefined) a.report.videoUrl = report.videoUrl || null
    if (report.topCareers !== undefined)
      a.report.topCareers = Array.isArray(report.topCareers) ? report.topCareers : []
    if (report.summary !== undefined) a.report.summary = report.summary || ''
  }
  if (notes !== undefined) a.notes = notes || ''
  if (externalRef !== undefined) a.externalRef = externalRef || null

  a.status = 'completed'
  a.completedAt = a.completedAt || new Date()
  a.verifiedBy = adminId || a.verifiedBy
  await a.save()
  return a
}

/**
 * Admin saves the per-student Mindler coupon (generated in the partner
 * dashboard). The student's Learn card then shows THIS code.
 */
export async function adminSetCoupon(assessmentId, couponCode) {
  const a = await Assessment.findById(assessmentId)
  if (!a) throw httpError('Assessment not found', 404)
  a.couponCode = couponCode ? String(couponCode).trim() : null
  await a.save()
  return a
}

/** Send it back to the student (e.g. wrong account / test not actually done). */
export async function adminReopen(assessmentId, notes) {
  const a = await Assessment.findById(assessmentId)
  if (!a) throw httpError('Assessment not found', 404)
  a.status = 'in_progress'
  a.submittedAt = null
  a.completedAt = null
  if (notes !== undefined) a.notes = notes || ''
  await a.save()
  return a
}
