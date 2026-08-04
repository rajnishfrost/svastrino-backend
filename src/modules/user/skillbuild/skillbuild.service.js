import { SkillBuild } from './skillbuild.model.js'
import { Package } from './package.model.js'

const httpError = (message, status) => {
  const err = new Error(message)
  err.status = status
  return err
}

/** All active skill-build products (without packages). */
export async function listSkillBuilds() {
  // Only video courses — mentoring programs have their own catalog/listing.
  return SkillBuild.find({ active: true, kind: { $ne: 'mentoring' } }).sort({ order: 1, name: 1 })
}

/** One skill-build by slug, with its active packages (ordered). */
export async function getSkillBuildBySlug(slug) {
  const sb = await SkillBuild.findOne({ slug, active: true })
  if (!sb) throw httpError('Skill-Build not found', 404)
  const packages = await Package.find({ skillBuild: sb._id, active: true }).sort({ order: 1 })
  return { skillBuild: sb, packages }
}

/**
 * All active packages of a product (by skill-build slug), normalised for the
 * payments/upgrade flow and ordered cheapest → dearest. Returns [] if unknown.
 */
export async function listPackagesByProduct(productSlug) {
  const sb = await SkillBuild.findOne({ slug: productSlug, active: true })
  if (!sb) return []
  const packages = await Package.find({ skillBuild: sb._id, active: true }).sort({ price: 1 })
  return packages.map((pkg) => ({
    sku: pkg.sku,
    name: pkg.name,
    price: pkg.price,
    earlyBird: pkg.earlyBird,
    durationDays: pkg.durationDays,
  }))
}

/**
 * Look up a package by its SKU for the payments flow. Returns a normalised shape
 * (with the parent product name so orders read "Nirmaan — Clarity"). This is the
 * server-authoritative price source.
 */
export async function getPackageBySku(sku) {
  const pkg = await Package.findOne({ sku, active: true }).populate('skillBuild', 'name slug kind')
  if (!pkg) return null
  const isMentoring = pkg.skillBuild?.kind === 'mentoring'
  return {
    sku: pkg.sku,
    slug: pkg.slug,
    name: pkg.name,
    // Course tiers share their parent's product (enables upgrades between
    // tiers). Mentoring programs are INDEPENDENT purchases under the one
    // "Mentoring" parent — product = own SKU so payments never treats buying a
    // second program as an upgrade of the first.
    product: isMentoring ? pkg.sku : pkg.skillBuild?.slug || null,
    label: `${pkg.skillBuild?.name || ''} — ${pkg.name}`.trim().replace(/^—\s*/, ''),
    price: pkg.price,
    earlyBird: pkg.earlyBird,
    durationDays: pkg.durationDays,
  }
}
