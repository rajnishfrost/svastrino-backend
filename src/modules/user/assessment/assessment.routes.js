import { Router } from 'express'
import { requireUserAuth } from '../../../middleware/auth.js'
import { getStatus, start, markSubmitted } from './assessment.controller.js'

// Mounted at /api/user/assessment
const router = Router()
router.use(requireUserAuth)

router.get('/:product', getStatus)
router.post('/:product/start', start)
router.post('/:product/submitted', markSubmitted)

export default router
