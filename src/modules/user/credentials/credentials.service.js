import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { User } from './credentials.model.js'
import { passwordHasName } from './credentials.dto.js'
import { signToken } from '../../../utils/token.js'
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeSetPasswordEmail,
} from '../../../utils/mailer.js'
import { deleteByKey, keyFromUrl } from '../../../config/uploads.js'

const BCRYPT_ROUNDS = 12
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000 // 24h — verify-link lifetime
const RESET_TTL_MS = 60 * 60 * 1000 // 1h
// Unverified accounts are deleted after this window (refreshed on each resend),
// so an abandoned signup frees up its email instead of squatting forever.
const UNVERIFIED_PURGE_MS = 3 * 24 * 60 * 60 * 1000 // 3 days

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

const clientUrl = () =>
  (process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5174').replace(/\/$/, '')

// --- One-time token helpers -------------------------------------------------
// The raw token travels only in the email link; we persist just its sha256 so
// a database leak can't be replayed into a valid link.
function makeToken() {
  const raw = crypto.randomBytes(32).toString('hex')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}
const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex')

function issueSession(user) {
  // `urole` carries the fine application role (student/institution/referral);
  // the second arg 'user' is the area claim (user vs admin).
  return signToken({ id: user._id.toString(), urole: user.role || 'student' }, 'user')
}

/** Best-effort verification email — failure to send must not crash signup. */
async function dispatchVerification(user) {
  const { raw, hash } = makeToken()
  user.emailVerifyTokenHash = hash
  user.emailVerifyExpires = new Date(Date.now() + EMAIL_VERIFY_TTL_MS)
  // (Re)arm the auto-purge deadline — cleared once the user verifies. Each
  // resend pushes it out so someone actively trying isn't deleted mid-flow.
  user.purgeAt = new Date(Date.now() + UNVERIFIED_PURGE_MS)
  await user.save()
  const link = `${clientUrl()}/verify-email?token=${raw}`
  try {
    await sendVerificationEmail(user.email, link)
  } catch (err) {
    console.error('✗ Failed to send verification email:', err.message)
  }
}

// --- Email + password -------------------------------------------------------

export async function signup({ name, email, password, phone }) {
  const existing = await User.findOne({ email })
  if (existing) throw httpError('An account with this email already exists', 409)

  // Phone is deliberately NOT unique — the same number may be reused across
  // accounts. Only the email identifies an account.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  const user = await User.create({ name, email, phone, passwordHash })

  await dispatchVerification(user)

  // NO session here — the account stays locked until the emailed link is used.
  return { email: user.email }
}

export async function login({ email, password }) {
  // Explicitly select the normally-hidden hash.
  const user = await User.findOne({ email }).select('+passwordHash')
  // Same generic message whether the email is unknown or the password is wrong,
  // so the endpoint can't be used to enumerate accounts.
  if (!user || !user.passwordHash) throw httpError('Invalid email or password', 401)

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) throw httpError('Invalid email or password', 401)

  // A superadmin can disable any account without deleting it.
  if (user.active === false) throw httpError('This account has been disabled', 403)

  // Gate: a password account must confirm its email before the first login.
  // The client uses the code to show a "verify your email" prompt + resend.
  if (!user.emailVerified) {
    throw httpError(
      'Please verify your email first — check your inbox for the link.',
      403,
      'EMAIL_NOT_VERIFIED'
    )
  }

  user.lastLoginAt = new Date()
  await user.save()

  return { token: issueSession(user), user }
}

// --- Guest checkout (mentoring booking) -------------------------------------
// "Book as guest": the visitor gives name + email on the booking form and we
// create the account on the spot so the purchase/booking has an owner. No
// password yet — a welcome email carries a 7-day set-password link (the reset
// mechanics reused, so the existing /reset-password page finishes the job).

const GUEST_SETPW_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function guestAccount({ name, email, phone }) {
  const existing = await User.findOne({ email })
  if (existing) {
    // The client turns this into a "you already have an account — log in" prompt.
    throw httpError('An account with this email already exists — please log in to continue', 409, 'EMAIL_EXISTS')
  }

  // Verified straight away: the address is actively in use for this booking and
  // the payment receipt + calendar emails all land there. This also keeps the
  // paid account out of the unverified auto-purge.
  const user = await User.create({ name, email, phone, emailVerified: true })

  const { raw, hash } = makeToken()
  user.passwordResetTokenHash = hash
  user.passwordResetExpires = new Date(Date.now() + GUEST_SETPW_TTL_MS)
  user.lastLoginAt = new Date()
  await user.save()

  const link = `${clientUrl()}/reset-password?token=${raw}`
  try {
    await sendWelcomeSetPasswordEmail(user.email, { name: user.name, link })
  } catch (err) {
    console.error('✗ Failed to send guest welcome email:', err.message)
  }

  // Session token so the booking + payment continue seamlessly in this tab.
  return { token: issueSession(user), user }
}

// --- Google sign-in ---------------------------------------------------------
// The client performs the GIS implicit flow and sends us Google's access token.
// We verify it server-side: `tokeninfo` confirms the token's audience is OUR
// client id (blocks tokens minted for another app), then `userinfo` gives the
// profile. Only GOOGLE_CLIENT_ID is required — no client secret.

async function verifyGoogleToken(accessToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw httpError('Google sign-in is not configured', 500)

  const infoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  )
  if (!infoRes.ok) throw httpError('Invalid Google session', 401)
  const info = await infoRes.json()

  // Audience check — the token MUST have been issued for this app.
  if (info.aud !== clientId) throw httpError('Google token audience mismatch', 401)

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!profileRes.ok) throw httpError('Could not fetch Google profile', 401)
  const profile = await profileRes.json()

  if (!profile.email || profile.email_verified === false) {
    throw httpError('Your Google email is not verified', 401)
  }
  return {
    googleId: profile.sub,
    email: String(profile.email).toLowerCase(),
    name: profile.name || '',
    avatar: profile.picture || '',
  }
}

export async function googleAuth({ accessToken }) {
  const g = await verifyGoogleToken(accessToken)

  // Prefer matching by googleId, then fall back to email so an existing
  // password account links Google instead of creating a duplicate.
  let user = await User.findOne({ googleId: g.googleId }).select('+googleId')
  if (!user) user = await User.findOne({ email: g.email }).select('+googleId')

  if (!user) {
    user = await User.create({
      googleId: g.googleId,
      email: g.email,
      name: g.name,
      avatar: g.avatar,
      emailVerified: true, // Google already vouches for the address.
    })
  } else {
    if (!user.googleId) user.googleId = g.googleId
    if (!user.avatar && g.avatar) user.avatar = g.avatar
    if (!user.name && g.name) user.name = g.name
    user.emailVerified = true
    // Google vouches for the email, so this account is now verified — drop the
    // auto-purge deadline in case it was still a pending email/password signup.
    user.purgeAt = undefined
  }

  user.lastLoginAt = new Date()
  await user.save()

  return { token: issueSession(user), user }
}

// --- Email verification -----------------------------------------------------

export async function verifyEmail(rawToken) {
  if (!rawToken) throw httpError('Missing verification token', 400)
  const user = await User.findOne({
    emailVerifyTokenHash: hashToken(rawToken),
    emailVerifyExpires: { $gt: new Date() },
  }).select('+emailVerifyTokenHash +emailVerifyExpires')

  if (!user) throw httpError('Verification link is invalid or has expired', 400)

  user.emailVerified = true
  user.emailVerifyTokenHash = undefined
  user.emailVerifyExpires = undefined
  user.purgeAt = undefined // verified — never auto-delete this account
  await user.save()
  return { email: user.email }
}

export async function resendVerification({ email }) {
  const user = await User.findOne({ email })
  // Silent no-op if unknown/already-verified — never reveal which emails exist.
  if (user && !user.emailVerified) await dispatchVerification(user)
  return { ok: true }
}

// --- Password reset ---------------------------------------------------------

export async function forgotPassword({ email }) {
  const user = await User.findOne({ email })
  // Always resolve the same way to avoid account enumeration.
  if (user) {
    const { raw, hash } = makeToken()
    user.passwordResetTokenHash = hash
    user.passwordResetExpires = new Date(Date.now() + RESET_TTL_MS)
    await user.save()
    const link = `${clientUrl()}/reset-password?token=${raw}`
    try {
      await sendPasswordResetEmail(user.email, link)
    } catch (err) {
      console.error('✗ Failed to send reset email:', err.message)
    }
  }
  return { ok: true }
}

/** Whose account a reset token belongs to — lets the reset page show the email
 *  and feed the user's name to the strength check. Never consumes the token. */
export async function getResetInfo(token) {
  if (!token) throw httpError('Missing reset token', 400)
  const user = await User.findOne({
    passwordResetTokenHash: hashToken(token),
    passwordResetExpires: { $gt: new Date() },
  })
  if (!user) throw httpError('Reset link is invalid or has expired', 400)
  return { email: user.email, name: user.name }
}

export async function resetPassword({ token, password }) {
  const user = await User.findOne({
    passwordResetTokenHash: hashToken(token),
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpires')

  if (!user) throw httpError('Reset link is invalid or has expired', 400)

  // Block passwords built around the account's name or email (the client can't
  // see these until it fetches getResetInfo, so enforce here regardless).
  const emailLocal = String(user.email || '').split('@')[0]
  if (passwordHasName(`${user.name} ${emailLocal}`, password)) {
    throw httpError('Password must not contain your name or email', 400)
  }

  user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  user.passwordResetTokenHash = undefined
  user.passwordResetExpires = undefined
  // A completed reset is a good moment to trust the address.
  user.emailVerified = true
  user.purgeAt = undefined // now verified — exempt from auto-purge
  await user.save()

  // Issue a fresh session so the user is logged straight in after resetting.
  return { token: issueSession(user), user }
}

export async function findUserById(id) {
  // Select the hash so toUserDTO can report `hasPassword` accurately.
  return User.findById(id).select('+passwordHash')
}

// --- Profile & password management ------------------------------------------

/** Update name and/or phone. Changing the phone marks it unverified again. */
export async function updateProfile(userId, changes) {
  // Select the hash so the returned DTO reports `hasPassword` correctly.
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw httpError('User not found', 404)

  if (changes.name !== undefined) user.name = changes.name

  if (changes.phone !== undefined && changes.phone !== (user.phone || null)) {
    // No duplicate check — phone is not unique (same rule as signup).
    if (changes.phone) {
      user.phone = changes.phone
    } else {
      user.phone = undefined // clearing the number
    }
    user.phoneVerified = false // a new/changed number must be re-verified later
  }

  await user.save()
  return user
}

/**
 * Set (`url`) or clear (`''`) the profile photo. Any previous locally-stored
 * avatar file is deleted so uploads don't accumulate. Remote (Google) avatars
 * have no local key and are simply overwritten.
 */
export async function updateAvatar(userId, url) {
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw httpError('User not found', 404)

  const oldKey = keyFromUrl(user.avatar)
  user.avatar = url || ''
  await user.save()
  if (oldKey && oldKey !== keyFromUrl(url)) await deleteByKey(oldKey)
  return user
}

/**
 * Change (or, for Google-only accounts, set) the password. When a password
 * already exists the current one must be provided and verified.
 */
export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw httpError('User not found', 404)

  if (user.passwordHash) {
    if (!currentPassword) throw httpError('Enter your current password', 400)
    const ok = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!ok) throw httpError('Current password is incorrect', 401)
    if (currentPassword === newPassword) {
      throw httpError('New password must be different from the current one', 400)
    }
  }

  const emailLocal = String(user.email || '').split('@')[0]
  if (passwordHasName(`${user.name} ${emailLocal}`, newPassword)) {
    throw httpError('Password must not contain your name or email', 400)
  }

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await user.save()
  return user
}
