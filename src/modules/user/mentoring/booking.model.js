import mongoose from 'mongoose'

/**
 * One booked counselling/mentoring appointment (a 2-hour slot). A program
 * (Bulls-eye 3 / Bloom 5 / Breakthrough 22) is paid for ONCE via the normal
 * payments flow (its SKU lives in `packages`); each of its sessions is then
 * booked here, one slot at a time.
 *
 * `update` (what happened in the session) and `tasks` (homework for the
 * student) are written by the admin and shown in the student's dashboard table.
 */
const bookingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    programSku: { type: String, required: true, index: true }, // e.g. 'mentoring-bloom'
    sessionNumber: { type: Number, required: true },           // 1..sessionsCount

    startAt: { type: Date, required: true, index: true },      // UTC instant (slot start)
    endAt: { type: Date, required: true },                     // start + 2h

    status: {
      type: String,
      enum: ['booked', 'completed', 'cancelled'],
      default: 'booked',
      index: true,
    },

    update: { type: String, default: '' },  // admin: session summary/notes
    tasks: { type: [String], default: [] }, // admin: tasks for the student

    gcalEventId: { type: String, default: '' }, // Google Calendar sync handle
  },
  { timestamps: true }
)

bookingSchema.index({ status: 1, startAt: 1 }) // availability sweeps
bookingSchema.index({ user: 1, programSku: 1, sessionNumber: 1 })

export const MentoringBooking =
  mongoose.models.MentoringBooking || mongoose.model('MentoringBooking', bookingSchema)
