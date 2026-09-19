// Input validation + shaping for the user credentials module.
// DTOs keep raw request bodies out of the service/controller layer and are the
// authoritative server-side validation (the client checks are only UX sugar).
//
// The name, email and phone rules come from utils/validate.js, which the browser
// mirrors. They used to live here as a third private copy, and the copies had
// drifted: this file capped a phone at 15 characters while the enquiry forms and
// the database allowed 20, and its name rule refused a name of 61 characters with
// the message "enter a valid name".
import {
  LIMITS, optionalPhone, requireEmail, requireName, str,
} from '../../../utils/validate.js'

const fail = (message, status = 400) => {
  const err = new Error(message)
  err.status = status
  throw err
}

// Strip angle brackets to shrink the HTML/script-injection surface. Real
// escaping happens at render time; this is defence-in-depth on the way in.
const clean = (s, max = LIMITS.shortText) => str(s, max)

const normalizeEmail = (raw) => requireEmail(raw)

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
  if (password.length > LIMITS.password) fail('Password is too long')
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

/**
 * Normalise a phone to E.164. Returns null for an empty value, so the caller
 * decides whether clearing is allowed.
 *
 * Every phone field on the site is a country picker now, so what arrives from our
 * own pages already carries its dial code. A bare ten-digit number is still
 * accepted and read as Indian, because accounts created before the picker existed
 * hold numbers in that shape and a profile save must not fail on a number the
 * account already had.
 */
function parsePhone(raw) {
  return optionalPhone(raw) || null
}

export function validateSignup(body) {
  const name = requireName(body.name)
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
  const name = requireName(body.name)
  const email = normalizeEmail(body.email)
  const phone = body.phone != null ? parsePhone(body.phone) : undefined
  return { name, email, phone: phone ?? undefined }
}

/** Partial account update — any of name/phone/studentClass. At least one must
 *  be present. */
export function validateUpdateProfile(body) {
  const out = {}
  if (body.name != null) out.name = requireName(body.name)
  if (body.phone != null) {
    out.phone = parsePhone(body.phone) // string, or null to clear
  }
  if (body.studentClass != null) {
    // No enum on purpose: the home enquiry form offers 'Class 7' … 'Class 12',
    // 'Graduate' and 'Other', and that list is worded by marketing rather than by
    // us. A bounded free string keeps every one of those answers valid, and the
    // psychometric eligibility check reads the number out of it. '' clears it.
    out.studentClass = clean(body.studentClass, LIMITS.studentClass)
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
    // Empty unless the account told us. The Nirmaan package cards use it to show
    // which plans this student is eligible for, and checkout enforces the same
    // rule for real: psychometric plans are only sold to classes 7 to 12.
    studentClass: user.studentClass || '',
    avatar: user.avatar || '',
    role: user.role || 'student',
    // Whether the student portal is open to this account. Always true for a
    // student; the client uses it to keep a panel-only account out of the
    // portal's pages rather than letting them load and fail one request at a time.
    siteAccess: user.siteAccess !== false,
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
