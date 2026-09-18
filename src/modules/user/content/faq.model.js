import mongoose from 'mongoose'

/**
 * A published FAQ entry. The Resources page shows two groups — 'Nirmaan' and
 * 'Svastrino Services' — and within a group the entries are split into
 * sections ("Bull's Eye Program", "Payments & Packages", …). Both come from the
 * FAQs doc via parseFaqs.js; `order` is the doc's own order across the lot.
 */
const faqSchema = new mongoose.Schema(
  {
    group: { type: String, required: true, default: 'Svastrino Services', index: true },
    section: { type: String, required: true, index: true },
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

faqSchema.index({ group: 1, section: 1, order: 1 })

export const Faq = mongoose.models.Faq || mongoose.model('Faq', faqSchema)
