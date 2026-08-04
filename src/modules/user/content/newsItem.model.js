import mongoose from 'mongoose'

/**
 * A Quick News headline (the legacy "Newsletter" page) — one-line education /
 * career news snippets with a publish date. Read-only archive; new items can be
 * added from the admin panel later.
 */
const newsItemSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, index: true },
    text: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 }, // original position, tie-breaker within a date
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

newsItemSchema.index({ date: -1, order: 1 })

export const NewsItem = mongoose.models.NewsItem || mongoose.model('NewsItem', newsItemSchema)
