import { Router } from 'express'
import {
  listPrograms,
  getProgram,
  listFaqs,
  listTestimonials,
  listCareerLibrary,
  getCourse,
  getSitePage,
  resolveSlug,
} from './content.controller.js'

// Mounted at /api/user/content — PUBLIC marketing/site content migrated from
// the legacy svastrino.com site (mentoring programs, FAQs, success stories,
// career library).
const router = Router()

router.get('/programs', listPrograms)
router.get('/programs/:slug', getProgram)
router.get('/faqs', listFaqs)
router.get('/testimonials', listTestimonials)
router.get('/career-library', listCareerLibrary)
router.get('/courses/:slug', getCourse)
router.get('/pages/:slug', getSitePage)

// Which kind of thing lives at a root-level URL.
//
// The WordPress site served every article and every course page from the root
// — svastrino.com/law/ — and those URLs carry years of search ranking, so the
// new site keeps them rather than moving everything under /blog/ and
// /career-library/ and asking Google to follow. One address has to answer for
// both kinds, and only the server knows which is which.
router.get('/resolve/:slug', resolveSlug)

export default router
