import { Router } from 'express'
import { getRoles, postRole, patchRole, deleteRole } from './roles.controller.js'
import { requireAdminAuth, requireAdminRole } from '../../../middleware/auth.js'

// Mounted at /api/admin/roles — managing roles is superadmin-only. Roles are
// fully CRUD-able except the two seeded system roles: `student` (can't be
// deleted) and `superadmin` (locked + can't be deleted).
const router = Router()
router.use(requireAdminAuth, requireAdminRole('superadmin'))
router.get('/', getRoles)
router.post('/', postRole)
router.patch('/:id', patchRole)
router.delete('/:id', deleteRole)

export default router
