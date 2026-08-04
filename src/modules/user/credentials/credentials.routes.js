import { Router } from 'express'
import {
  signup,
  login,
  guest,
  google,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetInfo,
  resetPassword,
} from './credentials.controller.js'
import { authLimiter, emailLimiter } from '../../../middleware/rateLimit.js'

// Mounted at /api/user/auth
const router = Router()

// Credential entry points — brute-force limited.
router.post('/signup', authLimiter, signup)
router.post('/login', authLimiter, login)
router.post('/guest', authLimiter, guest) // guest checkout (mentoring booking)
router.post('/google', authLimiter, google)
router.get('/reset-info', resetInfo)
router.post('/reset-password', authLimiter, resetPassword)
router.post('/verify-email', authLimiter, verifyEmail)

// Email-dispatching routes — stricter limit to prevent inbox spam.
router.post('/resend-verification', emailLimiter, resendVerification)
router.post('/forgot-password', emailLimiter, forgotPassword)

export default router
