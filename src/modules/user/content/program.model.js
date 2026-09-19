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

    // How this program is BOUGHT. Every program is 'self-serve' today — pick a
    // slot, pay, done. 'expert-call' instead refuses the checkout until the
    // team has approved that person's call request; Breakthrough was sold that
    // way until 2026-09-19. Set per program from the admin panel.
    buyMode: { type: String, enum: ['self-serve', 'expert-call'], default: 'self-serve' },

    // Whether this program's PAGE leads with the "Talk to an Expert" form
    // instead of a Book Now strip. Separate from buyMode on purpose: Breakthrough
    // takes a negotiated price through that form AND can be bought outright at
    // the listed price from /book-online, and one flag could not say both. It
    // used to be derived from buyMode, so making Breakthrough self-serve took
    // the form off its page along with the checkout gate.
    // No default on purpose, the same as Package.expertEnquiry. The content
    // service returns hydrated documents, so `default: false` would have
    // Mongoose fill the field in on rows that predate it — and the readers'
    // `?? buyMode === 'expert-call'` fallback would never fire, leaving an
    // un-migrated database showing Book Now where the form belongs.
    expertEnquiry: { type: Boolean },
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
