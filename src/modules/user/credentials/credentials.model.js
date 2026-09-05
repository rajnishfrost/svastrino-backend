import mongoose from 'mongoose'

/**
 * Unified end-user account — one account powers both mentoring and courses.
 *
 * Auth is email + password (bcrypt-hashed) with optional Google sign-in.
 * Security notes:
 *  - `passwordHash` is never selected by default (select:false) so it can't
 *    leak through a stray `.find()` — it must be explicitly requested.
 *  - Email-verification and password-reset tokens are stored HASHED (sha256).
 *    The raw token only ever lives in the email link; a DB leak can't be
 *    replayed. Both carry an expiry and are single-use.
 *  - `googleId` lets a Google account bind to the same record (sparse unique).
 *  - `purgeAt` + a TTL index auto-delete accounts that are created but never
 *    verified, so abandoned signups don't linger or squat on an email forever.
 *    It's cleared the moment the email is verified (verified users never expire).
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    // Not unique — several accounts may share a phone (e.g. a parent's number
    // used by siblings). Uniqueness lives on `email` only.
    phone: { type: String, trim: true },

    // Which class the student is in. The psychometric assessment is only offered
    // to students in classes 7 to 12, so the account has to know where the
    // student is before a plan can be sold to them. Free-form rather than an enum
    // because this mirrors what the enquiry forms already collect ('Class 7' …
    // 'Class 12', 'Graduate', 'Other') and that wording changes with the site.
    // Empty for anyone who never told us — an adult buying mentoring, typically.
    studentClass: { type: String, trim: true, default: '' },

    // Unified account role, referencing a Role by its `key` (see modules/admin/
    // roles). Roles are managed on the Roles page, so this is a free-form key
    // (validated against existing roles when set) rather than a fixed enum.
    // `student` is the seeded default; only roles that grant modules (or
    // superadmin) can sign into the admin panel.
    role: { type: String, default: 'student', index: true },
    // Lets a superadmin disable an account without deleting it. Blocks sign-in.
    // A role's module set (and thus panel access) lives on the Role collection,
    // keyed by this `role` string — see modules/admin/roles.
    active: { type: Boolean, default: true },

    // May this account use the STUDENT portal — the dashboard, a course, a
    // checkout — as opposed to only the admin panel?
    //
    // One account, one login: the site and the panel share a token, so an admin
    // pressing "View site" has always landed inside the student portal signed
    // in. That is right for a mentor who is also learning and wrong for a
    // content editor, and until now there was no way to say which. Students are
    // never judged by this — a student account IS the portal — so it is only
    // ever read for someone whose role is something else.
    siteAccess: { type: Boolean, default: true },

    // Which organisation this account came from (see modules/user/organisation).
    //   null      → a plain public signup, nobody added them
    //   ObjectId  → the organisation that bulk-added / registered them
    // Read `organisationRole` alongside it to tell a student apart from the
    // organisation's own login:
    //   'member' → a student the organisation added
    //   'owner'  → this account IS the organisation ("self")
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', default: null, index: true },
    organisationRole: { type: String, enum: ['member', 'owner', null], default: null },

    // Absent for Google-only accounts that never set a password.
    passwordHash: { type: String, select: false },

    googleId: { type: String, sparse: true, unique: true, select: false },
    avatar: { type: String, default: '' },

    emailVerified: { type: Boolean, default: false },
    // Phone isn't verified at signup — the profile page will offer a
    // "verify this" step later. Flag reserved for that flow.
    phoneVerified: { type: Boolean, default: false },

    // Hashed one-time tokens (never store the raw value).
    emailVerifyTokenHash: { type: String, select: false },
    emailVerifyExpires: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    // Set at signup for unverified accounts; a TTL index (below) deletes the
    // doc once this instant passes. Cleared on verification so the account stays.
    purgeAt: { type: Date, select: false },

    // Deliberately NOT derived from `studentClass`: plenty of accounts are adults
    // buying mentoring for themselves and have no class at all, so requiring one
    // would leave their profile permanently incomplete.
    isProfileComplete: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
)

// TTL index: MongoDB removes a doc ~once `purgeAt` is in the past. Docs without
// a `purgeAt` (i.e. verified users) are ignored and never auto-deleted.
userSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 })

export const User = mongoose.models.User || mongoose.model('User', userSchema)
