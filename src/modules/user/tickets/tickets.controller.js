import { asyncHandler } from '../../../utils/asyncHandler.js'
import {
  validateTicketCreate,
  validateReply,
  validateGrant,
  toTicketDTO,
  toTicketAdminDTO,
} from './tickets.dto.js'
import * as service from './tickets.service.js'

// ---- The student's side ------------------------------------------------------

// POST /api/user/tickets — start a conversation with the team.
export const postTicket = asyncHandler(async (req, res) => {
  const data = validateTicketCreate(req.body || {})
  const { ticket, created } = await service.createTicket(req.user.id, data)
  // A repeat press lands on the thread they already have rather than a new one,
  // so it is a 200 on an existing record, not a 201 on a fresh one.
  res.status(created ? 201 : 200).json({
    ticket: toTicketDTO(ticket),
    message: created
      ? 'Thank you. We have your message and someone from our team will reply here soon.'
      : 'You already have a conversation open about this, so we have kept it all in one place. Our team will reply here.',
  })
})

// GET /api/user/tickets
export const getMyTickets = asyncHandler(async (req, res) => {
  const list = await service.listMine(req.user.id)
  res.json({ tickets: list.map(toTicketDTO) })
})

// GET /api/user/tickets/:id
export const getMyTicket = asyncHandler(async (req, res) => {
  const ticket = await service.getMine(req.user.id, req.params.id)
  res.json({ ticket: toTicketDTO(ticket) })
})

// POST /api/user/tickets/:id/reply
export const postMyReply = asyncHandler(async (req, res) => {
  const { text } = validateReply(req.body || {})
  const ticket = await service.replyAsStudent(req.user.id, req.params.id, text)
  res.json({ ticket: toTicketDTO(ticket) })
})

// ---- The panel ---------------------------------------------------------------

// GET /api/admin/tickets?status=open&q=name
export const adminGetTickets = asyncHandler(async (req, res) => {
  const list = await service.adminList({ status: req.query.status, q: req.query.q })
  res.json({ tickets: list.map(toTicketAdminDTO) })
})

// GET /api/admin/tickets/:id
export const adminGetTicket = asyncHandler(async (req, res) => {
  const ticket = await service.adminGet(req.params.id)
  res.json({ ticket: toTicketAdminDTO(ticket) })
})

// POST /api/admin/tickets/:id/reply
export const adminPostReply = asyncHandler(async (req, res) => {
  const { text } = validateReply(req.body || {})
  const ticket = await service.replyAsAdmin(req.admin.id, req.params.id, text)
  res.json({ ticket: toTicketAdminDTO(ticket) })
})

// PATCH /api/admin/tickets/:id/status — { status }
export const adminPatchStatus = asyncHandler(async (req, res) => {
  const ticket = await service.setStatus(req.admin.id, req.params.id, req.body?.status)
  res.json({ ticket: toTicketAdminDTO(ticket) })
})

// POST /api/admin/tickets/:id/grant — { days }. Reopens the student's course.
export const adminPostGrant = asyncHandler(async (req, res) => {
  const { days } = validateGrant(req.body || {})
  const ticket = await service.grantAccess(req.admin.id, req.params.id, days)
  res.json({ ticket: toTicketAdminDTO(ticket) })
})
