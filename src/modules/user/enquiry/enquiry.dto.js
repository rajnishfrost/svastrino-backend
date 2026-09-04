const fail = (message, field) => {
  const err = new Error(message)
  err.status = 400
  if (field) err.field = field
  return err
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Validate and normalise an incoming enquiry. Never trust the body. */
export function validateEnquiry(body = {}) {
  const name = clean(body.name, 80)
  const email = clean(body.email, 160).toLowerCase()
  const phone = clean(body.phone, 20)
  const message = clean(body.message, 2000)
  const studentClass = clean(body.studentClass, 40)
  const city = clean(body.city, 80)
  const program = clean(body.program, 60)
  const preferredTime = clean(body.preferredTime, 80)
  const SOURCES = ['home', 'expert-call', 'contact']
  const source = SOURCES.includes(body.source) ? body.source : 'contact'

  if (name.length < 2) throw fail('Please tell us your name', 'name')

  // The home banner and the expert-call panel share one set of fields and ask
  // for all of them, so they are checked the same way here. An enquiry missing
  // a city or a way to reach the sender is one the team cannot act on, and the
  // browser is the last place to enforce that — anything can post to this route.
  //
  // The contact page is a different form with a different shape (no city, no
  // phone) and keeps the rules it always had.
  const FULL = source === 'home' || source === 'expert-call'

  if (!email) throw fail('Please add your email address', 'email')
  if (!EMAIL_RE.test(email)) throw fail('That email does not look right', 'email')

  if (FULL) {
    if (!phone) throw fail('Please leave a phone number so we can reach you', 'phone')
    if (!city) throw fail('Please tell us where you are based', 'city')
    if (message.length < 3) throw fail('Please tell us how we can help', 'message')
    if (source === 'expert-call' && !preferredTime) {
      throw fail('Please tell us when we should call', 'preferredTime')
    }
  } else if (message.length < 3) {
    throw fail('Please tell us how we can help', 'message')
  }

  if (phone && !/^[+\d][\d\s-]{6,19}$/.test(phone)) throw fail('That phone number does not look right', 'phone')

  return { name, email, phone, message, studentClass, city, program, preferredTime, source }
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
