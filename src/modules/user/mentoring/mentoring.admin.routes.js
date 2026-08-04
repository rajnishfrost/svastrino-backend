import { Router } from 'express'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { MentoringBooking } from './booking.model.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { Package } from '../skillbuild/package.model.js'

// Mounted at /api/admin/mentoring — manage bookings, write session updates/tasks.
const router = Router()
router.use(requireAdminAuth, requirePermission('mentoring'))

const bookingDTO = (b) => ({
  id: b._id,
  user: b.user && b.user.name ? { id: b.user._id, name: b.user.name, email: b.user.email } : b.user,
  programSku: b.programSku,
  sessionNumber: b.sessionNumber,
  startAt: b.startAt,
  endAt: b.endAt,
  status: b.status,
  update: b.update || '',
  tasks: b.tasks || [],
})

// GET /bookings?status=booked|completed|cancelled&when=upcoming|past
router.get('/bookings', asyncHandler(async (req, res) => {
  const q = {}
  if (req.query.status) q.status = String(req.query.status)
  if (req.query.when === 'upcoming') q.startAt = { $gte: new Date() }
  if (req.query.when === 'past') q.startAt = { $lt: new Date() }
  const bookings = await MentoringBooking.find(q)
    .populate('user', 'name email')
    .sort({ startAt: 1 })
    .limit(500)
  // Program names for the table header/filter.
  const pkgs = await Package.find({ sku: { $in: [...new Set(bookings.map((b) => b.programSku))] } })
  const names = Object.fromEntries(pkgs.map((p) => [p.sku, p.name]))
  res.json({ bookings: bookings.map((b) => ({ ...bookingDTO(b), programName: names[b.programSku] || b.programSku })) })
}))

// PATCH /bookings/:id — { update?, tasks?, status? } (mentor notes + lifecycle)
router.patch('/bookings/:id', asyncHandler(async (req, res) => {
  const b = await MentoringBooking.findById(req.params.id)
  if (!b) return res.status(404).json({ error: 'Booking not found' })
  if (req.body.update != null) b.update = String(req.body.update).slice(0, 5000)
  if (Array.isArray(req.body.tasks)) {
    b.tasks = req.body.tasks.map((t) => String(t).slice(0, 500)).filter(Boolean).slice(0, 50)
  }
  if (['booked', 'completed', 'cancelled'].includes(req.body.status)) b.status = req.body.status
  await b.save()
  await b.populate('user', 'name email')
  res.json({ booking: bookingDTO(b) })
}))

// GET /programs — the mentoring catalog (for filters/labels in the admin UI).
// One parent SkillBuild (kind 'mentoring'); each program is a Package under it.
router.get('/programs', asyncHandler(async (req, res) => {
  const parents = await SkillBuild.find({ kind: 'mentoring' })
  const pkgs = await Package.find({ skillBuild: { $in: parents.map((p) => p._id) } }).sort({ order: 1 })
  res.json({ programs: pkgs.map((p) => ({ sku: p.sku, name: p.name, sessions: p.sessionsCount || 1 })) })
}))

export default router
