import { Router } from 'express'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import * as service from './careerLibrary.admin.service.js'

// Mounted at /api/admin/career-library — gated by the 'career-library' module.
const router = Router()
router.use(requireAdminAuth, requirePermission('career-library'))

const fieldDTO = (f) => ({
  id: String(f._id),
  slug: f.slug,
  name: f.name,
  description: f.description,
  order: f.order,
  active: f.active,
  courseCount: f.courses.length,
  courses: f.courses.map((c) => ({ name: c.name, slug: c.slug })),
})

// Row shape for the course table — the long-form fields are stripped by the
// service, so don't pretend to send them.
const courseRowDTO = (c) => ({
  id: String(c._id),
  slug: c.slug,
  name: c.name,
  active: c.active,
  sourceUrl: c.sourceUrl,
  fields: c.fields.map((f) => ({ name: f.name, slug: f.slug })),
  updatedAt: c.updatedAt,
})

const courseDTO = (c) => ({
  ...courseRowDTO(c),
  overview: c.overview,
  topQualities: c.topQualities,
  topJobs: c.topJobs.map((j) => ({
    role: j.role, description: j.description, indiaSalary: j.indiaSalary, globalSalary: j.globalSalary,
  })),
  institutesIndia: c.institutesIndia,
  institutesInternational: c.institutesInternational,
  careerLadder: c.careerLadder,
})

const newsDTO = (n) => ({ id: String(n._id), date: n.date, text: n.text, order: n.order, active: n.active })

// --- Streams ---
router.get('/fields', asyncHandler(async (req, res) => {
  const fields = await service.listFields()
  res.json({ fields: fields.map(fieldDTO) })
}))
router.post('/fields', asyncHandler(async (req, res) => {
  res.status(201).json({ field: fieldDTO(await service.createField(req.body || {})) })
}))
router.patch('/fields/:id', asyncHandler(async (req, res) => {
  res.json({ field: fieldDTO(await service.updateField(req.params.id, req.body || {})) })
}))
router.delete('/fields/:id', asyncHandler(async (req, res) => {
  res.json(await service.deleteField(req.params.id))
}))

// --- Courses ---
router.get('/courses', asyncHandler(async (req, res) => {
  const result = await service.listCourses(req.query)
  res.json({
    courses: result.items.map(courseRowDTO),
    pagination: { page: result.page, limit: result.limit, total: result.total, pages: result.pages },
  })
}))
router.get('/courses/:id', asyncHandler(async (req, res) => {
  res.json({ course: courseDTO(await service.getCourse(req.params.id)) })
}))
router.post('/courses', asyncHandler(async (req, res) => {
  res.status(201).json({ course: courseDTO(await service.createCourse(req.body || {})) })
}))
router.patch('/courses/:id', asyncHandler(async (req, res) => {
  res.json({ course: courseDTO(await service.updateCourse(req.params.id, req.body || {})) })
}))
router.delete('/courses/:id', asyncHandler(async (req, res) => {
  res.json(await service.deleteCourse(req.params.id))
}))

// --- Quick News ---
router.get('/news', asyncHandler(async (req, res) => {
  const result = await service.listNews(req.query)
  res.json({
    news: result.items.map(newsDTO),
    pagination: { page: result.page, limit: result.limit, total: result.total, pages: result.pages },
  })
}))
router.post('/news', asyncHandler(async (req, res) => {
  res.status(201).json({ item: newsDTO(await service.createNews(req.body || {})) })
}))
router.patch('/news/:id', asyncHandler(async (req, res) => {
  res.json({ item: newsDTO(await service.updateNews(req.params.id, req.body || {})) })
}))
router.delete('/news/:id', asyncHandler(async (req, res) => {
  res.json(await service.deleteNews(req.params.id))
}))

export default router
