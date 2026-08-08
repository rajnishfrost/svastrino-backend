// One-off migration: the old Institution + singleton ScholarshipTest model
// becomes Organisation + per-organisation yearly ScholarshipCycle.
//
//   npm run migrate:organisations
//
// Safe to re-run: every step is keyed on something stable (institution _id,
// {organisation, year}, {user, cycle}), so a second run finds everything already
// migrated and changes nothing. It never deletes the old collections — verify
// the new data first, then drop `institutions` / `scholarshiptests` by hand.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { Organisation, DEFAULT_ORG_MODULES } from './organisation.model.js'
import {
  ScholarshipCycle,
  ScholarshipQuestion,
  ScholarshipEnrollment,
  ScholarshipAttempt,
} from '../scholarship/scholarship.model.js'

// The legacy collections, read raw — their Mongoose models no longer exist.
const raw = (name) => mongoose.connection.db.collection(name)

async function run() {
  await connectDB()
  const year = new Date().getFullYear()
  const summary = { organisations: 0, cycles: 0, questions: 0, enrolments: 0, attempts: 0, skipped: 0 }

  // --- 1. institutions → organisations (same _id, so every reference holds) ---
  const institutions = await raw('institutions').find({}).toArray()
  for (const inst of institutions) {
    if (await Organisation.exists({ _id: inst._id })) { summary.skipped++; continue }
    await Organisation.create({
      _id: inst._id,
      name: inst.name,
      // The old enum was school|college — both survive unchanged in ORG_TYPES.
      type: inst.type === 'college' ? 'college' : 'school',
      branch: inst.branch || '',
      city: inst.city || '',
      state: inst.state || '',
      contactPerson: inst.contactPerson || '',
      phone: inst.phone || '',
      email: inst.email,
      status: inst.status || 'pending',
      rejectionReason: inst.rejectionReason || '',
      submittedIp: inst.submittedIp || '',
      reviewedBy: inst.reviewedBy || null,
      reviewedAt: inst.reviewedAt || null,
      // No owner account yet — approving from the admin panel creates one and
      // emails the set-password link, exactly like a fresh application.
      owner: null,
      modules: [...DEFAULT_ORG_MODULES],
      publicListed: true,
      active: true,
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
    })
    summary.organisations++
  }

  // --- 2. the singleton test → one cycle per organisation that had students ---
  const legacyTest = (await raw('scholarshiptests').findOne({ key: 'nirmaan' })) || {}
  // These three collections now hold BOTH shapes — the old docs and the ones we
  // write below. `cycle` is the discriminator: only the new shape has it, so
  // excluding it is what makes a second run a no-op instead of a mess.
  const legacyEnrolments = await raw('scholarshipenrollments').find({ cycle: { $exists: false } }).toArray()
  const legacyQuestions = await raw('scholarshipquestions').find({ cycle: { $exists: false } }).toArray()
  const legacyAttempts = await raw('scholarshipattempts').find({ cycle: { $exists: false } }).toArray()

  // Which organisations actually had enrolments — only those need a cycle.
  const orgIds = [...new Set(legacyEnrolments.filter((e) => e.institution).map((e) => String(e.institution)))]

  for (const orgId of orgIds) {
    const org = await Organisation.findById(orgId)
    if (!org) continue

    let cycle = await ScholarshipCycle.findOne({ organisation: org._id, year })
    if (!cycle) {
      cycle = await ScholarshipCycle.create({
        organisation: org._id,
        year,
        title: legacyTest.title || `Nirmaan Scholarship ${year} — ${org.name}`,
        instructions: legacyTest.instructions || '',
        startAt: legacyTest.startAt || null,
        endAt: legacyTest.endAt || null,
        durationMins: legacyTest.durationMins || 30,
        // The old flow had no draft state — anything that was running stays
        // running; anything switched off lands as a draft for review.
        status: legacyTest.active === false ? 'draft' : 'published',
        active: legacyTest.active !== false,
      })
      summary.cycles++
    }

    // Questions were global — every migrated cycle gets its own copy so each
    // organisation can now edit its paper independently.
    if (!(await ScholarshipQuestion.exists({ cycle: cycle._id })) && legacyQuestions.length) {
      await ScholarshipQuestion.insertMany(
        legacyQuestions.map((q, i) => ({
          cycle: cycle._id,
          order: q.order || i + 1,
          prompt: q.prompt,
          guidance: q.guidance || '',
          maxWords: q.maxWords || 1000,
          active: q.active !== false,
        }))
      )
      summary.questions += legacyQuestions.length
    }

    // Enrolments + attempts for this organisation's students.
    const mine = legacyEnrolments.filter((e) => String(e.institution) === String(org._id))
    for (const e of mine) {
      if (await ScholarshipEnrollment.exists({ user: e.user, cycle: cycle._id })) continue
      await ScholarshipEnrollment.create({
        user: e.user,
        cycle: cycle._id,
        organisation: org._id,
        studentClass: e.studentClass || '',
        section: e.section || '',
        rollNo: e.rollNo || '',
        source: 'self', // everything pre-migration was student self-enrolment
        enrolledAt: e.enrolledAt || e.createdAt,
      })
      summary.enrolments++

      const att = legacyAttempts.find((a) => String(a.user) === String(e.user))
      if (att && !(await ScholarshipAttempt.exists({ user: e.user, cycle: cycle._id }))) {
        await ScholarshipAttempt.create({
          user: att.user,
          cycle: cycle._id,
          organisation: org._id,
          startedAt: att.startedAt,
          submittedAt: att.submittedAt || null,
          answers: att.answers || [],
          score: att.score || 0,
          total: att.total || 0,
          gradedModel: att.gradedModel || '',
          status: att.status || 'in_progress',
        })
        summary.attempts++
      }
    }

    // Carry the old single winner onto whichever cycle they actually sat.
    if (legacyTest.declaredWinner && !cycle.declaredWinner) {
      const won = await ScholarshipAttempt.exists({ cycle: cycle._id, user: legacyTest.declaredWinner })
      if (won) {
        cycle.declaredWinner = legacyTest.declaredWinner
        cycle.winnerDeclaredAt = legacyTest.updatedAt || new Date()
        await cycle.save()
      }
    }
  }

  console.log('✓ Migration complete:', summary)
  console.log(
    '  The legacy `institutions` and `scholarshiptests` collections were left in place.\n' +
      '  Verify the new data, then drop them manually.'
  )
  await mongoose.disconnect()
}

run().catch(async (err) => {
  console.error('✗ Migration failed:', err)
  await mongoose.disconnect()
  process.exit(1)
})
