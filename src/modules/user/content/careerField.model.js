import mongoose from 'mongoose'

/**
 * A course entry inside a stream. `slug` is the legacy permalink segment
 * (svastrino.com/<slug>/), kept so a course detail page can be built later.
 */
const courseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
  },
  { _id: false }
)

/**
 * A stream in the Career Library (was "Courselist" on the legacy site) — a
 * category such as Commerce or Engineering plus the courses filed under it.
 *
 * Courses are intentionally many-to-many: the legacy site files several under
 * more than one stream (e.g. Interior Design is both Arts and Commercial Arts),
 * so the same course can appear in multiple fields.
 */
const careerFieldSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true }, // 'Professional Commerce Courses'
    description: { type: String, default: '' },
    courses: { type: [courseSchema], default: [] },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const CareerField =
  mongoose.models.CareerField || mongoose.model('CareerField', careerFieldSchema)
