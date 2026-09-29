import { Router } from 'express'
import { requireUserAuth, requireSiteAccess } from '../../../middleware/auth.js'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './payments.service.js'
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

// An institution's payment link (/pay/<token>). Public: the institution pays
// without signing in, and the 48-character token in the link is the secret.
router.get('/link/:token', asyncHandler(async (req, res) => {
  res.json(await service.getPayLink(req.params.token))
}))
router.post('/link/:token/verify', asyncHandler(async (req, res) => {
  const b = req.body || {}
  res.json(await service.verifyPayLink(req.params.token, {
    paymentId: b.paymentId ? String(b.paymentId).slice(0, 100) : undefined,
    signature: b.signature ? String(b.signature).slice(0, 200) : undefined,
  }))
}))

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
