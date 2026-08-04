// Dev utility: reset ONE student's course so the Start button reappears.
//   npm run reset:user -- <email> [slug]
//   e.g. npm run reset:user -- rajnishfrost@gmail.com nirmaan
// Clears their start-marker, progress and answers (defaults to the nirmaan course).
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { User } from '../credentials/credentials.model.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { Progress } from './progress.model.js'
import { Answer } from './answer.model.js'
import { LearnState } from './learnState.model.js'

async function run() {
  const email = process.argv[2]
  const slug = process.argv[3] || 'nirmaan'
  if (!email) {
    console.error('Usage: npm run reset:user -- <email> [slug]')
    process.exit(1)
  }

  await connectDB()
  const user = await User.findOne({ email })
  if (!user) { console.error(`✗ No user with email "${email}"`); process.exit(1) }
  const sb = await SkillBuild.findOne({ slug })
  if (!sb) { console.error(`✗ No skill-build "${slug}"`); process.exit(1) }

  const f = { user: user._id, skillBuild: sb._id }
  const [ls, p, a] = await Promise.all([
    LearnState.deleteMany(f),
    Progress.deleteMany(f),
    Answer.deleteMany(f),
  ])
  console.log(`✓ Reset "${slug}" for ${email}: ${ls.deletedCount} start-marker, ${p.deletedCount} progress, ${a.deletedCount} answers — Start button will show again.`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Reset failed:', err.message)
  process.exit(1)
})
