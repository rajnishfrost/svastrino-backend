import { Router } from 'express'
import { requireUserAuth, requireSiteAccess } from '../../../middleware/auth.js'
import {
  getQuote,
  upgradeStatus,
  createOrder,
  cancelOrder,
  verify,
  listOrders,
  getOrder,
  listEnrollments,
  webhook,
} from './payments.controller.js'

// Mounted at /api/user/payments
const router = Router()

// Gateway webhook is public (the gateway calls it, not the browser).
router.post('/webhook', webhook)

// Everything else needs a signed-in user with the student portal open to them:
// buying a course is a student act, and an account barred from the portal has
// nowhere to use what it would buy.
router.use(requireUserAuth, requireSiteAccess)
router.get('/quote', getQuote)
router.get('/upgrade-status', upgradeStatus)
router.post('/order', createOrder)
router.post('/verify', verify)
router.get('/orders', listOrders)
router.get('/orders/:id', getOrder)
router.post('/orders/:id/cancel', cancelOrder)
router.get('/enrollments', listEnrollments)

export default router
