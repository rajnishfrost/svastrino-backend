import mongoose from 'mongoose'

/**
 * A 1-on-1 mentoring consultancy program (Model Session, Bull's Eye, Bloom,
 * Breakthrough) as offered on the legacy svastrino.com site.
 *
 * NOTE: deliberately separate from the Skill-Build catalog (SkillBuild/Package,
 * e.g. Nirmaan) — those are self-serve priced courses; these are booked
 * consultancy sessions and carry no checkout SKU.
 */
const stageSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },   // 'Stage 1 — Presession' / 'Day 1'
    title: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  { _id: false }
)

const mentoringProgramSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    // "Services" sub-category this program sits under (Career Counselling /
    // Personalised Mentoring) — drives the site nav + landing grouping.
    category: {
      slug: { type: String, default: '' },
      name: { type: String, default: '' },
    },
    // The bookable program SKU (mentoring catalog) this page's "Book" CTA opens.
    bookingSku: { type: String, default: '' },

    // How this program is bought. Most are 'self-serve' — pick a slot, pay,
    // done. Breakthrough is 'expert-call': a two-year commitment is not sold
    // from a checkout page, so the visitor asks for a call and the team sends a
    // payment link afterwards.
    buyMode: { type: String, enum: ['self-serve', 'expert-call'], default: 'self-serve' },
    tagline: { type: String, default: '' },
    // One line of reassurance under the hero buttons. Per program, because
    // "500+ students mentored" is true of the practice but not of every
    // program on its own. Blank falls back to a neutral line on the page.
    trustLine: { type: String, default: '' },
    summary: { type: String, default: '' },

    duration: { type: String, default: '' },   // '2 hours' · '45–60 days'
    sessions: { type: String, default: '' },   // '3 sessions of 2 hours each'
    mode: { type: String, default: 'Online' },

    chooseIf: { type: [String], default: [] }, // 'Choose this program if…' bullets
    journey: { type: [stageSchema], default: [] },
    benefits: { type: [String], default: [] },

    // Questions specific to THIS program. The global FAQ list is grouped by
    // topic, not by program, so a program page needs its own.
    faqs: {
      type: [{
        _id: false,
        q: { type: String, required: true },
        a: { type: String, required: true },
      }],
      default: [],
    },

    brochureUrl: { type: String, default: '' },
    sourceUrl: { type: String, default: '' },

    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const MentoringProgram =
  mongoose.models.MentoringProgram ||
  mongoose.model('MentoringProgram', mentoringProgramSchema)
