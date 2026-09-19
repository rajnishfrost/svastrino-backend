import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './payments.service.js'
import { enrollmentProgress } from '../learn/learn.service.js'
import { courseAccess } from '../learn/courseAccess.js'
import * as gateway from './gateway.js'
import { getPackageBySku } from '../skillbuild/skillbuild.service.js'
import {
  validateCheckout,
  validateVerify,
  validateRefund,
  validateCouponCreate,
  toOrderDTO,
  toEnrollmentDTO,
} from './payments.dto.js'
import { LIMITS, couponStr, str } from '../../../utils/validate.js'

// ---- User (requireUserAuth) ----

// GET /api/user/payments/quote?packageId=&coupon=
export const getQuote = asyncHandler(async (req, res) => {
  const q = await service.quote({
    userId: req.user.id,
    packageId: str(req.query.packageId, LIMITS.slug),
    // The buyer typed this one, so it is normalised rather than refused: a stray
    // space or a lower-case letter is a typo we can absorb, and what is left
    // either matches a coupon or does not. The cap is the point — a query string
    // is the one place a caller can put a megabyte without a body at all.
    couponCode: couponStr(req.query.coupon) || null,
  })
  res.json(q)
})

// GET /api/user/payments/upgrade-status?product=nirmaan
export const upgradeStatus = asyncHandler(async (req, res) => {
  const status = await service.upgradeStatus(req.user.id, str(req.query.product, LIMITS.slug))
  res.json(status)
})

// POST /api/user/payments/order  → create order + gateway order
export const createOrder = asyncHandler(async (req, res) => {
  const dto = validateCheckout(req.body)
  const result = await service.createOrder({ userId: req.user.id, ...dto })
  res.status(201).json(result)
})

// POST /api/user/payments/verify  → confirm payment, grant access
export const verify = asyncHandler(async (req, res) => {
  const dto = validateVerify(req.body)
  const { order, enrollment } = await service.verifyAndComplete({ userId: req.user.id, ...dto })
  res.json({ order: toOrderDTO(order), enrollment: enrollment ? toEnrollmentDTO(enrollment) : null })
})

// POST /api/user/payments/orders/:id/cancel — the customer closed the checkout
export const cancelOrder = asyncHandler(async (req, res) => {
  const result = await service.cancelOrder({ userId: req.user.id, orderId: req.params.id })
  res.json(result)
})

// GET /api/user/payments/orders
export const listOrders = asyncHandler(async (req, res) => {
  const orders = await service.listOrders(req.user.id)
  res.json({ orders: orders.map(toOrderDTO) })
})

// GET /api/user/payments/orders/:id
export const getOrder = asyncHandler(async (req, res) => {
  const order = await service.getOrder(req.user.id, req.params.id)
  res.json({ order: toOrderDTO(order) })
})

// GET /api/user/payments/enrollments  (with course progress, for the dashboard)
//
// The dates come from `courseAccess`, not from the enrolment row itself, and the
// reason matters. The year runs from the student's FIRST enrolment for a course,
// but a pay-as-you-use student holds one enrolment per phase they have paid for
// and only the newest is still 'active' — so the row we list here carries an end
// date written a full year after whichever phase they bought last. Reading the
// row would have the dashboard promise a "valid till" date the learn page will
// not honour. Asking the same helper the learn page asks keeps the two screens
// telling the student one story. It costs one extra query per card.
export const listEnrollments = asyncHandler(async (req, res) => {
  const list = await service.listEnrollments(req.user.id)
  const enrollments = await Promise.all(
    list.map(async (e) => {
      const [access, progress] = await Promise.all([
        courseAccess(req.user.id, e.product),
        enrollmentProgress(req.user.id, e),
      ])
      // Which half of the dashboard this belongs under, and what the course is
      // actually called. Both come from the package, because the enrollment
      // itself only stores the plan name ("Bull's Eye Program") and cannot say
      // whether that plan is a course or a mentoring program.
      const pkg = await getPackageBySku(e.packageId, { includeInactive: true })
      const kind = pkg?.kind === 'mentoring' ? 'mentoring' : 'course'

      return {
        ...toEnrollmentDTO(e, { kind, courseName: pkg?.courseName || '', courseSlug: e.product }),
        // A plan with no end date never closes, and `expiresAt` is null then —
        // the dashboard simply says nothing about validity, which is right.
        startsAt: access.enrolledAt || e.startsAt,
        expiresAt: access.expiresAt,
        // The gate's own verdict, sent whole. Without it the dashboard has to
        // work out for itself whether a course is still open, which means a
        // second copy of the one-year and three-year rules living in the
        // browser — and one day the card would say something the course page
        // would not honour.
        access: { state: access.state, expiresAt: access.expiresAt, recordUntil: access.recordUntil },
        courseSlug: e.product,
        progress,
      }
    })
  )
  res.json({ enrollments })
})

// POST /api/user/payments/webhook  (public — the gateway calls this)
// Cashfree signs the EXACT raw body (prefixed with x-webhook-timestamp),
// captured as req.rawBody in app.js; without a raw body we fall back to the
// JSON re-stringify.
export const webhook = asyncHandler(async (req, res) => {
  const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {})
  if (!gateway.verifyWebhook(raw, req.headers['x-webhook-signature'], req.headers['x-webhook-timestamp'])) {
    return res.status(400).json({ error: 'Invalid webhook signature' })
  }
  const result = await service.handleWebhookEvent(req.body)
  res.json(result)
})

// ---- Admin (requireAdminAuth) ----

export const adminListOrders = asyncHandler(async (req, res) => {
  const list = await service.adminListOrders({
    status: req.query.status, page: req.query.page, limit: req.query.limit,
  })
  res.json({
    ...list,
    orders: list.items.map((o) => ({
      ...toOrderDTO(o),
      user: o.user ? { id: o.user._id, name: o.user.name, email: o.user.email } : null,
    })),
  })
})

export const adminRevenue = asyncHandler(async (req, res) => {
  res.json(await service.adminRevenue())
})

export const adminRefund = asyncHandler(async (req, res) => {
  const dto = validateRefund(req.body)
  const order = await service.adminRefund(dto)
  res.json({ order: toOrderDTO(order) })
})

export const adminCreateCoupon = asyncHandler(async (req, res) => {
  const dto = validateCouponCreate(req.body)
  const coupon = await service.createCoupon(dto)
  res.status(201).json({ coupon })
})

export const adminListCoupons = asyncHandler(async (req, res) => {
  const list = await service.listCoupons({ page: req.query.page, limit: req.query.limit })
  res.json({ ...list, coupons: list.items })
})

// PATCH /api/admin/payments/coupons/:id  { active }
export const adminSetCouponActive = asyncHandler(async (req, res) => {
  if (typeof req.body?.active !== 'boolean') {
    const err = new Error('active must be true or false')
    err.status = 400
    throw err
  }
  const coupon = await service.setCouponActive(req.params.id, req.body.active)
  res.json({ coupon })
})
