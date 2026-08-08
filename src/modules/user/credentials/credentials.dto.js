// Input validation + shaping for the user credentials module.
// DTOs keep raw request bodies out of the service/controller layer and are the
// authoritative server-side validation (the client checks are only UX sugar).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// E.164-ish: optional +, 8–15 digits. Phone is optional on signup.
const PHONE_RE = /^\+?[0-9]{8,15}$/
const NAME_RE = /^[\p{L}][\p{L}\s'.-]{1,59}$/u

const fail = (message, status = 400) => {
  const err = new Error(message)
  err.status = status
  throw err
}

// Strip angle brackets to shrink the HTML/script-injection surface. Real
// escaping happens at render time; this is defence-in-depth on the way in.
const clean = (s) => String(s ?? '').replace(/[<>]/g, '').trim()

function normalizeEmail(raw) {
  const email = clean(raw).toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 254) fail('Enter a valid email address')
  return email
}

// 0–4 strength score — mirrors the client's utils/password.js scorePassword.
function scorePassword(pw) {
  let score = 0
  if (pw.length >= 8) score += 1
  if (pw.length >= 12) score += 1
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1
  if (/\d/.test(pw)) score += 1
  if (/[^A-Za-z0-9]/.test(pw)) score += 1
  return Math.min(score, 4)
}

// The single password policy enforced everywhere a password is set (signup,
// reset, change). Matches the client rule so both sides agree.
function checkPassword(raw) {
  const password = String(raw ?? '')
  if (password.length < 8) fail('Password must be at least 8 characters')
  if (password.length > 128) fail('Password is too long')
  if (scorePassword(password) < 2) fail('Use letters, numbers & a symbol')
  return password
}

// True if the password embeds any 3+ char part of the user's name — such
// passwords are guessable even with extra characters bolted on.
export function passwordHasName(name, password) {
  const lowerPw = String(password ?? '').toLowerCase()
  return String(name ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 3)
    .some((part) => lowerPw.includes(part))
}

// Normalise a phone string to bare digits (with optional leading +). Returns
// null for an empty value (caller decides whether clearing is allowed).
function parsePhone(raw) {
  const phone = clean(raw).replace(/[\s()-]/g, '')
  if (phone === '') return null
  if (!PHONE_RE.test(phone)) fail('Enter a valid phone number')
  return phone
}

export function validateSignup(body) {
  const name = clean(body.name)
  if (!NAME_RE.test(name)) fail("Enter a valid name (letters, spaces, . - ')")

  const email = normalizeEmail(body.email)
  const password = checkPassword(body.password)

  // Reject passwords built around the user's own name (mirrors the client check).
  if (passwordHasName(name, password)) fail('Password must not contain your name')

  const phone = body.phone != null ? parsePhone(body.phone) : undefined

  return { name, email, password, phone: phone ?? undefined }
}

/** Guest checkout (mentoring booking): name + email required, no password —
 *  the account is created on the fly and a set-password email follows. */
export function validateGuest(body) {
  const name = clean(body.name)
  if (!NAME_RE.test(name)) fail("Enter a valid name (letters, spaces, . - ')")
  const email = normalizeEmail(body.email)
  const phone = body.phone != null ? parsePhone(body.phone) : undefined
  return { name, email, phone: phone ?? undefined }
}

/** Partial account update — any of name/phone. At least one must be present. */
export function validateUpdateProfile(body) {
  const out = {}
  if (body.name != null) {
    const name = clean(body.name)
    if (!NAME_RE.test(name)) fail("Enter a valid name (letters, spaces, . - ')")
    out.name = name
  }
  if (body.phone != null) {
    out.phone = parsePhone(body.phone) // string, or null to clear
  }
  if (Object.keys(out).length === 0) fail('Nothing to update')
  return out
}

/** Change/set password. `currentPassword` is only required when one exists. */
export function validateChangePassword(body) {
  const newPassword = checkPassword(body.newPassword)
  const currentPassword = String(body.currentPassword ?? '')
  return { currentPassword, newPassword }
}

export function validateLogin(body) {
  const email = normalizeEmail(body.email)
  const password = String(body.password ?? '')
  if (!password) fail('Password is required')
  return { email, password }
}

/** Google sign-in: the client sends the OAuth access token from Google. */
export function validateGoogle(body) {
  const accessToken = String(body.accessToken ?? body.credential ?? '').trim()
  if (!accessToken) fail('Missing Google credential')
  return { accessToken }
}

export function validateForgot(body) {
  return { email: normalizeEmail(body.email) }
}

export function validateReset(body) {
  const token = String(body.token ?? '').trim()
  if (!token || token.length < 20) fail('Invalid or missing reset token')
  const password = checkPassword(body.password)
  return { token, password }
}

export function validateResend(body) {
  return { email: normalizeEmail(body.email) }
}

/** Shape a user document for the client (never leak internal/secret fields). */
export function toUserDTO(user, extra = {}) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || null,
    avatar: user.avatar || '',
    role: user.role || 'student',
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    // Whether a password is set — the client shows "Change" vs "Set" password.
    // Only accurate when passwordHash was selected (see findUserById).
    hasPassword: !!user.passwordHash,
    isProfileComplete: user.isProfileComplete,
    // Which organisation added this account, and in what capacity:
    //   null       → a plain public signup
    //   'member'   → a student their organisation registered
    //   'owner'    → this account IS the organisation (see modules/org)
    // `organisation` itself is filled in by the controller (name + id).
    organisationRole: user.organisationRole || null,
    // `panel`: does this account's role grant admin-panel access? Set by the
    // login / profile controllers so the client can route + show the panel link.
    ...extra,
  }
}
