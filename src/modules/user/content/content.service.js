import { MentoringProgram } from './program.model.js'
import { Faq } from './faq.model.js'
import { Testimonial } from './testimonial.model.js'
import { CareerField } from './careerField.model.js'
import { Course } from './course.model.js'
import { SitePage } from './sitePage.model.js'

const httpError = (message, status) => {
  const err = new Error(message)
  err.status = status
  return err
}

// ---- Mentoring programs ----------------------------------------------------

export async function listPrograms() {
  return MentoringProgram.find({ active: true }).sort({ order: 1, name: 1 })
}

export async function getProgramBySlug(slug) {
  const program = await MentoringProgram.findOne({ slug, active: true })
  if (!program) throw httpError('Program not found', 404)
  return program
}

// ---- FAQs ------------------------------------------------------------------

/** All active FAQs, grouped into ordered sections for the accordion. */
export async function listFaqsGrouped() {
  const faqs = await Faq.find({ active: true }).sort({ order: 1 })

  const bySection = new Map()
  for (const f of faqs) {
    if (!bySection.has(f.section)) bySection.set(f.section, [])
    bySection.get(f.section).push(f)
  }
  return [...bySection.entries()].map(([section, items]) => ({ section, items }))
}

// ---- Testimonials ----------------------------------------------------------

export async function listTestimonials({ featured } = {}) {
  const filter = { active: true }
  if (featured === true) filter.featured = true
  return Testimonial.find(filter).sort({ order: 1 })
}

// ---- Career library --------------------------------------------------------

export async function listCareerFields() {
  return CareerField.find({ active: true }).sort({ order: 1, name: 1 })
}

/** One course detail page by slug. */
export async function getCourseBySlug(slug) {
  const course = await Course.findOne({ slug, active: true })
  if (!course) throw httpError('Course not found', 404)
  return course
}

// ---- Site pages (policies) -------------------------------------------------

export async function getSitePageBySlug(slug) {
  const page = await SitePage.findOne({ slug, active: true })
  if (!page) throw httpError('Page not found', 404)
  return page
}

