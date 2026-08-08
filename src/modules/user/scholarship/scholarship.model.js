import mongoose from 'mongoose'

/**
 * Nirmaan Scholarship data model — organisation-scoped and run in yearly cycles.
 *
 * The partner record itself now lives in modules/user/organisation (an
 * Organisation can be a school, college, village, NGO, …, and has its own
 * login). Everything here hangs off ONE organisation's cycle:
 *
 *   ScholarshipCycle      : one organisation's scholarship for one year —
 *                           window, duration, status, winner. {org, year} unique.
 *   ScholarshipQuestion   : that cycle's open-ended questions (AI-graded)
 *   ScholarshipEnrollment : a student in that cycle (self-enrolled or bulk-added)
 *   ScholarshipAttempt    : that student's timed attempt + AI-graded result
 *
 * Nothing is global any more: two organisations running in the same year have
 * separate questions, separate leaderboards and separate winners. Last year's
 * cycle stays untouched as history.
 */

export const CYCLE_STATUSES = ['draft', 'published', 'archived']

// --- One organisation's scholarship for one year -----------------------------
const cycleSchema = new mongoose.Schema(
  {
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    // Calendar year the cycle belongs to, e.g. 2026. One per organisation.
    year: { type: Number, required: true, index: true },

    title: { type: String, trim: true, default: 'Nirmaan Scholarship Test' },
    instructions: { type: String, default: '' },

    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    durationMins: { type: Number, default: 30 }, // per-student limit once started

    // draft     → only the organisation/admin can see it; students can't enrol
    // published → live: students may enrol and (inside the window) take the test
    // archived  → finished; read-only history
    status: { type: String, enum: CYCLE_STATUSES, default: 'draft', index: true },
    // Kill-switch inside `published` (pause without unpublishing).
    active: { type: Boolean, default: true },

    declaredWinner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    winnerDeclaredAt: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

// One cycle per organisation per year — the create path relies on this to be
// race-safe rather than checking-then-inserting.
cycleSchema.index({ organisation: 1, year: 1 }, { unique: true })

// --- Question bank (per cycle, open-ended, AI-graded) ------------------------
// Reflective / experience questions the student answers in their own words,
// e.g. "What problem have you solved, and did you think you'd solve it?".
const questionSchema = new mongoose.Schema(
  {
    cycle: { type: mongoose.Schema.Types.ObjectId, ref: 'ScholarshipCycle', required: true, index: true },
    order: { type: Number, default: 0 },
    prompt: { type: String, required: true, trim: true },
    // Internal grading hint for the AI (what a strong answer shows). Never sent
    // to students.
    guidance: { type: String, trim: true, default: '' },
    // Per-question word limit for the student's typed answer.
    maxWords: { type: Number, default: 1000, min: 20, max: 1000 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)
questionSchema.index({ cycle: 1, order: 1 })

// --- Enrolment (one per student per cycle) -----------------------------------
const enrollmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cycle: { type: mongoose.Schema.Types.ObjectId, ref: 'ScholarshipCycle', required: true, index: true },
    // Denormalised so "all enrolments for this organisation, all years" is one
    // indexed query instead of a join through cycles.
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },

    studentClass: { type: String, trim: true, default: '' },
    section: { type: String, trim: true, default: '' },
    rollNo: { type: String, trim: true, default: '' },

    // How they got here — 'self' from the public page, 'bulk' from the
    // organisation's CSV import, 'org' from a single manual add.
    source: { type: String, enum: ['self', 'bulk', 'org'], default: 'self' },

    enrolledAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)
// A student enrols once per cycle — but may return in a later year.
enrollmentSchema.index({ user: 1, cycle: 1 }, { unique: true })

// --- Attempt (one per student per cycle, timed + AI-graded) ------------------
const attemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cycle: { type: mongoose.Schema.Types.ObjectId, ref: 'ScholarshipCycle', required: true, index: true },
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },

    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    answers: {
      type: [
        {
          _id: false,
          question: { type: mongoose.Schema.Types.ObjectId, ref: 'ScholarshipQuestion' },
          text: { type: String, default: '' },     // the student's typed answer
          awarded: { type: Number, default: 0 },    // 0 or 1 (1 mark per question)
          feedback: { type: String, default: '' },  // short AI note (admin-visible)
        },
      ],
      default: [],
    },
    score: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    gradedModel: { type: String, default: '' }, // which model graded it
    status: { type: String, enum: ['in_progress', 'submitted'], default: 'in_progress', index: true },
  },
  { timestamps: true }
)
attemptSchema.index({ user: 1, cycle: 1 }, { unique: true })
// Leaderboard: top score first, earliest submit breaks ties — within one cycle.
attemptSchema.index({ cycle: 1, status: 1, score: -1, submittedAt: 1 })

export const ScholarshipCycle =
  mongoose.models.ScholarshipCycle || mongoose.model('ScholarshipCycle', cycleSchema)
export const ScholarshipQuestion =
  mongoose.models.ScholarshipQuestion || mongoose.model('ScholarshipQuestion', questionSchema)
export const ScholarshipEnrollment =
  mongoose.models.ScholarshipEnrollment || mongoose.model('ScholarshipEnrollment', enrollmentSchema)
export const ScholarshipAttempt =
  mongoose.models.ScholarshipAttempt || mongoose.model('ScholarshipAttempt', attemptSchema)
