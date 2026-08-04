import mongoose from 'mongoose'

/**
 * A standalone content page (Terms of Use, Privacy Policy, Cancellations &
 * Refunds, …) migrated from the legacy site. `body` is markdown, rendered by
 * the client's Markdown component. Seeded from data/pages/<slug>.json.
 */
const sitePageSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, default: '' }, // markdown
    sourceUrl: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const SitePage = mongoose.models.SitePage || mongoose.model('SitePage', sitePageSchema)
