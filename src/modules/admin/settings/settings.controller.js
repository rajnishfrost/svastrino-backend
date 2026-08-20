import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './settings.service.js'

const toDTO = (s) => ({
  enquiryTo: s.enquiryTo || '',
  updatedAt: s.updatedAt,
  // What the site would actually use right now, so the screen can show the
  // fallback in place rather than an empty box that looks broken.
  effectiveEnquiryTo: s.enquiryTo || process.env.ENQUIRY_TO || process.env.SEED_ADMIN_EMAIL || '',
})

// GET /api/admin/settings
export const getSettings = asyncHandler(async (req, res) => {
  res.json({ settings: toDTO(await service.getSettings()) })
})

// PATCH /api/admin/settings
export const patchSettings = asyncHandler(async (req, res) => {
  const s = await service.updateSettings(req.body || {}, req.admin?.id || null)
  res.json({ settings: toDTO(s) })
})
