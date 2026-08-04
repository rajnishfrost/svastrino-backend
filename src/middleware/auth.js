import { verifyToken } from '../utils/token.js'

function extractToken(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

/** Guards user-account routes. Attaches req.user = { id, role }. */
export function requireUserAuth(req, res, next) {
  const token = extractToken(req)
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  try {
    const decoded = verifyToken(token)
    if (decoded.role !== 'user') return res.status(403).json({ error: 'Not a user token' })
    req.user = { id: decoded.id, role: decoded.urole || 'student' }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/**
 * Guards admin routes. There's ONE login now: the same session token powers the
 * site and the panel. So this accepts the unified token and resolves panel
 * identity from the DB — the account must exist, be active, and have panel
 * access (superadmin, or a role that grants ≥1 module). Attaches
 * req.admin = { id, role, permissions }. Reading the DB every request also means
 * a demotion / disable / module change takes effect immediately.
 */
export async function requireAdminAuth(req, res, next) {
  const token = extractToken(req)
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  let decoded
  try {
    decoded = verifyToken(token)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  try {
    // Lazy imports avoid a circular dependency at module load time.
    const { User } = await import('../modules/user/credentials/credentials.model.js')
    const { rolePermissions, hasPanelAccess } = await import('../modules/admin/roles/roles.service.js')
    const user = await User.findById(decoded.id)
    if (!user || user.active === false) {
      return res.status(401).json({ error: 'Account disabled', code: 'ADMIN_DISABLED' })
    }
    const perms = await rolePermissions(user.role)
    if (!hasPanelAccess(user.role, perms)) {
      return res.status(403).json({ error: 'You do not have admin panel access', code: 'NO_PANEL_ACCESS' })
    }
    req.admin = { id: String(user._id), role: user.role, permissions: perms }
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Restrict a user route to specific application roles. Use AFTER requireUserAuth:
 *   router.get('/batch', requireUserAuth, requireUserRole('institution'), handler)
 */
export function requireUserRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this resource', code: 'ROLE_FORBIDDEN' })
    }
    next()
  }
}

/**
 * Restrict an admin route to specific admin roles (e.g. superadmin-only).
 * Use AFTER requireAdminAuth.
 */
export function requireAdminRole(...roles) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'Authentication required' })
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ error: 'Insufficient admin privileges', code: 'ADMIN_ROLE_FORBIDDEN' })
    }
    next()
  }
}

/**
 * Module-level admin permission. Use AFTER requireAdminAuth:
 *   router.get('/orders', requirePermission('orders'), handler)
 * Passing several modules = ANY-of. Superadmins always pass. requireAdminAuth
 * already resolved role + modules from the DB, so this is a pure check.
 */
export function requirePermission(...modules) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'Authentication required' })
    if (req.admin.role === 'superadmin') return next()
    if (modules.some((m) => (req.admin.permissions || []).includes(m))) return next()
    return res.status(403).json({ error: 'You do not have access to this module', code: 'MODULE_FORBIDDEN' })
  }
}
