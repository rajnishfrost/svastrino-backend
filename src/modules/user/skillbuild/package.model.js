import mongoose from 'mongoose'

/**
 * A priced tier of a Skill-Build product (Discover / Clarity / Launch). This is
 * the single source of truth for pricing — the payments module looks up the
 * price here by `sku`, never trusting the client. Money is in PAISE.
 */
const packageSchema = new mongoose.Schema(
  {
    skillBuild: { type: mongoose.Schema.Types.ObjectId, ref: 'SkillBuild', required: true, index: true },

    sku: { type: String, required: true, unique: true }, // 'nirmaan-clarity' (used by payments)
    slug: { type: String, required: true },              // 'clarity'
    name: { type: String, required: true },              // 'Clarity'
    tagline: { type: String, default: '' },

    price: { type: Number, required: true },             // list price, paise
    earlyBird: { type: Number, default: null },          // early-bird price, paise (null = none)
    period: { type: String, default: 'one-time' },       // display: 'one-time' | '6 months' | '12 months'
    durationDays: { type: Number, default: null },       // access length for the enrollment (null = one-time)
    // Mentoring programs only: how many bookable sessions this SKU includes.
    sessionsCount: { type: Number, default: null },
    sessionMins: { type: Number, default: null },        // e.g. 120 (2-hour slots)

    features: { type: [String], default: [] },

    cta: { type: String, default: 'Buy now' },
    variant: { type: String, default: 'btn-secondary' }, // button style on the card
    featured: { type: Boolean, default: false },
    badge: { type: String, default: null },              // e.g. 'Most Popular'

    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const Package = mongoose.models.Package || mongoose.model('Package', packageSchema)
