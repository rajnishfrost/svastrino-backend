import { Organisation } from './organisation.model.js'
import { Order } from '../payments/order.model.js'
import { Enrollment } from '../payments/enrollment.model.js'
import { User } from '../credentials/credentials.model.js'

/**
 * Seats: how many students an institution has paid for.
 *
 * Every paid institution order adds its quantity to `org.seats`. An
 * institution made before seats existed has `seats: null` and no limit at all.
 */

/**
 * The students taking up a seat: everyone on the roster now, plus anyone who
 * has left it but already received the sponsored course. A seat is spent when
 * the course is handed out, so removing a student and adding another does not
 * give the course away twice.
 */
export async function seatsUsed(orgId) {
  const [members, granted] = await Promise.all([
    User.find({ organisation: orgId, organisationRole: 'member' }).distinct('_id'),
    Enrollment.find({ sponsoredBy: orgId }).distinct('user'),
  ])
  return new Set([...members, ...granted].map(String)).size
}

/** { total, used, left } — null when the institution has no limit. */
export async function seatSummary(org) {
  if (org?.seats == null) return null
  const used = await seatsUsed(org._id)
  return { total: org.seats, used, left: Math.max(0, org.seats - used) }
}

/**
 * Add a paid institution order's seats to its institution, once. Claimed on
 * the order itself, so the webhook and the browser both finishing the same
 * payment still add them only once. Also makes the order's course the one the
 * institution sponsors — the seats are seats on that course.
 */
export async function grantSeats(order) {
  if (order?.kind !== 'institution' || !order.organisation) return
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: 'paid', seatsGranted: { $ne: true } },
    { $set: { seatsGranted: true } },
    { new: true }
  )
  if (!claimed) return
  await Organisation.updateOne(
    { _id: claimed.organisation },
    [{ $set: { seats: { $add: [{ $ifNull: ['$seats', 0] }, claimed.quantity || 0] }, packages: [claimed.packageId], awaitingPayment: false } }]
  )
}
