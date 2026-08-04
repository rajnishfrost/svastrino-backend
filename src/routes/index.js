import { Router } from 'express'
import userRoutes from '../modules/user/index.js'
import adminRoutes from '../modules/admin/index.js'

// ---- Main API router ----
// Everything is split into two areas, each aggregating its own modules:
//   /api/user/*   → public + signed-in user endpoints   (modules/user/*)
//   /api/admin/*  → admin panel endpoints                (modules/admin/*)
const router = Router()

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'svastrino-api', time: new Date().toISOString() })
})

router.use('/user', userRoutes)
router.use('/admin', adminRoutes)

export default router
