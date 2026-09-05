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
 * Refuses a signed-in account that is not allowed in the STUDENT portal.
 * Use AFTER requireUserAuth, on the routes that serve the portal itself.
 *
 * Students skip the check entirely — a student account is the portal, and the
 * role is already on the token, so the common case costs nothing. Only an
 * account with some other role is looked up, and it IS looked up rather than
 * trusted from the token: this is an access decision, and one taken away in the
 * admin panel has to bite on the next request, not whenever the holder next
 * signs in.
 */
export async function requireSiteAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' })
  if ((req.user.role || 'student') === 'student') return next()
  try {
    const { User } = await import('../modules/user/credentials/credentials.model.js')
    const account = await User.findById(req.user.id).select('siteAccess')
    if (account && account.siteAccess === false) {
      return res.status(403).json({
        error: 'This account cannot do that. Sign in with your student account, or talk to the Svastrino team.',
        code: 'NO_SITE_ACCESS',
      })
    }
    return next()
  } catch (err) {
    return next(err)
  }
}

/**
 * Attaches req.user when a valid user token happens to be present, and does
 * nothing at all when it is not.
 *
 * For public routes that behave better knowing who is asking but must keep
 * working for someone who is not signed in — the enquiry forms, which link a
 * request to the account that sent it so the team does not have to match them
 * up by email afterwards. A bad or expired token is treated as no token: the
 * visitor came to fill in a form, and refusing it over a stale session would
 * lose the enquiry to make a point about authentication.
 */
export function optionalUserAuth(req, _res, next) {
  const token = extractToken(req)
  if (token) {
    try {
      const decoded = verifyToken(token)
      if (decoded.role === 'user') req.user = { id: decoded.id, role: decoded.urole || 'student' }
    } catch { /* not signed in, as far as this route is concerned */ }
  }
  next()
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
 * Guards the organisation portal (/api/org/*). Same unified session token as
 * everything else — what makes it an organisation request is the ACCOUNT, not
 * a separate login: the user must own an Organisation that is approved and
 * active. Resolved from the DB on every request so an admin revoking approval,
 * suspending the organisation or trimming its modules takes effect immediately.
 *
 * Attaches req.org = { id, name, modules, doc } and req.orgUser = { id }.
 */
export async function requireOrgAuth(req, res, next) {
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
    const { Organisation } = await import('../modules/user/organisation/organisation.model.js')

    const user = await User.findById(decoded.id)
    if (!user || user.active === false) {
      return res.status(401).json({ error: 'Account disabled', code: 'ACCOUNT_DISABLED' })
    }
    if (!user.organisation || user.organisationRole !== 'owner') {
      return res.status(403).json({ error: 'This account does not manage an organisation', code: 'NOT_ORG_OWNER' })
    }

    const org = await Organisation.findById(user.organisation)
    if (!org) return res.status(403).json({ error: 'Organisation not found', code: 'ORG_NOT_FOUND' })
    if (org.status !== 'approved') {
      return res.status(403).json({ error: 'Your organisation is not approved yet', code: 'ORG_NOT_APPROVED' })
    }
    if (org.active === false) {
      return res.status(403).json({ error: 'Your organisation has been suspended', code: 'ORG_SUSPENDED' })
    }

    req.orgUser = { id: String(user._id), name: user.name, email: user.email }
    req.org = { id: String(org._id), name: org.name, modules: org.modules || [], doc: org }
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Section-level gate inside the organisation portal. Use AFTER requireOrgAuth:
 *   router.get('/students', requireOrgModule('students'), handler)
 * Passing several = ANY-of. Admin controls the set per organisation.
 */
export function requireOrgModule(...modules) {
  return (req, res, next) => {
    if (!req.org) return res.status(401).json({ error: 'Authentication required' })
    if (modules.some((m) => (req.org.modules || []).includes(m))) return next()
    return res
      .status(403)
      .json({ error: 'Your organisation does not have access to this section', code: 'ORG_MODULE_FORBIDDEN' })
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
