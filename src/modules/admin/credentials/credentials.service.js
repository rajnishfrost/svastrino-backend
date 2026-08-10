import bcrypt from 'bcryptjs'
import { User } from '../../user/credentials/credentials.model.js'
import { rolePermissions, hasPanelAccess, roleExists } from '../roles/roles.service.js'
import { signToken } from '../../../utils/token.js'
import { deleteByKey, keyFromUrl } from '../../../config/uploads.js'

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

/**
 * The `organisation` role is not just a label — an account carrying it must OWN
 * an Organisation record, because that's what `requireOrgAuth` resolves the
 * portal from. An account with the role but no organisation can sign in and then
 * bounce off every /api/org route, so the two are created and torn down
 * together here rather than left to be wired up by hand afterwards.
 */
const ORG_ROLE = 'organisation'

/** Create any account with a chosen role. Admin-created accounts are trusted
 *  (email pre-verified) so they can sign in right away. Picking the
 *  `organisation` role also creates the organisation itself — see ORG_ROLE. */
export async function createManagedAdmin({ name, email, password, role, organisation }) {
  const cleanName = String(name || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!cleanName) throw httpError('Name is required', 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw httpError('Enter a valid email', 400)
  if (String(password || '').length < 8) throw httpError('Password must be at least 8 characters', 400)
  const finalRole = role || 'student' // new accounts default to student
  if (!(await roleExists(finalRole))) throw httpError('Selected role does not exist', 400)
  if (await User.findOne({ email: cleanEmail })) throw httpError('An account with this email already exists', 409)

  const isOrg = finalRole === ORG_ROLE
  // Validate the organisation BEFORE creating the account, so a bad form doesn't
  // leave a half-made user behind.
  if (isOrg) {
    const { assertOrganisationDraft } = await import('../../user/organisation/organisation.service.js')
    assertOrganisationDraft(organisation, cleanEmail)
  }

  const passwordHash = await bcrypt.hash(String(password), 10)
  const user = await User.create({
    name: cleanName,
    email: cleanEmail,
    passwordHash,
    role: finalRole,
    active: true,
    emailVerified: true,
  })

  if (!isOrg) return user

  try {
    const { createOrganisationForOwner } = await import('../../user/organisation/organisation.service.js')
    const org = await createOrganisationForOwner(user, organisation)
    user.organisation = org._id
    user.organisationRole = 'owner'
    await user.save()
  } catch (err) {
    // Never leave an `organisation`-role account with no organisation to own.
    await user.deleteOne()
    throw err
  }
  return user
}

/**
 * Guard both directions of a role change that crosses the `organisation` line,
 * since an account and its Organisation must stay in lock-step.
 *
 *   → organisation : create the organisation now, from the details supplied.
 *   ← organisation : refuse. Their organisation owns students, cycles and
 *     results; silently orphaning all of it behind a dropdown would be the
 *     worst possible outcome, so the admin is told to remove the organisation
 *     from the Scholarship page first (or just suspend it).
 */
async function assertOrgRoleSwap(user, newRole, organisationDraft) {
  const { assertOrganisationDraft, createOrganisationForOwner, organisationOwnedBy } = await import(
    '../../user/organisation/organisation.service.js'
  )
  const owned = await organisationOwnedBy(user._id)

  if (newRole === ORG_ROLE) {
    if (owned) {
      // Re-linking an existing organisation back to its owner — nothing to make.
      user.organisation = owned._id
      user.organisationRole = 'owner'
      return
    }
    assertOrganisationDraft(organisationDraft, user.email)
    const org = await createOrganisationForOwner(user, organisationDraft)
    user.organisation = org._id
    user.organisationRole = 'owner'
    return
  }

  if (owned) {
    throw httpError(
      `This account owns “${owned.name}”. Delete or suspend that organisation on the Scholarship page before changing its role.`,
      400
    )
  }
  // Not an owner — just clear any stale link so the role change is clean.
  if (user.organisationRole === 'owner') {
    user.organisation = null
    user.organisationRole = null
  }
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
  if (newRole !== undefined && newRole !== user.role) await assertOrgRoleSwap(user, newRole, body.organisation)
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
 * Remove everything a user owns across every module, so deleting the account
 * leaves no dangling references. Best-effort per collection: each module is
 * loaded and cleared independently (dynamic import + try/catch) so a
 * module that's mid-refactor can't abort the whole delete. Also nulls the
 * "reviewedBy"/"winner" back-references that point at this user.
 */
async function cascadeDeleteUserData(userId) {
  // [module path, export name, filter builder] — records this user OWNS.
  const owned = [
    ['../../user/payments/order.model.js', 'Order'],
    ['../../user/payments/enrollment.model.js', 'Enrollment'],
    ['../../user/learn/progress.model.js', 'Progress'],
    ['../../user/learn/learnState.model.js', 'LearnState'],
    ['../../user/learn/answer.model.js', 'Answer'],
    ['../../user/mentoring/booking.model.js', 'MentoringBooking'],
    ['../../user/assessment/assessment.model.js', 'Assessment'],
    ['../../user/scholarship/scholarship.model.js', 'ScholarshipEnrollment'],
    ['../../user/scholarship/scholarship.model.js', 'ScholarshipAttempt'],
  ]
  for (const [path, name] of owned) {
    try {
      const mod = await import(path)
      const Model = mod[name]
      if (Model) await Model.deleteMany({ user: userId })
    } catch (err) {
      console.error(`✗ cascade delete ${name} failed:`, err.message)
    }
  }

  // Back-references that should just be cleared (not deleted).
  const backrefs = [
    ['../../user/scholarship/scholarship.model.js', 'ScholarshipCycle', { declaredWinner: userId }, { declaredWinner: null, winnerDeclaredAt: null }],
    ['../../user/organisation/organisation.model.js', 'Organisation', { reviewedBy: userId }, { reviewedBy: null }],
  ]
  for (const [path, name, filter, update] of backrefs) {
    try {
      const mod = await import(path)
      const Model = mod[name]
      if (Model) await Model.updateMany(filter, { $set: update })
    } catch (err) {
      console.error(`✗ cascade clear ${name} failed:`, err.message)
    }
  }
}

/**
 * Permanently delete an account AND everything it owns (orders, enrolments,
 * learn progress, mentoring bookings, assessments, scholarship entries, its
 * uploaded avatar). Guard-rails mirror the edit rules: you can't delete
 * yourself, and the last active superadmin can't be deleted (so the panel can
 * never lock everyone out).
 */
export async function deleteManagedAccount(actorId, id) {
  if (String(actorId) === String(id)) throw httpError('You cannot delete your own account', 400)
  const user = await User.findById(id)
  if (!user) throw httpError('Account not found', 404)
  if (user.role === 'superadmin') {
    const others = await User.countDocuments({ _id: { $ne: user._id }, role: 'superadmin', active: true })
    if (others === 0) throw httpError('At least one active superadmin must remain', 400)
  }

  // Deleting an organisation's owner would leave the organisation with nobody
  // able to sign in, but its students, cycles and results all still live. That's
  // a decision for the Scholarship page, not a side effect of deleting a user.
  const { organisationOwnedBy } = await import('../../user/organisation/organisation.service.js')
  const owned = await organisationOwnedBy(user._id)
  if (owned) {
    throw httpError(
      `This account owns “${owned.name}”. Delete or suspend that organisation on the Scholarship page first.`,
      400
    )
  }

  await cascadeDeleteUserData(user._id)
  // Drop the uploaded avatar file too (local or S3); remote avatars have no key.
  await deleteByKey(keyFromUrl(user.avatar)).catch(() => {})
  await user.deleteOne()
  return { id: String(user._id) }
}
