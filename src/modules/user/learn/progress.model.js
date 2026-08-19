import mongoose from 'mongoose'

/**
 * Per-user, per-session progress. One row per (user, session). Two milestones:
 *   videoDoneAt  — first time the video passed 90% (unlocks Q1 the next IST
 *                  midnight, and permanently unlocks seeking on that video).
 *   completed/At — set once all 6 questions are answered (session fully done;
 *                  unlocks the NEXT session's video the next IST midnight).
 */
const progressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    skillBuild: { type: mongoose.Schema.Types.ObjectId, ref: 'SkillBuild', required: true },
    videoDoneAt: { type: Date }, // first 90% watch — drives Q1 unlock + seek unlock
    // Anti-piracy: a video may be started at most PLAY_LIMIT times. Counted on
    // the server so clearing browser storage does not reset it.
    plays: { type: Number, default: 0 },

    completed: { type: Boolean, default: false }, // all questions answered
    completedAt: { type: Date }, // when the last question was answered
  },
  { timestamps: true }
)

progressSchema.index({ user: 1, session: 1 }, { unique: true })

export const Progress = mongoose.models.Progress || mongoose.model('Progress', progressSchema)
