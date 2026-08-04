import mongoose from 'mongoose'

/**
 * A success story / testimonial. `featured` ones surface on the homepage and
 * program pages; all of them list on Resources → Success Stories.
 */
const testimonialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, default: '' },   // 'MSc Investment Banking, University College Dublin'
    quote: { type: String, required: true },
    photo: { type: String, default: '' },

    program: { type: String, default: '' }, // related program slug, when known
    featured: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const Testimonial =
  mongoose.models.Testimonial || mongoose.model('Testimonial', testimonialSchema)
