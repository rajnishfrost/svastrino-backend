import { Router } from 'express'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import * as service from './scholarship.service.js'

// Mounted at /api/admin/scholarship — gated by the 'scholarship' module.
const router = Router()
router.use(requireAdminAuth, requirePermission('scholarship'))

const instDTO = (i) => ({
  id: i._id,
  name: i.name,
  type: i.type,
  branch: i.branch || '',
  city: i.city || '',
  state: i.state || '',
  contactPerson: i.contactPerson || '',
  phone: i.phone || '',
  email: i.email,
  status: i.status,
  rejectionReason: i.rejectionReason || '',
  reviewedAt: i.reviewedAt || null,
  createdAt: i.createdAt,
})
const testDTO = (t) => ({
  title: t.title,
  instructions: t.instructions || '',
  startAt: t.startAt || null,
  endAt: t.endAt || null,
  durationMins: t.durationMins,
  active: t.active,
  declaredWinner: t.declaredWinner || null,
})
const qDTO = (q) => ({ id: q._id, order: q.order, prompt: q.prompt, guidance: q.guidance || '', maxWords: q.maxWords || 1000 })

// --- Institution applications ---
router.get('/institutions', asyncHandler(async (req, res) => {
  const list = await service.listInstitutions({ status: req.query.status })
  res.json({ institutions: list.map(instDTO) })
}))
router.patch('/institutions/:id', asyncHandler(async (req, res) => {
  const inst = await service.reviewInstitution(req.admin.id, req.params.id, req.body || {})
  res.json({ institution: instDTO(inst) })
}))

// --- Test config + questions ---
router.get('/test', asyncHandler(async (req, res) => {
  res.json({ test: testDTO(await service.getTest()) })
}))
router.patch('/test', asyncHandler(async (req, res) => {
  res.json({ test: testDTO(await service.updateTest(req.body || {})) })
}))
router.get('/questions', asyncHandler(async (req, res) => {
  const qs = await service.listQuestions({ withAnswers: true })
  res.json({ questions: qs.map(qDTO) })
}))
router.put('/questions', asyncHandler(async (req, res) => {
  const qs = await service.saveQuestions(req.body?.questions)
  res.json({ questions: qs.map(qDTO) })
}))

// --- Enrolments ---
router.get('/enrollments', asyncHandler(async (req, res) => {
  res.json({ enrollments: await service.listEnrollments() })
}))
router.delete('/enrollments/:id', asyncHandler(async (req, res) => {
  await service.removeEnrollment(req.params.id)
  res.json({ ok: true })
}))

// --- Results ---
router.get('/leaderboard', asyncHandler(async (req, res) => {
  res.json({ leaderboard: await service.leaderboard() })
}))
router.post('/winner', asyncHandler(async (req, res) => {
  const test = await service.declareWinner(req.body?.userId)
  res.json({ test: testDTO(test) })
}))

export default router
