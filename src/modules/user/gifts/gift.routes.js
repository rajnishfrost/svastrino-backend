import { Router } from 'express'
import mongoose from 'mongoose'
import rateLimit from 'express-rate-limit'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { requireUserAuth, optionalUserAuth } from '../../../middleware/auth.js'
import { verifyGiftOrder } from '../payments/payments.service.js'
import * as gifts from './gift.service.js'

// Mounted at /api/user/gifts — gift coupons (see gift.service.js). Buying needs
// no account: the order hands the browser a secret token, and confirming the
// payment and reading the coupons take that token instead of a login.
const router = Router()

// Ordering and checking are open to anyone, so keep a bot from creating
// gateway orders in bulk. Generous enough for a family retrying a payment.
const giftLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
})

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(404).json({ error: 'Gift order not found' })

// GET /api/user/gifts/options — the values on offer
router.get('/options', (req, res) => res.json(gifts.giftOptions()))

// POST /api/user/gifts/order  { value (paise), quantity, email } — signed in or not
router.post('/order', giftLimiter, optionalUserAuth, asyncHandler(async (req, res) => {
  const { value, quantity, email } = req.body || {}
  res.status(201).json(await gifts.createGiftOrder({ userId: req.user?.id || null, value, quantity, email }))
}))

// POST /api/user/gifts/orders/:id/verify  { token } — after the payment popup
router.post('/orders/:id/verify', giftLimiter, validId, asyncHandler(async (req, res) => {
  await verifyGiftOrder({ orderId: req.params.id, token: req.body?.token })
  res.json({ gift: await gifts.getGiftByToken(req.params.id, req.body?.token) })
}))

// GET /api/user/gifts/orders/:id?t=<token> — one paid gift order and its coupons
// (the page reads it again when Cashfree sends the buyer back here)
router.get('/orders/:id', giftLimiter, validId, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ gift: await gifts.getGiftByToken(req.params.id, req.query.t) })
}))

// GET /api/user/gifts — everything this account has bought (signed in only)
router.get('/', requireUserAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ gifts: await gifts.listGifts(req.user.id) })
}))

export default router
