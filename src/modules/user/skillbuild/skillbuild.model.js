import mongoose from 'mongoose'

/**
 * A Skill-Build product (e.g. Nirmaan). Holds the top-level name/description;
 * its priced tiers live in the `packages` collection (see package.model.js),
 * each linked back here via `skillBuild`.
 */
const skillBuildSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true }, // 'nirmaan'
    name: { type: String, required: true, trim: true },                                 // 'Nirmaan'
    tagline: { type: String, default: '' },
    // 'course' = video course (Nirmaan); 'mentoring' = bookable counselling program
    kind: { type: String, enum: ['course', 'mentoring'], default: 'course' },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export const SkillBuild =
  mongoose.models.SkillBuild || mongoose.model('SkillBuild', skillBuildSchema)
