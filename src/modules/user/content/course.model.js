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

    // Addresses this page used to answer on.
    //
    // A slug is a public URL: changing it throws away whatever the old one
    // ranked for and turns every existing link into a 404. Rather than forbid
    // the change, the old address is remembered and redirected — so renaming
    // stays possible and costs nothing.
    previousSlugs: { type: [String], default: [], index: true },
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

    // What search engines should show for this page. Left empty, the page keeps
    // the wording svastrino.com published — see client/src/seo/legacyRootSeo.js
    // — which is what these addresses have ranked with for years. Filling it in
    // overrides that, deliberately.
    seoTitle: { type: String, default: '', trim: true },
    seoDescription: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const Course = mongoose.models.Course || mongoose.model('Course', courseSchema)
