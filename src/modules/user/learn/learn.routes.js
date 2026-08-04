import { Router } from 'express'
import { requireUserAuth } from '../../../middleware/auth.js'
import { getCourse, startCourse, videoDone, answerQuestion, getReport } from './learn.controller.js'

// Mounted at /api/user/learn — all routes require a signed-in student.
const router = Router()
router.use(requireUserAuth)

router.get('/:slug', getCourse)
router.get('/:slug/report', getReport)
router.post('/:slug/start', startCourse)
router.post('/sessions/:id/video-done', videoDone)
router.post('/questions/:id/answer', answerQuestion)

export default router
