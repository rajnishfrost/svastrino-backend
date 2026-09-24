import mongoose from 'mongoose'

/**
 * One student's psychometric assessment for one product (e.g. 'nirmaan').
 *
 * Lifecycle (handoff mode):
 *   not_started → in_progress   student opened the Mindler test site
 *               → submitted     student says they finished it
 *               → completed     admin verified + attached the report
 *
 * In API mode `completed` also comes straight from Mindler: while the test is
 * open or self-reported, each status read asks getAssessmentStatus, and a
 * finished answer completes it (providerStatus records what Mindler said).
 *
 * The report fields are what the Career Report page renders (RIASEC code drives
 * which pre-recorded explanation video is shown).
 */
const assessmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product: { type: String, required: true, index: true }, // 'nirmaan'
    provider: { type: String, default: 'mindler' },

    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'submitted', 'completed'],
      default: 'not_started',
      index: true,
    },

    // Whatever identifies the student on the provider side (e.g. the email they
    // registered with on the white-label site). Set by the student or an admin.
    externalRef: { type: String, default: null },

    // Per-student Mindler coupon. The admin generates it in the partner
    // dashboard ("Assessment Coupons Remaining" → pick Stream/Career/College +
    // services → generate) and saves it here; the student uses it to sign up.
    couponCode: { type: String, default: null },

    // What Mindler said at the last getAssessmentStatus call ('completed', or
    // how far through, e.g. '40% done'), and when we asked. The check is throttled on providerCheckedAt.
    providerStatus: { type: String, default: null },
    // How far through the test Mindler says they are, 0–100 (null = never asked).
    providerPercent: { type: Number, default: null, min: 0, max: 100 },
    providerCheckedAt: { type: Date, default: null },

    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    report: {
      url: { type: String, default: null },        // link to the report PDF
      riasecCode: { type: String, default: null }, // e.g. 'RIA' — picks the explainer video
      videoUrl: { type: String, default: null },   // optional explicit override; else auto by RIASEC
      topCareers: { type: [String], default: [] },
      summary: { type: String, default: '' },
    },

    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

assessmentSchema.index({ user: 1, product: 1 }, { unique: true })

export const Assessment =
  mongoose.models.Assessment || mongoose.model('Assessment', assessmentSchema)
