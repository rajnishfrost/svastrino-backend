import crypto from 'node:crypto'
import Razorpay from 'razorpay'

/**
 * Payment gateway abstraction. Set GATEWAY=razorpay + RAZORPAY_KEY_ID/SECRET to
 * use real Razorpay; otherwise it's a MOCK that mimics Razorpay's shape (order
 * id, payment id, HMAC signature, webhook signature) so local dev works without
 * keys. Both share the same verify formula, so the app code never branches:
 *   signature = HMAC_SHA256(`${orderId}|${paymentId}`, keySecret)
 *
 * Amounts are in PAISE.
 */
export const GATEWAY = process.env.GATEWAY || 'mock'
const MOCK_SECRET = process.env.MOCK_GATEWAY_SECRET || 'mock_secret_key'
const PUBLIC_KEY = process.env.RAZORPAY_KEY_ID || 'rzp_test_mock'

const rid = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`
const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('hex')

// Lazily-created, cached Razorpay client (only when GATEWAY=razorpay).
let _rzp = null
function razorpay() {
  if (_rzp) return _rzp
  const key_id = process.env.RAZORPAY_KEY_ID
  const key_secret = process.env.RAZORPAY_KEY_SECRET
  if (!key_id || !key_secret) {
    throw new Error('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing)')
  }
  _rzp = new Razorpay({ key_id, key_secret })
  return _rzp
}

/** The public key id the client checkout needs. */
export function publicKey() {
  return PUBLIC_KEY
}

/** Create a gateway order. Returns { id }. */
export async function createOrder({ amount, currency = 'INR', receipt }) {
  if (GATEWAY === 'razorpay') {
    // Razorpay expects the amount in paise (integer). notes are optional.
    const order = await razorpay().orders.create({ amount: Math.round(amount), currency, receipt })
    return { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt }
  }
  return { id: rid('order'), amount, currency, receipt }
}

/**
 * MOCK ONLY — simulate the payment the client-side Razorpay widget would return
 * on success. Real Razorpay: the browser widget returns these; there is no
 * server-side "simulate".
 */
export function simulatePayment(gatewayOrderId) {
  const paymentId = rid('pay')
  const signature = sign(`${gatewayOrderId}|${paymentId}`, MOCK_SECRET)
  return { paymentId, signature }
}

/** Verify a payment signature. Same formula for mock and Razorpay. */
export function verifyPayment({ gatewayOrderId, paymentId, signature }) {
  if (!gatewayOrderId || !paymentId || !signature) return false
  const secret = GATEWAY === 'razorpay' ? process.env.RAZORPAY_KEY_SECRET : MOCK_SECRET
  const expected = sign(`${gatewayOrderId}|${paymentId}`, secret)
  // constant-time compare
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Refund a payment. Returns a refund record. */
export async function refund({ paymentId, amount }) {
  if (GATEWAY === 'razorpay') {
    const r = await razorpay().payments.refund(paymentId, { amount: Math.round(amount) })
    return { id: r.id, paymentId, amount: r.amount, status: r.status }
  }
  return { id: rid('rfnd'), paymentId, amount, status: 'processed' }
}

/** Verify a webhook signature (Razorpay sends X-Razorpay-Signature). */
export function verifyWebhook(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || MOCK_SECRET
  const expected = sign(rawBody, secret)
  if (!signature) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
