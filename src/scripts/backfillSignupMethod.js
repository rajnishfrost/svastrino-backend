import mongoose from 'mongoose'
import { User } from '../modules/user/credentials/credentials.model.js'

/**
 * One-off: fill `signupMethod` on accounts that predate the field.
 *
 * The field is written at creation from then on, but every account already in
 * the database has nothing — and a breakdown that counted them all as "email"
 * by default would quietly mis-report every Google and every invited student.
 * They can be told apart from what they carry:
 *
 *   googleId                          → they signed in with Google
 *   organisationRole 'member'         → an organisation provisioned them
 *   no password and no Google         → an invite nobody has claimed
 *   otherwise                         → an ordinary email signup
 *
 * Safe to re-run: only accounts still missing the field are touched, so a
 * value set at creation is never overwritten by this guesswork.
 *
 *   node --env-file=.env.local src/scripts/backfillSignupMethod.js
 */
await mongoose.connect(process.env.MONGODB_URI)

const users = await User.find({ signupMethod: { $exists: false } })
  .select('+passwordHash +googleId organisationRole')

if (!users.length) {
  console.log('nothing to backfill — every account already says how it was made')
} else {
  const counts = { password: 0, google: 0, invite: 0 }
  for (const u of users) {
    const method = u.googleId
      ? 'google'
      : u.organisationRole === 'member' || !u.passwordHash
        ? 'invite'
        : 'password'
    await User.updateOne({ _id: u._id }, { $set: { signupMethod: method } })
    counts[method] += 1
  }
  console.log(`backfilled ${users.length}:`, Object.entries(counts).map(([k, n]) => `${k}=${n}`).join(' '))
}

const after = await User.aggregate([{ $group: { _id: '$signupMethod', n: { $sum: 1 } } }])
console.log('\nnow:')
for (const r of after.sort((a, b) => b.n - a.n)) console.log(` ${String(r._id ?? '(none)').padEnd(10)} ${r.n}`)

await mongoose.disconnect()
