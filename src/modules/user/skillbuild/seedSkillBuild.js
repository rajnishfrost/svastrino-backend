// Seeds the Skill-Build catalog (Nirmaan + its packages) into MongoDB.
// Idempotent — upserts by slug/sku. Run:  npm run seed:skillbuild
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { SkillBuild } from './skillbuild.model.js'
import { Package } from './package.model.js'
import { Session } from '../learn/session.model.js'

const NIRMAAN = {
  slug: 'nirmaan',
  name: 'Nirmaan',
  tagline: 'Career clarity for classes 9–12',
  description:
    'Nirmaan is Svastrino’s structured Skill-Build course — a psychometric-backed ' +
    'journey of career discovery, mindset mentoring and a personalised roadmap that ' +
    'helps students in Tier 2/3 India find and build their direction.',
  order: 1,
}

// Prices in PAISE. Features/pricing mirror the SRS §9 tiers.
const PACKAGES = [
  {
    sku: 'nirmaan-full', slug: 'full', name: 'Nirmaan', tagline: 'Pay once, save 25%',
    // List price Rs 6,000; paying at once takes 25% off, so Rs 4,500 is charged.
    price: 600000, earlyBird: 450000, period: 'one-time', durationDays: 365,
    paymentMode: 'one-time', phases: 6, includesPsychometric: false,
    features: [
      '24 life-changing aspects of future life',
      'Structured personal & professional skill development',
      'Daily worksheets / tasks for overall development',
      'Daily progress tracking',
      'Daily task reminders',
      'Total course validity 1 year from the date of enrolment',
      'Pay at once and get a 25% discount immediately',
    ],
    cta: 'Get Nirmaan', variant: 'btn-primary', featured: true, badge: 'Best value', order: 1,
  },
  {
    sku: 'nirmaan-payu', slug: 'pay-as-you-use', name: 'Nirmaan (Pay as you Use)',
    tagline: 'Spread the cost over 6 phases',
    // Rs 1,000 per phase x 6 phases = Rs 6,000. No interest, no discount.
    price: 100000, earlyBird: null, period: 'per phase', durationDays: 365,
    paymentMode: 'per-phase', phases: 6, includesPsychometric: false,
    features: [
      '24 life-changing aspects of future life',
      'Structured personal & professional skill development',
      'Daily worksheets / tasks for overall development',
      'Daily progress tracking',
      'Daily task reminders',
      'Course has to be completed in 1 year',
      'Video & task validity 1 year from first enrolment; each video plays 5 times',
      'After the 1-year expiry, tasks can be viewed for 3 years',
      'Six equal payments, without interest',
      'Resume where you left off by paying for each phase at a time',
    ],
    cta: 'Start with 1 phase', variant: 'btn-secondary', featured: false, badge: null, order: 2,
  },
  {
    sku: 'nirmaan-psy-full', slug: 'with-psychometric', name: 'Nirmaan + Psychometric Testing',
    tagline: 'The course plus the test — pay once, save 25%',
    // List Rs 6,900 (course Rs 6,000 + test Rs 900); 25% off = Rs 5,175.
    price: 690000, earlyBird: 517500, period: 'one-time', durationDays: 365,
    paymentMode: 'one-time', phases: 6, includesPsychometric: true,
    features: [
      '24 life-changing aspects of future life',
      'Structured personal & professional skill development',
      'Daily worksheets / tasks for overall development',
      'Daily progress tracking',
      'Daily task reminders',
      'Total course validity 1 year from the date of enrolment',
      "India's best psychometric testing, guiding students on the RIASEC scale",
      'Up to a 40-page report covering strengths, weaknesses, personality, interests, preferences and your top 5 career options',
      'Psychometric testing is for students of class 7 to 12 only',
      'Pay at once and get a 25% discount immediately',
    ],
    cta: 'Get Nirmaan + Test', variant: 'btn-primary', featured: false, badge: null, order: 3,
  },
  {
    sku: 'nirmaan-psy-payu', slug: 'with-psychometric-pay-as-you-use',
    name: 'Nirmaan + Psychometric Testing (Pay as you Use)',
    tagline: 'Course plus test, spread over 6 phases',
    // Rs 1,150 per phase x 6 phases = Rs 6,900.
    price: 115000, earlyBird: null, period: 'per phase', durationDays: 365,
    paymentMode: 'per-phase', phases: 6, includesPsychometric: true,
    features: [
      '24 life-changing aspects of future life',
      'Structured personal & professional skill development',
      'Daily worksheets / tasks for overall development',
      'Daily progress tracking',
      'Daily task reminders',
      'Course has to be completed in 1 year',
      'Video & task validity 1 year from first enrolment; each video plays 5 times',
      'After the 1-year expiry, tasks can be viewed for 3 years',
      "India's best psychometric testing, guiding students on the RIASEC scale",
      'Six equal payments, without interest',
    ],
    cta: 'Start with 1 phase', variant: 'btn-secondary', featured: false, badge: null, order: 4,
  },
]

// Mock course content (SRS §4.3). tier = min package rank to unlock
// (1 Discover+ · 2 Clarity+ · 3 Launch only). Videos are public sample MP4s —
// replace with real S3/CloudFront URLs (admin upload) later.
const V = (n) => `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/${n}.mp4`
const SESSIONS = [
  { order: 1, tier: 1, title: 'Welcome & Your Career Report', durationMins: 8, video: 'BigBuckBunny',
    description: 'Orientation: how Nirmaan works and how to read your psychometric career report.',
    worksheet: { title: 'Getting started', tasks: ['Note your top 3 career interests from the report', 'Write one question you want answered', 'Set your weekly study time'] } },

  { order: 2, tier: 2, title: 'Discovering Your Interests (RIASEC)', durationMins: 14, video: 'ElephantsDream',
    description: 'Understand the RIASEC interest model and map it to real career families.',
    worksheet: { title: 'Interest mapping', tasks: ['List your RIASEC top two codes', 'Match 3 careers to each', 'Shortlist 5 to explore'] } },
  { order: 3, tier: 2, title: 'Strengths & Skills Audit', durationMins: 12, video: 'ForBiggerBlazes',
    description: 'Identify your current strengths and the skills to build next.',
    worksheet: { title: 'Skills audit', tasks: ['Rate 8 core skills 1–5', 'Pick 2 to improve this month', 'Find one resource for each'] } },
  { order: 4, tier: 2, title: 'Growth Mindset Foundations', durationMins: 11, video: 'ForBiggerEscapes',
    description: 'Fixed vs growth mindset and how it shapes career choices.',
    worksheet: { title: 'Mindset reset', tasks: ['Spot one fixed-mindset belief', 'Reframe it', 'Plan a small stretch task'] } },
  { order: 5, tier: 2, title: 'Goal-Setting that Sticks', durationMins: 13, video: 'ForBiggerFun',
    description: 'Turn ambitions into SMART goals and milestones.',
    worksheet: { title: 'Your 90-day goal', tasks: ['Write one SMART goal', 'Break it into 3 milestones', 'Set a review date'] } },
  { order: 6, tier: 2, title: 'Time & Habit Systems', durationMins: 10, video: 'ForBiggerJoyrides',
    description: 'Build routines that protect study and exploration time.',
    worksheet: { title: 'Habit plan', tasks: ['Design a weekly time-block', 'Choose one keystone habit', 'Set a streak tracker'] } },
  { order: 7, tier: 2, title: 'Overcoming Exam & Career Stress', durationMins: 12, video: 'SubaruOutbackOnStreetAndDirt',
    description: 'Practical techniques to manage stress and decision anxiety.',
    worksheet: { title: 'Calm toolkit', tasks: ['List your top 2 stressors', 'Pick a coping technique', 'Practise it for a week'] } },

  { order: 8, tier: 3, title: 'Personal Branding Basics', durationMins: 15, video: 'TearsOfSteel',
    description: 'Craft a simple personal brand and online presence.',
    worksheet: { title: 'Brand starter', tasks: ['Write a 1-line intro', 'Pick 3 brand keywords', 'Clean up one profile'] } },
  { order: 9, tier: 3, title: 'Interview & Communication Skills', durationMins: 16, video: 'VolkswagenGTIReview',
    description: 'Speak and present with confidence in any setting.',
    worksheet: { title: 'Communication reps', tasks: ['Record a 60s self-intro', 'Prepare 3 STAR stories', 'Practise with a friend'] } },
  { order: 10, tier: 3, title: 'Building Your Career Roadmap', durationMins: 18, video: 'WeAreGoingOnBullrun',
    description: 'Assemble everything into a personalised, actionable roadmap.',
    worksheet: { title: 'Your roadmap', tasks: ['Define your 1-year target', 'List 5 milestones', 'Identify one mentor to reach out to'] } },
]

async function run() {
  await connectDB()

  const sb = await SkillBuild.findOneAndUpdate(
    { slug: NIRMAAN.slug },
    { $set: NIRMAAN },
    { upsert: true, new: true }
  )
  console.log(`✓ SkillBuild: ${sb.name} (${sb.slug})`)

  for (const p of PACKAGES) {
    await Package.findOneAndUpdate(
      { sku: p.sku },
      { $set: { ...p, skillBuild: sb._id } },
      { upsert: true, new: true }
    )
    console.log(`  ✓ Package: ${p.name} (${p.sku})`)
  }

  // Retire any package of this course that is no longer in the seed list —
  // otherwise renamed or dropped plans (Discover / Clarity / Launch) keep
  // showing on the pricing cards. Deactivated rather than deleted so existing
  // orders and enrollments still resolve their package name.
  const keep = PACKAGES.map((p) => p.sku)
  const retired = await Package.updateMany(
    { skillBuild: sb._id, sku: { $nin: keep }, active: true },
    { $set: { active: false } }
  )
  if (retired.modifiedCount) console.log(`  ⏻ Retired ${retired.modifiedCount} old package(s)`)

  // Reseed sessions for this skill-build (idempotent: clear then insert).
  await Session.deleteMany({ skillBuild: sb._id })
  for (const s of SESSIONS) {
    await Session.create({
      skillBuild: sb._id,
      order: s.order,
      tier: s.tier,
      title: s.title,
      description: s.description,
      videoUrl: V(s.video),
      durationMins: s.durationMins,
      worksheet: s.worksheet,
    })
  }
  console.log(`  ✓ Sessions: ${SESSIONS.length} seeded (tiers 1/2/3)`)

  await mongoose.disconnect()
  console.log('✓ Skill-Build catalog + content seeded.')
}

run().catch((err) => {
  console.error('✗ Seed failed:', err)
  process.exit(1)
})
