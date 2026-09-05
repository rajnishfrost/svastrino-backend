// Delete ONE account and everything that belongs to it.
//   npm run delete:user -- <email> [--apply] [--backup <path>]
//   e.g. npm run delete:user -- rajnishfrost@gmail.com --apply
//
// Dry run by default: it prints exactly what would go and writes the backup,
// and only removes anything when you add --apply. The backup is the whole of
// what was deleted, as JSON, so an accident can be put back.
//
// Rows are found by scanning EVERY collection for a `user` field pointing at
// the account, rather than a hand-written list — a collection added later is
// then swept too, instead of quietly surviving. Fields that merely record who
// ACTED on a row (updatedBy, owner, reviewedBy…) are left alone: those rows
// belong to somebody else.
import '../../../config/env.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { User } from './credentials.model.js'

async function run() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const bi = args.indexOf('--backup')
  const backupPath = bi !== -1 ? args[bi + 1] : null
  // Skip the flags, and the path that follows --backup. Guarded on bi, because
  // an absent --backup gives bi = -1 and would otherwise drop argument 0 — the
  // email itself.
  const email = args.filter((a, i) => !a.startsWith('--') && !(bi !== -1 && i === bi + 1))[0]
  if (!email) {
    console.error('Usage: npm run delete:user -- <email> [--apply] [--backup <path>]')
    process.exit(1)
  }

  await connectDB()
  // +googleId because the schema hides it by default, and a backup missing the
  // Google link could not put the account back the way it was.
  const user = await User.findOne({ email }).select('+googleId')
  if (!user) { console.error(`✗ No user with email "${email}"`); process.exit(1) }

  const db = mongoose.connection.db
  const id = user._id
  const names = (await db.listCollections().toArray()).map((c) => c.name).sort()

  const owned = []
  for (const name of names) {
    const rows = await db.collection(name).find({ user: id }).toArray()
    if (rows.length) owned.push({ name, rows })
  }

  const out = backupPath || path.join(os.tmpdir(), `deleted-${email}-${Date.now()}.json`)
  const backup = {
    email, userId: id.toString(), takenAt: new Date().toISOString(),
    users: [user.toObject()],
    owned: Object.fromEntries(owned.map(({ name, rows }) => [name, rows])),
    // Recorded but NOT deleted: rows carrying the address without pointing at
    // the account. Say what was left behind rather than let it go unnoticed.
    keptByEmail: {
      enquiries: await db.collection('enquiries').find({ email, user: { $in: [null, undefined] } }).toArray(),
      institutions: await db.collection('institutions').find({ email }).toArray(),
    },
  }
  fs.writeFileSync(out, JSON.stringify(backup, null, 2))

  console.log(`\n${email} · ${id}  (created ${user.createdAt?.toISOString().slice(0, 10)})`)
  console.log(`backup → ${out}`)
  for (const { name, rows } of owned) console.log(`  ${name}`.padEnd(24), rows.length)
  console.log('  users'.padEnd(24), 1)
  const kept = backup.keptByEmail
  if (kept.enquiries.length || kept.institutions.length) {
    console.log(`  kept (email only): enquiries ${kept.enquiries.length} · institutions ${kept.institutions.length}`)
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --apply.')
    return mongoose.disconnect()
  }

  let total = 0
  for (const { name } of owned) {
    const r = await db.collection(name).deleteMany({ user: id })
    total += r.deletedCount
    console.log(`deleted ${String(r.deletedCount).padStart(3)}  ${name}`)
  }
  const ru = await User.deleteOne({ _id: id })
  console.log(`deleted ${String(ru.deletedCount).padStart(3)}  users`)
  console.log(`\n✓ removed ${total + ru.deletedCount} document(s) for ${email}`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Delete failed:', err.message)
  process.exit(1)
})
