import mongoose from 'mongoose'

/**
 * A support conversation between one student and the team.
 *
 * A course is only valid for a year. When that year runs out the course locks
 * and the student's one way forward is to talk to us — that conversation is a
 * ticket. An admin picks it up in the panel, and once it is settled they can
 * reopen the student's course from the same screen (see accessGrant below).
 *
 * The whole thread lives in ONE document rather than a row per message,
 * because a support thread is only ever read as a whole: nobody opens message
 * four on its own. That keeps the read to a single query and keeps the order of
 * the conversation beyond argument.
 *
 * The status machine, and who is waiting on whom:
 *
 *   open             — the ball is with US. Set when the student starts the
 *                      ticket and again every time they write back.
 *   awaiting_student — an admin has replied, so the ball is with the student.
 *   resolved         — settled. The student can still write back, which moves
 *                      it to 'open' again; people often have one more question
 *                      and making them start over would lose the history.
 *   closed           — the end of the road. No further replies are accepted;
 *                      a new question needs a new ticket.
 *
 * So only 'closed' is final. Everything else can go back to 'open' the moment
 * the student says something.
 */

export const TICKET_CATEGORIES = ['course-expired', 'payment', 'technical', 'other']
export const TICKET_STATUSES = ['open', 'awaiting_student', 'resolved', 'closed']

// One line of the conversation. _id is switched off because these are only ever
// read in order as part of the thread — nothing addresses a single message.
const messageSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ['student', 'admin'], required: true },

    // The account that wrote it. Null is allowed so a message left by an
    // automated step (the grant note, say) still reads sensibly.
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // The name as it was at the time of writing. Copied rather than looked up
    // so the thread still reads correctly years later, after staff have changed
    // or an account has been renamed.
    authorName: { type: String, default: '' },

    text: { type: String, required: true, trim: true },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false }
)

const ticketSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    subject: { type: String, required: true, trim: true },

    category: {
      type: String,
      enum: TICKET_CATEGORIES,
      default: 'other',
      index: true,
    },

    // The course slug the ticket is about, when it is about one. Empty for a
    // general question. Reopening access needs this — without a course there is
    // nothing to reopen.
    product: { type: String, default: '', trim: true },

    status: {
      type: String,
      enum: TICKET_STATUSES,
      default: 'open',
      index: true,
    },

    messages: { type: [messageSchema], default: [] },

    // When the thread last moved. Kept as its own field rather than read off
    // the last message so the admin list can sort on it in the database, and
    // see at a glance who has been waiting longest.
    lastMessageAt: { type: Date, default: () => new Date(), index: true },

    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * The record of an admin reopening the course from this ticket: how many
     * days were given, when, and by whom. Kept on the ticket because the
     * conversation is the reason the access was given, and a question about it
     * later ("who let them back in?") is asked of the ticket, not the enrolment.
     */
    accessGrant: {
      days: { type: Number, default: 0 },
      grantedAt: { type: Date, default: null },
      grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },

    /**
     * Every reopening, in order. accessGrant above stays as the running total
     * and the latest grant, because a second grant stacks on top of the first
     * rather than replacing it; this is the working behind that number. An
     * admin who sees "sixty days given" needs to be able to find out whether
     * that was one decision or three.
     */
    grants: [
      {
        days: { type: Number, default: 0 },
        grantedAt: { type: Date, default: null },
        grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        // The date the course locked on after this grant, as it was promised to
        // the student at the time.
        newExpiry: { type: Date, default: null },
        _id: false,
      },
    ],
  },
  { timestamps: true }
)

// The student's own list, newest activity first.
ticketSchema.index({ user: 1, lastMessageAt: -1 })
// The admin queue: one status at a time, longest wait first.
ticketSchema.index({ status: 1, lastMessageAt: -1 })

export const Ticket = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema)
