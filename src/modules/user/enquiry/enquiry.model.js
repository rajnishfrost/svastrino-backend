import mongoose from 'mongoose'

/**
 * One enquiry from the public site — the Contact page form and the banner form
 * on the home page both land here. Kept in the database rather than only being
 * emailed, so nothing is lost if mail delivery fails and so the team can work
 * through them later.
 */
const enquirySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Optional: the home-page form collects a phone number instead.
    email: { type: String, default: '', lowercase: true, trim: true },
    phone: { type: String, default: '', trim: true },
    message: { type: String, default: '', trim: true },

    // Extra fields the home-page form asks for; the Contact form leaves them blank.
    studentClass: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },

    // Which program the request is about. Only the expert-call form sets it —
    // Breakthrough is not sold self-serve, so the request has to carry which
    // program the caller was reading about.
    program: { type: String, default: '', trim: true },

    // When they would like to be called. Free text on purpose: "after 6pm",
    // "weekends" and "tomorrow morning" are all more useful than a fake slot.
    preferredTime: { type: String, default: '', trim: true },

    // Which form it came from, so the team can tell them apart.
    source: {
      type: String,
      enum: ['contact', 'home', 'expert-call'],
      default: 'contact',
      index: true,
    },

    // Set when the sender was signed in — lets the team open the account.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * new       — nobody has picked it up yet
     * contacted — someone has spoken to them
     * approved  — only for expert-call requests: the call has happened and the
     *             team has cleared them to pay. Until an enquiry reaches this
     *             state the checkout refuses the program (see createOrder).
     * closed    — dealt with, one way or the other
     */
    status: {
      type: String,
      enum: ['new', 'contacted', 'approved', 'closed'],
      default: 'new',
      index: true,
    },

    // When the team cleared them to pay, and who did it.
    approvedAt: { type: Date, default: null },
    notes: { type: String, default: '' },

    // For rate-limit forensics and spotting abuse.
    ip: { type: String, default: '' },
  },
  { timestamps: true }
)

enquirySchema.index({ createdAt: -1 })

export const Enquiry = mongoose.models.Enquiry || mongoose.model('Enquiry', enquirySchema)
