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
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },

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

    startsAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, default: null }, // null = lifetime / one-time
  },
  { timestamps: true }
)

export const Enrollment =
  mongoose.models.Enrollment || mongoose.model('Enrollment', enrollmentSchema)
