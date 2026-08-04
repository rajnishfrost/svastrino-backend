// Seeds mock Nirmaan Scholarship data: a test config with an open window, 10
// open-ended (AI-graded) reflective questions, and approved partner institutions.
//   npm run seed:scholarship
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { Institution, ScholarshipTest, ScholarshipQuestion } from './scholarship.model.js'

const INSTITUTIONS = [
  { name: 'Delhi Public School', type: 'school', branch: 'R.K. Puram', city: 'New Delhi', state: 'Delhi', contactPerson: 'Anita Sharma', phone: '+911123456789', email: 'partner1@example.com', status: 'approved' },
  { name: 'Kendriya Vidyalaya', type: 'school', branch: 'Sector 8', city: 'Gandhinagar', state: 'Gujarat', contactPerson: 'Ravi Patel', phone: '+919812345678', email: 'partner2@example.com', status: 'approved' },
  { name: 'St. Xavier’s College', type: 'college', branch: 'Main Campus', city: 'Mumbai', state: 'Maharashtra', contactPerson: 'Neha Verma', phone: '+919900112233', email: 'partner3@example.com', status: 'approved' },
  { name: 'City Montessori School', type: 'school', branch: 'Gomti Nagar', city: 'Lucknow', state: 'Uttar Pradesh', contactPerson: 'S. Khan', phone: '+915223344556', email: 'partner4@example.com', status: 'pending' },
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

async function run() {
  await connectDB()

  // Test config — open window (started yesterday, ends in 2 weeks).
  const now = new Date()
  const startAt = new Date(now.getTime() - 24 * 3600 * 1000)
  const endAt = new Date(now.getTime() + 14 * 24 * 3600 * 1000)
  await ScholarshipTest.findOneAndUpdate(
    { key: 'nirmaan' },
    {
      $set: {
        title: 'Nirmaan Scholarship Test',
        instructions: 'Answer every question in your own words before the timer runs out. Each question carries 1 mark and is graded on the honesty and depth of your reflection.',
        startAt,
        endAt,
        durationMins: 30,
        active: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
  console.log('✓ Test config upserted (window open now)')

  // Questions — replace the whole set with the 10 reflective questions.
  const removed = await ScholarshipQuestion.deleteMany({})
  await ScholarshipQuestion.insertMany(
    QUESTIONS.map((q, i) => ({ ...q, order: i + 1, maxWords: 1000, active: true }))
  )
  console.log(`✓ Replaced questions (removed ${removed.deletedCount}, seeded ${QUESTIONS.length} open-ended)`)

  // Institutions — upsert by email.
  for (const inst of INSTITUTIONS) {
    await Institution.findOneAndUpdate({ email: inst.email }, { $set: inst }, { upsert: true, setDefaultsOnInsert: true })
  }
  console.log(`✓ Upserted ${INSTITUTIONS.length} institutions (${INSTITUTIONS.filter((i) => i.status === 'approved').length} approved)`)

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error('✗ Seed failed:', err.message)
  process.exit(1)
})
