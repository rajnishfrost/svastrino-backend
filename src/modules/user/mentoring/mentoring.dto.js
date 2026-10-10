import { LIMITS, badRequest, lower } from '../../../utils/validate.js'

/**
 * Shape-check a booking request before any of it reaches the service.
 *
 * This is not only about length. `sku` is used as-is in Package.findOne({ sku }),
 * and express parses JSON, so a body of { "sku": { "$ne": null } } arrives as an
 * OBJECT and Mongo reads it as a query operator — "any package" rather than "this
 * package". Forcing each field through a string normaliser is what closes that,
 * and the pattern checks are what stop `start.split(':')` being handed something
 * with no colon in it and throwing a 500 where a 400 belongs.
 *
 * The date and time are not range-checked here on purpose. Whether a slot is
 * bookable depends on the calendar, the two-hour grid and what is already taken,
 * and slots.js owns all of that — this only guarantees it is looking at something
 * shaped like a date and a time.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** A package SKU: the ids we mint are lower-case letters, digits, dash, underscore. */
const SKU_RE = /^[a-z0-9][a-z0-9_-]{1,79}$/

export function validateBooking(body = {}) {
  const sku = lower(body.sku, LIMITS.slug)
  if (!SKU_RE.test(sku)) throw badRequest('Please choose a program from the list', 'sku')
  return { sku, ...validateSlot(body) }
}

/** The date and time half on its own — a reschedule keeps its original SKU. */
export function validateSlot(body = {}) {
  const date = lower(body.date, 10)
  const start = lower(body.start, 5)
  if (!DATE_RE.test(date)) throw badRequest('Please pick a date', 'date')
  if (!TIME_RE.test(start)) throw badRequest('Please pick a time', 'start')
  return { date, start }
}
