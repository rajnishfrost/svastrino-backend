// Creates the stand-alone psychometric test product: ₹900, sold on
// /skill-build/psychometric-testing. One test for every buyer — the student's
// class decides whether Mindler serves the Stream Selector (7–9) or the Career
// Selector (10–12), exactly as for Nirmaan + Psychometric Testing.
//
// It is a product of its own (SkillBuild kind 'test'), not a Nirmaan plan, so
// buying it is never read as a Nirmaan upgrade. The buying rules — one test per
// student, and a test-only buyer cannot take a Nirmaan plan that bundles it —
// live in payments.service.js (standingFor).
//
// Only ever CREATES what is missing; an existing product or package is left
// exactly as it is (the admin panel owns it after this). Dry run by default:
//   node src/modules/user/skillbuild/seedPsychometricTest.js           # report
//   node src/modules/user/skillbuild/seedPsychometricTest.js --write   # apply
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { SkillBuild } from './skillbuild.model.js'
import { Package } from './package.model.js'

const PRODUCT = {
  slug: 'psychometric-testing',
  name: 'Psychometric Testing',
  kind: 'test',
  tagline: 'Know your strengths before you choose',
  description: 'A RIASEC-based psychometric test — Stream Selector for classes 7 to 9, Career Selector for classes 10 to 12 — with a 20 - 40-page report.',
  // Hidden from every course listing (the old server lists any active product
  // as a course). Nothing needs it active: the checkout resolves the package by
  // its SKU, and the package below is what is on sale.
  active: false,
  order: 90,
}

const PACKAGE = {
  sku: 'psychometric-test',
  slug: 'test',
  name: 'Psychometric Testing',
  price: 90000, // ₹900, in paise
  paymentMode: 'one-time',
  phases: 1,
  includesPsychometric: true, // also makes the checkout ask for the class (7 to 12)
  cta: 'Buy the test',
  features: [
    'Stream Selector (classes 7 to 9) or Career Selector (classes 10 to 12), by your class',
    '20 - 40-page report: strengths, weaker areas, personality, interests and preferences',
    'Your top 5 suitable career options',
  ],
  active: true,
  listed: true,
  order: 1,
}

const write = process.argv.includes('--write')

async function run() {
  await connectDB()
  const { host, name } = mongoose.connection
  console.log(`\nDatabase: ${name} @ ${host}`)
  console.log(write ? 'Mode: WRITE\n' : 'Mode: dry run (pass --write to apply)\n')

  let product = await SkillBuild.findOne({ slug: PRODUCT.slug })
  if (product) {
    console.log(`  product '${PRODUCT.slug}' exists (kind ${product.kind}) — left as it is`)
  } else if (write) {
    product = await SkillBuild.create(PRODUCT)
    console.log(`  ✓ created product '${PRODUCT.slug}' (${product._id})`)
  } else {
    console.log(`  would create product '${PRODUCT.slug}' (kind test)`)
  }

  const pkg = await Package.findOne({ sku: PACKAGE.sku })
  if (pkg) {
    console.log(`  package '${PACKAGE.sku}' exists (₹${pkg.price / 100}) — left as it is`)
  } else if (write) {
    const created = await Package.create({ ...PACKAGE, skillBuild: product._id })
    console.log(`  ✓ created package '${PACKAGE.sku}' — ₹${created.price / 100} (${created._id})`)
  } else {
    console.log(`  would create package '${PACKAGE.sku}' — ₹${PACKAGE.price / 100}`)
  }

  if (!write) console.log('\nNothing written.')
  await mongoose.disconnect()
}

run().catch(async (err) => {
  console.error(err)
  await mongoose.disconnect()
  process.exit(1)
})
