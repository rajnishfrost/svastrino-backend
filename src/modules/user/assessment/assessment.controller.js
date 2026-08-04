import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './assessment.service.js'

const clean = (s) => String(s ?? '').replace(/[<>]/g, '').trim()

// ---- Student (requireUserAuth) ----

// GET /api/user/assessment/:product
export const getStatus = asyncHandler(async (req, res) => {
  res.json(await service.getStatus(req.user.id, clean(req.params.product)))
})

// POST /api/user/assessment/:product/start  → mark in-progress, return test URL
export const start = asyncHandler(async (req, res) => {
  res.json(await service.start(req.user.id, clean(req.params.product)))
})

// POST /api/user/assessment/:product/submitted  → student says they finished
export const markSubmitted = asyncHandler(async (req, res) => {
  const externalRef = req.body?.externalRef ? clean(req.body.externalRef) : null
  res.json(await service.markSubmitted(req.user.id, clean(req.params.product), externalRef))
})

// ---- Admin (requireAdminAuth) ----

// GET /api/admin/assessments?status=submitted&product=nirmaan
export const adminList = asyncHandler(async (req, res) => {
  const list = await service.adminList({
    status: req.query.status ? clean(req.query.status) : undefined,
    product: req.query.product ? clean(req.query.product) : undefined,
  })
  res.json({
    assessments: list.map((a) => ({
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
    notes: b.notes !== undefined ? clean(b.notes) : undefined,
    report: {
      url: b.reportUrl !== undefined ? clean(b.reportUrl) : undefined,
      riasecCode: b.riasecCode !== undefined ? clean(b.riasecCode) : undefined,
      videoUrl: b.videoUrl !== undefined ? clean(b.videoUrl) : undefined,
      topCareers: Array.isArray(b.topCareers) ? b.topCareers.map(clean) : undefined,
      summary: b.summary !== undefined ? clean(b.summary) : undefined,
    },
  })
  res.json({ assessment: { id: a._id, status: a.status, report: a.report } })
})

// PATCH /api/admin/assessments/:id/reopen
export const adminReopen = asyncHandler(async (req, res) => {
  const a = await service.adminReopen(req.params.id, req.body?.notes)
  res.json({ assessment: { id: a._id, status: a.status } })
})

// PATCH /api/admin/assessments/:id/coupon  → save the per-student Mindler coupon
export const adminSetCoupon = asyncHandler(async (req, res) => {
  const a = await service.adminSetCoupon(req.params.id, clean(req.body?.couponCode))
  res.json({ assessment: { id: a._id, couponCode: a.couponCode } })
})
