// Reopen ONE student's package-upgrade window for a few more days.
//   npm run reopen:upgrade-window -- <email> <days> [slug]
//   e.g. npm run reopen:upgrade-window -- rajnishfrost@gmail.com 2 nirmaan
// `days` counts from today (today is day 1), so 2 keeps it open through the end
// of tomorrow, IST. 0 takes the grant away again. It works whether the standard
// 7-day window is still running or closed months ago, and it never shortens one
// that has longer to run.
//
// The deadline is stored on the student's LearnState, so it survives an upgrade
// and leaves the drip schedule alone — moving `startedAt` to buy days would
// have dragged every video unlock along with it.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { User } from '../credentials/credentials.model.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { LearnState } from '../learn/learnState.model.js'
import { nextIstMidnight, istDaysBetween } from '../../../utils/schedule.js'

const DAY_MS = 86400000
const IST = { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }

async function run() {
  const [email, rawDays, slug = 'nirmaan'] = process.argv.slice(2)
  const days = Number(rawDays)
  if (!email || !Number.isInteger(days) || days < 0) {
    console.error('Usage: npm run reopen:upgrade-window -- <email> <days> [slug]')
    process.exit(1)
  }

  await connectDB()
  const user = await User.findOne({ email })
  if (!user) { console.error(`✗ No user with email "${email}"`); process.exit(1) }
  const sb = await SkillBuild.findOne({ slug })
  if (!sb) { console.error(`✗ No skill-build "${slug}"`); process.exit(1) }

  const state = await LearnState.findOne({ user: user._id, skillBuild: sb._id })
  if (!state) {
    // The window is anchored to the day they press Start, so it has not begun
    // yet — the full 7 days are still waiting for them. Creating a LearnState
    // here would start the course on their behalf, which nobody asked for.
    console.log(
      `• ${email} has not started "${slug}" yet, so the upgrade window has not begun — ` +
      `they get the full 7 days from the day they press Start. Nothing to reopen.`
    )
    await mongoose.disconnect()
    return
  }

  const before = state.upgradeWindowUntil
  // Day 1 is today, so the deadline is the IST midnight that ends day `days`.
  state.upgradeWindowUntil = days > 0
    ? nextIstMidnight(new Date(Date.now() + (days - 1) * DAY_MS))
    : null
  await state.save()

  const was = before ? before.toLocaleString('en-IN', IST) : 'none'
  if (!state.upgradeWindowUntil) {
    console.log(`✓ ${email} · "${slug}": upgrade-window reopen cleared (was ${was}).`)
  } else {
    const left = Math.max(0, istDaysBetween(new Date(), state.upgradeWindowUntil))
    console.log(
      `✓ ${email} · "${slug}": upgrade window open until ` +
      `${state.upgradeWindowUntil.toLocaleString('en-IN', IST)} IST ` +
      `— ${left} day${left === 1 ? '' : 's'} left (was ${was}).`
    )
  }
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Reopen failed:', err.message)
  process.exit(1)
})
