import mongoose from 'mongoose'
import { ADMIN_MODULES } from '../credentials/credentials.model.js'

/**
 * A role IS its permission set. Every account references one role by `key`
 * (mirrored on User.role). A role grants a set of admin-panel modules; an
 * account can enter the panel when its role is superadmin OR its role grants at
 * least one module.
 *
 * Roles are fully CRUD-able except two seeded system roles:
 *   student    — the default role for every new account; can't be deleted.
 *   superadmin — always everything; locked (can't edit) and can't be deleted.
 */
const roleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    label: { type: String, required: true, trim: true },
    permissions: { type: [String], enum: ADMIN_MODULES, default: [] },
    // System roles (student, superadmin) can never be deleted.
    system: { type: Boolean, default: false },
    // Superadmin is locked: its module set can't be edited (always all).
    locked: { type: Boolean, default: false },
  },
  { timestamps: true }
)

export const Role = mongoose.models.Role || mongoose.model('Role', roleSchema)

// Only these three are seeded. Everything else is created via the Roles page.
//
// `organisation` grants NO admin modules on purpose — an organisation owner
// must never reach the admin panel. Its access is the /organisation portal,
// gated by requireOrgAuth + the per-organisation `modules` list.
export const SEED_ROLES = [
  { key: 'student', label: 'Student', permissions: [], system: true, locked: false },
  { key: 'organisation', label: 'Organisation', permissions: [], system: true, locked: true },
  { key: 'superadmin', label: 'Superadmin', permissions: [...ADMIN_MODULES], system: true, locked: true },
]
