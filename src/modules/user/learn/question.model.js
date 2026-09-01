import mongoose from 'mongoose'

/**
 * A post-video question for a session. Each session has up to 6 questions
 * (`order` 1..6). Answers are free text (typed), stored but not auto-graded.
 * Questions drip one per day: Q1 opens the day after the video is watched, each
 * next question opens the day after the previous one is answered.
 */
const questionSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    skillBuild: { type: mongoose.Schema.Types.ObjectId, ref: 'SkillBuild', required: true },
    order: { type: Number, required: true }, // 1..6 within the session
    prompt: { type: String, required: true },
    // A worked answer, shown greyed out in the box the student types into.
    // The course sheet writes one for every task, and they do real work: the
    // tasks are open-ended ("write three things you are grateful for"), and an
    // example is the difference between a student knowing what is being asked
    // and guessing at it.
    placeholder: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

questionSchema.index({ session: 1, order: 1 }, { unique: true })

export const Question = mongoose.models.Question || mongoose.model('Question', questionSchema)
