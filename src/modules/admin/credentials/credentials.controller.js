import { asyncHandler } from '../../../utils/asyncHandler.js'
import { validateLogin, toAdminDTO } from './credentials.dto.js'
import { rolePermissions } from '../roles/roles.service.js'
import * as service from './credentials.service.js'

// POST /api/admin/auth/login
export const login = asyncHandler(async (req, res) => {
  const creds = validateLogin(req.body)
  const { token, admin, permissions } = await service.login(creds)
  res.json({ token, admin: toAdminDTO(admin, permissions) })
})

// GET /api/admin/auth/me  (requireAdminAuth)
export const getMe = asyncHandler(async (req, res) => {
  const admin = await service.findAdminById(req.admin.id)
  if (!admin) return res.status(404).json({ error: 'Admin not found' })
  const permissions = await rolePermissions(admin.role)
  res.json({ admin: toAdminDTO(admin, permissions) })
})

// --- Admin management (superadmin only; mounted at /api/admin/admins) --------

export const getAdmins = asyncHandler(async (req, res) => {
  const admins = await service.listAdmins()
  const dtos = await Promise.all(admins.map(async (a) => toAdminDTO(a, await rolePermissions(a.role))))
  res.json({ admins: dtos })
})

export const postAdmin = asyncHandler(async (req, res) => {
  const admin = await service.createManagedAdmin(req.body || {})
  res.status(201).json({ admin: toAdminDTO(admin, await rolePermissions(admin.role)) })
})

export const patchAdmin = asyncHandler(async (req, res) => {
  const admin = await service.updateManagedAdmin(req.admin.id, req.params.id, req.body || {})
  res.json({ admin: toAdminDTO(admin, await rolePermissions(admin.role)) })
})
