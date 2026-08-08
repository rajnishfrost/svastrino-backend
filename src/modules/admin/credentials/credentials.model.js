import mongoose from 'mongoose'

/**
 * Admin-panel modules an admin can be granted. Mirrors the sidebar; 'admins'
 * (managing admin accounts) is implicit superadmin-only and not in this list.
 */
export const ADMIN_MODULES = [
  'assessments',
  'blogs',
  'career-library',
  'content',
  'coupons',
  'mentoring',
  'orders',
  'scholarship',
  'skill-builds',
  'users',
]

/** Admin account — email + hashed password (separate from end-user accounts). */
const adminSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: 'Admin' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // superadmin: full access + manages admins/roles. admin: only the modules
    // granted by the assigned role (see roleId).
    role: { type: String, enum: ['admin', 'superadmin'], default: 'admin' },
    // Assigned role preset. Effective module access = this role's permissions.
    // null for superadmins (they see everything) or an admin with no role yet.
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
)

export const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema)
