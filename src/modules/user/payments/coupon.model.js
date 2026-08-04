import mongoose from 'mongoose'

/**
 * Discount coupon (SRS PAY-04). `percent` type takes `value`% off; `flat` type
 * takes `value` paise off. Optionally scoped to specific package ids and capped
 * by a usage limit / expiry.
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
  },
  { timestamps: true }
)

export const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema)
