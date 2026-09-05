import { Router } from 'express'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import {
  adminListOrders,
  adminRevenue,
  adminRefund,
  adminCreateCoupon,
  adminListCoupons,
  adminSetCouponActive,
} from './payments.controller.js'

// Mounted at /api/admin/payments
const router = Router()
router.use(requireAdminAuth)

router.get('/orders', requirePermission('orders'), adminListOrders) // ?status=paid|refunded|...
router.get('/revenue', requirePermission('orders'), adminRevenue)
router.post('/refund', requirePermission('orders'), adminRefund)    // { orderId, reason? }
router.get('/coupons', requirePermission('coupons'), adminListCoupons)
router.post('/coupons', requirePermission('coupons'), adminCreateCoupon)
router.patch('/coupons/:id', requirePermission('coupons'), adminSetCouponActive) // { active }

export default router
