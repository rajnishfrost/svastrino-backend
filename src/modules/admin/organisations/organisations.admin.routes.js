import { Router } from 'express'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import * as orgService from '../../user/organisation/organisation.service.js'
import { ORG_TYPES, ORG_TYPE_LABELS, ORG_MODULES } from '../../user/organisation/organisation.model.js'

/**
 * Mounted at /api/admin/organisations — gated by the 'organisations' module.
 *
 * Partner bodies apply through the public form and can do nothing until an
 * admin approves them here; approving is what creates their owner account and
 * sends the set-password link. This used to live under the scholarship module,
 * which is why it was easy to miss that removing the scholarship would have
 * left every partner unapprovable.
 */
const router = Router()
router.use(requireAdminAuth, requirePermission('organisations'))

// GET /api/admin/organisations?status=&type=&q=
router.get('/', asyncHandler(async (req, res) => {
  const list = await orgService.listOrganisations({
    status: req.query.status,
    type: req.query.type,
    q: req.query.q,
    page: req.query.page,
    limit: req.query.limit,
  })
  res.json({
    ...list,
    organisations: list.items.map(orgService.fullOrgDTO),
    types: ORG_TYPES.map((key) => ({ key, label: ORG_TYPE_LABELS[key] })),
    orgModules: ORG_MODULES,
  })
}))

// GET /api/admin/organisations/:id — profile + headline numbers
router.get('/:id', asyncHandler(async (req, res) => {
  const [org, stats] = await Promise.all([
    orgService.getOrganisation(req.params.id),
    orgService.organisationStats(req.params.id),
  ])
  res.json({ organisation: orgService.fullOrgDTO(org), stats })
}))

// PATCH /api/admin/organisations/:id — approve / reject
// Body: { status: 'approved' | 'rejected', reason }
router.patch('/:id', asyncHandler(async (req, res) => {
  const org = await orgService.reviewOrganisation(req.admin.id, req.params.id, req.body || {})
  res.json({ organisation: orgService.fullOrgDTO(org) })
}))

// PUT /api/admin/organisations/:id — edit profile, modules, listing, suspension.
// Kept separate from the review PATCH so the two can never be confused.
router.put('/:id', asyncHandler(async (req, res) => {
  const org = await orgService.updateOrganisationByAdmin(req.params.id, req.body || {})
  res.json({ organisation: orgService.fullOrgDTO(org) })
}))

// POST /api/admin/organisations/students/:userId/restore — undo a removal
router.post('/students/:userId/restore', asyncHandler(async (req, res) => {
  const { user, organisation } = await orgService.restoreOrgStudent(req.params.userId)
  res.json({ ok: true, organisation: { id: organisation._id, name: organisation.name }, userId: user._id })
}))

// GET /api/admin/organisations/:id/students
router.get('/:id/students', asyncHandler(async (req, res) => {
  res.json({ students: await orgService.listOrgStudents(req.params.id, { q: req.query.q }) })
}))

export default router
