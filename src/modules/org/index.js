import { Router } from 'express'
import { requireOrgAuth } from '../../middleware/auth.js'
import orgRoutes from './org.routes.js'
import orgScholarshipRoutes from './org.scholarship.routes.js'

/**
 * ---- Organisation portal router (/api/org/*) ----
 *
 * The third area alongside /api/user and /api/admin. It is deliberately its own
 * namespace rather than a slice of the admin panel: every handler here is
 * implicitly scoped to `req.org`, so an organisation physically cannot address
 * another's data — there is no route that takes an organisation id.
 *
 * requireOrgAuth runs once, here, and re-reads the organisation from the DB on
 * every request, so an admin suspending a partner or trimming its modules takes
 * effect on the very next call.
 */
const router = Router()
router.use(requireOrgAuth)

router.use('/scholarship', orgScholarshipRoutes)
router.use('/', orgRoutes)

export default router
