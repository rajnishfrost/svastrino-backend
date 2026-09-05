import { Router } from 'express'
import { requireUserAuth, requireSiteAccess } from '../../../middleware/auth.js'
import { getCourse, startCourse, videoDone, registerPlay, checkPlay, savePosition, answerQuestion, getReport, getRecord, getTrial, postTrial } from './learn.controller.js'

// Mounted at /api/user/learn — all routes require a signed-in student, and an
// account barred from the student portal is not one (see requireSiteAccess).
const router = Router()
router.use(requireUserAuth, requireSiteAccess)

// Before '/:slug', which would otherwise swallow 'trial' as a course name.
router.get('/trial', getTrial)
router.post('/trial', postTrial)

router.get('/:slug', getCourse)
router.get('/:slug/report', getReport)
router.get('/:slug/record', getRecord)
router.post('/:slug/start', startCourse)
router.post('/sessions/:id/play-check', checkPlay)
router.post('/sessions/:id/play', registerPlay)
router.post('/sessions/:id/position', savePosition)
router.post('/sessions/:id/video-done', videoDone)
router.post('/questions/:id/answer', answerQuestion)

export default router
