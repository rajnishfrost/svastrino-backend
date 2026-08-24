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
import {
  uploadMode, initUpload, partUrl, completeUpload, abortUpload,
} from './s3Upload.controller.js'
import { uploadImageMw, uploadImage } from './imageUpload.controller.js'
import { uploadCaptionMw, uploadCaption, deleteCaption, translateCaption } from './captionUpload.controller.js'

// Mounted under /api/admin — all admin-only.
const router = Router()
router.use(requireAdminAuth)

router.get('/stats', getStats) // dashboard — open to every signed-in admin

// Media upload (video → local storage; returns a streamable URL)
router.post('/upload/video', requirePermission('content'), uploadVideoMw, uploadVideo)
router.get('/upload/progress/:id', requirePermission('content'), uploadProgress)

// Browser-direct upload to S3. The bytes never reach this server, which is what
// keeps a multi-gigabyte video clear of CloudFront's 60-second origin timeout.
// `mode` lets the client ask which path to take instead of guessing.
router.get('/upload/mode', requirePermission('content'), uploadMode)
router.post('/upload/s3/init', requirePermission('content'), initUpload)
router.post('/upload/s3/part-url', requirePermission('content'), partUrl)
router.post('/upload/s3/complete', requirePermission('content'), completeUpload)
router.post('/upload/s3/abort', requirePermission('content'), abortUpload)
// Editorial images (blog covers) — shared by every module that stores artwork.
router.post('/upload/image', requirePermission('content', 'blogs', 'career-library'), uploadImageMw, uploadImage)

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

// Caption tracks (SRT/VTT upload → stored as WebVTT; optional AI translation)
router.post('/sessions/:id/captions', requirePermission('content'), uploadCaptionMw, uploadCaption)
router.delete('/sessions/:id/captions/:lang', requirePermission('content'), deleteCaption)
router.post('/sessions/:id/captions/:lang/translate', requirePermission('content'), translateCaption)

export default router
