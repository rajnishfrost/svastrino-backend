import { Assessment } from './assessment.model.js'
import { Enrollment } from '../payments/enrollment.model.js'
import * as mindler from './mindler.js'

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

/** The psychometric test ships with every package, so any active enrollment grants it. */
async function requireEnrollment(userId, product) {
  const enrollment = await Enrollment.findOne({ user: userId, product, status: 'active' })
  if (!enrollment)
    throw httpError('Enrol in this product to take the psychometric test', 403, 'NOT_ENROLLED')
  return enrollment
}

/** Get (or lazily create) the student's assessment record. */
async function getOrCreate(userId, product) {
  const found = await Assessment.findOne({ user: userId, product })
  if (found) return found
  return Assessment.create({ user: userId, product, provider: 'mindler' })
}

function toDTO(a) {
  const handoff = mindler.handoffInfo()
  return {
    product: a.product,
    provider: a.provider,
    status: a.status,
    startedAt: a.startedAt,
    submittedAt: a.submittedAt,
    completedAt: a.completedAt,
    externalRef: a.externalRef,
    // Handoff details for the "take the test" step. The student's own Mindler
    // coupon (generated per-student in the partner dashboard) wins over the
    // env-level fallback code.
    testUrl: handoff.testUrl,
    accessCode: a.couponCode || handoff.accessCode,
    steps: handoff.steps,
    report: a.status === 'completed' ? reportDTO(a.report) : null,
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
  await requireEnrollment(userId, product)
  const a = await getOrCreate(userId, product)
  return toDTO(a)
}

/** Student opened the test site — mark in progress. */
export async function start(userId, product) {
  await requireEnrollment(userId, product)
  const a = await getOrCreate(userId, product)
  if (a.status === 'not_started') {
    a.status = 'in_progress'
    a.startedAt = new Date()
    await a.save()
  }
  return toDTO(a)
}

/**
 * Student self-reports that they finished the test on Mindler. This does NOT
 * complete it — an admin verifies against the partner portal and attaches the
 * report, which is what flips it to 'completed'.
 */
export async function markSubmitted(userId, product, externalRef) {
  await requireEnrollment(userId, product)
  const a = await getOrCreate(userId, product)
  if (a.status === 'completed') return toDTO(a)

  a.status = 'submitted'
  a.submittedAt = new Date()
  if (externalRef) a.externalRef = String(externalRef).trim()
  if (!a.startedAt) a.startedAt = new Date()
  await a.save()
  return toDTO(a)
}

// ---- Admin ----------------------------------------------------------------

export async function adminList({ status, product } = {}) {
  const q = {}
  if (status) q.status = status
  if (product) q.product = product
  return Assessment.find(q).sort({ updatedAt: -1 }).limit(500).populate('user', 'name email')
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
