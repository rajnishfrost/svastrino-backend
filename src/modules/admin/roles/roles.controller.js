import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './roles.service.js'

export const toRoleDTO = (role) => ({
  id: role._id,
  key: role.key,
  name: role.label,
  permissions: role.permissions || [],
  system: role.system === true, // student / superadmin — can't be deleted
  locked: role.locked === true, // superadmin — can't be edited
  panel: role.key === 'superadmin' || (role.permissions || []).length > 0,
})

// GET /api/admin/roles
export const getRoles = asyncHandler(async (req, res) => {
  const roles = await service.listRoles()
  res.json({ roles: roles.map(toRoleDTO) })
})

// POST /api/admin/roles
export const postRole = asyncHandler(async (req, res) => {
  const role = await service.createRole(req.body || {})
  res.status(201).json({ role: toRoleDTO(role) })
})

// PATCH /api/admin/roles/:id
export const patchRole = asyncHandler(async (req, res) => {
  const role = await service.updateRole(req.params.id, req.body || {})
  res.json({ role: toRoleDTO(role) })
})

// DELETE /api/admin/roles/:id
export const deleteRole = asyncHandler(async (req, res) => {
  await service.deleteRole(req.params.id)
  res.json({ ok: true })
})
