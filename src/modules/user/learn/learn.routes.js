import { Router } from 'express'
import { requireUserAuth } from '../../../middleware/auth.js'
import { getCourse, startCourse, videoDone, registerPlay, answerQuestion, getReport, getRecord, getTrial, postTrial } from './learn.controller.js'

// Mounted at /api/user/learn — all routes require a signed-in student.
const router = Router()
router.use(requireUserAuth)

// Before '/:slug', which would otherwise swallow 'trial' as a course name.
router.get('/trial', getTrial)
router.post('/trial', postTrial)

router.get('/:slug', getCourse)
router.get('/:slug/report', getReport)
router.get('/:slug/record', getRecord)
router.post('/:slug/start', startCourse)
router.post('/sessions/:id/play', registerPlay)
router.post('/sessions/:id/video-done', videoDone)
router.post('/questions/:id/answer', answerQuestion)

export default router
