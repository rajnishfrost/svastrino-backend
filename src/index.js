import './config/env.js' // must be first — loads .env.local / .env
import cron from 'node-cron'
import { createApp } from './app.js'
import { connectDB } from './config/db.js'
import { ensureBuiltinRoles } from './modules/admin/roles/roles.service.js'
import { runReminders, runEveningNudges } from './modules/user/learn/reminders.js'

const PORT = process.env.PORT || 5060

async function start() {
  await connectDB()
  await ensureBuiltinRoles() // guarantee the five built-in roles exist
  const app = createApp()
  app.listen(PORT, () => {
    console.log(`🟢 Svastrino server running on http://localhost:${PORT}`)
  })

  // Daily learning nudge at 7:00 AM IST — "today's question/video is open".
  // Disable with DISABLE_REMINDERS=true (e.g. on a second machine, so students
  // aren't emailed twice).
  if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_REMINDERS !== 'true') {
    const run = (why, job = runReminders) =>
      job()
        .then((r) => console.log(`[reminders] (${why}) sent ${r.sent} / checked ${r.checked}, skipped ${r.skipped}`))
        .catch((err) => console.error(`💥[reminders] (${why}) run failed:`, err.message))

    // Morning: "today's task is ready". Evening: gentle "still pending" tease —
    // the evening sweep re-checks at send time, so students who already finished
    // today's task get NOTHING.
    cron.schedule('0 7 * * *', () => run('daily 7am'), { timezone: 'Asia/Kolkata' })
    cron.schedule('0 19 * * *', () => run('daily 7pm', runEveningNudges), { timezone: 'Asia/Kolkata' })
    console.log('✅ Learning reminders scheduled (7:00 AM + 7:00 PM IST)')

    // Catch-up on boot: if the server was down at the scheduled time (dev
    // machines restart all the time), still send today's nudges — but only
    // during waking hours. Per-day dedup makes repeated restarts send nothing.
    const istHour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()),
    )
    if (istHour >= 7 && istHour < 21) {
      setTimeout(() => run('boot catch-up'), 2 * 60 * 1000)
      console.log('✅ Reminder catch-up run in 2 minutes (server started during the day)')
    }
    if (istHour >= 19 && istHour < 22) {
      setTimeout(() => run('boot catch-up 7pm', runEveningNudges), 3 * 60 * 1000)
    }
  }
}

start()
