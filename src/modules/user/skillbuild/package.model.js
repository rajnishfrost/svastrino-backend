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
    // How the student pays for this plan.
    //   'one-time'  — pay once, the whole course opens
    //   'per-phase' — pay for one phase at a time; each payment opens the next
    // The course is always cut into `phases` equal blocks of sessions.
    paymentMode: { type: String, enum: ['one-time', 'per-phase'], default: 'one-time' },
    phases: { type: Number, default: 1 },
    // Bundles the Mindler psychometric test with the course.
    includesPsychometric: { type: Boolean, default: false },

    sessionsCount: { type: Number, default: null },
    sessionMins: { type: Number, default: null },        // e.g. 120 (2-hour slots)

    // How this package is bought. 'self-serve' is the normal checkout. With
    // 'expert-call' the visitor cannot pay online at all: they request a call
    // and the team sends a payment link afterwards (Breakthrough).
    buyMode: { type: String, enum: ['self-serve', 'expert-call'], default: 'self-serve' },

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
