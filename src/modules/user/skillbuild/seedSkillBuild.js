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
    sku: 'nirmaan-discover', slug: 'discover', name: 'Discover', tagline: 'Test the waters',
    price: 49900, earlyBird: null, period: 'one-time', durationDays: null,
    features: [
      'Psychometric Test',
      'Career Report (PDF)',
      'Pre-recorded Report Explanation Video',
      'Career Roadmap (Basic — Top 5 Careers)',
    ],
    cta: 'Get Discover', variant: 'btn-secondary', featured: false, badge: null, order: 1,
  },
  {
    sku: 'nirmaan-clarity', slug: 'clarity', name: 'Clarity', tagline: 'Build the plan',
    price: 199900, earlyBird: 169900, period: '6 months', durationDays: 182,
    features: [
      'Everything in Discover',
      '12 Mindset Mentoring Sessions + Worksheets',
      'Community Access',
      'Scholarship Information',
    ],
    cta: 'Get Clarity', variant: 'btn-primary', featured: true, badge: 'Most Popular', order: 2,
  },
  {
    sku: 'nirmaan-launch', slug: 'launch', name: 'Launch', tagline: 'Go all-in',
    price: 349900, earlyBird: 299900, period: '12 months', durationDays: 365,
    features: [
      'Everything in Clarity',
      'Full 20 Mindset Sessions + Worksheets',
      '2 Career Webinars',
      'Personality Development Module',
      '1 × 30-min Career Call',
    ],
    cta: 'Get Launch', variant: 'btn-secondary', featured: false, badge: null, order: 3,
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
