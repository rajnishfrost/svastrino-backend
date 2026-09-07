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

    // The pricing card splits its list in two: what the plan INCLUDES
    // (features) and what the student GETS OUT of it (benefits).
    features: { type: [String], default: [] },
    benefits: { type: [String], default: [] },

    // What a mentoring program's card on /services says about itself. These
    // are LABELS, written for a reader — `durationLabel` is "10 days" while
    // `durationDays` is the number the enrollment expires on, and
    // `sessionsLabel` is the sentence a visitor reads while `sessionsCount` is
    // what the booking calendar counts. `deliveryMode` is named apart from
    // `modeLabel` below, which is about paying, not about how you attend.
    summary: { type: String, default: '' },
    trustLine: { type: String, default: '' },
    durationLabel: { type: String, default: '' },
    sessionsLabel: { type: String, default: '' },
    deliveryMode: { type: String, default: '' },

    // Wording the card cannot work out on its own.
    //   modeLabel — what this payment mode is called to a visitor, and the
    //               label on the toggle: 'Pay Once' / 'Pay As You Use'.
    //   priceNote — the green line under the two costs, e.g. 'Flat 25%
    //               Discount' or 'Phase wise payment offer, No Interest at all'.
    modeLabel: { type: String, default: '' },
    priceNote: { type: String, default: '' },

    cta: { type: String, default: 'Buy now' },
    variant: { type: String, default: 'btn-secondary' }, // button style on the card
    featured: { type: Boolean, default: false },
    badge: { type: String, default: null },              // e.g. 'Most Popular'

    order: { type: Number, default: 0 },
    // Two different questions, deliberately kept apart:
    //   active — can this SKU still be resolved and sold? Turning it off also
    //            hides it from a student who OWNS it, which costs them their
    //            upgrade credit (payments looks their tier up by sku).
    //   listed — does a card for it appear on the site?
    // A retired plan therefore stays active:true, listed:false — off the page,
    // but its owners keep their standing.
    active: { type: Boolean, default: true },
    listed: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const Package = mongoose.models.Package || mongoose.model('Package', packageSchema)
