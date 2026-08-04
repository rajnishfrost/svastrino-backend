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
    tagline: { type: String, default: '' },
    summary: { type: String, default: '' },

    duration: { type: String, default: '' },   // '2 hours' · '45–60 days'
    sessions: { type: String, default: '' },   // '3 sessions of 2 hours each'
    mode: { type: String, default: 'Online' },

    chooseIf: { type: [String], default: [] }, // 'Choose this program if…' bullets
    journey: { type: [stageSchema], default: [] },
    benefits: { type: [String], default: [] },

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
