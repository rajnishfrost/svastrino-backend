import { Router } from 'express'
import {
  listPrograms,
  getProgram,
  listFaqs,
  listTestimonials,
  listCareerLibrary,
  getCourse,
  getSitePage,
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

export default router
