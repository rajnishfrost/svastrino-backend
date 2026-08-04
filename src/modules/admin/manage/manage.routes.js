import { Router } from 'express'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import {
  getStats,
  getUsers, patchUserRole,
  getPackages, patchPackage, postPackage,
  getSkillBuilds, postSkillBuild, patchSkillBuild,
  getSessions, postSession, patchSession, deleteSessionH,
  getQuestions, putQuestions, getSessionAnswers,
} from './manage.controller.js'
import { uploadVideoMw, uploadVideo, uploadProgress } from './upload.controller.js'

// Mounted under /api/admin — all admin-only.
const router = Router()
router.use(requireAdminAuth)

router.get('/stats', getStats) // dashboard — open to every signed-in admin

// Media upload (video → local storage; returns a streamable URL)
router.post('/upload/video', requirePermission('content'), uploadVideoMw, uploadVideo)
router.get('/upload/progress/:id', requirePermission('content'), uploadProgress)

router.get('/users', requirePermission('users'), getUsers)
router.patch('/users/:id/role', requirePermission('users'), patchUserRole)

// Packages sit inside the Skill Builds page; Mentoring→Programs uses them too.
router.get('/packages', requirePermission('skill-builds', 'mentoring'), getPackages)
router.post('/packages', requirePermission('skill-builds', 'mentoring'), postPackage)
router.patch('/packages/:id', requirePermission('skill-builds', 'mentoring'), patchPackage)

// The course list is also the picker in Content; any-of both modules.
router.get('/skill-builds', requirePermission('skill-builds', 'content', 'mentoring'), getSkillBuilds)
router.post('/skill-builds', requirePermission('skill-builds'), postSkillBuild)
router.patch('/skill-builds/:slug', requirePermission('skill-builds'), patchSkillBuild)
router.get('/skill-builds/:slug/sessions', requirePermission('content'), getSessions)
router.post('/skill-builds/:slug/sessions', requirePermission('content'), postSession)
router.patch('/sessions/:id', requirePermission('content'), patchSession)
router.delete('/sessions/:id', requirePermission('content'), deleteSessionH)
router.get('/sessions/:id/questions', requirePermission('content'), getQuestions)
router.put('/sessions/:id/questions', requirePermission('content'), putQuestions)
router.get('/sessions/:id/answers', requirePermission('content'), getSessionAnswers)

export default router
