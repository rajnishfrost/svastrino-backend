import mongoose from 'mongoose'

/**
 * Everything behind the bell icon lives here, in two schemas rather than one.
 *
 *   Notification : something that happened to ONE student — their report is
 *                  ready, a phase unlocked, a session was confirmed, a payment
 *                  went through. It is addressed, it can be read, and it is
 *                  worthless to anybody else.
 *   Offer        : a broadcast the team publishes — a discount, a new batch, a
 *                  scholarship window. It belongs to nobody, it is live for a
 *                  period, and the same row is shown to every visitor.
 *
 * Keeping them apart avoids writing one row per student every time marketing
 * announces something, and avoids an "is this mine?" flag on every read. They
 * share a module because to the student they are one list: the bell shows their
 * notifications and the live offers together, and the "New offers" page is just
 * the offers half of it on its own.
 */

export const NOTIFICATION_KINDS = ['system', 'course', 'payment', 'booking', 'report', 'offer']
export const OFFER_AUDIENCES = ['everyone', 'students']

// --- Addressed to one student ------------------------------------------------
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // What raised it, so the client can pick an icon and the team can filter.
    kind: { type: String, enum: NOTIFICATION_KINDS, default: 'system', index: true },

    title: { type: String, required: true, trim: true },
    body: { type: String, default: '', trim: true },

    // Where clicking it should take them — an in-app path such as '/dashboard',
    // never an absolute URL, so the client can route it without a page load.
    link: { type: String, default: '', trim: true },

    // Null until they open the bell. A timestamp rather than a boolean because
    // "when did they see it" answers support questions a flag cannot.
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
)

// The only query this collection ever serves: one student's list, newest first.
notificationSchema.index({ user: 1, createdAt: -1 })

// --- Broadcast to everyone ---------------------------------------------------
const offerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, default: '', trim: true },

    // The coupon code to show on the card, if the offer has one. Displayed for
    // the student to copy — the discount itself is enforced by the coupon in
    // the payments module, not by this row.
    code: { type: String, default: '', trim: true },

    link: { type: String, default: '', trim: true },
    image: { type: String, default: '', trim: true },

    // The window the offer is live for. Either end may be null, which means
    // open-ended in that direction: an offer with neither runs until it is
    // switched off by hand.
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },

    // Kill-switch that is independent of the window, so the team can pull an
    // offer immediately without editing its dates.
    active: { type: Boolean, default: true, index: true },

    // 'everyone' shows on the public page to signed-out visitors too;
    // 'students' is held back for signed-in accounts.
    audience: { type: String, enum: OFFER_AUDIENCES, default: 'everyone' },

    // Hand-ordering for the "New offers" page — the team decides what leads.
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema)
export const Offer = mongoose.models.Offer || mongoose.model('Offer', offerSchema)
