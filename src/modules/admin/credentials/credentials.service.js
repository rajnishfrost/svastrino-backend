import bcrypt from 'bcryptjs'
import { User } from '../../user/credentials/credentials.model.js'
import { rolePermissions, hasPanelAccess, roleExists } from '../roles/roles.service.js'
import { signToken } from '../../../utils/token.js'

const httpError = (message, status) => {
  const err = new Error(message)
  err.status = status
  return err
}

/** Verify panel credentials against the unified account store, issue an admin JWT. */
export async function login({ email, password }) {
  const user = await User.findOne({ email: String(email || '').toLowerCase() }).select('+passwordHash')
  if (!user || !user.passwordHash) throw httpError('Invalid email or password', 401)

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) throw httpError('Invalid email or password', 401)
  if (user.active === false) throw httpError('This account has been disabled', 403)

  // A role with no modules (student/institution/referral by default) can't enter.
  const perms = await rolePermissions(user.role)
  if (!hasPanelAccess(user.role, perms)) {
    throw httpError('This account does not have admin panel access', 403)
  }

  user.lastLoginAt = new Date()
  await user.save()

  // One login for both worlds: issue the same unified session token the site
  // uses, so signing in here also signs you in on the site (and vice-versa).
  const token = signToken({ id: user._id.toString(), urole: user.role }, 'user')
  return { token, admin: user, permissions: perms }
}

export async function findAdminById(id) {
  return User.findById(id)
}

/** Create a superadmin account directly (used by the seed script). */
export async function createAdmin({ name, email, password, role = 'superadmin' }) {
  const passwordHash = await bcrypt.hash(password, 10)
  return User.create({
    name,
    email: String(email).toLowerCase(),
    passwordHash,
    role,
    active: true,
    emailVerified: true,
  })
}

// --- Account management (superadmin only) ------------------------------------

/** Panel accounts (roles that grant access), for any legacy admin-list view. */
export async function listAdmins() {
  return User.find({ role: { $in: ['admin', 'superadmin'] } }).sort({ role: -1, name: 1 })
}

/** Create any account with a chosen role. Admin-created accounts are trusted
 *  (email pre-verified) so they can sign in right away. */
export async function createManagedAdmin({ name, email, password, role }) {
  const cleanName = String(name || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!cleanName) throw httpError('Name is required', 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw httpError('Enter a valid email', 400)
  if (String(password || '').length < 8) throw httpError('Password must be at least 8 characters', 400)
  const finalRole = role || 'student' // new accounts default to student
  if (!(await roleExists(finalRole))) throw httpError('Selected role does not exist', 400)
  if (await User.findOne({ email: cleanEmail })) throw httpError('An account with this email already exists', 409)

  const passwordHash = await bcrypt.hash(String(password), 10)
  return User.create({
    name: cleanName,
    email: cleanEmail,
    passwordHash,
    role: finalRole,
    active: true,
    emailVerified: true,
  })
}

/**
 * Edit an account: name / role / active / password. Guard-rails: you can't
 * demote or disable YOURSELF out of superadmin, and the last active superadmin
 * can't be demoted/disabled (so the panel can never lock everyone out).
 */
export async function updateManagedAdmin(actorId, id, body) {
  const user = await User.findById(id)
  if (!user) throw httpError('Account not found', 404)

  const isSelf = String(actorId) === String(id)
  const newRole = body.role !== undefined ? body.role : undefined
  if (newRole !== undefined && !(await roleExists(newRole))) throw httpError('Selected role does not exist', 400)
  const demoting = newRole && newRole !== 'superadmin' && user.role === 'superadmin'
  const disabling = body.active === false && user.active !== false

  if (isSelf && (demoting || disabling)) {
    throw httpError('You cannot demote or disable your own account', 400)
  }
  if ((demoting || disabling) && user.role === 'superadmin') {
    const others = await User.countDocuments({ _id: { $ne: user._id }, role: 'superadmin', active: true })
    if (others === 0) throw httpError('At least one active superadmin must remain', 400)
  }

  if (body.name !== undefined) {
    const n = String(body.name).trim()
    if (!n) throw httpError('Name is required', 400)
    user.name = n
  }
  if (newRole) user.role = newRole
  if (body.active !== undefined) user.active = !!body.active
  if (body.password) {
    if (String(body.password).length < 8) throw httpError('Password must be at least 8 characters', 400)
    user.passwordHash = await bcrypt.hash(String(body.password), 10)
  }

  await user.save()
  return user
}

/**
 * Permanently delete an account. Guard-rails mirror the edit rules: you can't
 * delete yourself, and the last active superadmin can't be deleted (so the panel
 * can never lock everyone out). Financial/history records (orders) are left
 * intact — their DTOs already tolerate a missing user.
 */
export async function deleteManagedAccount(actorId, id) {
  if (String(actorId) === String(id)) throw httpError('You cannot delete your own account', 400)
  const user = await User.findById(id)
  if (!user) throw httpError('Account not found', 404)
  if (user.role === 'superadmin') {
    const others = await User.countDocuments({ _id: { $ne: user._id }, role: 'superadmin', active: true })
    if (others === 0) throw httpError('At least one active superadmin must remain', 400)
  }
  await user.deleteOne()
  return { id: String(user._id) }
}
