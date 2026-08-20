import mongoose from 'mongoose'

/**
 * Site settings the team can change from the admin panel, without a deploy.
 *
 * One document holds them all (`key: 'site'`). Anything that must be editable
 * at runtime belongs here; anything that is a deployment secret (SMTP password,
 * database URI, gateway keys) stays in the environment.
 */
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'site', unique: true, index: true },

    // Where enquiries from the public forms are emailed. Several addresses may
    // be given, separated by commas. Blank falls back to the ENQUIRY_TO env var,
    // then to SEED_ADMIN_EMAIL, so the site never silently stops notifying.
    enquiryTo: { type: String, default: '', trim: true },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

export const Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema)
