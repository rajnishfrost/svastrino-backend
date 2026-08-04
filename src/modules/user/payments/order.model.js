import mongoose from 'mongoose'

/**
 * An Order is one purchase attempt for a package. It moves:
 *   created → paid            (successful payment, enrollment granted)
 *           → failed          (payment failed/abandoned)
 *   paid    → refunded        (admin refund)
 *
 * All monetary fields are in PAISE. `gateway` records which provider handled it
 * ('mock' now; 'razorpay' once real keys are wired) so the flow is swappable.
 */
const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

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

    status: { type: String, enum: ['created', 'paid', 'failed', 'refunded'], default: 'created', index: true },

    // Gateway details
    gateway: { type: String, default: 'mock' },
    gatewayOrderId: { type: String },   // Razorpay order id (or mock)
    gatewayPaymentId: { type: String }, // Razorpay payment id (or mock)
    receiptNo: { type: String, index: true },

    paidAt: { type: Date },
    refundedAt: { type: Date },
    refundReason: { type: String },
  },
  { timestamps: true }
)

export const Order = mongoose.models.Order || mongoose.model('Order', orderSchema)
