import mongoose from 'mongoose'
import { Enrollment } from '../modules/user/payments/enrollment.model.js'

/**
 * One-off: replace the plain unique index on Enrollment.order with a partial one.
 *
 * A free trial is an enrollment with no order. MongoDB reads a missing field as
 * null and a plain unique index counts every null as the same value, so the
 * FIRST trial would insert and the second would fail with a duplicate key on an
 * order neither of them has. The partial index (defined on the schema) applies
 * uniqueness only to rows that actually carry an ObjectId, which keeps the
 * one-payment-one-enrollment guarantee and lets trials through.
 *
 * Mongoose will not rewrite an index that already exists under the same name,
 * so the old one has to be dropped by hand — that is all this does. Safe to
 * re-run: it checks first and does nothing when the index is already partial.
 *
 *   node --env-file=.env.local src/scripts/fixEnrollmentOrderIndex.js
 */
await mongoose.connect(process.env.MONGODB_URI)
const col = Enrollment.collection

const before = await col.indexes()
const stale = before.find((i) => i.name === 'order_1' && i.unique && !i.partialFilterExpression)

if (stale) {
  await col.dropIndex('order_1')
  console.log('dropped stale unique index order_1')
} else {
  console.log('no stale order_1 index — nothing to drop')
}

await Enrollment.syncIndexes()
console.log('indexes now:')
for (const i of await col.indexes()) {
  console.log(` · ${i.name}${i.unique ? ' (unique)' : ''}${i.partialFilterExpression ? ' partial' : ''}`)
}
await mongoose.disconnect()
