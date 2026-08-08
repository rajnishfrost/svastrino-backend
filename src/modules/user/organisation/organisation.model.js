import mongoose from 'mongoose'

/**
 * An Organisation is any body we tie up with to run the Nirmaan scholarship —
 * a school, a college, a village panchayat, an NGO, a coaching centre, a
 * company. It supersedes the old `Institution` (which was school/college only
 * and had no login).
 *
 * Lifecycle:
 *   1. Someone submits the public partner form  → status 'pending'
 *   2. An admin approves it                     → status 'approved', an owner
 *      User account is created (role 'organisation') and emailed a
 *      set-password link
 *   3. The owner signs into /organisation and bulk-adds students, configures
 *      their scholarship cycle, and sees their own results
 *
 * `modules` is what the admin lets this organisation reach in its portal —
 * the org portal reads it on every request, so revoking access is immediate.
 */

// Organisation kinds. Fixed list so the public directory can filter/group
// reliably; add a new kind here and it shows up everywhere.
export const ORG_TYPES = ['school', 'college', 'village', 'ngo', 'coaching', 'corporate', 'other']

export const ORG_TYPE_LABELS = {
  school: 'School',
  college: 'College',
  village: 'Village / Panchayat',
  ngo: 'NGO / Trust',
  coaching: 'Coaching centre',
  corporate: 'Corporate',
  other: 'Other',
}

// Sections of the organisation portal an admin can grant. Kept deliberately
// small — an organisation never reaches the admin panel or anyone else's data.
export const ORG_MODULES = ['students', 'scholarship', 'profile']

// What a freshly approved organisation gets. Admin can trim it afterwards.
export const DEFAULT_ORG_MODULES = [...ORG_MODULES]

const organisationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ORG_TYPES, default: 'school', index: true },

    // Public-facing blurb shown on /organisations. Optional — an organisation
    // with no description simply renders without one.
    description: { type: String, trim: true, default: '', maxlength: 1200 },

    branch: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '', index: true },
    state: { type: String, trim: true, default: '', index: true },
    pincode: { type: String, trim: true, default: '' },
    website: { type: String, trim: true, default: '' },

    contactPerson: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },

    // Short human-friendly handle (e.g. DPS-RKP-4821) an organisation can give
    // students so they can find it, and that prefixes CSV-generated logins.
    code: { type: String, uppercase: true, trim: true, unique: true, sparse: true },

    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    rejectionReason: { type: String, trim: true, default: '' },

    // The organisation's own login account (User with role 'organisation').
    // Created on approval; null while pending/rejected.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    // Portal sections this organisation may use — see ORG_MODULES.
    modules: { type: [String], enum: ORG_MODULES, default: DEFAULT_ORG_MODULES },

    // Shown in the public /organisations directory. The organisation can opt
    // out from its own profile page; admin can override.
    publicListed: { type: Boolean, default: true, index: true },

    // Suspend an organisation without deleting it — blocks the portal and hides
    // it from the enrolment dropdown, but keeps every record intact.
    active: { type: Boolean, default: true, index: true },

    // One application per IP on the public form — stored so the service can
    // block duplicates.
    submittedIp: { type: String, index: true },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
)

// The directory and the enrolment dropdown both ask for "approved, listed,
// active" — one index covers both.
organisationSchema.index({ status: 1, active: 1, publicListed: 1 })

export const Organisation =
  mongoose.models.Organisation || mongoose.model('Organisation', organisationSchema)
