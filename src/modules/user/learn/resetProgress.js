// Dev utility: wipe a student's learning state so the course starts fresh —
// progress, answers AND the course-start marker (so the Start button reappears).
//   npm run reset:progress            → resets ALL courses
//   npm run reset:progress nirmaan    → resets only that skill-build (by slug)
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { Progress } from './progress.model.js'
import { Answer } from './answer.model.js'
import { LearnState } from './learnState.model.js'

async function run() {
  await connectDB()
  const slug = process.argv[2]

  let filter = {}
  if (slug) {
    const sb = await SkillBuild.findOne({ slug })
    if (!sb) {
      console.error(`✗ No skill-build with slug "${slug}"`)
      process.exit(1)
    }
    filter = { skillBuild: sb._id }
  }

  const [p, a, ls] = await Promise.all([
    Progress.deleteMany(filter),
    Answer.deleteMany(filter),
    LearnState.deleteMany(filter),
  ])
  const scope = slug ? ` for "${slug}"` : ' (all courses)'
  console.log(`✓ Reset${scope}: ${p.deletedCount} progress, ${a.deletedCount} answers, ${ls.deletedCount} start-markers — course starts fresh.`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Reset failed:', err.message)
  process.exit(1)
})
