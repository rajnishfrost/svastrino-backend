import { asyncHandler } from '../../../utils/asyncHandler.js'
import { toNotificationDTO, toOfferDTO, validateOffer } from './notification.dto.js'
import * as service from './notifications.service.js'

// GET /api/user/notifications — the bell: the list and the badge in one call,
// so opening the dropdown never needs a second round trip.
export const getNotifications = asyncHandler(async (req, res) => {
  const [list, unread] = await Promise.all([
    service.listForUser(req.user.id, { limit: req.query.limit }),
    service.unreadCount(req.user.id),
  ])
  res.json({ notifications: list.map(toNotificationDTO), unread })
})

// POST /api/user/notifications/read-all
export const readAllNotifications = asyncHandler(async (req, res) => {
  await service.markAllRead(req.user.id)
  res.json({ ok: true })
})

// PATCH /api/user/notifications/:id/read
export const readNotification = asyncHandler(async (req, res) => {
  const n = await service.markRead(req.user.id, req.params.id)
  res.json({ notification: toNotificationDTO(n) })
})

// GET /api/user/notifications/offers — public, powers the "New offers" page.
//
// There is no optional-auth middleware in middleware/auth.js today, so nothing
// attaches req.user on a public route and every caller is treated as signed
// out: offers aimed at 'students' stay hidden here. The check is written
// against req.user rather than hard-coded false so it starts working the day an
// optional-auth helper is added, without touching this file.
export const getOffers = asyncHandler(async (req, res) => {
  const offers = await service.liveOffers({ signedIn: !!req.user })
  res.json({ offers: offers.map(toOfferDTO) })
})

// ---- Admin -------------------------------------------------------------------

// GET /api/admin/notifications/offers — every offer, expired ones included.
export const adminGetOffers = asyncHandler(async (req, res) => {
  const offers = await service.adminListOffers()
  res.json({ offers: offers.map(toOfferDTO) })
})

// POST /api/admin/notifications/offers
export const adminPostOffer = asyncHandler(async (req, res) => {
  const offer = await service.createOffer(validateOffer(req.body || {}))
  res.status(201).json({ offer: toOfferDTO(offer) })
})

// PATCH /api/admin/notifications/offers/:id
export const adminPatchOffer = asyncHandler(async (req, res) => {
  const offer = await service.updateOffer(req.params.id, validateOffer(req.body || {}))
  res.json({ offer: toOfferDTO(offer) })
})

// DELETE /api/admin/notifications/offers/:id
export const adminDeleteOffer = asyncHandler(async (req, res) => {
  res.json(await service.deleteOffer(req.params.id))
})
