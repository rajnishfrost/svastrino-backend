import { Router } from 'express'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import { adminGetOffers, adminPostOffer, adminPatchOffer, adminDeleteOffer } from './notifications.controller.js'

// Mounted at /api/admin/notifications — gated by the 'content' module, since
// publishing an offer is a marketing/content job rather than a payments one:
// the discount it advertises is still a coupon owned by the payments module.
const router = Router()
router.use(requireAdminAuth, requirePermission('content'))

router.get('/offers', adminGetOffers)
router.post('/offers', adminPostOffer)
router.patch('/offers/:id', adminPatchOffer)
router.delete('/offers/:id', adminDeleteOffer)

export default router
