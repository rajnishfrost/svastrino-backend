import { Router } from 'express'
import { asyncHandler } from '../../utils/asyncHandler.js'
import { requireOrgModule } from '../../middleware/auth.js'
import * as service from '../user/scholarship/scholarship.service.js'

/**
 * Mounted at /api/org/scholarship — an organisation running its own scholarship.
 *
 * Every cycle-scoped handler passes `req.org.id` into the service, which 404s
 * on a cycle belonging to anyone else. That single rule is what keeps one
 * partner from ever reading another's questions, enrolments or results.
 */
const router = Router()
router.use(requireOrgModule('scholarship'))

const qDTO = (q) => ({
  id: q._id,
  order: q.order,
  prompt: q.prompt,
  guidance: q.guidance || '',
  maxWords: q.maxWords || 1000,
})

// ---- Cycles (one per year) ---------------------------------------------------

// GET /api/org/scholarship/cycles
router.get('/cycles', asyncHandler(async (req, res) => {
  const cycles = await service.listCycles(req.org.id)
  res.json({ cycles: cycles.map((c) => service.cycleDTO(c)) })
}))

// POST /api/org/scholarship/cycles — { year, title, instructions }
router.post('/cycles', asyncHandler(async (req, res) => {
  const cycle = await service.createCycle(req.org.id, req.body || {}, req.orgUser.id)
  res.status(201).json({ cycle: service.cycleDTO(cycle) })
}))

// GET /api/org/scholarship/cycles/:id
router.get('/cycles/:id', asyncHandler(async (req, res) => {
  const cycle = await service.getCycle(req.params.id, req.org.id)
  res.json({ cycle: service.cycleDTO(cycle) })
}))

// PATCH /api/org/scholarship/cycles/:id — window, duration, status, instructions
router.patch('/cycles/:id', asyncHandler(async (req, res) => {
  const cycle = await service.updateCycle(req.params.id, req.body || {}, req.org.id)
  res.json({ cycle: service.cycleDTO(cycle) })
}))

// DELETE /api/org/scholarship/cycles/:id — only while untouched
router.delete('/cycles/:id', asyncHandler(async (req, res) => {
  await service.deleteCycle(req.params.id, req.org.id)
  res.json({ ok: true })
}))

// ---- Questions ---------------------------------------------------------------

// GET /api/org/scholarship/cycles/:id/questions — with grading guidance
router.get('/cycles/:id/questions', asyncHandler(async (req, res) => {
  await service.getCycle(req.params.id, req.org.id) // ownership check
  const qs = await service.listQuestions(req.params.id, { withGuidance: true })
  res.json({ questions: qs.map(qDTO) })
}))

// PUT /api/org/scholarship/cycles/:id/questions — replace the whole set
router.put('/cycles/:id/questions', asyncHandler(async (req, res) => {
  const qs = await service.saveQuestions(req.params.id, req.body?.questions, req.org.id)
  res.json({ questions: qs.map(qDTO) })
}))

// ---- Enrolments --------------------------------------------------------------

// GET /api/org/scholarship/cycles/:id/enrollments
router.get('/cycles/:id/enrollments', asyncHandler(async (req, res) => {
  await service.getCycle(req.params.id, req.org.id)
  res.json({ enrollments: await service.listEnrollments(req.params.id) })
}))

// DELETE /api/org/scholarship/enrollments/:id
router.delete('/enrollments/:id', asyncHandler(async (req, res) => {
  await service.removeEnrollment(req.params.id, req.org.id)
  res.json({ ok: true })
}))

// ---- Results -----------------------------------------------------------------

// GET /api/org/scholarship/cycles/:id/leaderboard
router.get('/cycles/:id/leaderboard', asyncHandler(async (req, res) => {
  const cycle = await service.getCycle(req.params.id, req.org.id)
  res.json({
    leaderboard: await service.leaderboard(req.params.id),
    declaredWinner: cycle.declaredWinner || null,
  })
}))

// GET /api/org/scholarship/cycles/:id/attempts/:userId — one answer sheet
router.get('/cycles/:id/attempts/:userId', asyncHandler(async (req, res) => {
  await service.getCycle(req.params.id, req.org.id)
  res.json({ attempt: await service.attemptDetail(req.params.id, req.params.userId) })
}))

// POST /api/org/scholarship/cycles/:id/winner — { userId } (null clears it)
router.post('/cycles/:id/winner', asyncHandler(async (req, res) => {
  const cycle = await service.declareWinner(req.params.id, req.body?.userId || null, req.org.id)
  res.json({ cycle: service.cycleDTO(cycle) })
}))

export default router
