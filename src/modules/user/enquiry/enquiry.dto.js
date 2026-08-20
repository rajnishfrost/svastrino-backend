const fail = (message, field) => {
  const err = new Error(message)
  err.status = 400
  if (field) err.field = field
  return err
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max)

/** Validate and normalise an incoming enquiry. Never trust the body. */
export function validateEnquiry(body = {}) {
  const name = clean(body.name, 80)
  const email = clean(body.email, 160).toLowerCase()
  const phone = clean(body.phone, 20)
  const message = clean(body.message, 2000)
  const studentClass = clean(body.studentClass, 40)
  const city = clean(body.city, 80)
  const source = body.source === 'home' ? 'home' : 'contact'

  if (name.length < 2) throw fail('Please tell us your name', 'name')

  // We need ONE way to reach them back. The contact form asks for an email; the
  // home-page form asks for a phone number instead and has no email field at
  // all, so each form is validated against what it actually collects.
  if (source === 'contact') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('That email does not look right', 'email')
  } else if (!phone) {
    throw fail('Please leave a phone number so we can reach you', 'phone')
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('That email does not look right', 'email')
  if (phone && !/^[+\d][\d\s-]{6,19}$/.test(phone)) throw fail('That phone number does not look right', 'phone')
  // The contact form asks for a message; the home form asks what you need help
  // with, which may legitimately be left blank once class and city are given.
  if (source === 'contact' && message.length < 3) throw fail('Please tell us how we can help', 'message')

  return { name, email, phone, message, studentClass, city, source }
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
    source: e.source,
    status: e.status,
    notes: e.notes,
    createdAt: e.createdAt,
  }
}
