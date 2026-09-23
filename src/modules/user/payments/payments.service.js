import crypto from 'node:crypto'
import { Order } from './order.model.js'
import { Enrollment } from './enrollment.model.js'
import { Coupon } from './coupon.model.js'
import { getPackageBySku, listPackagesByProduct } from '../skillbuild/skillbuild.service.js'
import { Package } from '../skillbuild/package.model.js'
import { isApprovedForProgram } from '../enquiry/enquiry.service.js'
import { LearnState } from '../learn/learnState.model.js'
import { istDaysBetween } from '../../../utils/schedule.js'
import { rupees } from '../../../utils/money.js'
import * as gateway from './gateway.js'

const clientUrl = () =>
  (process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5174').replace(/\/$/, '')

// The charged price before coupons: early-bird if the package has one, else list.
const basePrice = (pkg) => (pkg.earlyBird != null ? pkg.earlyBird : pkg.price)

/**
 * What an upgrade credits against the new tier: the price the tier they own is
 * CHARGED at, not the rupees that actually changed hands. A coupon or offer won
 * on that tier is theirs to keep, so moving up costs the difference between the
 * two plans instead of quietly clawing the discount back at the till.
 *
 * A student who paid MORE than that — they bought before an early-bird landed —
 * is credited what they paid instead, so an upgrade can never cost more than
 * the new package sells for on its own.
 */
const upgradeCredit = (currentPkg, totalPaid) => Math.max(totalPaid, basePrice(currentPkg))
import { sendReceiptEmail } from '../../../utils/mailer.js'
import { pageOf, pageResult } from '../../../utils/paginate.js'
import { parseStudentClass, PSYCHOMETRIC_MIN_CLASS, PSYCHOMETRIC_MAX_CLASS } from '../../../utils/studentClass.js'

// Upgrade rules: only within this many days of the day the student STARTS the
// course, and only upward in price. Credit = the tier they already own.
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
 * begun, so the upgrade stays open. The team can also reopen the window for one
 * student (`LearnState.upgradeWindowUntil`); that deadline wins whenever it
 * runs later than the standard one — including after the standard one closed.
 */
async function activeContext(userId, product) {
  // A free trial is not a plan the student owns, so it never counts here — a
  // trial student buys like anyone else. The plan they DO own is looked up even
  // if it has since been switched off in the catalogue: retiring a plan stops it
  // being sold, not its owners owning it, and reading as "owns nothing" would
  // let them buy the course a second time at full price.
  const enrollment = await Enrollment.findOne({
    user: userId, product, status: 'active', trial: { $ne: true },
  }).sort({ createdAt: -1 })
  if (!enrollment) return null

  const currentPkg = await getPackageBySku(enrollment.packageId, { includeInactive: true })
  const paidAgg = await Order.aggregate([
    { $match: { user: enrollment.user, product, status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])
  const totalPaid = paidAgg[0]?.total || 0

  const learnState = await LearnState.findOne({ user: userId, slug: product })
  const courseStartedAt = learnState?.startedAt || null

  const reopenUntil = learnState?.upgradeWindowUntil || null

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

  // A reopen only ever extends: whole IST days from today up to the deadline,
  // taken only when that beats what the standard window still has. A deadline
  // already past leaves 0 and is ignored, so a spent grant changes nothing.
  if (reopenUntil) {
    const reopenDaysLeft = Math.max(0, istDaysBetween(new Date(), reopenUntil))
    if (reopenDaysLeft > daysLeft) {
      daysLeft = reopenDaysLeft
      windowEndsAt = reopenUntil
      withinWindow = true
    }
  }

  return {
    enrollment,
    currentPkg,
    totalPaid,
    courseStartedAt,
    courseStarted: !!courseStartedAt,
    reopenUntil,
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

/**
 * Where a buyer stands with one package, by the rules of the checkout: one plan
 * per course, upward only, inside the upgrade window — except a pay-as-you-use
 * plan, which is paid for again, phase by phase, on the same plan to the end.
 *
 * The pricing cards, the checkout summary, the course page's upgrade offer and
 * createOrder all read this one answer, so no button offers a purchase the
 * order would refuse. `ctx` is activeContext() for the package's product.
 *
 *   { state: 'buy' }                                 owns nothing in this course
 *   { state: 'upgrade', credit }                     a dearer plan, window open
 *   { state: 'next-phase', nextPhase, phasesTotal }  their pay-as-you-use plan
 *   { state: 'owned', code, message }                the plan they are on
 *   { state: 'blocked', code, message }              any other refusal
 */
async function standingFor(userId, pkg, ctx) {
  const current = ctx?.currentPkg
  if (!current) return { state: 'buy' }

  if (pkg.sku === current.sku) {
    if (current.paymentMode !== 'per-phase') {
      return { state: 'owned', code: 'ALREADY_OWNED', message: 'You already own this package' }
    }
    const active = await Enrollment.findOne({
      user: userId, product: pkg.product, packageId: pkg.sku, status: 'active',
    }).sort({ phasesUnlocked: -1 })
    const unlocked = active?.phasesUnlocked || 0
    const total = active?.phasesTotal || pkg.phases || 1
    if (unlocked >= total) {
      return { state: 'owned', code: 'ALL_PHASES_PAID', message: 'You have already paid for every phase of this course.' }
    }
    return { state: 'next-phase', nextPhase: unlocked + 1, phasesTotal: total }
  }

  if (current.paymentMode === 'per-phase') {
    return {
      state: 'blocked',
      code: 'PAY_AS_YOU_USE_LOCKED',
      message: 'You are on a pay-as-you-use plan. Keep paying phase by phase to finish this course.',
    }
  }
  if (pkg.paymentMode === 'per-phase') {
    return {
      state: 'blocked',
      code: 'PAID_IN_FULL',
      message: 'Your plan for this course is already paid in full, so pay-as-you-use is not open to you.',
    }
  }
  if (pkg.price <= current.price) {
    return { state: 'blocked', code: 'DOWNGRADE_BLOCKED', message: 'You can only upgrade to a higher package, not downgrade' }
  }
  if (!ctx.withinWindow) {
    return { state: 'blocked', code: 'UPGRADE_WINDOW_CLOSED', message: 'The 7-day upgrade window for your package has closed' }
  }
  return { state: 'upgrade', credit: upgradeCredit(current, ctx.totalPaid) }
}

const REFERRAL_COMMISSION = 20000 // ₹200 flat student/parent cashback (SRS §9.4)

// Class parsing and the 7-to-12 band live in utils/studentClass.js, shared with
// the Mindler handoff so both read a class the same way.

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

  // Whether this buyer may have the package at all, and on what terms. An
  // upgrade credits the plan they own against the new price; a plan they cannot
  // buy is said up front, so the checkout never offers a Pay button the order
  // would refuse.
  let upgrade = null
  let standing = { state: 'buy' }
  if (userId) {
    const ctx = await activeContext(userId, pkg.product)
    standing = await standingFor(userId, pkg, ctx)
    if (standing.state === 'upgrade') {
      upgrade = {
        isUpgrade: true,
        fromPackageId: ctx.currentPkg.sku,
        fromPackageName: ctx.currentPkg.name,
        credit: standing.credit,
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
    // The checkout asks for the student's class up front when the plan bundles
    // the test, rather than letting createOrder refuse the sale for it.
    includesPsychometric: !!pkg.includesPsychometric,
    earlyBirdApplied: pkg.earlyBird != null,
    couponCode: code,
    discount,
    credit,
    upgrade,
    standing,
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

/**
 * How a package is sold, straight from the catalog record. The normalised shape
 * getPackageBySku hands back does not carry buyMode, and a gate that quietly
 * passes because a projection dropped a field is no gate at all, so read the
 * flag ourselves whenever it is missing.
 */
async function packageBuyMode(pkg) {
  if (pkg.buyMode) return pkg.buyMode
  const row = await Package.findOne({ sku: pkg.sku, active: true }).select('buyMode').lean()
  return row?.buyMode || 'self-serve'
}

/** Create an Order + a gateway order, ready for the checkout widget. */
export async function createOrder({ userId, packageId, couponCode, referralCode }) {
  const pkg = await getPackageBySku(packageId)
  if (!pkg) throw httpError('Unknown package', 404)

  const buyMode = await packageBuyMode(pkg)

  // The guards below judge the buyer rather than the basket, and the gateway
  // wants to know who is paying, so read the profile once. The credentials
  // model stays a lazy import so payments never has to load the auth stack to
  // price a package.
  let buyer = null
  if (userId) {
    const { User } = await import('../credentials/credentials.model.js')
    buyer = await User.findById(userId).select('name email phone studentClass')
  }

  // Some programs are deliberately not sold straight from the checkout: the
  // visitor talks to a mentor first, and only once the team has approved that
  // request does the checkout open for them. Anyone else reaching here has
  // skipped the call, so refuse rather than take the money.
  if (buyMode === 'expert-call') {
    const cleared = await isApprovedForProgram({
      userId,
      email: buyer?.email,
      program: pkg.slug,
    })
    if (!cleared) {
      throw httpError(
        'This program starts with a call from our team. Request one on the program page and we will open your booking right after.',
        400,
      )
    }
  }

  // The psychometric test is only offered to school students in classes 7 to 12
  // (2026 plans sheet), because that is the band the test is built and scored
  // for. Taking money from anyone else would buy them a report we cannot give.
  if (pkg.includesPsychometric) {
    const studentClass = parseStudentClass(buyer?.studentClass)
    if (studentClass == null) {
      throw httpError(
        'This plan includes a psychometric test, and we need to know which class you are in before you buy it. Please add your class to your profile, then come back to this plan.',
        400,
        'CLASS_REQUIRED'
      )
    }
    if (studentClass < PSYCHOMETRIC_MIN_CLASS || studentClass > PSYCHOMETRIC_MAX_CLASS) {
      throw httpError(
        `The psychometric test is only for students in classes ${PSYCHOMETRIC_MIN_CLASS} to ${PSYCHOMETRIC_MAX_CLASS}. Everything else in this plan is open to you — pick the plan without psychometric testing to carry on.`,
        400,
        'PSYCHOMETRIC_CLASS_RANGE'
      )
    }
  }

  const base = basePrice(pkg)
  const { code, discount } = await validateCoupon(couponCode, packageId, base)

  // One package at a time: an owner may only move up (inside the window) or,
  // on pay-as-you-use, pay for the next phase of the same plan. See standingFor.
  const ctx = await activeContext(userId, pkg.product)
  const standing = await standingFor(userId, pkg, ctx)
  if (standing.state === 'owned' || standing.state === 'blocked') {
    throw httpError(standing.message, 400, standing.code)
  }
  const isUpgrade = standing.state === 'upgrade'
  const creditApplied = isUpgrade ? standing.credit : 0
  const previousPackageId = isUpgrade ? ctx.currentPkg.sku : null

  const amount = Math.max(0, base - discount - creditApplied)

  const gatewayOrder = await gateway.createOrder({
    amount,
    currency: 'INR',
    receipt: `rcpt_${crypto.randomBytes(6).toString('hex')}`,
    customer: { id: userId, name: buyer?.name, email: buyer?.email, phone: buyer?.phone },
    // Only used when the popup cannot open (an in-app browser) and Cashfree
    // takes the customer away to pay. The webhook grants access meanwhile, so
    // send them where their orders are listed.
    returnUrl: `${clientUrl()}/dashboard/settings?section=orders`,
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
    sessionId: gatewayOrder.sessionId,
    mode: gateway.checkoutMode(),
    amount,
    currency: 'INR',
    packageLabel: pkg.label,
    mock: gateway.GATEWAY === 'mock',
  }
}

/**
 * Mark an order paid and hand over everything that payment bought: the
 * enrollment, the coupon redemption, the receipt. Both ways a payment can reach
 * us — the browser coming back from the widget, and the gateway webhook — end
 * here, so access is identical whichever arrives first, and a buyer who closes
 * the tab the moment the money leaves still gets what they paid for.
 *
 * Idempotent by design, and safe when both arrive at once: the status
 * transition IS the lock. Only the caller whose write actually moved the order
 * to 'paid' burns the coupon redemption, and the enrollment is keyed on the
 * order id, so a webhook racing a browser confirm — or a retry repairing a
 * grant that died halfway — can never hand out a second enrollment or a second
 * redemption for one payment.
 */
async function completePaidOrder(order, { paymentId } = {}) {
  const userId = order.user

  // Claim the order with the status change itself. Anything already stamped is
  // kept as-is so a retry cannot move the paid date or reissue a receipt number
  // the customer has already been sent. A 'failed' order is claimable too: the
  // gateway reports a failure per ATTEMPT and lets the buyer pay the same
  // gateway order on the next try, so real money arriving must always be able
  // to overtake an earlier failed attempt — or one the customer closed the
  // widget on while their payment was still in flight.
  const claim = {
    status: 'paid',
    paidAt: order.paidAt || new Date(),
    receiptNo: order.receiptNo || `SVA-${Date.now().toString(36).toUpperCase()}`,
  }
  if (paymentId) claim.gatewayPaymentId = paymentId
  if (order.referralCode) claim.referralCommission = REFERRAL_COMMISSION

  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: { $in: ['created', 'failed', 'cancelled'] } },
    { $set: claim },
    { new: true }
  )

  // Losing the claim is ordinary — the other path got here first. The copy we
  // were handed was read before that write, so trust the database rather than
  // it, and only carry on for an order that really is paid (a refund landing in
  // between must not be re-granted).
  const current = claimed || (await Order.findById(order._id))
  if (!current || current.status !== 'paid') return hydrate(current || order)

  // Paid with nothing granted is the wreckage the old webhook left behind (and
  // what a crash mid-grant leaves too), so that case falls through and finishes
  // the job rather than handing back an order with no access attached.
  const granted = await hydrate(current)
  if (granted.enrollment) return granted

  // Only the caller that actually flipped the status bumps the coupon. A repair
  // pass re-enters here on an order that is already paid, and its redemption was
  // burned by whoever paid it — counting it again would exhaust a capped
  // coupon on other buyers.
  if (claimed?.couponCode) {
    await Coupon.updateOne({ code: claimed.couponCode }, { $inc: { redemptions: 1 } })
  }

  // Grant access. On an upgrade, supersede the old enrollment and PRESERVE its
  // original start — so the 7-day window and access duration anchor to the first
  // purchase, not the upgrade date.
  const pkg = await getPackageBySku(current.packageId, { includeInactive: true })
  let startsAt = new Date()
  // Retire any free trial for this product BEFORE anything else looks at the
  // student's rows. A trial is not something you upgrade from: it carries a
  // week-long expiresAt, and courseAccess anchors the student's year on their
  // EARLIEST active-or-upgraded row. Leave it in either of those states and the
  // student who just paid for a year is judged by the trial's end date — their
  // course would shut days after they bought it. 'expired' is the one status
  // anchorEnrollment ignores, which is exactly what a spent trial is.
  await Enrollment.updateMany(
    { user: userId, product: current.product, trial: true, status: { $in: ['active', 'upgraded'] } },
    { status: 'expired' }
  )

  if (current.isUpgrade) {
    const prev = await Enrollment.findOne({
      user: userId,
      product: current.product,
      trial: { $ne: true },
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
      user: userId, product: current.product, packageId: current.packageId, status: 'active',
    }).sort({ phasesUnlocked: -1 })
    if (prior) phasesUnlocked = Math.min(phasesTotal, (prior.phasesUnlocked || 1) + 1)
  }

  // Keyed on the order so one payment can only ever own one enrollment, however
  // many times this runs. (A unique index on Enrollment.order would make that a
  // guarantee rather than a very small window — see the handoff.)
  const enrollment = await Enrollment.findOneAndUpdate(
    { order: current._id },
    {
      $setOnInsert: {
        user: userId,
        product: current.product,
        packageId: current.packageId,
        packageName: pkg?.name || current.packageLabel,
        paymentMode: pkg?.paymentMode || 'one-time',
        phasesUnlocked,
        phasesTotal,
        startsAt,
        expiresAt: pkg?.durationDays
          ? new Date(new Date(startsAt).getTime() + pkg.durationDays * 86400000)
          : null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )

  // A pay-as-you-use student holds one enrollment per phase paid for. Retire the
  // earlier one so exactly one active enrollment carries the current access.
  if (perPhase) {
    await Enrollment.updateMany(
      { user: userId, product: current.product, packageId: current.packageId,
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
        receiptNo: current.receiptNo,
        item: current.packageLabel,
        amount: current.amount,
        date: current.paidAt,
      })
    }
  } catch (err) {
    console.error('✗ Failed to send receipt email:', err.message)
  }

  return { order: current, enrollment }
}

/**
 * Ask the gateway how an order stands and grant access if it is paid. The
 * browser calls this whenever the checkout window closes, whatever it said,
 * because only the gateway knows whether money moved. In MOCK mode the client
 * omits paymentId/signature and the server simulates a successful payment.
 */
export async function verifyAndComplete({ userId, orderId, paymentId, signature }) {
  const order = await Order.findOne({ _id: orderId, user: userId })
  if (!order) throw httpError('Order not found', 404)
  // Already paid: there is nothing left to verify, and a browser reload arrives
  // here without a payment id, so re-checking the signature would only mark a
  // good order failed. Hand it to the completer instead, which returns what was
  // granted — idempotent.
  if (order.status === 'paid') {
    return await completePaidOrder(order, { paymentId: order.gatewayPaymentId })
  }
  // Neither a failed attempt nor a closed widget shuts the order. The gateway
  // records a failure per attempt and the checkout offers to reopen the widget
  // on the same gateway order, so a later attempt succeeding must still be able
  // to land here. Only a refunded order is genuinely done with.
  if (!['created', 'failed', 'cancelled'].includes(order.status))
    throw httpError('This order can no longer be paid', 400)

  // MOCK: synthesize the payment the widget would have returned.
  if (gateway.GATEWAY === 'mock' && (!paymentId || !signature)) {
    const sim = gateway.simulatePayment(order.gatewayOrderId)
    paymentId = sim.paymentId
    signature = sim.signature
  }

  const outcome = await gateway.checkPayment({
    gatewayOrderId: order.gatewayOrderId,
    amount: order.amount,
    paymentId,
    signature,
  })

  if (outcome.status === 'paid') {
    return await completePaidOrder(order, { paymentId: outcome.paymentId })
  }

  // The bank has the request but has not answered. The order stays open so the
  // webhook can grant it the moment the answer lands.
  if (outcome.status === 'pending') {
    throw httpError(
      'Your bank has not confirmed this payment yet. If money has left your account, your purchase activates on its own within a few minutes — you can check it under your orders.',
      409,
      'PAYMENT_PENDING'
    )
  }

  // Closed the window without paying: an abandoned basket, parked the same way
  // cancelOrder parks one. Nothing is shown for it.
  if (outcome.status === 'not_attempted') {
    await Order.updateOne({ _id: order._id, status: 'created' }, { $set: { status: 'cancelled', cancelledAt: new Date() } })
    throw httpError('The payment was not completed', 409, 'PAYMENT_NOT_COMPLETED')
  }

  // Guarded, because the webhook may have recorded a genuine capture on this
  // order while the browser was asking, and money that has arrived outranks an
  // attempt that did not.
  await Order.updateOne(
    { _id: order._id, status: { $in: ['created', 'failed', 'cancelled'] } },
    { $set: { status: 'failed' } }
  )
  throw httpError(outcome.message || 'Payment verification failed', 400, 'PAYMENT_FAILED')
}

/**
 * The customer closed the checkout. Park the order so it stops reading as a
 * payment we are still waiting on — an abandoned basket is not "pending".
 *
 * Only an order still sitting at 'created' moves: one already paid, failed or
 * refunded has an outcome of its own, and a dismissed widget must never
 * overwrite it. Silent by design, since the browser fires this on its way out
 * and nothing is waiting to read the answer.
 */
export async function cancelOrder({ userId, orderId }) {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, user: userId, status: 'created' },
    { $set: { status: 'cancelled', cancelledAt: new Date() } },
    { new: true }
  )
  return { ok: true, status: order?.status || null }
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
  if (!ctx?.currentPkg) return { hasEnrollment: false, canUpgrade: false, options: [], packages: {} }

  const current = ctx.currentPkg
  const catalogue = await listPackagesByProduct(product)
  const standings = await Promise.all(catalogue.map(async (p) => [p, await standingFor(userId, p, ctx)]))

  // Every plan of the course with what this student may do about it, keyed by
  // sku — the pricing cards label their buttons from this.
  const packages = Object.fromEntries(
    standings.map(([p, s]) => {
      const amount =
        s.state === 'upgrade' ? Math.max(0, basePrice(p) - s.credit)
          : s.state === 'next-phase' ? basePrice(p)
            : null
      return [p.sku, { ...s, amount, rupees: amount == null ? null : rupees(amount) }]
    })
  )

  // The upgrade offer names only plans still on sale that the checkout would
  // actually sell them.
  const options = standings
    .filter(([p, s]) => s.state === 'upgrade' && p.listed)
    .map(([p, s]) => {
      const credit = s.credit
      const base = basePrice(p)
      const amount = Math.max(0, base - credit)
      // The same step at list prices — what the move up would cost with no
      // offer running. Shown beside `amount` as the "instead of" price, so it
      // is only worth printing while it is the bigger of the two.
      const listAmount = Math.max(0, p.price - current.price)
      return {
        packageId: p.sku,
        name: p.name,
        basePrice: base,
        credit,
        amount,
        listAmount,
        rupees: {
          basePrice: rupees(base),
          credit: rupees(credit),
          amount: rupees(amount),
          listAmount: rupees(listAmount),
        },
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
    reopenUntil: ctx.reopenUntil,
    courseStarted: ctx.courseStarted,
    courseStartedAt: ctx.courseStartedAt,
    withinWindow: ctx.withinWindow,
    windowEndsAt: ctx.windowEndsAt,
    daysLeft: ctx.daysLeft,
    canUpgrade: ctx.withinWindow && options.length > 0,
    options,
    packages,
  }
}

// --- Admin -------------------------------------------------------------------

export async function adminListOrders({ status, page, limit } = {}) {
  const q = status ? { status } : {}
  const p = pageOf({ page, limit })
  const [items, total] = await Promise.all([
    Order.find(q).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).populate('user', 'name email'),
    Order.countDocuments(q),
  ])
  return pageResult(items, total, p)
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
  // An order taken by a gateway we no longer run (Razorpay, before Cashfree)
  // cannot be refunded through the current one.
  if ((order.gateway || 'mock') !== gateway.GATEWAY) {
    throw httpError(
      `This order was paid through ${order.gateway}. Refund it from that gateway's dashboard.`,
      400,
      'GATEWAY_MISMATCH'
    )
  }

  await gateway.refund({
    gatewayOrderId: order.gatewayOrderId,
    paymentId: order.gatewayPaymentId,
    amount: order.amount,
  })

  order.status = 'refunded'
  order.refundedAt = new Date()
  order.refundReason = reason || 'Refunded by admin'
  await order.save()

  // Revoke the access that this order granted
  await Enrollment.updateMany({ order: order._id }, { status: 'revoked' })
  return order
}

export async function createCoupon(data) {
  // A coupon code is what the customer types, so a clash is an ordinary mistake
  // an admin makes, not a system fault. Check first for the clear message, and
  // keep the 11000 catch as the backstop for two admins saving at once.
  const code = String(data.code || '').trim().toUpperCase()
  const clash = await Coupon.findOne({ code })
  if (clash) {
    throw httpError(`A coupon called ${code} already exists. Pick a different code.`, 409, 'COUPON_EXISTS')
  }
  try {
    return await Coupon.create(data)
  } catch (e) {
    if (e?.code === 11000) {
      throw httpError(`A coupon called ${code} already exists. Pick a different code.`, 409, 'COUPON_EXISTS')
    }
    throw e
  }
}

export async function listCoupons({ page, limit } = {}) {
  const p = pageOf({ page, limit })
  const [items, total] = await Promise.all([
    Coupon.find().sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
    Coupon.countDocuments({}),
  ])
  return pageResult(items, total, p)
}

/**
 * Switch a coupon on or off by hand.
 *
 * Turning it off rather than deleting it: the code may already be printed on a
 * flyer or sitting in somebody's inbox, and the orders that used it still refer
 * to it. validateCoupon already refuses an inactive coupon, so this is the only
 * flag that has to move — and it can be moved back.
 */
export async function setCouponActive(id, active) {
  const coupon = await Coupon.findByIdAndUpdate(id, { $set: { active: !!active } }, { new: true })
  if (!coupon) throw httpError('Coupon not found', 404)
  return coupon
}

// --- Webhook -----------------------------------------------------------------

/**
 * Process a Cashfree payment webhook (PAYMENT_SUCCESS_WEBHOOK and friends).
 * Signature is verified by the controller. Idempotent by design. Anything else
 * Cashfree sends — the dashboard's test event, refund updates — is acknowledged
 * and ignored.
 */
export async function handleWebhookEvent(event) {
  const type = event?.type
  const gatewayOrderId = event?.data?.order?.order_id
  const payment = event?.data?.payment || {}

  // A successful payment must grant exactly what the browser path grants. The
  // browser coming back is not guaranteed — a closed tab or a dropped network
  // kills it — and this event is then the only word we get that the money
  // arrived. Every status a payment can still be completed from is passed
  // through: 'failed' because an earlier attempt on the same gateway order lost
  // and this one won, and 'paid' because the gateway retries this delivery until
  // we answer 2xx, so a retry has to be able to finish a grant that died halfway.
  if (type === 'PAYMENT_SUCCESS_WEBHOOK' && gatewayOrderId && payment.payment_status === 'SUCCESS') {
    const order = await Order.findOne({ gatewayOrderId })
    if (order && ['created', 'failed', 'cancelled', 'paid'].includes(order.status)) {
      await completePaidOrder(order, { paymentId: String(payment.cf_payment_id) })
    }
  }

  // A failed attempt parks an order that is still waiting to be paid, so the
  // checkout stops offering to resume something the gateway has given up on.
  // Parked, not closed: the buyer can pay the same gateway order on the next
  // attempt, and a later success takes it back to 'paid' from either path. Only
  // a 'created' order is touched, so a failed event arriving after a successful
  // attempt cannot undo the paid order.
  if (type === 'PAYMENT_FAILED_WEBHOOK' && gatewayOrderId) {
    await Order.updateOne({ gatewayOrderId, status: 'created' }, { $set: { status: 'failed' } })
  }

  // The customer walked away from the checkout — the same abandoned basket the
  // browser reports through cancelOrder, for when the browser never got to.
  if (type === 'PAYMENT_USER_DROPPED_WEBHOOK' && gatewayOrderId) {
    await Order.updateOne(
      { gatewayOrderId, status: 'created' },
      { $set: { status: 'cancelled', cancelledAt: new Date() } }
    )
  }

  return { received: true }
}
