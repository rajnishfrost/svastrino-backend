import { Router } from 'express'
import { requireUserAuth } from '../../../middleware/auth.js'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './mentoring.service.js'

// Mounted at /api/user/mentoring
const router = Router()

// Public — the booking calendar is browsable before login/purchase.
router.get('/programs', asyncHandler(async (req, res) => {
  res.json({ programs: await service.listPrograms() })
}))

// Public — the same catalog grouped by "Services" sub-category.
router.get('/categories', asyncHandler(async (req, res) => {
  res.json({ categories: await service.listCategories() })
}))

// GET /slots?date=YYYY-MM-DD → available 2-hour starts for that IST date
router.get('/slots', asyncHandler(async (req, res) => {
  res.json(await service.slotsFor(String(req.query.date || '')))
}))

// Signed-in — booking + the dashboard tables.
router.get('/my', requireUserAuth, asyncHandler(async (req, res) => {
  res.json(await service.myMentoring(req.user.id))
}))

// { sku, date: 'YYYY-MM-DD', start: 'HH:MM' }
router.post('/bookings', requireUserAuth, asyncHandler(async (req, res) => {
  const b = await service.createBooking(req.user.id, req.body || {})
  res.status(201).json({ booking: b })
}))

router.post('/bookings/:id/reschedule', requireUserAuth, asyncHandler(async (req, res) => {
  const b = await service.rescheduleBooking(req.user.id, req.params.id, req.body || {})
  res.json({ booking: b })
}))

export default router
