import { Router } from 'express'
import { requireAdminAuth, requireAdminRole } from '../../../middleware/auth.js'
import { getSettings, patchSettings } from './settings.controller.js'

// Mounted at /api/admin/settings. Site-wide switches, so superadmin only.
const router = Router()
router.use(requireAdminAuth, requireAdminRole('superadmin'))
router.get('/', getSettings)
router.patch('/', patchSettings)
export default router
