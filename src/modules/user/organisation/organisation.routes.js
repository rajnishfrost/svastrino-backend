import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './organisation.service.js'
import { ORG_TYPES, ORG_TYPE_LABELS } from './organisation.model.js'

// Mounted at /api/user/organisations — entirely public.
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

// GET /api/user/organisations — the public partner directory
router.get('/', asyncHandler(async (req, res) => {
  const list = await service.publicDirectory({
    q: req.query.q,
    type: req.query.type,
    state: req.query.state,
  })
  res.json({ organisations: list.map(service.publicOrgDTO) })
}))

// GET /api/user/organisations/filters — types + states for the directory UI
router.get('/filters', asyncHandler(async (req, res) => {
  res.json({
    types: ORG_TYPES.map((key) => ({ key, label: ORG_TYPE_LABELS[key] })),
    states: await service.directoryStates(),
  })
}))

// GET /api/user/organisations/enrollable — the student enrolment dropdown
router.get('/enrollable', asyncHandler(async (req, res) => {
  const list = await service.enrollableOrganisations()
  res.json({ organisations: list.map(service.publicOrgDTO) })
}))

// POST /api/user/organisations — partner application (one per network)
router.post('/', partnerLimiter, asyncHandler(async (req, res) => {
  await service.submitApplication(req.body || {}, req.ip)
  res.status(201).json({ ok: true, message: 'Request received. We’ll email you once it’s reviewed.' })
}))

export default router
