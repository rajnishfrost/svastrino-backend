import crypto from 'node:crypto'
import { Order } from '../payments/order.model.js'
import { Package } from '../skillbuild/package.model.js'
import { getPackageBySku } from '../skillbuild/skillbuild.service.js'
import * as gateway from '../payments/gateway.js'
import { grantSeats } from './seats.js'
import { sendInstitutionPaymentEmail } from '../../../utils/mailer.js'
import { str } from '../../../utils/validate.js'

/**
 * An institution buying seats: made by an admin when they add the institution.
 *
 *   cash    — the admin has the money in hand. The order is paid the moment it
 *             is made and the seats land with it.
 *   online  — the order waits for payment. The institution is emailed a link
 *             to /pay/<token>, pays there through Cashfree, and the same
 *             completion as a student's purchase (browser or webhook) marks it
 *             paid, keeps Cashfree's payment id, and adds the seats.
 *
 * Either way it is an ordinary Order, so it is listed on the Orders page with
 * everything else.
 */

const httpError = (message, status, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })
const clientUrl = () =>
  (process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5174').replace(/\/$/, '')

export const MAX_SEATS = 100000
const MAX_TOTAL_INR = 10_000_000 // ₹1 crore — a typo guard, not a business rule

/**
 * Check what the admin filled in, before anything is created. Returns the
 * cleaned purchase: { packageId, students, amount (paise), method, reference }.
 */
export async function validateInstitutionPurchase(p = {}) {
  const packageId = str(p.packageId, 80)
  if (!packageId) throw httpError('Choose the course the institution is buying.', 400)
  // One of the pay-once course plans. Pay-as-you-use plans sell a phase at a
  // time to a student; seats bought in bulk are for the whole course.
  const pkg = await Package.findOne({ sku: packageId, active: true }).populate('skillBuild', 'kind')
  if (!pkg || pkg.skillBuild?.kind === 'mentoring' || pkg.paymentMode === 'per-phase') {
    throw httpError('That course is not available for institutions.', 400)
  }

  const students = Number(p.students)
  if (!Number.isInteger(students) || students < 1 || students > MAX_SEATS) {
    throw httpError('Enter the number of students — a whole number, at least 1.', 400)
  }

  const totalInr = Number(p.totalInr)
  if (!Number.isFinite(totalInr) || totalInr < 0 || totalInr > MAX_TOTAL_INR) {
    throw httpError('Enter the total amount in rupees.', 400)
  }
  const amount = Math.round(totalInr * 100)

  const method = p.method === 'cash' ? 'cash' : p.method === 'online' ? 'online' : null
  if (!method) throw httpError('Choose how the institution is paying: cash or digital.', 400)
  // Cashfree does not take an order for less than a rupee.
  if (method === 'online' && amount < 100) throw httpError('An online payment has to be at least ₹1.', 400)

  return { packageId, students, amount, method, reference: str(p.reference, 120) }
}

/**
 * Make the institution's order. `purchase` is the output of
 * validateInstitutionPurchase. Returns { order, payLink } — payLink only for an
 * online payment, for the admin to copy as well.
 */
export async function createInstitutionOrder({ org, owner, purchase, adminId = null }) {
  const pkg = await getPackageBySku(purchase.packageId)
  if (!pkg) throw httpError('That course is not available for institutions.', 400)
  const base = {
    user: owner._id,
    kind: 'institution',
    organisation: org._id,
    quantity: purchase.students,
    paymentMethod: purchase.method,
    reference: purchase.reference || '',
    createdBy: adminId,
    packageId: pkg.sku,
    packageLabel: `${pkg.label} × ${purchase.students} student${purchase.students === 1 ? '' : 's'}`,
    product: pkg.product,
    listPrice: purchase.amount,
    basePrice: purchase.amount,
    amount: purchase.amount,
  }

  if (purchase.method === 'cash') {
    const order = await Order.create({
      ...base,
      status: 'paid',
      gateway: 'cash',
      paidAt: new Date(),
      receiptNo: `SVA-${Date.now().toString(36).toUpperCase()}`,
    })
    await grantSeats(order)
    return { order, payLink: null }
  }

  const payToken = crypto.randomBytes(24).toString('hex')
  const gw = await gateway.createOrder({
    amount: purchase.amount,
    currency: 'INR',
    receipt: `inst_${crypto.randomBytes(6).toString('hex')}`,
    customer: { id: owner._id, name: org.name, email: org.email, phone: org.phone },
    returnUrl: `${clientUrl()}/pay/${payToken}`,
  })
  const payLink = `${clientUrl()}/pay/${payToken}`
  const order = await Order.create({
    ...base,
    status: 'created',
    gateway: gateway.GATEWAY,
    gatewayOrderId: gw.id,
    payToken,
    payLink,
  })

  // Best effort: the admin is shown the link too, and can send it themselves.
  sendInstitutionPaymentEmail(org.email, {
    organisation: org.name,
    course: pkg.label,
    students: purchase.students,
    amountInr: purchase.amount / 100,
    link: payLink,
  }).catch((e) => console.error(`✗ institution payment email to ${org.email} failed:`, e.message))

  return { order, payLink }
}
