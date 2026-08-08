import { Router } from 'express'
import userRoutes from '../modules/user/index.js'
import adminRoutes from '../modules/admin/index.js'
import orgRoutes from '../modules/org/index.js'

// ---- Main API router ----
// Everything is split into three areas, each aggregating its own modules:
//   /api/user/*   → public + signed-in user endpoints   (modules/user/*)
//   /api/org/*    → partner organisation portal          (modules/org/*)
//   /api/admin/*  → admin panel endpoints                (modules/admin/*)
const router = Router()

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'svastrino-api', time: new Date().toISOString() })
})

router.use('/user', userRoutes)
router.use('/org', orgRoutes)
router.use('/admin', adminRoutes)

export default router
