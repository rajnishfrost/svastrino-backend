import mongoose from 'mongoose'

/**
 * A course/career detail page, migrated from svastrino.com/<slug>/.
 *
 * Referenced by `CareerField.courses` (which holds just `{ name, slug }`); this
 * is the full record. A course is one document even when it's filed under
 * several streams (Interior Design → Arts + Commercial Arts), so it's keyed by
 * its own `slug`, not by stream.
 */
const jobSchema = new mongoose.Schema(
  {
    role: { type: String, required: true },
    description: { type: String, default: '' },
    indiaSalary: { type: String, default: '' },
    globalSalary: { type: String, default: '' },
  },
  { _id: false }
)

const courseSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },

    overview: { type: String, default: '' },
    topQualities: { type: [String], default: [] },
    topJobs: { type: [jobSchema], default: [] },
    institutesIndia: { type: [String], default: [] },
    institutesInternational: { type: [String], default: [] },
    careerLadder: { type: [String], default: [] },

    // Streams this course belongs to — denormalised from CareerField for the
    // breadcrumb / "explore more" links on the detail page. [{ name, slug }].
    fields: {
      type: [{ name: String, slug: String, _id: false }],
      default: [],
    },

    sourceUrl: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const Course = mongoose.models.Course || mongoose.model('Course', courseSchema)
