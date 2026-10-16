import { Router } from 'express'
import mongoose from 'mongoose'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { requireUserAuth } from '../../../middleware/auth.js'
import * as gifts from './gift.service.js'

// Mounted at /api/user/gifts — gift coupons (see gift.service.js). Paying goes
// through the ordinary checkout widget and POST /api/user/payments/verify.
const router = Router()

// GET /api/user/gifts/options — the values on offer; public, so the page can
// show them before the visitor signs in.
router.get('/options', (req, res) => res.json(gifts.giftOptions()))

router.use(requireUserAuth)

// POST /api/user/gifts/order  { value (paise), quantity, email }
router.post('/order', asyncHandler(async (req, res) => {
  const { value, quantity, email } = req.body || {}
  res.status(201).json(await gifts.createGiftOrder({ userId: req.user.id, value, quantity, email }))
}))

// GET /api/user/gifts — what this student has bought
router.get('/', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ gifts: await gifts.listGifts(req.user.id) })
}))

// GET /api/user/gifts/orders/:id — one paid gift order and its coupons
router.get('/orders/:id', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Gift order not found' })
  res.set('Cache-Control', 'no-store')
  res.json({ gift: await gifts.getGift(req.user.id, req.params.id) })
}))

export default router
