import { Router } from 'express'
import { enquiryLimiter } from '../../../middleware/rateLimit.js'
import { optionalUserAuth, requireUserAuth } from '../../../middleware/auth.js'
import { submitEnquiry, getMyEnquiry } from './enquiry.controller.js'

// Mounted at /api/user/enquiry — public, so it is rate-limited by IP. The auth
// is optional: a signed-in sender gets their enquiry linked to their account,
// a signed-out one is served exactly as before.
const router = Router()
router.post('/', enquiryLimiter, optionalUserAuth, submitEnquiry)

// Reading your own request needs a real session — it is the only identity we
// can trust, and it is not rate-limited because it is a read.
router.get('/mine', requireUserAuth, getMyEnquiry)
export default router
