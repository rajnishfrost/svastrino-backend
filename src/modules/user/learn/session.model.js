import mongoose from 'mongoose'

/**
 * One course session/lesson of a Skill-Build product (SRS §4.3). Sessions are
 * TIERED: `tier` is the minimum package rank that unlocks it
 *   1 = Discover+ · 2 = Clarity+ · 3 = Launch only
 * A student can access every session whose tier ≤ their purchased package rank.
 * Videos + worksheets are managed here (later editable from the admin panel).
 */
const sessionSchema = new mongoose.Schema(
  {
    skillBuild: { type: mongoose.Schema.Types.ObjectId, ref: 'SkillBuild', required: true, index: true },
    order: { type: Number, required: true },   // sequence within the course
    tier: { type: Number, required: true, default: 1 }, // min package rank to unlock

    title: { type: String, required: true },
    description: { type: String, default: '' },

    videoUrl: { type: String, default: '' },   // stream URL (mock sample now; S3/CloudFront later)
    durationMins: { type: Number, default: 0 },

    // Caption tracks (WebVTT). One per language; `lang` is a BCP-47 code
    // ('hi', 'en'), `label` is what the player shows in the subtitle menu.
    captions: {
      type: [{
        _id: false,
        lang: { type: String, required: true },
        label: { type: String, required: true },
        url: { type: String, required: true },
        key: { type: String, default: '' }, // storage key, for deletion
      }],
      default: [],
    },

    // In-app worksheet (SRS CRS-05/06)
    worksheet: {
      title: { type: String, default: '' },
      tasks: { type: [String], default: [] },
    },

    // The week's written resource — the companion document to the video. It is
    // handed over only once the student has watched the video through, so it
    // never travels with the course payload the way the worksheet never does.
    // Blocks are { t: 'h' | 'p' | 'li' | 'table', text?, rows? } — Mixed for the
    // same reason the course overview is: the shape belongs to the document,
    // not to the database.
    resourceBlocks: { type: mongoose.Schema.Types.Mixed, default: null },

    // What that resource holds, kept beside it so the course page can say what
    // is inside the document without carrying the document itself. Written by
    // the same sync that writes the blocks, and never separately.
    resourceSummary: {
      blocks: { type: Number, default: 0 },        // 0 = this week has no resource
      headings: { type: [String], default: [] },   // its section titles, in order
    },

    // Timestamped notes shown under the video — click a timestamp to jump there.
    notes: {
      type: [{
        _id: false,
        time: { type: Number, required: true }, // seconds into the video
        text: { type: String, required: true },
      }],
      default: [],
    },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema)
