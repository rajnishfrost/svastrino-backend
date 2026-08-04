import { Router } from 'express'
import { login, getMe, getAdmins, postAdmin, patchAdmin } from './credentials.controller.js'
import { requireAdminAuth, requireAdminRole } from '../../../middleware/auth.js'

// Mounted at /api/admin/auth
const router = Router()

router.post('/login', login)
router.get('/me', requireAdminAuth, getMe)

export default router

// ---- Admin management (mounted at /api/admin/admins; superadmin only) ----
export const adminsRouter = Router()
adminsRouter.use(requireAdminAuth, requireAdminRole('superadmin'))
adminsRouter.get('/', getAdmins)
adminsRouter.post('/', postAdmin)
adminsRouter.patch('/:id', patchAdmin)
