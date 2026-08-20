import mongoose from 'mongoose'

import { Notification, Offer } from './notification.model.js'

const httpError = (message, status) => {
  const err = new Error(message)
  err.status = status
  return err
}

// An id that is not an ObjectId at all is still just an id we do not hold, so
// it deserves the same 404 as a well-formed one we cannot find. Left to Mongoose
// it would instead throw a CastError on the way to the database, which carries
// no status and so surfaces to the caller as a 500 quoting our model and field
// names — and fills the error log with stacks anyone can trigger by hand.
const isId = (id) => mongoose.isValidObjectId(id)

// The bell shows a short list, never a full archive; a runaway ?limit would
// only serve to page megabytes of old rows into a dropdown.
const MAX_LIMIT = 100

// ---- One student's notifications --------------------------------------------

/** That student's notifications, newest first. */
export async function listForUser(userId, { limit = 30 } = {}) {
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 30))
  return Notification.find({ user: userId }).sort({ createdAt: -1 }).limit(safeLimit)
}

/** How many they have not opened yet — the number painted on the bell. */
export async function unreadCount(userId) {
  return Notification.countDocuments({ user: userId, readAt: null })
}

/**
 * Mark one as read. Scoped by user as well as id so a guessed id from someone
 * else's account is a 404 rather than a write. Marking an already-read one
 * again is a no-op: the client fires this on every click of the row.
 */
export async function markRead(userId, id) {
  if (!isId(id)) throw httpError('Notification not found', 404)
  const n = await Notification.findOne({ _id: id, user: userId })
  if (!n) throw httpError('Notification not found', 404)
  if (!n.readAt) {
    n.readAt = new Date()
    await n.save()
  }
  return n
}

/** Clear the badge in one go. Always scoped to the caller's own rows. */
export async function markAllRead(userId) {
  const result = await Notification.updateMany(
    { user: userId, readAt: null },
    { $set: { readAt: new Date() } }
  )
  return { updated: result.modifiedCount || 0 }
}

/**
 * Raise a notification for a student. This is what the rest of the app calls —
 * after a payment, when a report is attached, when a booking is confirmed.
 *
 * Deliberately forgiving, in the same spirit as the enquiry email: telling
 * somebody about a thing must never be able to break the thing itself. A failed
 * write is logged and swallowed, and the caller gets null back rather than an
 * exception in the middle of its happy path.
 */
export async function notify(userId, { kind = 'system', title, body = '', link = '' } = {}) {
  if (!userId || !title) return null
  try {
    return await Notification.create({ user: userId, kind, title, body, link })
  } catch (err) {
    console.error('✗ Could not raise a notification:', err.message)
    return null
  }
}

// ---- Offers ------------------------------------------------------------------

/**
 * The offers a visitor should see right now: switched on, inside their window,
 * and meant for them. A null startsAt or endsAt means open-ended in that
 * direction, and a missing field matches null in Mongo, so offers saved before
 * a bound was ever set still show.
 *
 * `now` is read once so every comparison in the query agrees on the moment.
 */
export async function liveOffers({ signedIn = false } = {}) {
  const now = new Date()
  return Offer.find({
    active: true,
    audience: signedIn ? { $in: ['everyone', 'students'] } : 'everyone',
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  }).sort({ order: 1, createdAt: -1 })
}

// ---- Offers: admin -----------------------------------------------------------

/** Every offer, live or not — the admin table needs the expired ones too. */
export async function adminListOffers() {
  return Offer.find().sort({ order: 1, createdAt: -1 })
}

export async function createOffer(data) {
  return Offer.create(data)
}

export async function updateOffer(id, data) {
  if (!isId(id)) throw httpError('Offer not found', 404)
  const offer = await Offer.findByIdAndUpdate(id, data, { new: true })
  if (!offer) throw httpError('Offer not found', 404)
  return offer
}

export async function deleteOffer(id) {
  if (!isId(id)) throw httpError('Offer not found', 404)
  const offer = await Offer.findByIdAndDelete(id)
  if (!offer) throw httpError('Offer not found', 404)
  return { ok: true }
}
