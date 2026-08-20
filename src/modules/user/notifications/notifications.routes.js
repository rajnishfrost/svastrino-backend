import { Router } from 'express'
import { requireUserAuth } from '../../../middleware/auth.js'
import {
  getNotifications,
  readAllNotifications,
  readNotification,
  getOffers,
} from './notifications.controller.js'

// Mounted at /api/user/notifications.
const router = Router()

// Public — the "New offers" page is browsable before anyone signs in, so this
// one route sits outside the guard. Declared first to keep it clearly apart
// from the signed-in half below.
router.get('/offers', getOffers)

// The bell itself. Everything here is scoped to the caller's own account.
router.get('/', requireUserAuth, getNotifications)
router.post('/read-all', requireUserAuth, readAllNotifications)
router.patch('/:id/read', requireUserAuth, readNotification)

export default router
