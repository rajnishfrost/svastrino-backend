import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './skillbuild.service.js'
import { toSkillBuildDTO, toPackageDTO } from './skillbuild.dto.js'

// GET /api/user/skill-build  → all products (name/description only)
export const list = asyncHandler(async (req, res) => {
  const items = await service.listSkillBuilds()
  res.json({ skillBuilds: items.map(toSkillBuildDTO) })
})

// GET /api/user/skill-build/:slug  → one product + its packages
export const getBySlug = asyncHandler(async (req, res) => {
  const { skillBuild, packages } = await service.getSkillBuildBySlug(req.params.slug)
  res.json({
    skillBuild: toSkillBuildDTO(skillBuild),
    packages: packages.map(toPackageDTO),
  })
})
