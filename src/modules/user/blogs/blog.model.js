import mongoose from 'mongoose'

/**
 * A blog post. Content was migrated from the legacy WordPress site
 * (svastrino.com/blogs) — `sourceUrl` keeps the original permalink so old links
 * can be redirected and the import stays traceable.
 *
 * `body` is markdown; the client renders it. `owner` drives the Svastrino /
 * Nirmaan badge + filter on the listing page.
 */
const blogSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // Addresses this page used to answer on.
    //
    // A slug is a public URL: changing it throws away whatever the old one
    // ranked for and turns every existing link into a 404. Rather than forbid
    // the change, the old address is remembered and redirected — so renaming
    // stays possible and costs nothing.
    previousSlugs: { type: [String], default: [], index: true },
    title: { type: String, required: true, trim: true },

    owner: { type: String, enum: ['svastrino', 'nirmaan'], default: 'svastrino', index: true },
    author: { type: String, default: 'Svastrino' },
    categories: { type: [String], default: [], index: true },

    excerpt: { type: String, default: '' },
    body: { type: String, default: '' }, // markdown
    coverImage: { type: String, default: '' },

    sourceUrl: { type: String, default: '' }, // original WordPress permalink

    // What search engines should show for this page. Left empty, the page keeps
    // the wording svastrino.com published — see client/src/seo/legacyRootSeo.js
    // — which is what these addresses have ranked with for years. Filling it in
    // overrides that, deliberately.
    seoTitle: { type: String, default: '', trim: true },
    seoDescription: { type: String, default: '', trim: true },
    publishedAt: { type: Date, default: Date.now, index: true },
    readingMins: { type: Number, default: 1 },

    published: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 0 }, // position in the original listing (1 = newest)
  },
  { timestamps: true }
)

// Powers ?q= search across title/excerpt/body.
blogSchema.index({ title: 'text', excerpt: 'text', body: 'text' })

export const Blog = mongoose.models.Blog || mongoose.model('Blog', blogSchema)
