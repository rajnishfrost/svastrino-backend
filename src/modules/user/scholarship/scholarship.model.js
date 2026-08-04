import mongoose from 'mongoose'

/**
 * Nirmaan Scholarship data model. Everything here is admin-managed / dynamic:
 *  - Institution : a school/college partner application (public form → admin review)
 *  - ScholarshipTest : the single test config (window + settings), a singleton
 *  - ScholarshipQuestion : open-ended reflective questions (AI-graded)
 *  - ScholarshipEnrollment : a student's enrolment (picks their institution)
 *  - ScholarshipAttempt : a student's timed attempt + AI-graded result
 */

// --- Institution partner application -----------------------------------------
const institutionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['school', 'college'], default: 'school' },
    branch: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    contactPerson: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    rejectionReason: { type: String, trim: true, default: '' },
    // One application per IP — stored so the service can block duplicates.
    submittedIp: { type: String, index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
)

// --- Test config (singleton, key='nirmaan') ----------------------------------
const testSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'nirmaan', unique: true },
    title: { type: String, default: 'Nirmaan Scholarship Test' },
    instructions: { type: String, default: '' },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    durationMins: { type: Number, default: 30 }, // per-student time limit once started
    active: { type: Boolean, default: true },
    declaredWinner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

// --- Question bank (open-ended, AI-graded) -----------------------------------
// Reflective / experience questions the student answers in their own words,
// e.g. "What problem have you solved, and did you think you'd solve it?".
const questionSchema = new mongoose.Schema(
  {
    order: { type: Number, default: 0, index: true },
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

// --- Enrolment (one per student) ---------------------------------------------
const enrollmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
    // Collected from the student at enrolment time.
    studentClass: { type: String, trim: true, default: '' },
    section: { type: String, trim: true, default: '' },
    rollNo: { type: String, trim: true, default: '' },
    enrolledAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

// --- Attempt (one per student, timed + AI-graded) ----------------------------
const attemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
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

export const Institution = mongoose.models.Institution || mongoose.model('Institution', institutionSchema)
export const ScholarshipTest = mongoose.models.ScholarshipTest || mongoose.model('ScholarshipTest', testSchema)
export const ScholarshipQuestion =
  mongoose.models.ScholarshipQuestion || mongoose.model('ScholarshipQuestion', questionSchema)
export const ScholarshipEnrollment =
  mongoose.models.ScholarshipEnrollment || mongoose.model('ScholarshipEnrollment', enrollmentSchema)
export const ScholarshipAttempt =
  mongoose.models.ScholarshipAttempt || mongoose.model('ScholarshipAttempt', attemptSchema)
