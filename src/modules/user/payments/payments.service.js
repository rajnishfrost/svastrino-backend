import crypto from 'node:crypto'
import { Order } from './order.model.js'
import { Enrollment } from './enrollment.model.js'
import { Coupon } from './coupon.model.js'
import { getPackageBySku, listPackagesByProduct } from '../skillbuild/skillbuild.service.js'
import { LearnState } from '../learn/learnState.model.js'
import { istDaysBetween } from '../../../utils/schedule.js'
import { rupees } from '../../../utils/money.js'
import * as gateway from './gateway.js'

// The charged price before coupons: early-bird if the package has one, else list.
const basePrice = (pkg) => (pkg.earlyBird != null ? pkg.earlyBird : pkg.price)
import { sendReceiptEmail } from '../../../utils/mailer.js'

// Upgrade rules: only within this many days of the day the student STARTS the
// course, and only upward in price. Credit = everything paid for the product.
const UPGRADE_WINDOW_DAYS = 7
const DAY_MS = 86400000

/**
 * The user's current active enrollment for a product plus upgrade context, or
 * null if they own nothing. `totalPaid` is every paise they've paid toward this
 * product (so multi-step upgrades never charge more than the package price).
 *
 * The 7-day window is anchored to the LearnState `startedAt` (the day the
 * student clicked Start), counted in IST calendar days so it lines up with the
 * course report's "on day N". Bought but not started yet → the window hasn't
 * begun, so the upgrade stays open.
 */
async function activeContext(userId, product) {
  const enrollment = await Enrollment.findOne({ user: userId, product, status: 'active' }).sort({
    createdAt: -1,
  })
  if (!enrollment) return null

  const currentPkg = await getPackageBySku(enrollment.packageId)
  const paidAgg = await Order.aggregate([
    { $match: { user: enrollment.user, product, status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])
  const totalPaid = paidAgg[0]?.total || 0

  const learnState = await LearnState.findOne({ user: userId, slug: product })
  const courseStartedAt = learnState?.startedAt || null

  let daysLeft = UPGRADE_WINDOW_DAYS
  let withinWindow = true
  let windowEndsAt = null
  if (courseStartedAt) {
    // Day 1 = the start day itself, matching the report's "on day N".
    const dayNumber = istDaysBetween(courseStartedAt, new Date()) + 1
    daysLeft = Math.max(0, UPGRADE_WINDOW_DAYS - dayNumber + 1)
    withinWindow = daysLeft > 0
    windowEndsAt = new Date(new Date(courseStartedAt).getTime() + UPGRADE_WINDOW_DAYS * DAY_MS)
  }

  return {
    enrollment,
    currentPkg,
    totalPaid,
    courseStartedAt,
    courseStarted: !!courseStartedAt,
    daysLeft,
    windowEndsAt,
    withinWindow,
  }
}

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

const REFERRAL_COMMISSION = 20000 // ₹200 flat student/parent cashback (SRS §9.4)

// --- Pricing -----------------------------------------------------------------

/** Validate a coupon against a package and return its paise discount. Throws on invalid. */
export async function validateCoupon(rawCode, packageId, base) {
  const code = String(rawCode || '').trim().toUpperCase()
  if (!code) return { code: null, discount: 0 }

  const coupon = await Coupon.findOne({ code })
  if (!coupon || !coupon.active) throw httpError('Invalid coupon code', 400)
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw httpError('This coupon has expired', 400)
  if (coupon.maxRedemptions != null && coupon.redemptions >= coupon.maxRedemptions)
    throw httpError('This coupon is no longer available', 400)
  if (coupon.applicablePackages.length && !coupon.applicablePackages.includes(packageId))
    throw httpError('This coupon does not apply to that package', 400)

  let discount = coupon.type === 'percent' ? Math.round((base * coupon.value) / 100) : coupon.value
  discount = Math.min(discount, base) // never below zero
  return { code, discount, coupon }
}

/** Price breakdown for a package (+ optional coupon, + upgrade credit). Used by the checkout page. */
export async function quote({ userId, packageId, couponCode }) {
  const pkg = await getPackageBySku(packageId)
  if (!pkg) throw httpError('Unknown package', 404)

  const base = basePrice(pkg)
  const { code, discount } = await validateCoupon(couponCode, packageId, base)

  // If the signed-in user already owns a lower tier of this product, credit
  // everything they've paid so far against the new price (an upgrade).
  let upgrade = null
  if (userId) {
    const ctx = await activeContext(userId, pkg.product)
    if (ctx?.currentPkg && pkg.sku !== ctx.currentPkg.sku && pkg.price > ctx.currentPkg.price) {
      upgrade = {
        isUpgrade: true,
        fromPackageId: ctx.currentPkg.sku,
        fromPackageName: ctx.currentPkg.name,
        credit: ctx.totalPaid,
        withinWindow: ctx.withinWindow,
        windowEndsAt: ctx.windowEndsAt,
      }
    }
  }
  const credit = upgrade ? upgrade.credit : 0
  const amount = Math.max(0, base - discount - credit)

  return {
    packageId: pkg.sku,
    name: pkg.label,
    listPrice: pkg.price,
    basePrice: base,
    earlyBirdApplied: pkg.earlyBird != null,
    couponCode: code,
    discount,
    credit,
    upgrade,
    amount,
    currency: 'INR',
    // convenience for the client
    rupees: {
      listPrice: rupees(pkg.price),
      basePrice: rupees(base),
      discount: rupees(discount),
      credit: rupees(credit),
      amount: rupees(amount),
    },
  }
}

// --- Checkout ----------------------------------------------------------------

/** Create an Order + a gateway order, ready for the checkout widget. */
export async function createOrder({ userId, packageId, couponCode, referralCode }) {
  const pkg = await getPackageBySku(packageId)
  if (!pkg) throw httpError('Unknown package', 404)

  const base = basePrice(pkg)
  const { code, discount } = await validateCoupon(couponCode, packageId, base)

  // One package at a time. If the user already owns a tier of this product it
  // must be an UPGRADE: strictly higher price, and inside the 7-day window. The
  // amount already paid is credited against the new price.
  let creditApplied = 0
  let isUpgrade = false
  let previousPackageId = null
  const ctx = await activeContext(userId, pkg.product)

  // Pay-as-you-use is the exception to "one package at a time": the student
  // buys the SAME plan again for each further phase. Each phase is charged in
  // full, so no upgrade credit applies, and the plan cannot be swapped
  // mid-course — they carry on paying phase by phase to the end.
  if (ctx?.currentPkg && (pkg.paymentMode === 'per-phase' || ctx.currentPkg.paymentMode === 'per-phase')) {
    const current = ctx.currentPkg
    if (pkg.sku !== current.sku) {
      throw httpError(
        'You are on a pay-as-you-use plan. Keep paying phase by phase to finish this course.',
        400,
        'PAY_AS_YOU_USE_LOCKED'
      )
    }
    const active = await Enrollment.findOne({
      user: userId, product: pkg.product, packageId: pkg.sku, status: 'active',
    }).sort({ phasesUnlocked: -1 })
    const unlocked = active?.phasesUnlocked || 0
    const total = active?.phasesTotal || pkg.phases || 1
    if (unlocked >= total) {
      throw httpError('You have already paid for every phase of this course.', 400, 'ALL_PHASES_PAID')
    }
    // Fall through with no credit and no upgrade flags — a plain next-phase sale.
  } else if (ctx?.currentPkg) {
    const current = ctx.currentPkg
    if (pkg.sku === current.sku) throw httpError('You already own this package', 400, 'ALREADY_OWNED')
    if (pkg.price <= current.price)
      throw httpError('You can only upgrade to a higher package, not downgrade', 400, 'DOWNGRADE_BLOCKED')
    if (!ctx.withinWindow)
      throw httpError('The 7-day upgrade window for your package has closed', 400, 'UPGRADE_WINDOW_CLOSED')
    creditApplied = ctx.totalPaid
    isUpgrade = true
    previousPackageId = current.sku
  }

  const amount = Math.max(0, base - discount - creditApplied)

  const gatewayOrder = await gateway.createOrder({
    amount,
    currency: 'INR',
    receipt: `rcpt_${crypto.randomBytes(6).toString('hex')}`,
  })

  const order = await Order.create({
    user: userId,
    packageId: pkg.sku,
    packageLabel: pkg.label,
    product: pkg.product,
    listPrice: pkg.price,
    basePrice: base,
    discount,
    amount,
    earlyBirdApplied: pkg.earlyBird != null,
    couponCode: code,
    referralCode: referralCode ? String(referralCode).trim().toUpperCase() : null,
    isUpgrade,
    creditApplied,
    previousPackageId,
    status: 'created',
    gateway: gateway.GATEWAY,
    gatewayOrderId: gatewayOrder.id,
  })

  return {
    orderId: order._id.toString(),
    gatewayOrderId: gatewayOrder.id,
    key: gateway.publicKey(),
    amount,
    currency: 'INR',
    packageLabel: pkg.label,
    mock: gateway.GATEWAY === 'mock',
  }
}

/**
 * Verify a payment and grant access. In MOCK mode the client can omit
 * paymentId/signature — the server simulates a successful payment. With real
 * Razorpay the client MUST pass the widget's razorpay_payment_id + signature.
 */
export async function verifyAndComplete({ userId, orderId, paymentId, signature }) {
  const order = await Order.findOne({ _id: orderId, user: userId })
  if (!order) throw httpError('Order not found', 404)
  if (order.status === 'paid') return await hydrate(order) // idempotent
  if (order.status !== 'created') throw httpError('This order can no longer be paid', 400)

  // MOCK: synthesize the payment the widget would have returned.
  if (gateway.GATEWAY === 'mock' && (!paymentId || !signature)) {
    const sim = gateway.simulatePayment(order.gatewayOrderId)
    paymentId = sim.paymentId
    signature = sim.signature
  }

  const ok = gateway.verifyPayment({ gatewayOrderId: order.gatewayOrderId, paymentId, signature })
  if (!ok) {
    order.status = 'failed'
    await order.save()
    throw httpError('Payment verification failed', 400)
  }

  // Mark paid
  order.status = 'paid'
  order.gatewayPaymentId = paymentId
  order.paidAt = new Date()
  order.receiptNo = `SVA-${Date.now().toString(36).toUpperCase()}`
  if (order.referralCode) order.referralCommission = REFERRAL_COMMISSION
  await order.save()

  // Bump coupon usage
  if (order.couponCode) {
    await Coupon.updateOne({ code: order.couponCode }, { $inc: { redemptions: 1 } })
  }

  // Grant access. On an upgrade, supersede the old enrollment and PRESERVE its
  // original start — so the 7-day window and access duration anchor to the first
  // purchase, not the upgrade date.
  const pkg = await getPackageBySku(order.packageId)
  let startsAt = new Date()
  if (order.isUpgrade) {
    const prev = await Enrollment.findOne({
      user: userId,
      product: order.product,
      status: 'active',
    }).sort({ createdAt: -1 })
    if (prev) {
      startsAt = prev.startsAt || startsAt
      prev.status = 'upgraded'
      await prev.save()
    }
  }
  // Phase access. A pay-once plan opens every phase immediately. A
  // pay-as-you-use plan opens ONE phase per payment: the first purchase starts
  // at phase 1, and each later payment for the same plan adds the next one.
  const phasesTotal = pkg?.phases || 1
  const perPhase = pkg?.paymentMode === 'per-phase'
  let phasesUnlocked = perPhase ? 1 : phasesTotal
  if (perPhase) {
    const prior = await Enrollment.findOne({
      user: userId, product: order.product, packageId: order.packageId, status: 'active',
    }).sort({ phasesUnlocked: -1 })
    if (prior) phasesUnlocked = Math.min(phasesTotal, (prior.phasesUnlocked || 1) + 1)
  }

  const enrollment = await Enrollment.create({
    user: userId,
    order: order._id,
    product: order.product,
    packageId: order.packageId,
    packageName: pkg?.name || order.packageLabel,
    paymentMode: pkg?.paymentMode || 'one-time',
    phasesUnlocked,
    phasesTotal,
    startsAt,
    expiresAt: pkg?.durationDays
      ? new Date(new Date(startsAt).getTime() + pkg.durationDays * 86400000)
      : null,
  })

  // A pay-as-you-use student holds one enrollment per phase paid for. Retire the
  // earlier one so exactly one active enrollment carries the current access.
  if (perPhase) {
    await Enrollment.updateMany(
      { user: userId, product: order.product, packageId: order.packageId,
        status: 'active', _id: { $ne: enrollment._id } },
      { status: 'upgraded' }
    )
  }

  // Receipt email (best-effort — never fail the payment on email trouble)
  try {
    const user = await import('../credentials/credentials.model.js').then((m) =>
      m.User.findById(userId)
    )
    if (user?.email) {
      await sendReceiptEmail(user.email, {
        receiptNo: order.receiptNo,
        item: order.packageLabel,
        amount: order.amount,
        date: order.paidAt,
      })
    }
  } catch (err) {
    console.error('✗ Failed to send receipt email:', err.message)
  }

  return { order, enrollment }
}

async function hydrate(order) {
  const enrollment = await Enrollment.findOne({ order: order._id })
  return { order, enrollment }
}

// --- Reads -------------------------------------------------------------------

export async function listOrders(userId) {
  return Order.find({ user: userId }).sort({ createdAt: -1 })
}

export async function getOrder(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, user: userId })
  if (!order) throw httpError('Order not found', 404)
  return order
}

export async function listEnrollments(userId) {
  return Enrollment.find({ user: userId, status: 'active' }).sort({ createdAt: -1 })
}

/**
 * Upgrade availability for a product the user is enrolled in — powers the
 * "you can upgrade for ₹X more" prompt. Lists each higher tier with its net
 * price after crediting what the user already paid.
 */
export async function upgradeStatus(userId, product) {
  const ctx = await activeContext(userId, product)
  if (!ctx?.currentPkg) return { hasEnrollment: false, canUpgrade: false, options: [] }

  const current = ctx.currentPkg
  const options = (await listPackagesByProduct(product))
    .filter((p) => p.price > current.price)
    .map((p) => {
      const base = basePrice(p)
      const amount = Math.max(0, base - ctx.totalPaid)
      return {
        packageId: p.sku,
        name: p.name,
        basePrice: base,
        credit: ctx.totalPaid,
        amount,
        rupees: { basePrice: rupees(base), credit: rupees(ctx.totalPaid), amount: rupees(amount) },
      }
    })
    .sort((a, b) => a.basePrice - b.basePrice)

  // Phase-wise plans do not "upgrade" — the student simply buys the next phase
  // of the same plan. Hand the client enough to label that button.
  const phaseEnrollment = await Enrollment.findOne({
    user: userId, product, status: 'active',
  }).sort({ phasesUnlocked: -1 })
  const perPhase = (phaseEnrollment?.paymentMode || 'one-time') === 'per-phase'
  const unlocked = phaseEnrollment?.phasesUnlocked || 0
  const totalPhases = phaseEnrollment?.phasesTotal || 1
  const phase = perPhase
    ? {
        paymentMode: 'per-phase',
        unlocked,
        total: totalPhases,
        nextPhase: unlocked < totalPhases ? unlocked + 1 : null,
        // Each phase costs the plan's own price — no credit, no discount.
        amount: unlocked < totalPhases ? current.price : 0,
        rupees: { amount: rupees(unlocked < totalPhases ? current.price : 0) },
      }
    : { paymentMode: 'one-time', unlocked: totalPhases, total: totalPhases, nextPhase: null }

  return {
    hasEnrollment: true,
    product,
    currentPackage: { packageId: current.sku, name: current.name },
    phase,
    totalPaid: ctx.totalPaid,
    windowDays: UPGRADE_WINDOW_DAYS,
    courseStarted: ctx.courseStarted,
    courseStartedAt: ctx.courseStartedAt,
    withinWindow: ctx.withinWindow,
    windowEndsAt: ctx.windowEndsAt,
    daysLeft: ctx.daysLeft,
    canUpgrade: ctx.withinWindow && options.length > 0,
    options,
  }
}

// --- Admin -------------------------------------------------------------------

export async function adminListOrders({ status } = {}) {
  const q = status ? { status } : {}
  return Order.find(q).sort({ createdAt: -1 }).limit(500).populate('user', 'name email')
}

export async function adminRevenue() {
  const paid = await Order.aggregate([
    { $match: { status: 'paid' } },
    { $group: { _id: null, revenue: { $sum: '$amount' }, count: { $sum: 1 } } },
  ])
  const refunded = await Order.aggregate([
    { $match: { status: 'refunded' } },
    { $group: { _id: null, refunded: { $sum: '$amount' }, count: { $sum: 1 } } },
  ])
  return {
    revenue: paid[0]?.revenue || 0,
    paidCount: paid[0]?.count || 0,
    refunded: refunded[0]?.refunded || 0,
    refundedCount: refunded[0]?.count || 0,
  }
}

export async function adminRefund({ orderId, reason }) {
  const order = await Order.findById(orderId)
  if (!order) throw httpError('Order not found', 404)
  if (order.status !== 'paid') throw httpError('Only paid orders can be refunded', 400)

  await gateway.refund({ paymentId: order.gatewayPaymentId, amount: order.amount })

  order.status = 'refunded'
  order.refundedAt = new Date()
  order.refundReason = reason || 'Refunded by admin'
  await order.save()

  // Revoke the access that this order granted
  await Enrollment.updateMany({ order: order._id }, { status: 'revoked' })
  return order
}

export async function createCoupon(data) {
  return Coupon.create(data)
}

export async function listCoupons() {
  return Coupon.find().sort({ createdAt: -1 })
}

// --- Webhook -----------------------------------------------------------------

/**
 * Process a gateway webhook (Razorpay events like payment.captured / refund).
 * Signature is verified by the controller. Idempotent by design.
 */
export async function handleWebhookEvent(event) {
  const type = event?.event
  const entity = event?.payload?.payment?.entity || {}
  if (type === 'payment.captured' && entity.order_id) {
    const order = await Order.findOne({ gatewayOrderId: entity.order_id })
    if (order && order.status === 'created') {
      order.status = 'paid'
      order.gatewayPaymentId = entity.id
      order.paidAt = new Date()
      order.receiptNo = order.receiptNo || `SVA-${Date.now().toString(36).toUpperCase()}`
      await order.save()
    }
  }
  return { received: true }
}
