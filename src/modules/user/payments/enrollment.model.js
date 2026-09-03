import mongoose from 'mongoose'

/**
 * Access granted to a user after a successful payment. This is what the app
 * checks to decide "does this user own the Clarity package?". Created on order
 * `paid`, revoked (status='revoked') on refund.
 */
const enrollmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // One payment grants exactly one enrollment. The unique index is what makes
    // that true even when the browser callback and the gateway webhook complete
    // the same order at the same moment — without it the guard is a race.
    //
    // The index is PARTIAL because a free trial is an enrollment nobody paid
    // for, so it has no order at all. A plain `unique: true` counts a missing
    // field as null and treats every trial as a duplicate of the first one; the
    // filter below keeps the one-payment-one-enrollment guarantee while leaving
    // order-less rows alone. Changing this needs the old `order_1` index
    // dropped — see scripts/fixEnrollmentOrderIndex.js.
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: { unique: true, partialFilterExpression: { order: { $type: 'objectId' } } },
    },

    product: { type: String, required: true },   // 'nirmaan'
    packageId: { type: String, required: true },  // 'nirmaan-clarity'
    packageName: { type: String, required: true },// 'Clarity'

    // 'upgraded' = superseded by a higher tier the user moved up to (access moved
    // to the new enrollment). 'revoked' = refunded. 'expired' = access lapsed.
    status: {
      type: String,
      enum: ['active', 'revoked', 'expired', 'upgraded'],
      default: 'active',
      index: true,
    },
    // Phase-wise access. A one-time plan opens every phase at once; a
    // per-phase plan starts at 1 and grows by one with each further payment.
    paymentMode: { type: String, enum: ['one-time', 'per-phase'], default: 'one-time' },
    phasesUnlocked: { type: Number, default: 1 },
    phasesTotal: { type: Number, default: 1 },

    // A free trial, granted on sign-up from the Nirmaan page rather than bought.
    // It is deliberately a NORMAL enrollment so every gate already in the code —
    // package rank, phase access, the expiry dates in courseAccess — judges it
    // exactly like a purchase and none of them needed a second code path. What
    // makes it a trial is only its package: a week long, one phase open.
    // Retired the moment the student actually buys the course (payments.service).
    trial: { type: Boolean, default: false, index: true },

    startsAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, default: null }, // null = lifetime / one-time
  },
  { timestamps: true }
)

export const Enrollment =
  mongoose.models.Enrollment || mongoose.model('Enrollment', enrollmentSchema)
