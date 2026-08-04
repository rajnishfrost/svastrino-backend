// One-time migration: fold the old separate `admins` collection into the
// unified `users` collection (accounts are one system now).
//
//   node src/modules/admin/credentials/migrateAdminsToUsers.js
//
// Safe to re-run (idempotent). It does NOT delete the old admins collection —
// verify the panel still logs in, then drop `admins` manually when happy.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { Admin } from './credentials.model.js'
import { User } from '../../user/credentials/credentials.model.js'

async function run() {
  await connectDB()

  const admins = await Admin.find().lean()
  let created = 0
  let merged = 0

  for (const a of admins) {
    const email = String(a.email).toLowerCase()
    const existing = await User.findOne({ email })

    if (existing) {
      // Same person already has a site account — grant panel access to it.
      // Module access now comes from the role itself (see modules/admin/roles),
      // so a per-account preset is no longer carried over.
      existing.role = a.role || 'admin'
      existing.active = a.active !== false
      existing.emailVerified = true
      if (!existing.name && a.name) existing.name = a.name
      // Keep the site password if there is one; otherwise adopt the admin's.
      if (!existing.passwordHash && a.passwordHash) existing.passwordHash = a.passwordHash
      if (!existing.lastLoginAt && a.lastLoginAt) existing.lastLoginAt = a.lastLoginAt
      await existing.save()
      merged++
      console.log(`• merged into existing user: ${email} (${existing.role})`)
    } else {
      await User.create({
        name: a.name || 'Admin',
        email,
        passwordHash: a.passwordHash,
        role: a.role || 'admin',
        active: a.active !== false,
        emailVerified: true,
        lastLoginAt: a.lastLoginAt || null,
      })
      created++
      console.log(`✓ created user from admin: ${email} (${a.role || 'admin'})`)
    }
  }

  console.log(`\nDone. ${created} created, ${merged} merged, ${admins.length} admins processed.`)
  console.log('Verify panel login, then drop the old `admins` collection when ready.')
  await mongoose.connection.close()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
