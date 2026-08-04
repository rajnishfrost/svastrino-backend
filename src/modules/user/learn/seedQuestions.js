// Seed 6 reflective questions for every session of a skill-build (idempotent).
//   npm run seed:questions            → all skill-builds
//   npm run seed:questions nirmaan    → one skill-build (by slug)
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { Session } from './session.model.js'
import { Question } from './question.model.js'

// Generic 6-question set (one per day). `{t}` is replaced with the session title.
const TEMPLATE = [
  'What was the single most useful idea from “{t}”, and why?',
  'How does “{t}” apply to your own situation right now? Give one concrete example.',
  'What is one thing from this session you found difficult or unclear?',
  'Write one small action you will take this week based on “{t}”.',
  'How would you explain the main point of “{t}” to a friend in 2–3 lines?',
  'Looking back, what did you learn about yourself from “{t}”?',
]

async function run() {
  await connectDB()
  const slug = process.argv[2]

  const sbFilter = slug ? { slug } : {}
  const builds = await SkillBuild.find(sbFilter)
  if (!builds.length) {
    console.error(slug ? `✗ No skill-build "${slug}"` : '✗ No skill-builds found')
    process.exit(1)
  }

  let sessionCount = 0
  for (const sb of builds) {
    const sessions = await Session.find({ skillBuild: sb._id }).sort({ order: 1 })
    for (const s of sessions) {
      const ops = TEMPLATE.map((tpl, i) => ({
        updateOne: {
          filter: { session: s._id, order: i + 1 },
          update: { $set: { prompt: tpl.replaceAll('{t}', s.title), active: true, skillBuild: sb._id } },
          upsert: true,
        },
      }))
      await Question.bulkWrite(ops)
      await Question.deleteMany({ session: s._id, order: { $gt: TEMPLATE.length } })
      sessionCount++
    }
    console.log(`  ✓ ${sb.slug}: ${sessions.length} sessions × ${TEMPLATE.length} questions`)
  }

  console.log(`✓ Seeded questions for ${sessionCount} session(s).`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Seed failed:', err.message)
  process.exit(1)
})
