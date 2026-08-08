import { Router } from 'express'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { requireUserAuth } from '../../../middleware/auth.js'
import * as service from './scholarship.service.js'

// Mounted at /api/user/scholarship — the student-facing side.
// The partner directory and the partner application form moved to
// /api/user/organisations (see modules/user/organisation).
const router = Router()

// GET /api/user/scholarship/winners — public winner announcements, all partners
router.get('/winners', asyncHandler(async (req, res) => {
  res.json({ winners: await service.publicWinners() })
}))

// GET /api/user/scholarship/me — the signed-in student's scholarship state
router.get('/me', requireUserAuth, asyncHandler(async (req, res) => {
  res.json(await service.getMyScholarship(req.user.id))
}))

// POST /api/user/scholarship/enroll — { organisationId, studentClass, section, rollNo }
// The cycle is resolved server-side from the organisation, never sent by the client.
router.post('/enroll', requireUserAuth, asyncHandler(async (req, res) => {
  await service.enroll(req.user.id, req.body || {})
  res.status(201).json(await service.getMyScholarship(req.user.id))
}))

// POST /api/user/scholarship/attempt/start — begin the timed test
router.post('/attempt/start', requireUserAuth, asyncHandler(async (req, res) => {
  res.json(await service.startAttempt(req.user.id))
}))

// POST /api/user/scholarship/attempt/submit — { answers: [{ question, text }] }
router.post('/attempt/submit', requireUserAuth, asyncHandler(async (req, res) => {
  res.json(await service.submitAttempt(req.user.id, req.body?.answers))
}))

export default router
