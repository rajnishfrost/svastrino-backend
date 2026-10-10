import { MentoringProgram } from './program.model.js'
import { Faq } from './faq.model.js'
import { Testimonial } from './testimonial.model.js'
import { CareerField } from './careerField.model.js'
import { Course } from './course.model.js'
import { SitePage } from './sitePage.model.js'
// The root-slug resolver has to look across both sets; see resolveRootSlug.
import { Blog } from '../blogs/blog.model.js'

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

// Group names travel as slugs ('Svastrino Services' → 'svastrino-services') so
// they can sit in a URL. Matched in JS rather than the query because the stored
// value is the display name.
const slugifyGroup = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * All active FAQs as the accordion wants them: groups ('Nirmaan',
 * 'Svastrino Services') each holding their ordered sections. `order` is global
 * across the FAQs doc, so sorting once keeps both levels in the doc's order.
 *
 * `group` narrows it to one group by slug — the Nirmaan page wants its own 28
 * questions, not all 143.
 */
export async function listFaqsGrouped({ group } = {}) {
  const all = await Faq.find({ active: true }).sort({ order: 1 })
  const faqs = group ? all.filter((f) => slugifyGroup(f.group || '') === group) : all

  const byGroup = new Map()
  for (const f of faqs) {
    const group = f.group || 'Svastrino Services'
    if (!byGroup.has(group)) byGroup.set(group, new Map())
    const sections = byGroup.get(group)
    if (!sections.has(f.section)) sections.set(f.section, [])
    sections.get(f.section).push(f)
  }

  return [...byGroup.entries()].map(([group, sections]) => ({
    group,
    sections: [...sections.entries()].map(([section, items]) => ({ section, items })),
  }))
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

const MAX_COURSE_LIMIT = 50

/**
 * Paginated, filterable list of career-library courses, A→Z.
 *
 * The library is browsed by stream, and a course sits in more than one — the
 * 52 courses make 80 entries across the 13 streams — so the filter matches on
 * the denormalised `fields.slug` rather than reading CareerField and
 * de-duplicating what comes back.
 *
 * @param {object} opts { page, limit, field, q }
 */
export async function listCourses({ page = 1, limit = 12, field, q } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.min(MAX_COURSE_LIMIT, Math.max(1, Number(limit) || 12))

  const filter = { active: true }
  if (field) filter['fields.slug'] = field
  // Regex (not $text) so a partial word matches, the same way the blog searches.
  // The name only, though — searching the overview as well turns "design" into
  // thirteen results, most of them only mentioning the word in passing.
  if (q) filter.name = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

  const [items, total] = await Promise.all([
    Course.find(filter)
      .select('slug name overview fields')
      .sort({ name: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    Course.countDocuments(filter),
  ])

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
  }
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

/**
 * What kind of thing, if anything, lives at a root-level slug.
 *
 * The legacy WordPress site published both articles and course pages straight
 * off the root — svastrino.com/law/ — and those addresses carry the site's
 * search ranking, so they are kept rather than moved under a folder and
 * redirected. One route has to answer for both kinds, and only the database
 * knows which a slug belongs to.
 *
 * Returns just the kind, not the content: the page then fetches through the
 * same endpoint it always used, so nothing else had to learn about this.
 */
export async function resolveRootSlug(slug) {
  const clean = String(slug || '').trim().toLowerCase()
  if (!clean) return null

  // A course wins a tie. Slugs are unique across the two sets today, but a
  // course page is the more considered destination if that ever changes.
  if (await Course.exists({ slug: clean, active: true })) return { type: 'course' }
  if (await Blog.exists({ slug: clean, published: true })) return { type: 'blog' }

  // Not a live address — but it may be one this page used to answer on, before
  // somebody renamed it. Say where it went rather than let an old link 404.
  const movedCourse = await Course.findOne({ previousSlugs: clean, active: true }).select('slug').lean()
  if (movedCourse) return { type: 'course', movedTo: movedCourse.slug }
  const movedPost = await Blog.findOne({ previousSlugs: clean, published: true }).select('slug').lean()
  if (movedPost) return { type: 'blog', movedTo: movedPost.slug }

  return null
}
