import mongoose from 'mongoose'

/**
 * An Order is one purchase attempt for a package. It moves:
 *   created → paid            (successful payment, enrollment granted)
 *           → failed          (the gateway refused the payment)
 *           → cancelled       (the customer closed the checkout)
 *   paid    → refunded        (admin refund)
 *
 * 'failed' and 'cancelled' both stay claimable: the gateway reports a failure
 * per ATTEMPT and lets the same gateway order be paid on the next try, and a
 * customer who closes the widget may still have a payment in flight. Money
 * arriving always outranks either.
 *
 * All monetary fields are in PAISE. `gateway` records which provider handled it
 * ('mock' in dev, 'cashfree' with real keys; older orders may say 'razorpay';
 * 'cash' for money an admin took in person).
 *
 * `kind: 'institution'` is an institution buying seats for its students: made
 * by an admin, `user` is the institution's owner account, `quantity` the
 * number of students, and being paid adds that many seats to the institution
 * instead of enrolling anyone (see organisation/institutionOrder.js). Paid in
 * cash, it is paid the moment it is made; paid online, the institution pays
 * through the emailed link at /pay/<payToken>.
 */
const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    kind: { type: String, enum: ['self', 'institution'], default: 'self', index: true },
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', default: null, index: true },
    quantity: { type: Number, default: 1, min: 1 },
    paymentMethod: { type: String, enum: ['online', 'cash'], default: 'online' },
    // A cash receipt or other reference the admin typed in.
    reference: { type: String, trim: true, default: '' },
    // The secret in the institution's /pay/<token> link. Only for online
    // institution orders.
    payToken: { type: String, default: undefined, index: { unique: true, sparse: true } },
    // The full link as it was emailed, kept so the admin can see and copy it.
    payLink: { type: String, default: '' },
    // Set once the paid order's seats have been added, so a webhook racing the
    // browser can never add them twice.
    seatsGranted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Snapshot of the purchased package (so later catalog changes don't rewrite history).
    packageId: { type: String, required: true },
    packageLabel: { type: String, required: true },
    product: { type: String, required: true }, // e.g. 'nirmaan'

    // Money (paise)
    listPrice: { type: Number, required: true },   // catalog list price
    basePrice: { type: Number, required: true },   // after early-bird
    discount: { type: Number, default: 0 },        // coupon discount
    amount: { type: Number, required: true },      // final charged = basePrice - discount
    currency: { type: String, default: 'INR' },
    earlyBirdApplied: { type: Boolean, default: false },

    couponCode: { type: String, default: null },
    referralCode: { type: String, default: null },
    referralCommission: { type: Number, default: 0 }, // paise owed to the referrer (SRS §9.4)

    // Upgrade path: when the buyer already owns a lower tier of the same product,
    // the amount they've already paid is credited against the new package price.
    isUpgrade: { type: Boolean, default: false },
    creditApplied: { type: Number, default: 0 },      // paise credited from prior payments
    previousPackageId: { type: String, default: null }, // sku being upgraded from

    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'cancelled', 'refunded'],
      default: 'created',
      index: true,
    },
    cancelledAt: { type: Date },

    // Gateway details
    gateway: { type: String, default: 'mock' },
    gatewayOrderId: { type: String },   // Cashfree order_id (or mock)
    gatewayPaymentId: { type: String }, // Cashfree cf_payment_id (or mock)
    receiptNo: { type: String, index: true },

    paidAt: { type: Date },
    refundedAt: { type: Date },
    refundReason: { type: String },
  },
  { timestamps: true }
)

export const Order = mongoose.models.Order || mongoose.model('Order', orderSchema)
