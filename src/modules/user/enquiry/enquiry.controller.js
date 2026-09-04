import { asyncHandler } from '../../../utils/asyncHandler.js'
import { validateEnquiry, toEnquiryDTO } from './enquiry.dto.js'
import * as service from './enquiry.service.js'

// POST /api/user/enquiry — public. Used by the Contact page and the home banner.
export const submitEnquiry = asyncHandler(async (req, res) => {
  const data = validateEnquiry(req.body || {})
  await service.createEnquiry(data, { userId: req.user?.id || null, ip: req.ip })
  // Deliberately says nothing about whether the email went out — the visitor
  // only needs to know we have it.
  res.status(201).json({ ok: true, message: 'Thanks! We have your details and will be in touch.' })
})

// GET /api/user/enquiry/mine?source=&program=  (requireUserAuth)
// Where this person's last request stands, so a form that has already been
// answered can show that instead of sitting there blank.
export const getMyEnquiry = asyncHandler(async (req, res) => {
  const e = await service.myLatestEnquiry({
    userId: req.user.id,
    source: req.query.source,
    program: req.query.program,
  })
  res.json({
    enquiry: e && {
      id: e._id,
      status: e.status,
      source: e.source,
      program: e.program,
      createdAt: e.createdAt,
    },
  })
})

// GET /api/admin/enquiries
export const getEnquiries = asyncHandler(async (req, res) => {
  const list = await service.listEnquiries({ status: req.query.status, source: req.query.source })
  res.json({ enquiries: list.map(toEnquiryDTO) })
})

// PATCH /api/admin/enquiries/:id
export const patchEnquiry = asyncHandler(async (req, res) => {
  const e = await service.updateEnquiry(req.params.id, req.body || {})
  res.json({ enquiry: toEnquiryDTO(e) })
})
