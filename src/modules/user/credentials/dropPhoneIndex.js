// One-off migration: phone is no longer unique, but Mongo keeps an index that
// the schema change alone does NOT remove — so duplicate numbers would still
// fail with E11000. This drops the leftover unique index.
//   npm run fix:phone-index
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { User } from './credentials.model.js'

async function run() {
  await connectDB()

  const indexes = await User.collection.indexes()
  const stale = indexes.filter((i) => i.key?.phone === 1 && i.unique)

  if (!stale.length) {
    console.log('✓ No unique index on `phone` — nothing to drop.')
  } else {
    for (const idx of stale) {
      await User.collection.dropIndex(idx.name)
      console.log(`✓ Dropped unique index "${idx.name}" — phone numbers can now repeat.`)
    }
  }

  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Failed:', err.message)
  process.exit(1)
})
