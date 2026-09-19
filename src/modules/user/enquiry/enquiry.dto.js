import {
  LIMITS, MINIMUMS, oneOf, optionalLine, optionalPhone, optionalPlace,
  requireEmail, requireLine, requireName, requirePhone, requirePlace, requireText,
} from '../../../utils/validate.js'

/**
 * Validate and normalise an incoming enquiry. Never trust the body.
 *
 * Three forms post here and they ask for different things, so the rules are
 * declared per source rather than written out three times:
 *
 *   home         the banner form — everything, plus which class they are in
 *   expert-call  the program-page panel — everything, plus when to ring
 *   contact      the Contact page — no city, and the phone is their choice
 *
 * The checks come from utils/validate.js, which the browser mirrors. That is what
 * makes the two agree: a message the form accepted is one this will accept, and a
 * phone number that got past the country picker is one with a dial code on it.
 * The mirror is a convenience for the visitor, though — this is the copy that
 * decides, because nothing obliges a caller to have loaded our page at all.
 */

const SOURCES = ['home', 'expert-call', 'contact']

export function validateEnquiry(body = {}) {
  const source = oneOf(body.source, SOURCES, 'contact')
  // The Contact page asks for less. Everywhere else, an enquiry without a city or
  // a number is one the team cannot act on, and the browser is the last place to
  // enforce that.
  const full = source !== 'contact'

  const name = requireName(body.name)
  const email = requireEmail(body.email)
  const phone = full
    ? requirePhone(body.phone)
    : optionalPhone(body.phone)
  const city = full
    ? requirePlace(body.city, { label: 'city' })
    : optionalPlace(body.city)
  const message = requireText(body.message, {
    field: 'message',
    label: 'your message',
    min: MINIMUMS.message,
    max: LIMITS.message,
  })

  // Only the expert-call panel asks when to ring, and it is free text on purpose:
  // "after 6pm", "weekends" and "tomorrow morning" all beat a fake slot.
  const preferredTime = source === 'expert-call'
    ? requireLine(body.preferredTime, {
        field: 'preferredTime', label: 'when we should call you', max: LIMITS.shortText,
      })
    : optionalLine(body.preferredTime, { field: 'preferredTime', max: LIMITS.shortText })

  return {
    name,
    email,
    phone,
    message,
    city,
    // Not an enum: the home form's list is worded by marketing, and the
    // psychometric eligibility check reads the year out of whatever it says.
    // Bounded free text keeps every one of those answers valid.
    studentClass: optionalLine(body.studentClass, { field: 'studentClass', max: LIMITS.studentClass }),
    // A program slug the page filled in for them, not something anyone typed.
    program: optionalLine(body.program, { field: 'program', max: LIMITS.slug }),
    preferredTime,
    source,
  }
}

export function toEnquiryDTO(e) {
  return {
    id: e._id,
    name: e.name,
    email: e.email,
    phone: e.phone,
    message: e.message,
    studentClass: e.studentClass,
    city: e.city,
    program: e.program,
    preferredTime: e.preferredTime,
    source: e.source,
    status: e.status,
    approvedAt: e.approvedAt,
    notes: e.notes,
    createdAt: e.createdAt,
  }
}
