import { Router } from 'express'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import * as service from './testimonials.admin.service.js'

// Mounted at /api/admin/testimonials — gated by the 'testimonials' module.
const router = Router()
router.use(requireAdminAuth, requirePermission('testimonials'))

const dto = (t) => ({
  id: String(t._id),
  name: t.name,
  role: t.role || '',
  quote: t.quote,
  photo: t.photo || '',
  program: t.program || '',
  featured: !!t.featured,
  order: t.order || 0,
  active: t.active !== false,
  updatedAt: t.updatedAt,
})

router.get('/', asyncHandler(async (req, res) => {
  res.json({ testimonials: (await service.listAll()).map(dto) })
}))

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json({ testimonial: dto(await service.create(req.body)) })
}))

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json({ testimonial: dto(await service.update(req.params.id, req.body)) })
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  res.json(await service.remove(req.params.id))
}))

export default router
