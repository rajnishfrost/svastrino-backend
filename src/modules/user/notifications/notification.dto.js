import { OFFER_AUDIENCES } from './notification.model.js'

const fail = (message, field) => {
  const err = new Error(message)
  err.status = 400
  if (field) err.field = field
  return err
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max)

/**
 * Parse a date the admin form sent. An empty value is a deliberate "no bound"
 * and becomes null; anything unparseable is a mistake worth reporting rather
 * than silently dropping, because a bad date would quietly hide the offer.
 */
const date = (v, field) => {
  if (v == null || v === '') return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw fail('That date does not look right', field)
  return d
}

/**
 * Validate and normalise an offer coming from the admin panel. The same
 * function serves create and update — the offer form posts the whole record
 * back either way, so there is nothing to merge.
 */
export function validateOffer(body = {}) {
  const title = clean(body.title, 140)
  const text = clean(body.body, 2000)
  // Coupon codes are stored and compared upper-case everywhere else (see the
  // payments module), so the one we print on the card matches what checkout
  // will accept.
  const code = clean(body.code, 40).toUpperCase()
  const link = clean(body.link, 300)
  const image = clean(body.image, 500)

  if (title.length < 2) throw fail('Please give the offer a title', 'title')

  const startsAt = date(body.startsAt, 'startsAt')
  const endsAt = date(body.endsAt, 'endsAt')
  // An offer that ends before it starts is never live, which looks like a
  // silent failure to whoever published it.
  if (startsAt && endsAt && endsAt < startsAt) {
    throw fail('The offer cannot end before it starts', 'endsAt')
  }

  const audience = OFFER_AUDIENCES.includes(body.audience) ? body.audience : 'everyone'
  const order = Number.isFinite(Number(body.order)) ? Number(body.order) : 0

  return {
    title,
    body: text,
    code,
    link,
    image,
    startsAt,
    endsAt,
    // Only an explicit false switches an offer off, so a form that omits the
    // field still publishes.
    active: body.active === undefined ? true : !!body.active,
    audience,
    order,
  }
}

export function toNotificationDTO(n) {
  return {
    id: String(n._id),
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    // The client only ever branches on read/unread; readAt is there for the
    // rare "when did I see this" case.
    read: !!n.readAt,
    readAt: n.readAt,
    createdAt: n.createdAt,
  }
}

export function toOfferDTO(o) {
  return {
    id: String(o._id),
    title: o.title,
    body: o.body,
    code: o.code,
    link: o.link,
    image: o.image,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    active: o.active,
    audience: o.audience,
    order: o.order,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }
}
