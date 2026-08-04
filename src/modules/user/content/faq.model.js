import mongoose from 'mongoose'

/** A published FAQ entry, grouped under a section on the Resources page. */
const faqSchema = new mongoose.Schema(
  {
    section: { type: String, required: true, index: true }, // 'About Svastrino' | 'Process Basics' | 'Mentoring Programs'
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

faqSchema.index({ section: 1, order: 1 })

export const Faq = mongoose.models.Faq || mongoose.model('Faq', faqSchema)
