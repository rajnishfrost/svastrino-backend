// Validation + output shaping for the payments module.
import { rupees } from '../../../utils/money.js'
import {
  COUPON_RE, LIMITS, couponStr, optionalCoupon, requireInt, str, strList,
} from '../../../utils/validate.js'

const fail = (message, status = 400) => {
  const err = new Error(message)
  err.status = status
  throw err
}

// Every id here was minted by us or by the gateway, so the cap is generous
// enough for any of those and still a cap. Before it was added `clean` trimmed
// and stripped markup but never truncated, which left a 100 kB "coupon code"
// perfectly acceptable all the way to the database index.
const clean = (s, max = LIMITS.shortText) => str(s, max)

export function validateCheckout(body) {
  const packageId = clean(body.packageId, LIMITS.slug)
  if (!packageId) fail('packageId is required')
  // A code the buyer typed, so it is held to the shape a code can have: letters,
  // digits and dashes. Anything else is a typo or a probe, and either way it was
  // never going to match a coupon.
  const couponCode = optionalCoupon(body.couponCode, { field: 'couponCode' }) || null
  const referralCode = optionalCoupon(body.referralCode, { field: 'referralCode' }) || null
  return { packageId, couponCode, referralCode }
}

export function validateVerify(body) {
  const orderId = clean(body.orderId, LIMITS.shortText)
  if (!orderId) fail('orderId is required')
  // paymentId/signature only mean anything to the mock gateway. Cashfree is
  // asked directly how the order stands, so the browser sends just the order.
  return {
    orderId,
    paymentId: clean(body.paymentId, LIMITS.shortText) || null,
    signature: clean(body.signature, 512) || null,
  }
}

export function validateRefund(body) {
  const orderId = clean(body.orderId, LIMITS.shortText)
  if (!orderId) fail('orderId is required')
  return { orderId, reason: clean(body.reason, LIMITS.notes) || undefined }
}

export function validateCouponCreate(body) {
  // The admin types the code that buyers will then type back, so it is held to
  // the same shape the checkout accepts. A coupon containing a space or a comma
  // is one no buyer could ever successfully enter.
  const code = couponStr(body.code)
  const type = clean(body.type, 16)
  const value = Number(body.value)
  if (!code) fail('code is required')
  if (!COUPON_RE.test(code)) fail('A coupon code is 3 to 24 letters, digits and dashes')
  if (!['percent', 'flat'].includes(type)) fail("type must be 'percent' or 'flat'")
  if (!Number.isFinite(value) || value <= 0) fail('value must be a positive number')
  if (type === 'percent' && value > 100) fail('percent value cannot exceed 100')
  return {
    code,
    type,
    value, // percent OR paise (flat)
    // Bounded in both directions: the panel posts these from a picker, and an
    // array is the one input shape a length cap on a string never touches.
    applicablePackages: strList(body.applicablePackages, { max: LIMITS.slug, count: 100 }),
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    maxRedemptions:
      body.maxRedemptions != null
        ? requireInt(body.maxRedemptions, { field: 'maxRedemptions', label: 'the redemption limit', min: 1, max: 1_000_000 })
        : null,
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
