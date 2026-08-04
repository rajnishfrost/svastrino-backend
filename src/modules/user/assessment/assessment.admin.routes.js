import { Router } from 'express'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import { adminList, adminComplete, adminReopen, adminSetCoupon } from './assessment.controller.js'
import { uploadReportMw, uploadReport } from './reportUpload.controller.js'

// Mounted at /api/admin/assessments
const router = Router()
router.use(requireAdminAuth, requirePermission('assessments'))

router.get('/', adminList)                     // ?status=submitted&product=nirmaan
router.post('/report-pdf', uploadReportMw, uploadReport) // re-host the Mindler PDF → { url }
router.patch('/:id/complete', adminComplete)   // { reportUrl, topCareers[], summary }
router.patch('/:id/reopen', adminReopen)       // { notes? }
router.patch('/:id/coupon', adminSetCoupon)    // { couponCode } — per-student Mindler coupon

export default router
