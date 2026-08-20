import rateLimit from 'express-rate-limit'

/**
 * Rate limiters for auth endpoints — the primary defence against credential
 * brute-forcing and email-bombing. Keyed by client IP.
 */
const common = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
}

// Login / signup / Google — tight window to blunt password guessing.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  ...common,
})

// Email-sending routes (forgot-password, resend-verification) — stricter, so
// the SMTP relay can't be abused to spam a victim's inbox.
export const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  ...common,
})

/**
 * Public enquiry form. Generous enough that a family filling it in twice is
 * never blocked, tight enough that a bot cannot flood the inbox.
 */
export const enquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many enquiries from this device. Please try again later.' },
})
