import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './content.service.js'
import {
  toProgramCardDTO,
  toProgramDTO,
  toFaqDTO,
  toTestimonialDTO,
  toCareerFieldDTO,
  toCourseDTO,
  toSitePageDTO,
} from './content.dto.js'

// GET /api/user/content/programs
export const listPrograms = asyncHandler(async (req, res) => {
  const programs = await service.listPrograms()
  res.json({ programs: programs.map(toProgramCardDTO) })
})

// GET /api/user/content/programs/:slug
export const getProgram = asyncHandler(async (req, res) => {
  const program = await service.getProgramBySlug(req.params.slug)
  res.json({ program: toProgramDTO(program) })
})

// GET /api/user/content/faqs  → [{ section, items: [...] }]
export const listFaqs = asyncHandler(async (req, res) => {
  const groups = await service.listFaqsGrouped()
  res.json({
    faqs: groups.map((g) => ({ section: g.section, items: g.items.map(toFaqDTO) })),
  })
})

// GET /api/user/content/testimonials?featured=true
export const listTestimonials = asyncHandler(async (req, res) => {
  const featured = req.query.featured === 'true' ? true : undefined
  const items = await service.listTestimonials({ featured })
  res.json({ testimonials: items.map(toTestimonialDTO) })
})

// GET /api/user/content/career-library
export const listCareerLibrary = asyncHandler(async (req, res) => {
  const fields = await service.listCareerFields()
  res.json({ fields: fields.map(toCareerFieldDTO) })
})

// GET /api/user/content/courses/:slug
export const getCourse = asyncHandler(async (req, res) => {
  const course = await service.getCourseBySlug(req.params.slug)
  res.json({ course: toCourseDTO(course) })
})

// GET /api/user/content/pages/:slug  → policy/legal page (markdown body)
export const getSitePage = asyncHandler(async (req, res) => {
  const page = await service.getSitePageBySlug(req.params.slug)
  res.json({ page: toSitePageDTO(page) })
})
