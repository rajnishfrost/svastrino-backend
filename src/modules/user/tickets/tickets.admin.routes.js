import { Router } from 'express'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import {
  adminGetTickets,
  adminGetTicket,
  adminPostReply,
  adminPatchStatus,
  adminPostGrant,
} from './tickets.controller.js'

// Mounted at /api/admin/tickets. Gated by the 'users' module: a ticket is a
// conversation with one student, and reopening their course is a decision about
// that student's account.
const router = Router()
router.use(requireAdminAuth, requirePermission('users'))

router.get('/', adminGetTickets)          // ?status=open|awaiting_student|resolved|closed&q=
router.get('/:id', adminGetTicket)
router.post('/:id/reply', adminPostReply)
router.patch('/:id/status', adminPatchStatus) // { status }
router.post('/:id/grant', adminPostGrant)     // { days } — reopen the course

export default router
