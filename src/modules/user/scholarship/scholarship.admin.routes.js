import { Router } from 'express'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import * as service from './scholarship.service.js'
import * as orgService from '../organisation/organisation.service.js'
import { ORG_TYPES, ORG_TYPE_LABELS, ORG_MODULES } from '../organisation/organisation.model.js'

/**
 * Mounted at /api/admin/scholarship — gated by the 'scholarship' module.
 *
 * Admin sees the whole programme across every organisation: applications and
 * their review, what each partner has been granted, every cycle with live
 * counts, and — by passing no organisation scope to the service — any cycle's
 * questions, enrolments, leaderboard and individual answer sheets.
 */
const router = Router()
router.use(requireAdminAuth, requirePermission('scholarship'))

const qDTO = (q) => ({
  id: q._id,
  order: q.order,
  prompt: q.prompt,
  guidance: q.guidance || '',
  maxWords: q.maxWords || 1000,
})

// ---- Programme overview ------------------------------------------------------

// GET /api/admin/scholarship/overview
router.get('/overview', asyncHandler(async (req, res) => {
  res.json({
    stats: await service.adminOverview(),
    types: ORG_TYPES.map((key) => ({ key, label: ORG_TYPE_LABELS[key] })),
    orgModules: ORG_MODULES,
  })
}))

// ---- Organisations -----------------------------------------------------------

// GET /api/admin/scholarship/organisations?status=&type=&q=
router.get('/organisations', asyncHandler(async (req, res) => {
  const list = await orgService.listOrganisations({
    status: req.query.status,
    type: req.query.type,
    q: req.query.q,
  })
  res.json({ organisations: list.map(orgService.fullOrgDTO) })
}))

// GET /api/admin/scholarship/organisations/:id — profile + numbers + its cycles
router.get('/organisations/:id', asyncHandler(async (req, res) => {
  const [org, stats, cycles] = await Promise.all([
    orgService.getOrganisation(req.params.id),
    orgService.organisationStats(req.params.id),
    service.listAllCycles({ organisation: req.params.id }),
  ])
  res.json({ organisation: orgService.fullOrgDTO(org), stats, cycles })
}))

// PATCH /api/admin/scholarship/organisations/:id — approve / reject
// Body: { status: 'approved' | 'rejected', reason }
router.patch('/organisations/:id', asyncHandler(async (req, res) => {
  const org = await orgService.reviewOrganisation(req.admin.id, req.params.id, req.body || {})
  res.json({ organisation: orgService.fullOrgDTO(org) })
}))

// PUT /api/admin/scholarship/organisations/:id — edit profile, modules, listing,
// suspension. Kept separate from the review PATCH so the two can't be confused.
router.put('/organisations/:id', asyncHandler(async (req, res) => {
  const org = await orgService.updateOrganisationByAdmin(req.params.id, req.body || {})
  res.json({ organisation: orgService.fullOrgDTO(org) })
}))

// GET /api/admin/scholarship/organisations/:id/students
router.get('/organisations/:id/students', asyncHandler(async (req, res) => {
  res.json({
    students: await orgService.listOrgStudents(req.params.id, { q: req.query.q, cycleId: req.query.cycleId }),
  })
}))

// ---- Cycles (across every organisation) --------------------------------------

// GET /api/admin/scholarship/cycles?organisation=&year=&status=
router.get('/cycles', asyncHandler(async (req, res) => {
  res.json({
    cycles: await service.listAllCycles({
      organisation: req.query.organisation,
      year: req.query.year,
      status: req.query.status,
    }),
  })
}))

// GET /api/admin/scholarship/cycles/:id
router.get('/cycles/:id', asyncHandler(async (req, res) => {
  const cycle = await service.getCycle(req.params.id)
  res.json({ cycle: service.cycleDTO(cycle) })
}))

// PATCH /api/admin/scholarship/cycles/:id — admin can correct any cycle
router.patch('/cycles/:id', asyncHandler(async (req, res) => {
  const cycle = await service.updateCycle(req.params.id, req.body || {})
  res.json({ cycle: service.cycleDTO(cycle) })
}))

// GET /api/admin/scholarship/cycles/:id/questions — including grading guidance
router.get('/cycles/:id/questions', asyncHandler(async (req, res) => {
  const qs = await service.listQuestions(req.params.id, { withGuidance: true })
  res.json({ questions: qs.map(qDTO) })
}))

// PUT /api/admin/scholarship/cycles/:id/questions
router.put('/cycles/:id/questions', asyncHandler(async (req, res) => {
  const qs = await service.saveQuestions(req.params.id, req.body?.questions)
  res.json({ questions: qs.map(qDTO) })
}))

// GET /api/admin/scholarship/cycles/:id/enrollments
router.get('/cycles/:id/enrollments', asyncHandler(async (req, res) => {
  res.json({ enrollments: await service.listEnrollments(req.params.id) })
}))

// DELETE /api/admin/scholarship/enrollments/:id
router.delete('/enrollments/:id', asyncHandler(async (req, res) => {
  await service.removeEnrollment(req.params.id)
  res.json({ ok: true })
}))

// GET /api/admin/scholarship/cycles/:id/leaderboard
router.get('/cycles/:id/leaderboard', asyncHandler(async (req, res) => {
  const cycle = await service.getCycle(req.params.id)
  res.json({
    leaderboard: await service.leaderboard(req.params.id),
    declaredWinner: cycle.declaredWinner || null,
  })
}))

// GET /api/admin/scholarship/cycles/:id/attempts/:userId — one answer sheet
router.get('/cycles/:id/attempts/:userId', asyncHandler(async (req, res) => {
  res.json({ attempt: await service.attemptDetail(req.params.id, req.params.userId) })
}))

// POST /api/admin/scholarship/cycles/:id/winner — { userId } (null clears it)
router.post('/cycles/:id/winner', asyncHandler(async (req, res) => {
  const cycle = await service.declareWinner(req.params.id, req.body?.userId || null)
  res.json({ cycle: service.cycleDTO(cycle) })
}))

export default router
