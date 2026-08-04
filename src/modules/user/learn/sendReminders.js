// Manually fire the learning reminders (same jobs the IST crons run).
//   npm run send:reminders              → morning "task is ready"
//   npm run send:reminders -- evening   → evening "still pending" tease
// Each sweep sends at most once per IST day per student (reset the LearnState's
// lastNotifiedDay / lastEveningNudgeDay to test again the same day).
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { runReminders, runEveningNudges } from './reminders.js'

async function run() {
  await connectDB()
  const evening = process.argv[2] === 'evening'
  const r = evening ? await runEveningNudges() : await runReminders()
  console.log(`✓ ${evening ? 'Evening nudges' : 'Reminders'}: checked ${r.checked}, sent ${r.sent}, skipped ${r.skipped}`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Reminders failed:', err.message)
  process.exit(1)
})
