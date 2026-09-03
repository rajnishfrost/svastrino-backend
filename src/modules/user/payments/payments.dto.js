// Validation + output shaping for the payments module.
import { rupees } from '../../../utils/money.js'

const fail = (message, status = 400) => {
  const err = new Error(message)
  err.status = status
  throw err
}
const clean = (s) => String(s ?? '').replace(/[<>]/g, '').trim()

export function validateCheckout(body) {
  const packageId = clean(body.packageId)
  if (!packageId) fail('packageId is required')
  const couponCode = body.couponCode ? clean(body.couponCode).toUpperCase() : null
  const referralCode = body.referralCode ? clean(body.referralCode).toUpperCase() : null
  return { packageId, couponCode, referralCode }
}

export function validateVerify(body) {
  const orderId = clean(body.orderId)
  if (!orderId) fail('orderId is required')
  // paymentId/signature are optional in mock mode; required with real Razorpay.
  return {
    orderId,
    paymentId: body.razorpay_payment_id || body.paymentId || null,
    signature: body.razorpay_signature || body.signature || null,
  }
}

export function validateRefund(body) {
  const orderId = clean(body.orderId)
  if (!orderId) fail('orderId is required')
  return { orderId, reason: clean(body.reason) || undefined }
}

export function validateCouponCreate(body) {
  const code = clean(body.code).toUpperCase()
  const type = clean(body.type)
  const value = Number(body.value)
  if (!code) fail('code is required')
  if (!['percent', 'flat'].includes(type)) fail("type must be 'percent' or 'flat'")
  if (!Number.isFinite(value) || value <= 0) fail('value must be a positive number')
  if (type === 'percent' && value > 100) fail('percent value cannot exceed 100')
  return {
    code,
    type,
    value, // percent OR paise (flat)
    applicablePackages: Array.isArray(body.applicablePackages) ? body.applicablePackages : [],
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    maxRedemptions: body.maxRedemptions != null ? Number(body.maxRedemptions) : null,
  }
}

/** Shape an order for the client. Amounts exposed in both paise and rupees. */
export function toOrderDTO(order) {
  return {
    id: order._id,
    packageId: order.packageId,
    item: order.packageLabel,
    product: order.product,
    amount: order.amount,
    amountInr: rupees(order.amount),
    listPrice: order.listPrice,
    basePrice: order.basePrice,
    discount: order.discount,
    discountInr: rupees(order.discount),
    earlyBirdApplied: order.earlyBirdApplied,
    couponCode: order.couponCode,
    isUpgrade: order.isUpgrade || false,
    creditApplied: order.creditApplied || 0,
    creditAppliedInr: rupees(order.creditApplied || 0),
    previousPackageId: order.previousPackageId || null,
    currency: order.currency,
    status: order.status,
    receiptNo: order.receiptNo || null,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
    refundedAt: order.refundedAt || null,
  }
}

export function toEnrollmentDTO(e, extra = {}) {
  return {
    id: e._id,
    product: e.product,
    packageId: e.packageId,
    packageName: e.packageName,
    status: e.status,
    startsAt: e.startsAt,
    expiresAt: e.expiresAt,
    // Buying a mentoring program creates an enrollment too, so the dashboard
    // has to be told which half it belongs under — otherwise Bull's Eye lands
    // beside Nirmaan in Skill Build. 'course' | 'mentoring'.
    kind: extra.kind || 'course',
    // The course this package belongs to ("Nirmaan"), so a card can name itself
    // instead of every card being labelled Nirmaan by the client.
    courseName: extra.courseName || '',
    courseSlug: extra.courseSlug || '',
  }
}
