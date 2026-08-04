import { Router } from 'express'
import { list, categories, latest, getBySlug } from './blogs.controller.js'

// Mounted at /api/user/blogs — PUBLIC (published content, no login needed).
const router = Router()

router.get('/', list)
// These must stay above '/:slug', otherwise the param route swallows them.
router.get('/categories', categories)
router.get('/latest', latest)
router.get('/:slug', getBySlug)

export default router
