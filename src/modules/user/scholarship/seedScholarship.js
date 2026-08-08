// Seeds mock Nirmaan Scholarship data: partner organisations of several kinds,
// an open cycle for each approved one, and 10 open-ended (AI-graded) questions.
//   npm run seed:scholarship
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { ScholarshipCycle, ScholarshipQuestion } from './scholarship.model.js'
import { Organisation, DEFAULT_ORG_MODULES } from '../organisation/organisation.model.js'

// A deliberate spread of types so the public directory's filters have something
// to show — it's no longer a schools-and-colleges-only programme.
const ORGANISATIONS = [
  { name: 'Delhi Public School', type: 'school', branch: 'R.K. Puram', city: 'New Delhi', state: 'Delhi', contactPerson: 'Anita Sharma', phone: '+911123456789', email: 'partner1@example.com', status: 'approved', code: 'DPS-1A01', description: 'A CBSE senior secondary school running the Nirmaan scholarship for classes 9–12.' },
  { name: 'Kendriya Vidyalaya', type: 'school', branch: 'Sector 8', city: 'Gandhinagar', state: 'Gujarat', contactPerson: 'Ravi Patel', phone: '+919812345678', email: 'partner2@example.com', status: 'approved', code: 'KV-2B02', description: 'Central government school partnering to give one student a full Nirmaan package.' },
  { name: 'St. Xavier’s College', type: 'college', branch: 'Main Campus', city: 'Mumbai', state: 'Maharashtra', contactPerson: 'Neha Verma', phone: '+919900112233', email: 'partner3@example.com', status: 'approved', code: 'SXC-3C03', description: 'Undergraduate college offering the scholarship to first and second year students.' },
  { name: 'Rampur Gram Panchayat', type: 'village', city: 'Rampur', state: 'Uttar Pradesh', contactPerson: 'Sunil Yadav', phone: '+915223344556', email: 'partner4@example.com', status: 'approved', code: 'RGP-4D04', description: 'Village panchayat sponsoring career guidance for students across the block.' },
  { name: 'Aasha Foundation', type: 'ngo', city: 'Jaipur', state: 'Rajasthan', contactPerson: 'Meera Joshi', phone: '+919000011122', email: 'partner5@example.com', status: 'approved', code: 'AF-5E05', description: 'NGO working with first-generation learners in and around Jaipur.' },
  { name: 'City Montessori School', type: 'school', branch: 'Gomti Nagar', city: 'Lucknow', state: 'Uttar Pradesh', contactPerson: 'S. Khan', phone: '+915223344557', email: 'partner6@example.com', status: 'pending' },
]

// Open-ended, reflective questions (AI-graded, 1 mark each). `guidance` is an
// internal hint for the grader and is never shown to students.
const QUESTIONS = [
  {
    prompt: 'Tell us about a problem you have solved so far. At that time, did you think you would be able to solve it? What happened?',
    guidance: 'A specific real problem, honest reflection on their initial doubt/confidence, and how it turned out or what they did.',
  },
  {
    prompt: 'Describe a time you tried something new and it did not go as planned. What did you learn from it?',
    guidance: 'A concrete attempt, an honest failure/setback, and a genuine lesson or change in approach.',
  },
  {
    prompt: 'What is one subject or activity you enjoy the most, and why does it interest you?',
    guidance: 'A clear interest with a personal, specific reason — not a one-word or generic answer.',
  },
  {
    prompt: 'Think of a goal you are working towards right now. What steps are you taking to reach it?',
    guidance: 'A real goal plus at least one concrete, believable step they are actually taking.',
  },
  {
    prompt: 'Tell us about a time you helped someone. How did it make you feel?',
    guidance: 'A specific instance of helping and honest reflection on the feeling/impact.',
  },
  {
    prompt: 'What is something you are curious about and would love to explore or learn more deeply?',
    guidance: 'Genuine curiosity with a specific topic and some reasoning, not a vague "everything".',
  },
  {
    prompt: 'Describe a challenge you are facing in your studies or life, and how you are trying to deal with it.',
    guidance: 'An honest current challenge and a realistic coping/action approach — shows self-awareness.',
  },
  {
    prompt: 'If you could change one thing about your school or community, what would it be and why?',
    guidance: 'A thoughtful, specific change with a reason showing awareness of others.',
  },
  {
    prompt: 'What does success mean to you? Has your idea of it changed over time?',
    guidance: 'A personal definition of success with some reflection or evolution in their thinking.',
  },
  {
    prompt: 'Where do you see yourself in five years, and what makes you believe you can get there?',
    guidance: 'A concrete aspiration plus honest reasoning about their strengths/plan — not just a job title.',
  },
]

const INSTRUCTIONS =
  'Answer every question in your own words before the timer runs out. Each question carries 1 mark and is graded on the honesty and depth of your reflection.'

async function run() {
  await connectDB()

  const year = new Date().getFullYear()
  // Open window: started yesterday, ends in 2 weeks.
  const now = new Date()
  const startAt = new Date(now.getTime() - 24 * 3600 * 1000)
  const endAt = new Date(now.getTime() + 14 * 24 * 3600 * 1000)

  // Organisations — upsert by email. No owner accounts here: approving from the
  // admin panel is what provisions the login, and seeding fake ones would send
  // real set-password emails.
  for (const org of ORGANISATIONS) {
    await Organisation.findOneAndUpdate(
      { email: org.email },
      { $set: { ...org, modules: [...DEFAULT_ORG_MODULES], publicListed: true, active: true } },
      { upsert: true, setDefaultsOnInsert: true }
    )
  }
  const approved = ORGANISATIONS.filter((o) => o.status === 'approved')
  console.log(`✓ Upserted ${ORGANISATIONS.length} organisations (${approved.length} approved)`)

  // One published cycle per approved organisation, each with its own copy of the
  // question set — that's the whole point of per-organisation cycles.
  let cycles = 0
  for (const spec of approved) {
    const org = await Organisation.findOne({ email: spec.email })
    const cycle = await ScholarshipCycle.findOneAndUpdate(
      { organisation: org._id, year },
      {
        $set: {
          title: `Nirmaan Scholarship ${year} — ${org.name}`,
          instructions: INSTRUCTIONS,
          startAt,
          endAt,
          durationMins: 30,
          status: 'published',
          active: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    await ScholarshipQuestion.deleteMany({ cycle: cycle._id })
    await ScholarshipQuestion.insertMany(
      QUESTIONS.map((q, i) => ({ ...q, cycle: cycle._id, order: i + 1, maxWords: 1000, active: true }))
    )
    cycles++
  }
  console.log(`✓ Seeded ${cycles} open ${year} cycles, ${QUESTIONS.length} questions each`)

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error('✗ Seed failed:', err.message)
  process.exit(1)
})
