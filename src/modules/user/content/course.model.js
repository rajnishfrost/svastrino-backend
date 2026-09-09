import mongoose from 'mongoose'

/**
 * A course/career detail page, migrated from svastrino.com/<slug>/.
 *
 * Referenced by `CareerField.courses` (which holds just `{ name, slug }`); this
 * is the full record. A course is one document even when it's filed under
 * several streams (Interior Design → Arts + Commercial Arts), so it's keyed by
 * its own `slug`, not by stream.
 */
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

    // The page itself, as the editor holds it — Editor.js blocks. `overview`
    // above is derived from this on every save (see richText.js), so the card
    // blurb, the search description and anything else reading a plain string
    // keeps working while there is still only one thing for an admin to edit.
    overviewBlocks: { type: mongoose.Schema.Types.Mixed, default: null },

    // A course page used to be a form — separate fields for qualities, careers
    // and salaries, institutes and the career ladder — each drawn into its own
    // fixed section. It is one document now, so those fields are gone from the
    // schema; their content was folded into `overviewBlocks` by
    // migrateCourseSections.js. The values themselves are still sitting in the
    // existing documents, unread, which is deliberate: the way back doesn't
    // depend on a backup.

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

    // The address search engines should treat as the real one, when two pages
    // say close to the same thing. Both keep answering — nothing is taken away
    // from anyone holding a link — but only one accumulates the ranking, rather
    // than the two of them splitting it and competing with each other.
    canonicalSlug: { type: String, default: '', lowercase: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const Course = mongoose.models.Course || mongoose.model('Course', courseSchema)
