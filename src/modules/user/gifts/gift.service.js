import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { Order } from '../payments/order.model.js'
import { Coupon } from '../payments/coupon.model.js'
import * as gateway from '../payments/gateway.js'
import { User } from '../credentials/credentials.model.js'
import { EMAIL_RE } from '../../../utils/validate.js'
import { sendGiftCouponsEmail } from '../../../utils/mailer.js'

/**
 * Gift coupons — anyone buys coupons to hand to a younger sibling or a friend
 * (footer → /gift-coupons). No account is needed: the buyer gives an email the
 * coupons are sent to (their copy if they lose them), and that email is kept on
 * the order and on every coupon so a purchase can always be traced. A buyer who
 * is signed in also has the order linked to their account. Each coupon:
 *   • is worth one of GIFT_VALUES — or any whole-rupee amount from ₹100 to
 *     ₹99,999 the buyer types — off ANY course or programme at checkout,
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
// Or any whole-rupee amount the buyer types, ₹100 to ₹99,999.
export const GIFT_MIN = 10000
export const GIFT_MAX = 9999900
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
    custom: { min: GIFT_MIN / 100, max: GIFT_MAX / 100 }, // rupees
    maxQuantity: MAX_GIFT_QUANTITY,
    validDays: GIFT_VALID_DAYS,
  }
}

/**
 * Start buying `quantity` coupons worth `value` paise, emailed to `email`.
 * `userId` is set when the buyer is signed in, null otherwise. Returns the
 * order's secret `giftToken`, which the browser uses to confirm the payment and
 * read the coupons (see verifyGiftOrder / getGiftByToken).
 */
export async function createGiftOrder({ userId = null, value, quantity, email }) {
  value = Number(value)
  quantity = Number(quantity)
  const to = String(email || '').trim().toLowerCase()
  // A whole number of rupees in range: the fixed values are all inside it.
  if (!Number.isInteger(value) || value % 100 !== 0 || value < GIFT_MIN || value > GIFT_MAX) {
    throw httpError(`Enter a coupon value from ₹${GIFT_MIN / 100} to ₹${(GIFT_MAX / 100).toLocaleString('en-IN')}, in whole rupees`, 400)
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_GIFT_QUANTITY) {
    throw httpError(`You can buy 1 to ${MAX_GIFT_QUANTITY} coupons at a time`, 400)
  }
  if (!EMAIL_RE.test(to)) throw httpError('Enter a valid email address for your coupons', 400)

  // Signed in: link the account (a stale session of a deleted account is
  // simply treated as a guest). Not signed in: the email is the buyer.
  const buyer = userId ? await User.findById(userId).select('name email phone') : null

  const amount = value * quantity
  const label = `Gift coupon ${inr(value)} × ${quantity}`
  const _id = new mongoose.Types.ObjectId()
  const giftToken = crypto.randomBytes(24).toString('hex')
  const gatewayOrder = await gateway.createOrder({
    amount,
    currency: 'INR',
    receipt: `rcpt_${crypto.randomBytes(6).toString('hex')}`,
    customer: {
      id: buyer ? String(buyer._id) : `guest_${_id}`,
      name: buyer?.name || '',
      email: buyer?.email || to,
      phone: buyer?.phone,
    },
    // Only when Cashfree takes the buyer away to pay (an in-app browser): back
    // to the gift page, which reads this order's coupons with its token.
    returnUrl: `${clientUrl()}/gift-coupons?order=${_id}&t=${giftToken}`,
  })

  const order = await Order.create({
    _id,
    user: buyer?._id || null,
    giftToken,
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
    giftToken,
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
          purchasedBy: order.user || null,
          purchaserEmail: order.giftEmail,
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
      const buyer = order.user ? await User.findById(order.user).select('name') : null
      await sendGiftCouponsEmail(order.giftEmail, {
        name: buyer?.name,
        downloadUrl: ticketsUrl(order),
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

/**
 * The printable tickets page for a gift order — the email's "Download your
 * coupons" button. Served by our API on the site's own address, opened with the
 * order's secret token (the email is the buyer's), so it works with no account.
 */
export function ticketsUrl(order) {
  return `${clientUrl()}/api/user/gifts/orders/${order._id}/tickets?t=${order.giftToken}`
}

const escHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const dayGb = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * A standalone page of the order's coupons as tickets, ready to save as PDF —
 * the same design as the site's Download (client/src/utils/giftTicket.js) and
 * the tickets on /gift-coupons. Used and expired coupons are shown stamped.
 */
export function ticketsPageHtml(gift, nonce) {
  // Relative: on the live site the API and the site share one address.
  const logo = '/logo-256.png'
  const tickets = gift.coupons.map((c) => {
    const off = c.status !== 'active'
    return `
  <div class="t${off ? ' off' : ''}">
    <div class="stub"><span class="tag">Gift coupon</span><span class="val">${escHtml(inr(c.value))}</span><span class="sub">off any course</span><span class="stars">✦ ✦ ✦</span></div>
    <span class="notch a"></span><span class="notch b"></span>
    <div class="main">
      <div class="brand"><img src="${escHtml(logo)}" alt="Svastrino"><span>svastrino.com</span></div>
      <p class="title">A gift for your journey</p>
      <div class="code">${escHtml(c.code)}</div>
      <p class="meta">Valid till <strong>${escHtml(dayGb(c.expiresAt))}</strong> &nbsp;•&nbsp; One-time use</p>
      <p class="how">Enter the code in the coupon box at checkout on svastrino.com — it comes off any course or programme.</p>
    </div>
    ${off ? `<span class="stamp">${c.status === 'used' ? 'Used' : c.status === 'expired' ? 'Expired' : 'Off'}</span>` : ''}
  </div>`
  }).join('')
  const n = gift.coupons.length
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Svastrino gift coupon${n === 1 ? '' : 's'}</title>
<style>
  *{box-sizing:border-box} body{margin:0;padding:28px 16px;background:#fff;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f2c5c}
  h1{font-size:20px;margin:0 0 4px;text-align:center} .lead{margin:0 auto 24px;max-width:640px;color:#64748b;font-size:14px;text-align:center}
  .t{--stub:34%;position:relative;display:flex;max-width:640px;min-height:190px;margin:0 auto 22px;border-radius:18px;border:1px solid #e3d9c4;break-inside:avoid;page-break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .stub{flex:0 0 var(--stub);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:2px;padding:20px 12px;border-radius:17px 0 0 17px;color:#fff;text-align:center;background:radial-gradient(circle at 18% 18%,rgba(240,198,116,.28),transparent 42%),radial-gradient(circle at 85% 90%,rgba(200,16,46,.35),transparent 45%),linear-gradient(150deg,#0f2c5c,#0a1f43)}
  .tag{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#f0c674} .val{font-size:34px;font-weight:800;line-height:1.1} .sub{font-size:12px;color:#c9d3e6} .stars{margin-top:8px;font-size:10px;letter-spacing:6px;color:rgba(240,198,116,.75)}
  .main{flex:1;min-width:0;padding:18px 20px 16px 24px;border-radius:0 17px 17px 0;background:#fffaf0;border-left:2px dashed rgba(15,44,92,.25)}
  .notch{position:absolute;left:var(--stub);width:24px;height:24px;border-radius:50%;background:#fff;transform:translateX(-50%);border:1px solid #e3d9c4} .notch.a{top:-13px;border-top-color:#fff} .notch.b{bottom:-13px;border-bottom-color:#fff}
  .brand{display:flex;justify-content:space-between;align-items:center} .brand img{height:26px} .brand span{font-size:11.5px;font-weight:700;letter-spacing:.06em;color:#8a7f6a}
  .title{margin:10px 0 8px;font-size:13px;font-weight:700;letter-spacing:.04em;color:#c8102e;text-transform:uppercase}
  .code{display:inline-block;padding:7px 12px;border:1.5px dashed rgba(15,44,92,.35);border-radius:10px;background:#fff;font-family:'Courier New',monospace;font-size:20px;font-weight:800;letter-spacing:.12em}
  .meta{margin:10px 0 0;font-size:12.5px;color:#475569} .how{margin:6px 0 0;font-size:12px;color:#8a7f6a}
  .off .stub,.off .main{filter:grayscale(1);opacity:.6}
  .stamp{position:absolute;top:50%;left:62%;transform:translate(-50%,-50%) rotate(-12deg);padding:6px 18px;border:3px solid #c8102e;border-radius:10px;color:#c8102e;font-size:22px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;background:rgba(255,255,255,.85)}
  .actions{text-align:center;margin-top:8px} .actions button{padding:12px 26px;border:0;border-radius:999px;background:#c8102e;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
  @media (max-width:560px){.t{flex-direction:column}.stub{height:120px;flex:0 0 auto;border-radius:17px 17px 0 0}.main{border-radius:0 0 17px 17px;border-left:0;border-top:2px dashed rgba(15,44,92,.25);padding:16px}.notch{left:auto;top:120px;transform:translateY(-50%)}.notch.a{left:-13px;border-left-color:#fff;border-top-color:#e3d9c4}.notch.b{right:-13px;bottom:auto;border-right-color:#fff;border-bottom-color:#e3d9c4}.stamp{left:50%;top:62%}}
  @media print{body{padding:0}.actions,.lead{display:none}}
</style></head><body>
  <h1>Your Svastrino gift coupon${n === 1 ? '' : 's'}</h1>
  <p class="lead">Tap <strong>Download / Save as PDF</strong>, then hand a coupon on. Each code works once, for a year.</p>
  ${tickets}
  <div class="actions"><button id="dl" type="button">Download / Save as PDF</button></div>
  <script nonce="${escHtml(nonce)}">
    document.getElementById('dl').addEventListener('click', function () { window.print() })
    window.addEventListener('load', function () { setTimeout(function () { window.print() }, 500) })
  </script>
</body></html>`
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

/**
 * Every gift this account has bought, newest first, with each coupon's state —
 * including ones bought without signing in to the same email.
 */
export async function listGifts(userId) {
  const me = await User.findById(userId).select('email')
  const who = [{ user: userId }]
  if (me?.email) who.push({ giftEmail: me.email })
  const orders = await Order.find({ kind: 'gift', status: 'paid', $or: who }).sort({ paidAt: -1 }).limit(100)
  const out = []
  for (const o of orders) out.push(giftOrderDTO(o, await issueGiftCoupons(o)))
  return out
}

/** One gift order, for whoever holds its secret token (signed in or not). */
export async function getGiftByToken(orderId, token) {
  const order = await Order.findOne({ _id: orderId, kind: 'gift' })
  const given = Buffer.from(String(token || ''))
  const kept = Buffer.from(String(order?.giftToken || ''))
  if (!order || !kept.length || given.length !== kept.length || !crypto.timingSafeEqual(given, kept)) {
    throw httpError('Gift order not found', 404)
  }
  if (order.status !== 'paid') throw httpError('This gift order is not paid yet', 409, 'NOT_PAID')
  return giftOrderDTO(order, await issueGiftCoupons(order))
}

/** One gift order of this student's — the page shows it right after paying. */
export async function getGift(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, user: userId, kind: 'gift' })
  if (!order) throw httpError('Gift order not found', 404)
  if (order.status !== 'paid') throw httpError('This gift order is not paid yet', 409, 'NOT_PAID')
  return giftOrderDTO(order, await issueGiftCoupons(order))
}
