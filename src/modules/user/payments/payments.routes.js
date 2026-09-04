import { Router } from 'express'
import { requireUserAuth } from '../../../middleware/auth.js'
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

// Everything else needs a signed-in user.
router.use(requireUserAuth)
router.get('/quote', getQuote)
router.get('/upgrade-status', upgradeStatus)
router.post('/order', createOrder)
router.post('/verify', verify)
router.get('/orders', listOrders)
router.get('/orders/:id', getOrder)
router.post('/orders/:id/cancel', cancelOrder)
router.get('/enrollments', listEnrollments)

export default router
