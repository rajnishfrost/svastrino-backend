import mongoose from 'mongoose'
import { Package } from './package.model.js'
import { Order } from '../payments/order.model.js'
import { Enrollment } from '../payments/enrollment.model.js'

/**
 * Delete catalogue rows that nothing points at.
 *
 * A package is not just a card: payments resolves a student's tier by sku to
 * work out their upgrade credit, and the free trial has a package of its own.
 * So this refuses to delete any sku that appears on an order or an enrollment,
 * whatever the argument list says — the check decides, not the caller.
 *
 * Run:  node src/modules/user/skillbuild/deleteUnusedPackages.js <sku> [...] [--dry]
 */
const dry = process.argv.includes('--dry')
const skus = process.argv.slice(2).filter((a) => !a.startsWith('--'))

async function main() {
  if (!skus.length) throw new Error('kaun sa sku delete karna hai, batao')
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/svastrino'
  await mongoose.connect(uri)
  console.log('db:', uri.replace(/\/\/[^@]*@/, '//***@'), dry ? '(dry run)' : '')

  for (const sku of skus) {
    const pkg = await Package.findOne({ sku })
    if (!pkg) { console.log(`  ${sku}: catalogue me hai hi nahi`); continue }

    // Money that changed hands, or anyone still holding access, means the row
    // has to stay: payments resolves a student's tier by sku. A checkout that
    // was started and abandoned is not history — the order keeps its own
    // snapshot of name and price, so nothing is lost when the row goes.
    const paid = await Order.countDocuments({ packageId: sku, status: 'paid' })
    const abandoned = await Order.countDocuments({ packageId: sku, status: { $ne: 'paid' } })
    const enrollments = await Enrollment.countDocuments({ packageId: sku })
    if (paid || enrollments) {
      console.log(`  ${sku}: SKIP — ${paid} paid order(s), ${enrollments} enrollment(s) isse jude hain`)
      continue
    }
    const note = abandoned ? ` (${abandoned} abandoned checkout, kabhi pay nahi hua)` : ''
    if (dry) { console.log(`  ${sku}: delete hoga${note}`); continue }
    await Package.deleteOne({ _id: pkg._id })
    console.log(`  ${sku}: deleted${note}`)
  }
  await mongoose.disconnect()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
