import { Router } from 'express'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import { getEnquiries, patchEnquiry } from './enquiry.controller.js'

// Mounted at /api/admin/enquiries.
const router = Router()
router.use(requireAdminAuth, requirePermission('users'))
router.get('/', getEnquiries)
router.patch('/:id', patchEnquiry)
export default router
