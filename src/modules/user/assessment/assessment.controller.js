import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './assessment.service.js'
import { LIMITS, couponStr, optionalLink, str, strList, text } from '../../../utils/validate.js'

// Every value that reaches this module is either a slug we minted or a reference
// an admin copied out of Mindler's panel. `clean` strips markup and — the part
// that was missing — truncates, so none of them can arrive as a wall of text.
const clean = (s, max = LIMITS.shortText) => str(s, max)

// ---- Student (requireUserAuth) ----

// GET /api/user/assessment/:product
export const getStatus = asyncHandler(async (req, res) => {
  res.json(await service.getStatus(req.user.id, clean(req.params.product, LIMITS.slug)))
})

// POST /api/user/assessment/:product/start  → mark in-progress, return test URL
export const start = asyncHandler(async (req, res) => {
  res.json(await service.start(req.user.id, clean(req.params.product, LIMITS.slug)))
})

// POST /api/user/assessment/:product/submitted  → student says they finished
export const markSubmitted = asyncHandler(async (req, res) => {
  const externalRef = req.body?.externalRef ? clean(req.body.externalRef) : null
  res.json(await service.markSubmitted(req.user.id, clean(req.params.product, LIMITS.slug), externalRef))
})

// ---- Admin (requireAdminAuth) ----

// GET /api/admin/assessments?status=submitted&product=nirmaan
export const adminList = asyncHandler(async (req, res) => {
  const list = await service.adminList({
    status: req.query.status ? clean(req.query.status) : undefined,
    product: req.query.product ? clean(req.query.product) : undefined,
    page: req.query.page,
    limit: req.query.limit,
  })
  res.json({
    ...list,
    assessments: list.items.map((a) => ({
      id: a._id,
      user: a.user ? { id: a.user._id, name: a.user.name, email: a.user.email } : null,
      product: a.product,
      status: a.status,
      couponCode: a.couponCode,
      externalRef: a.externalRef,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      completedAt: a.completedAt,
      report: a.report,
      notes: a.notes,
    })),
  })
})

// PATCH /api/admin/assessments/:id/complete  → attach report + mark completed
export const adminComplete = asyncHandler(async (req, res) => {
  const b = req.body || {}
  const a = await service.adminComplete(req.params.id, {
    adminId: req.admin?.id,
    externalRef: b.externalRef !== undefined ? clean(b.externalRef) : undefined,
    notes: b.notes !== undefined ? text(b.notes, LIMITS.notes) : undefined,
    report: {
      // Both of these end up in an href the student clicks, so anything that is
      // not an http(s) URL or a path on this site is refused rather than stored
      // and rendered. Our own uploader returns the relative form.
      url: b.reportUrl !== undefined ? optionalLink(b.reportUrl, { field: 'reportUrl' }) : undefined,
      riasecCode: b.riasecCode !== undefined ? clean(b.riasecCode, 12) : undefined,
      videoUrl: b.videoUrl !== undefined ? optionalLink(b.videoUrl, { field: 'videoUrl' }) : undefined,
      // An array is the one input shape a cap on a single string never reaches.
      topCareers: Array.isArray(b.topCareers)
        ? strList(b.topCareers, { max: LIMITS.title, count: 20 })
        : undefined,
      summary: b.summary !== undefined ? text(b.summary, LIMITS.description) : undefined,
    },
  })
  res.json({ assessment: { id: a._id, status: a.status, report: a.report } })
})

// PATCH /api/admin/assessments/:id/reopen
export const adminReopen = asyncHandler(async (req, res) => {
  // undefined, not '', when no note was sent: the service reads undefined as
  // "leave the note alone" and an empty string as "clear it".
  const notes = req.body?.notes !== undefined ? text(req.body.notes, LIMITS.notes) : undefined
  const a = await service.adminReopen(req.params.id, notes)
  res.json({ assessment: { id: a._id, status: a.status } })
})

// PATCH /api/admin/assessments/:id/coupon  → save the per-student Mindler coupon
export const adminSetCoupon = asyncHandler(async (req, res) => {
  const a = await service.adminSetCoupon(req.params.id, couponStr(req.body?.couponCode))
  res.json({ assessment: { id: a._id, couponCode: a.couponCode } })
})
