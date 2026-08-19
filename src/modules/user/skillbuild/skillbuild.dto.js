import { rupees, formatInr } from '../../../utils/money.js'

/** Shape a skill-build product for the client. */
export function toSkillBuildDTO(sb) {
  return {
    slug: sb.slug,
    name: sb.name,
    tagline: sb.tagline,
    description: sb.description,
  }
}

/**
 * Shape a package for the pricing cards. Prices come pre-formatted (₹ strings)
 * so the client renders them directly, plus raw paise for any calculations.
 */
export function toPackageDTO(pkg) {
  return {
    id: pkg.slug, // 'clarity'
    sku: pkg.sku, // 'nirmaan-clarity' — what checkout uses
    name: pkg.name,
    tagline: pkg.tagline,
    price: formatInr(pkg.price),
    priceValue: pkg.price, // paise
    period: `/ ${pkg.period}`,
    earlyBird: pkg.earlyBird != null ? formatInr(pkg.earlyBird) : null,
    earlyBirdValue: pkg.earlyBird, // paise or null
    features: pkg.features,
    cta: pkg.cta,
    variant: pkg.variant,
    featured: pkg.featured,
    badge: pkg.badge,
    priceInr: rupees(pkg.price),
    // Phase-wise selling. 'per-phase' cards charge `price` once per phase, so
    // the card shows the instalment and the full run alongside it.
    paymentMode: pkg.paymentMode || 'one-time',
    phases: pkg.phases || 1,
    includesPsychometric: !!pkg.includesPsychometric,
    totalPrice:
      pkg.paymentMode === 'per-phase' && pkg.phases > 1
        ? formatInr(pkg.price * pkg.phases)
        : null,
    // What the student actually pays today, after the pay-once discount.
    payableNow: formatInr(pkg.earlyBird != null ? pkg.earlyBird : pkg.price),
    savingPercent:
      pkg.earlyBird != null && pkg.price > 0
        ? Math.round(((pkg.price - pkg.earlyBird) / pkg.price) * 100)
        : null,
  }
}
