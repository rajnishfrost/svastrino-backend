// Validation + shaping for admin credentials.

export function validateLogin(body) {
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!email || !password) {
    const err = new Error('Email and password are required')
    err.status = 400
    throw err
  }
  return { email, password }
}

/**
 * Shape an account for the panel. `permissions` (the role's module set) is
 * resolved by the caller and passed in — superadmin is all-access, so the
 * sidebar/middleware treat an empty list from a superadmin as "everything".
 */
export function toAdminDTO(admin, permissions = []) {
  return {
    id: admin._id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    permissions: admin.role === 'superadmin' ? [] : permissions || [],
    active: admin.active !== false,
    emailVerified: admin.emailVerified === true,
    lastLoginAt: admin.lastLoginAt || null,
  }
}
