import crypto from 'node:crypto'
import { Order } from '../payments/order.model.js'
import { Coupon } from '../payments/coupon.model.js'
import * as gateway from '../payments/gateway.js'
import { User } from '../credentials/credentials.model.js'
import { EMAIL_RE } from '../../../utils/validate.js'
import { sendGiftCouponsEmail } from '../../../utils/mailer.js'

/**
 * Gift coupons — a student buys coupons to hand to a younger sibling or a
 * friend (footer → /gift-coupons). Each coupon:
 *   • is worth one of GIFT_VALUES off ANY course or programme at checkout,
 *   • costs its face value,
 *   • works ONCE, for a year from the day it was bought,
 *   • counts as used only when the purchase it is applied to completes — the
 *     ordinary coupon rule (completePaidOrder bumps `redemptions` on payment).
 *
 * Buying is an Order of `kind: 'gift'`, paid through the same gateway as any
 * course, so the browser confirm and the webhook both end in completePaidOrder,
 * which calls issueGiftCoupons. That is idempotent: however often it runs, an
 * order owns exactly `quantity` coupons and is emailed once.
 */

export const GIFT_VALUES = [50000, 100000, 200000, 450000] // paise: ₹500 · ₹1,000 · ₹2,000 · ₹4,500
export const MAX_GIFT_QUANTITY = 10
export const GIFT_VALID_DAYS = 365

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

const clientUrl = () =>
  (process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5174').replace(/\/$/, '')

const inr = (paise) => '₹' + (Number(paise) / 100).toLocaleString('en-IN')

// Codes are read aloud and typed from a screenshot, so no 0/O, 1/I/L.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function newCode() {
  const bytes = crypto.randomBytes(8)
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')
  return `GIFT-${chars.slice(0, 4)}-${chars.slice(4)}`
}

/** What the page offers before anyone signs in. */
export function giftOptions() {
  return {
    values: GIFT_VALUES.map((v) => ({ value: v, rupees: v / 100 })),
    maxQuantity: MAX_GIFT_QUANTITY,
    validDays: GIFT_VALID_DAYS,
  }
}

/** Start buying `quantity` coupons worth `value` paise, emailed to `email`. */
export async function createGiftOrder({ userId, value, quantity, email }) {
  value = Number(value)
  quantity = Number(quantity)
  const to = String(email || '').trim().toLowerCase()
  if (!GIFT_VALUES.includes(value)) throw httpError('Pick one of the coupon values shown', 400)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_GIFT_QUANTITY) {
    throw httpError(`You can buy 1 to ${MAX_GIFT_QUANTITY} coupons at a time`, 400)
  }
  if (!EMAIL_RE.test(to)) throw httpError('Enter a valid email address for your coupons', 400)

  const buyer = await User.findById(userId).select('name email phone')
  if (!buyer) throw httpError('Please sign in again to buy gift coupons', 401, 'ACCOUNT_NOT_FOUND')

  const amount = value * quantity
  const label = `Gift coupon ${inr(value)} × ${quantity}`
  const gatewayOrder = await gateway.createOrder({
    amount,
    currency: 'INR',
    receipt: `rcpt_${crypto.randomBytes(6).toString('hex')}`,
    customer: { id: userId, name: buyer.name, email: buyer.email, phone: buyer.phone },
    // Only when Cashfree takes the buyer away to pay (an in-app browser): back
    // to the gift page, which lists what they have bought.
    returnUrl: `${clientUrl()}/gift-coupons`,
  })

  const order = await Order.create({
    user: userId,
    kind: 'gift',
    quantity,
    giftValue: value,
    giftEmail: to,
    packageId: 'gift-coupon',
    packageLabel: label,
    product: 'gift',
    listPrice: amount,
    basePrice: amount,
    amount,
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
    packageLabel: label,
    mock: gateway.GATEWAY === 'mock',
  }
}

/**
 * Give a paid gift order its coupons and email them — once. Called from
 * completePaidOrder on every pass (browser confirm, webhook, repairs), so it
 * tops up to `quantity` rather than creating, and claims the email with a
 * guarded write so two passes at once still send one email.
 */
export async function issueGiftCoupons(order) {
  if (!order || order.kind !== 'gift' || order.status !== 'paid') return []
  const existing = await Coupon.find({ giftOrder: order._id }).sort({ createdAt: 1 })
  const missing = Math.max(0, (order.quantity || 1) - existing.length)
  const start = order.paidAt || new Date()
  const expiresAt = new Date(new Date(start).getTime() + GIFT_VALID_DAYS * 86400000)

  for (let i = 0; i < missing; i++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        existing.push(await Coupon.create({
          code: newCode(),
          type: 'flat',
          value: order.giftValue,
          applicablePackages: [],   // any course or programme
          active: true,
          expiresAt,
          maxRedemptions: 1,
          source: 'gift',
          giftOrder: order._id,
          purchasedBy: order.user,
        }))
        break
      } catch (err) {
        if (err?.code !== 11000 || attempt === 4) throw err // only a code collision is retried
      }
    }
  }

  // Email the coupons once. Claim first; on a failed send, release the claim so
  // the next pass (or the gift page loading) tries again.
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, giftEmailedAt: null },
    { $set: { giftEmailedAt: new Date() } },
    { new: true }
  )
  if (claimed) {
    try {
      const buyer = await User.findById(order.user).select('name')
      await sendGiftCouponsEmail(order.giftEmail, {
        name: buyer?.name,
        receiptNo: order.receiptNo,
        amount: order.amount,
        coupons: existing.map((c) => ({ code: c.code, value: c.value, expiresAt: c.expiresAt })),
      })
    } catch (err) {
      console.error('✗ Failed to send gift coupons email:', err.message)
      await Order.updateOne({ _id: order._id }, { $set: { giftEmailedAt: null } })
    }
  }
  return existing
}

/** One coupon as the buyer sees it. */
export function couponDTO(c, now = new Date()) {
  const used = c.maxRedemptions != null && c.redemptions >= c.maxRedemptions
  const expired = !!c.expiresAt && c.expiresAt < now
  return {
    code: c.code,
    value: c.value,
    rupees: c.value / 100,
    expiresAt: c.expiresAt,
    status: used ? 'used' : expired ? 'expired' : !c.active ? 'inactive' : 'active',
    usedAt: used ? c.lastRedeemedAt : null,
  }
}

function giftOrderDTO(order, coupons) {
  return {
    orderId: order._id.toString(),
    receiptNo: order.receiptNo || null,
    paidAt: order.paidAt || null,
    amount: order.amount,
    quantity: order.quantity,
    value: order.giftValue,
    email: order.giftEmail,
    coupons: coupons.map((c) => couponDTO(c)),
  }
}

/** Every gift this student has bought, newest first, with each coupon's state. */
export async function listGifts(userId) {
  const orders = await Order.find({ user: userId, kind: 'gift', status: 'paid' }).sort({ paidAt: -1 }).limit(100)
  const out = []
  for (const o of orders) out.push(giftOrderDTO(o, await issueGiftCoupons(o)))
  return out
}

/** One gift order of this student's — the page shows it right after paying. */
export async function getGift(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, user: userId, kind: 'gift' })
  if (!order) throw httpError('Gift order not found', 404)
  if (order.status !== 'paid') throw httpError('This gift order is not paid yet', 409, 'NOT_PAID')
  return giftOrderDTO(order, await issueGiftCoupons(order))
}
