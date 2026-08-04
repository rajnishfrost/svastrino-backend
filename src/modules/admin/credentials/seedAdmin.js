// Creates the first superadmin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
// Accounts are unified now, so the superadmin is just a User with role
// 'superadmin'. Run once:  npm run seed:admin
import '../../../config/env.js' // must be first — loads .env.local / .env
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { User } from '../../user/credentials/credentials.model.js'
import { createAdmin } from './credentials.service.js'

async function run() {
  await connectDB()

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@svastrino.com').toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme123'

  const existing = await User.findOne({ email })
  if (existing) {
    // Make sure the seed account can actually reach the panel.
    if (existing.role !== 'superadmin' || existing.active === false) {
      existing.role = 'superadmin'
      existing.active = true
      await existing.save()
      console.log(`• Promoted existing account to superadmin: ${email}`)
    } else {
      console.log(`• Superadmin already exists: ${email}`)
    }
  } else {
    await createAdmin({ name: 'Svastrino Admin', email, password, role: 'superadmin' })
    console.log(`✓ Created superadmin: ${email}`)
    console.log('  Change this password after first login.')
  }

  await mongoose.connection.close()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
