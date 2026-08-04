import mongoose from 'mongoose'

/**
 * Per-(user, course) start marker. Buying a course does NOT begin it — the
 * student must click "Start" and confirm; that sets `startedAt`, which is the
 * anchor for the whole drip schedule (Video 1 opens immediately, everything
 * after chains off it) and for the completion report (target vs actual days).
 */
const learnStateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    skillBuild: { type: mongoose.Schema.Types.ObjectId, ref: 'SkillBuild', required: true },
    slug: { type: String, required: true }, // convenience for lookups (e.g. 'nirmaan')
    startedAt: { type: Date, required: true, default: () => new Date() },
    // IST day index of the last MORNING reminder — caps it at one per day.
    lastNotifiedDay: { type: Number },
    // IST day index of the last EVENING "still pending" nudge — same cap.
    lastEveningNudgeDay: { type: Number },
    // How many evening nudges this student has received — rotates the 20 taana
    // templates (1st nudge → template 1 … 20th → 20, then back to 1).
    eveningNudgeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
)

learnStateSchema.index({ user: 1, skillBuild: 1 }, { unique: true })

export const LearnState = mongoose.models.LearnState || mongoose.model('LearnState', learnStateSchema)
