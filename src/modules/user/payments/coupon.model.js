import mongoose from 'mongoose'

/**
 * Discount coupon (SRS PAY-04). `percent` type takes `value`% off; `flat` type
 * takes `value` paise off. Optionally scoped to specific package ids and capped
 * by a usage limit / expiry. `redemptions` counts COMPLETED purchases only —
 * applying a code at checkout never uses it up (see completePaidOrder).
 */
const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: ['percent', 'flat'], required: true },
    value: { type: Number, required: true }, // percent (1–100) OR paise
    applicablePackages: { type: [String], default: [] }, // empty = all packages
    active: { type: Boolean, default: true },
    expiresAt: { type: Date, default: null },
    maxRedemptions: { type: Number, default: null }, // null = unlimited
    redemptions: { type: Number, default: 0 },

    // Where the coupon came from: made by an admin, or bought as a gift by a
    // student (gifts/gift.service.js) — one coupon per gift, single use, a year.
    source: { type: String, enum: ['admin', 'gift'], default: 'admin', index: true },
    giftOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    purchasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // The email the buyer gave — set for every gift coupon, account or not.
    purchaserEmail: { type: String, lowercase: true, trim: true, default: '', index: true },

    // The last purchase that used it — set when that payment completes, which is
    // the only moment a coupon counts as used.
    lastRedeemedAt: { type: Date, default: null },
    lastRedeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastRedeemedOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  },
  { timestamps: true }
)

export const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema)
