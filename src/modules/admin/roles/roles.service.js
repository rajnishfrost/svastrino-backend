import { Role, SEED_ROLES } from './roles.model.js'
import { ADMIN_MODULES } from '../credentials/credentials.model.js'

const httpError = (message, status) => {
  const err = new Error(message)
  err.status = status
  return err
}

const cleanPermissions = (perms) =>
  Array.isArray(perms) ? [...new Set(perms.filter((p) => ADMIN_MODULES.includes(p)))] : []

const slugify = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Ensure the seeded system roles exist (idempotent, on startup). Never
 * overwrites the editable student modules; forces every LOCKED role back to its
 * declared module set — superadmin to everything, organisation to nothing (its
 * access lives in the /organisation portal, not the admin panel).
 */
export async function ensureBuiltinRoles() {
  for (const r of SEED_ROLES) {
    const existing = await Role.findOne({ key: r.key })
    if (!existing) {
      await Role.create(r)
    } else if (r.locked) {
      existing.permissions = [...r.permissions]
      existing.locked = true
      existing.system = true
      existing.label = r.label
      await existing.save()
    } else if (!existing.system) {
      existing.system = true // keep student undeletable even if it predates this
      await existing.save()
    }
  }
}

/** All roles: student first, superadmin last, the rest A→Z by label. */
export async function listRoles() {
  const roles = await Role.find()
  const rank = (r) => (r.key === 'student' ? 0 : r.key === 'superadmin' ? 2 : 1)
  return roles.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
}

export async function createRole({ name, permissions }) {
  const label = String(name || '').trim()
  if (!label) throw httpError('Role name is required', 400)
  const key = slugify(label)
  if (!key) throw httpError('Role name must contain letters or numbers', 400)
  if (await Role.findOne({ key })) throw httpError('A role with this name already exists', 409)
  return Role.create({ key, label, permissions: cleanPermissions(permissions), system: false, locked: false })
}

/** Edit a role's modules (and name for non-system roles). Locked roles
 *  (superadmin, organisation) can't be edited — their module set is fixed. */
export async function updateRole(id, { name, permissions }) {
  const role = await Role.findById(id)
  if (!role) throw httpError('Role not found', 404)
  if (role.locked) throw httpError(`The ${role.label} role cannot be edited`, 400)

  if (name !== undefined && !role.system) {
    const label = String(name).trim()
    if (!label) throw httpError('Role name is required', 400)
    const dup = await Role.findOne({ _id: { $ne: role._id }, key: new RegExp(`^${escapeRegExp(slugify(label))}$`, 'i') })
    if (dup) throw httpError('A role with this name already exists', 409)
    role.label = label
    role.key = slugify(label)
  }
  if (permissions !== undefined) role.permissions = cleanPermissions(permissions)
  await role.save()
  return role
}

/** Delete a role. System roles (student/superadmin) and in-use roles are protected. */
export async function deleteRole(id) {
  const role = await Role.findById(id)
  if (!role) throw httpError('Role not found', 404)
  if (role.system) throw httpError('This is a built-in role and cannot be deleted', 400)

  const { User } = await import('../../user/credentials/credentials.model.js')
  const inUse = await User.countDocuments({ role: role.key })
  if (inUse > 0) {
    throw httpError(
      `This role is assigned to ${inUse} account${inUse === 1 ? '' : 's'}. Reassign them before deleting it.`,
      400
    )
  }
  await role.deleteOne()
}

// --- Shared helpers (used by auth + account management) ----------------------

export async function roleExists(key) {
  if (key === 'superadmin') return true
  return !!(await Role.findOne({ key }).select('_id'))
}

/** Modules a role grants. superadmin → everything. */
export async function rolePermissions(roleKey) {
  if (roleKey === 'superadmin') return [...ADMIN_MODULES]
  const r = await Role.findOne({ key: roleKey })
  return r ? r.permissions : []
}

/** Can an account with this role + resolved modules sign into the panel? */
export function hasPanelAccess(roleKey, perms) {
  return roleKey === 'superadmin' || (Array.isArray(perms) && perms.length > 0)
}
