import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { requireUserAuth } from '../../../middleware/auth.js'
import * as service from './scholarship.service.js'

const router = Router()

// Extra guard on the public partner form (the hard rule is one-per-IP in the
// service; this just blunts rapid spam). Keyed by client IP.
const partnerLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

const instPublicDTO = (i) => ({
  id: i._id,
  name: i.name,
  type: i.type,
  branch: i.branch || '',
  city: i.city || '',
  state: i.state || '',
  label: [i.name, i.branch, i.city].filter(Boolean).join(' · '),
})

// POST /api/user/scholarship/institutions — public partner application
router.post('/institutions', partnerLimiter, asyncHandler(async (req, res) => {
  await service.submitInstitution(req.body || {}, req.ip)
  res.status(201).json({ ok: true, message: 'Request received. We’ll email you once it’s reviewed.' })
}))

// GET /api/user/scholarship/institutions/approved — for the enrolment dropdown
router.get('/institutions/approved', asyncHandler(async (req, res) => {
  const list = await service.approvedInstitutions()
  res.json({ institutions: list.map(instPublicDTO) })
}))

// GET /api/user/scholarship/winner — public winner announcement (or null)
router.get('/winner', asyncHandler(async (req, res) => {
  res.json({ winner: await service.getWinnerInfo() })
}))

// GET /api/user/scholarship/me — the signed-in student's scholarship state
router.get('/me', requireUserAuth, asyncHandler(async (req, res) => {
  res.json(await service.getMyScholarship(req.user.id))
}))

// POST /api/user/scholarship/enroll — { institutionId, studentClass, section, rollNo }
router.post('/enroll', requireUserAuth, asyncHandler(async (req, res) => {
  await service.enroll(req.user.id, req.body || {})
  res.status(201).json(await service.getMyScholarship(req.user.id))
}))

// POST /api/user/scholarship/attempt/start — begin the timed test
router.post('/attempt/start', requireUserAuth, asyncHandler(async (req, res) => {
  res.json(await service.startAttempt(req.user.id))
}))

// POST /api/user/scholarship/attempt/submit — { answers: [{ question, selectedIndex }] }
router.post('/attempt/submit', requireUserAuth, asyncHandler(async (req, res) => {
  res.json(await service.submitAttempt(req.user.id, req.body?.answers))
}))

export default router
