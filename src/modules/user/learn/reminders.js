import { LearnState } from './learnState.model.js'
import { User } from '../credentials/credentials.model.js'
import { getCourse, todayTask } from './learn.service.js'
import { sendLearningReminderEmail, sendEveningNudgeEmail } from '../../../utils/mailer.js'
import { istDaysBetween } from '../../../utils/schedule.js'

/**
 * Daily learning nudge. For every started course, checks whether the student
 * has something OPEN on the drip schedule right now — a video they can watch,
 * or today's question — and emails them about it, at most once per IST day.
 *
 * Runs from the 7:00 AM IST cron in index.js; `npm run send:reminders` fires it
 * manually for testing.
 */

// IST calendar-day index of "now" (istDayIndex is private to schedule.js, but
// days-from-epoch equals it because the epoch itself lands on day 0 in IST).
const todayIst = () => istDaysBetween(new Date(0), new Date())

/**
 * What can the student act on TODAY? Uses the SAME `todayTask` calculation as
 * the report/page — only 'video' and 'question' types are worth a nudge.
 */
function findActionable(course) {
  const task = todayTask(course)
  return task.type === 'video' || task.type === 'question' ? task.label : null
}

// `send` is injectable so tests can stub the mailer.
/**
 * Shared sweep. The actionable check runs AT SEND TIME, so if the student
 * already finished today's task, `findActionable` returns null and they are
 * silently skipped — no e-mail. `dedupField` caps each sweep at once per day.
 */
async function sweep({ dedupField, send, log, counterField = null }) {
  const states = await LearnState.find({})
  const today = todayIst()
  let sent = 0
  let skipped = 0

  for (const st of states) {
    try {
      if (st[dedupField] === today) { skipped++; continue } // already mailed today

      const user = await User.findById(st.user)
      if (!user?.email) { skipped++; continue }

      let course
      try {
        course = await getCourse(String(st.user), st.slug)
      } catch {
        skipped++ // enrollment revoked / course inactive — nothing to remind
        continue
      }
      if (!course.started) { skipped++; continue }

      const taskLabel = findActionable(course)
      if (!taskLabel) { skipped++; continue } // nothing open (or already done today)

      await send(user.email, {
        name: user.name,
        courseName: course.skillBuild.name,
        taskLabel,
        slug: st.slug,
        // Which taana template to use (evening only) — rotates 1..20, repeat.
        variant: counterField ? st[counterField] || 0 : 0,
      })
      st[dedupField] = today
      if (counterField) st[counterField] = (st[counterField] || 0) + 1
      await st.save()
      sent++
    } catch (err) {
      // One student failing (bad email, SMTP hiccup) must not stop the rest.
      log.error?.(`[reminders] failed for user ${st.user}: ${err.message}`)
    }
  }

  return { checked: states.length, sent, skipped }
}

/** Morning (7 AM IST): "today's task is ready". */
export async function runReminders({ log = console, send = sendLearningReminderEmail } = {}) {
  return sweep({ dedupField: 'lastNotifiedDay', send, log })
}

/** Evening (7 PM IST): gentle "still pending" tease — skipped if already done. */
export async function runEveningNudges({ log = console, send = sendEveningNudgeEmail } = {}) {
  return sweep({ dedupField: 'lastEveningNudgeDay', send, log, counterField: 'eveningNudgeCount' })
}
