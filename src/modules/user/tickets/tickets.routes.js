import { Router } from 'express'
import { requireUserAuth } from '../../../middleware/auth.js'
import { ticketLimiter } from '../../../middleware/rateLimit.js'
import { postTicket, getMyTickets, getMyTicket, postMyReply } from './tickets.controller.js'

// Mounted at /api/user/tickets. Every route here is the caller's own support
// conversation, so the whole router sits behind the sign-in guard.
const router = Router()
router.use(requireUserAuth)

// Only opening a thread is limited. Replying is not: a student in the middle
// of a conversation with us should never be told to wait.
router.post('/', ticketLimiter, postTicket)
router.get('/', getMyTickets)
router.get('/:id', getMyTicket)
router.post('/:id/reply', postMyReply)

export default router
