import { asyncHandler } from '../../../utils/asyncHandler.js'
import {
  validateSignup,
  validateLogin,
  validateGoogle,
  validateForgot,
  validateReset,
  validateResend,
  validateUpdateProfile,
  validateChangePassword,
  validateGuest,
  toUserDTO,
} from './credentials.dto.js'
import * as service from './credentials.service.js'
import { rolePermissions, hasPanelAccess } from '../../admin/roles/roles.service.js'

// Does this account's role grant admin-panel access? Lets the client route to
// the panel after login and show the "Admin Panel" link.
const panelFlag = async (user) => ({ panel: hasPanelAccess(user.role, await rolePermissions(user.role)) })

// POST /api/user/auth/signup
// Creates an UNVERIFIED account and emails a verification link. No session is
// issued — the client shows a "check your inbox" screen and the user logs in
// only after clicking the link.
export const signup = asyncHandler(async (req, res) => {
  const dto = validateSignup(req.body)
  const { email } = await service.signup(dto)
  res.status(201).json({
    ok: true,
    email,
    message: 'Account created. Check your email to verify your address before logging in.',
  })
})

// POST /api/user/auth/login
export const login = asyncHandler(async (req, res) => {
  const dto = validateLogin(req.body)
  const { token, user } = await service.login(dto)
  res.json({ token, user: toUserDTO(user, await panelFlag(user)) })
})

// POST /api/user/auth/guest  { name, email, phone? }
// Guest checkout for mentoring bookings: creates the account on the fly (no
// password — a set-password email follows) and returns a live session so the
// booking + payment continue in the same tab. 409 EMAIL_EXISTS → client shows
// the login prompt instead.
export const guest = asyncHandler(async (req, res) => {
  const dto = validateGuest(req.body)
  const { token, user } = await service.guestAccount(dto)
  res.status(201).json({ token, user: toUserDTO(user) })
})

// POST /api/user/auth/google
export const google = asyncHandler(async (req, res) => {
  const dto = validateGoogle(req.body)
  const { token, user } = await service.googleAuth(dto)
  res.json({ token, user: toUserDTO(user, await panelFlag(user)) })
})

// POST /api/user/auth/verify-email  { token }
// Called by the frontend /verify-email page with the token from the email link.
export const verifyEmail = asyncHandler(async (req, res) => {
  const token = String(req.body?.token || req.query.token || '')
  const { email } = await service.verifyEmail(token)
  res.json({ ok: true, email })
})

// POST /api/user/auth/resend-verification
export const resendVerification = asyncHandler(async (req, res) => {
  const dto = validateResend(req.body)
  await service.resendVerification(dto)
  // Generic response — never reveal whether the email exists.
  res.json({ ok: true, message: 'If that account exists, a verification email is on its way.' })
})

// POST /api/user/auth/forgot-password
export const forgotPassword = asyncHandler(async (req, res) => {
  const dto = validateForgot(req.body)
  await service.forgotPassword(dto)
  res.json({ ok: true, message: 'If that account exists, a reset link is on its way.' })
})

// GET /api/user/auth/reset-info?token=...  → { email, name } for a valid token
export const resetInfo = asyncHandler(async (req, res) => {
  const info = await service.getResetInfo(String(req.query.token || ''))
  res.json(info)
})

// POST /api/user/auth/reset-password
export const resetPassword = asyncHandler(async (req, res) => {
  const dto = validateReset(req.body)
  const { token, user } = await service.resetPassword(dto)
  res.json({ token, user: toUserDTO(user) })
})

// GET /api/user/profile  (requireUserAuth)
export const getMe = asyncHandler(async (req, res) => {
  const user = await service.findUserById(req.user.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ user: toUserDTO(user, await panelFlag(user)) })
})

// PATCH /api/user/profile  (requireUserAuth) — update name and/or phone
export const updateProfile = asyncHandler(async (req, res) => {
  const dto = validateUpdateProfile(req.body)
  const user = await service.updateProfile(req.user.id, dto)
  res.json({ user: toUserDTO(user) })
})

// POST /api/user/change-password  (requireUserAuth)
export const changePassword = asyncHandler(async (req, res) => {
  const dto = validateChangePassword(req.body)
  await service.changePassword(req.user.id, dto)
  res.json({ ok: true, message: 'Password updated' })
})
