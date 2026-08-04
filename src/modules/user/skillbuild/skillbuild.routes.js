import { Router } from 'express'
import { list, getBySlug } from './skillbuild.controller.js'

// Mounted at /api/user/skill-build — PUBLIC (product catalog, no login needed).
const router = Router()

router.get('/', list)
router.get('/:slug', getBySlug)

export default router
