import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

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

/**
 * Starting a support conversation. A student whose course has just locked may
 * well write two or three times in an hour, and none of those should be turned
 * away; past that it is no longer a person asking for help. The route sits
 * behind the sign-in guard, so the account is the fairer key than the device —
 * a whole family on one connection is not one abuser.
 */
export const ticketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // ipKeyGenerator, not req.ip, for the signed-out fallback: it normalises an
  // IPv6 address to its subnet, which is what the library expects of a custom
  // key and what stops one visitor rotating through addresses.
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: {
    error:
      'You have started several conversations just now. Please wait a little while, and reply in the one you already have.',
  },
})
