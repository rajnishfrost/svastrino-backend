import { Router } from 'express'
import { enquiryLimiter } from '../../../middleware/rateLimit.js'
import { submitEnquiry } from './enquiry.controller.js'

// Mounted at /api/user/enquiry — public, so it is rate-limited by IP.
const router = Router()
router.post('/', enquiryLimiter, submitEnquiry)
export default router
