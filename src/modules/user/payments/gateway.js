import crypto from 'node:crypto'

/**
 * Payment gateway abstraction. Set GATEWAY=cashfree + CASHFREE_APP_ID/SECRET_KEY
 * (and CASHFREE_ENV=production for live money; anything else is sandbox) to use
 * real Cashfree; otherwise it's a MOCK so local dev works without keys.
 *
 * Cashfree hands the browser nothing it could sign — a closed popup and a
 * refused card come back looking alike — so a payment is only ever believed
 * when the server has asked Cashfree how the order stands. The mock plays the
 * same part with an HMAC it signs and checks itself.
 *
 * Amounts are in PAISE here; Cashfree wants rupees, converted at the edge.
 */
const HAS_CF_KEYS = !!(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY)
const IS_PROD = process.env.NODE_ENV === 'production'

// Cashfree keys are the switch. Present them and Cashfree is used; GATEWAY only
// needs setting to force a choice. Without this, a server given keys but no
// GATEWAY would quietly fall back to the mock — which grants courses for free.
export const GATEWAY = process.env.GATEWAY || (HAS_CF_KEYS ? 'cashfree' : 'mock')
const MOCK_SECRET = process.env.MOCK_GATEWAY_SECRET || 'mock_secret_key'

/**
 * Sandbox or production, read off the secret key itself: Cashfree prefixes
 * them cfsk_ma_test_ and cfsk_ma_prod_. Going live is then a matter of putting
 * the production keys in — a CASHFREE_ENV left saying 'sandbox' cannot send
 * live keys to the sandbox URL, because the key wins. CASHFREE_ENV is only
 * consulted for a key that carries neither prefix.
 */
function cashfreeMode() {
  const secret = process.env.CASHFREE_SECRET_KEY || ''
  const declared = process.env.CASHFREE_ENV
  const fromKey = secret.startsWith('cfsk_ma_prod_')
    ? 'production'
    : secret.startsWith('cfsk_ma_test_')
      ? 'sandbox'
      : null
  if (fromKey && declared && declared !== fromKey) {
    console.warn(`⚠️ [payments] CASHFREE_ENV=${declared} ignored: the Cashfree secret key is a ${fromKey} key.`)
  }
  return fromKey || (declared === 'production' ? 'production' : 'sandbox')
}

const CF_MODE = cashfreeMode()
const CF_BASE = CF_MODE === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg'
const CF_API_VERSION = '2026-01-01'

const rid = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`
const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('hex')
const toRupees = (paise) => Math.round(paise) / 100

const safeEqual = (expected, given) => {
  if (!given) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(String(given))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Neither the mock nor the Cashfree sandbox takes real money — the mock approves
 * whatever it is shown, and the sandbox accepts published test cards — so on
 * the live site either one is a free course for anyone who clicks Buy. A
 * production server in that state keeps running, because the rest of the site
 * is fine, but it refuses to sell until production keys are in.
 */
const SELLING_IS_SAFE = !IS_PROD || (GATEWAY === 'cashfree' && CF_MODE === 'production')

function refuseUnlessLive() {
  if (SELLING_IS_SAFE) return
  throw Object.assign(
    new Error('Payments are not available just now. Please try again later or write to us.'),
    { status: 503, code: 'PAYMENTS_UNAVAILABLE' },
  )
}

if (!SELLING_IS_SAFE) {
  console.error(`💥[payments] Production server on ${GATEWAY === 'mock' ? 'the mock gateway' : 'Cashfree sandbox keys'} — checkout is switched off until production Cashfree keys are set.`)
} else if (GATEWAY === 'cashfree') {
  console.log(`✅ Payments: Cashfree (${CF_MODE})`)
}

function cashfreeKeys() {
  const appId = process.env.CASHFREE_APP_ID
  const secret = process.env.CASHFREE_SECRET_KEY
  if (!appId || !secret) {
    throw new Error('Cashfree is not configured (CASHFREE_APP_ID / CASHFREE_SECRET_KEY missing)')
  }
  return { appId, secret }
}

async function cashfree(path, { method = 'GET', body } = {}) {
  const { appId, secret } = cashfreeKeys()
  const res = await fetch(`${CF_BASE}${path}`, {
    method,
    headers: {
      'x-client-id': appId,
      'x-client-secret': secret,
      'x-api-version': CF_API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // Cashfree's message names the field it disliked, which is what a support
    // ticket needs; the customer only ever sees our generic wording.
    const err = new Error(`Cashfree ${method} ${path} failed: ${data?.message || res.status}`)
    err.status = 502
    err.gateway = data
    throw err
  }
  return data
}

/**
 * Cashfree refuses an order without a phone number. Ours is optional at sign
 * up, so a missing or unusable one is sent as a placeholder rather than
 * blocking the sale — checkout asks the customer for anything their bank needs.
 */
function cashfreePhone(raw) {
  const phone = String(raw || '').replace(/[\s()-]/g, '')
  if (/^[6-9]\d{9}$/.test(phone)) return phone
  if (/^\+91[6-9]\d{9}$/.test(phone)) return phone.slice(3)
  if (/^\+\d{8,15}$/.test(phone)) return phone
  return '9999999999'
}

/** Which Cashfree environment the browser checkout must open in. */
export function checkoutMode() {
  return CF_MODE
}

/**
 * Create a gateway order. `receipt` doubles as Cashfree's order_id, so it must
 * stay within 3-45 characters of letters, digits, _ and -.
 * Returns { id, sessionId } — the browser checkout opens on sessionId.
 */
export async function createOrder({ amount, currency = 'INR', receipt, customer = {}, returnUrl }) {
  refuseUnlessLive()
  if (GATEWAY === 'cashfree') {
    const order = await cashfree('/orders', {
      method: 'POST',
      body: {
        order_id: receipt,
        order_amount: toRupees(amount),
        order_currency: currency,
        customer_details: {
          customer_id: String(customer.id),
          customer_phone: cashfreePhone(customer.phone),
          ...(customer.email ? { customer_email: customer.email } : {}),
          ...(customer.name?.trim().length >= 3 ? { customer_name: customer.name.trim() } : {}),
        },
        ...(returnUrl ? { order_meta: { return_url: returnUrl } } : {}),
      },
    })
    return { id: order.order_id, sessionId: order.payment_session_id }
  }
  return { id: rid('order'), sessionId: null }
}

/**
 * MOCK ONLY — simulate a successful payment on a gateway order. Cashfree has no
 * server-side equivalent: the customer pays in Cashfree's own window.
 */
export function simulatePayment(gatewayOrderId) {
  refuseUnlessLive()
  const paymentId = rid('pay')
  const signature = sign(`${gatewayOrderId}|${paymentId}`, MOCK_SECRET)
  return { paymentId, signature }
}

/**
 * How a gateway order stands. Returns { status, paymentId, message } where
 * status is one of:
 *   'paid'          — money arrived; paymentId is set
 *   'pending'       — an attempt the bank has not answered yet (UPI, mostly)
 *   'failed'        — the latest attempt was refused; message says why
 *   'not_attempted' — the customer left without trying to pay
 *
 * `amount` (paise) is checked against what Cashfree says was charged, so an
 * order can never be granted on a payment for a different sum.
 */
export async function checkPayment({ gatewayOrderId, amount, paymentId, signature }) {
  refuseUnlessLive()
  if (GATEWAY !== 'cashfree') {
    const ok = !!(gatewayOrderId && paymentId) && safeEqual(sign(`${gatewayOrderId}|${paymentId}`, MOCK_SECRET), signature)
    return ok
      ? { status: 'paid', paymentId, message: '' }
      : { status: 'failed', paymentId: null, message: 'Payment verification failed' }
  }

  const id = encodeURIComponent(gatewayOrderId)
  const order = await cashfree(`/orders/${id}`)
  const payments = await cashfree(`/orders/${id}/payments`)
  const list = Array.isArray(payments) ? payments : []

  const success = list.find((p) => p.payment_status === 'SUCCESS')
  if (order?.order_status === 'PAID' && success) {
    if (Math.round(Number(order.order_amount) * 100) !== Math.round(amount)) {
      return { status: 'failed', paymentId: null, message: 'Paid amount does not match the order' }
    }
    return { status: 'paid', paymentId: String(success.cf_payment_id), message: '' }
  }
  if (list.some((p) => p.payment_status === 'PENDING')) {
    return { status: 'pending', paymentId: null, message: '' }
  }

  // The newest attempt decides: a refusal the customer then abandoned
  // (USER_DROPPED) is someone who walked away, not a bank that said no.
  const latest = [...list].sort(
    (a, b) => new Date(b.payment_time || 0) - new Date(a.payment_time || 0)
  )[0]
  if (latest?.payment_status === 'FAILED') {
    return { status: 'failed', paymentId: null, message: latest.payment_message || '' }
  }
  return { status: 'not_attempted', paymentId: null, message: '' }
}

/**
 * Refund a gateway order in full. Cashfree refunds against the order, and the
 * refund id is derived from it so a retried request can never refund twice.
 */
export async function refund({ gatewayOrderId, paymentId, amount }) {
  if (GATEWAY === 'cashfree') {
    const r = await cashfree(`/orders/${encodeURIComponent(gatewayOrderId)}/refunds`, {
      method: 'POST',
      body: {
        refund_amount: toRupees(amount),
        refund_id: `${gatewayOrderId}_rf`.slice(-40),
        refund_note: 'Refunded by Svastrino admin',
      },
    })
    return { id: r.cf_refund_id, paymentId, amount, status: r.refund_status }
  }
  return { id: rid('rfnd'), paymentId, amount, status: 'processed' }
}

/**
 * Verify a webhook. Cashfree signs `timestamp + raw body` with the PG secret key
 * and sends base64(HMAC-SHA256) in x-webhook-signature; the mock uses the same
 * formula with its own secret.
 */
export function verifyWebhook(rawBody, signature, timestamp) {
  if (!signature || !timestamp) return false
  // The mock's secret has a well-known default, so on a live server anyone could
  // sign a "paid" webhook with it.
  if (!SELLING_IS_SAFE) return false
  const secret = GATEWAY === 'cashfree' ? process.env.CASHFREE_SECRET_KEY : MOCK_SECRET
  if (!secret) return false
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}${rawBody}`).digest('base64')
  return safeEqual(expected, signature)
}
