import mongoose from 'mongoose'

/**
 * A student's typed answer to one question. One row per (user, question).
 * `submittedAt` drives the drip: the next question opens the IST-midnight after
 * this. Answers are stored only (no grading) — used later for the report.
 */
const answerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    skillBuild: { type: mongoose.Schema.Types.ObjectId, ref: 'SkillBuild', required: true },
    order: { type: Number, required: true }, // mirror of the question order (1..6)
    text: { type: String, required: true },
    submittedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
)

answerSchema.index({ user: 1, question: 1 }, { unique: true })

export const Answer = mongoose.models.Answer || mongoose.model('Answer', answerSchema)
