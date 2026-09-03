// Seeds site content migrated from the legacy svastrino.com site: mentoring
// programs, FAQs, success stories and the career library.
// Idempotent — upserts by slug / natural key. Run:  npm run seed:content
import '../../../config/env.js'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { localMedia } from '../../../utils/media.js'
import { MentoringProgram } from './program.model.js'
import { Faq } from './faq.model.js'
import { Testimonial } from './testimonial.model.js'
import { CareerField } from './careerField.model.js'
import { Course } from './course.model.js'
import { SitePage } from './sitePage.model.js'

const here = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Mentoring programs  (source: svastrino.com program pages)
// ---------------------------------------------------------------------------
// Model Session was retired — the catalog now starts at Bull's Eye.
const PROGRAMS = [
  {
    slug: 'bulls-eye',
    name: "Bull's Eye Program",
    // Which "Services" sub-category this program sits under (for the site nav
    // + landing grouping). Matches the mentoring catalog sub-categories.
    category: { slug: 'career-counselling', name: 'Career Counselling' },
    bookingSku: 'mentoring-bullseye',
    tagline: "Get a quick yet accurate solution for your 'Career Confusion'",
    summary:
      'A focused 2-hour session designed to achieve clarity when you are stuck between ' +
      'options or facing a deadline — ending with concrete career recommendations and a plan.',
    duration: '10 days',
    sessions: '3 sessions of 2 hours each — about 6 hours in total, plus the pre-work and the follow-up',
    mode: 'Online',
    chooseIf: [
      'You want a second opinion on a career plan with multiple options',
      'You need guidance before an application deadline',
      'You want clarity on your interests and possible career pathways',
      'You are verifying a course, college or university selection',
      'You want to explore your personality-based potential and build a vision',
    ],
    journey: [
      { label: 'Stage 1', title: 'Pre-session', description: 'Your background, academics and personal development are reviewed via a form so the session starts informed.' },
      { label: 'Stage 2 · 0–30 min', title: 'Personality identification', description: 'Identifying your personality and validating your strengths.' },
      { label: 'Stage 2 · 31–70 min', title: 'Needs, vision and goals', description: 'Addressing your needs and understanding your vision and goals.' },
      { label: 'Stage 2 · 71–95 min', title: 'Clarifying ambitions', description: 'Clarifying and prioritising what you actually want.' },
      { label: 'Stage 2 · 95–120 min', title: 'Recommendations', description: 'Career recommendations and formulation of your plan.' },
      { label: 'Stage 3', title: 'Post-session follow-up', description: 'A 30-minute follow-up one week later to reaffirm your choice and address concerns.' },
    ],
    benefits: [
      'Quick evaluation for the right career alignment',
      'Coverage from 8th grade through post-graduation',
      'Guidance on the educational application process',
      'Resolution of last-minute confusion',
      'Personalised mentoring tailored to your strengths',
      'Confidence and clarity for the road ahead',
    ],
    sourceUrl: 'https://svastrino.com/bulls-eye/',
    order: 2,
    // Questions people ask about this program specifically.
    faqs: [
      {
        q: "How is this different from a full mentoring program?",
        a: "Bull's Eye is built for an immediate decision — you come with a specific confusion and leave with a recommendation. The longer programs work on you over months; this one works on the choice in front of you.",
      },
      {
        q: "What happens before the session?",
        a: "You fill in a short form about your background, academics and interests. That is reviewed before you arrive, so the session itself is spent on your questions rather than on gathering facts.",
      },
      {
        q: "Is one session really enough?",
        a: "For a specific decision — a stream, a course, a college, a second opinion on a plan — yes. There is also a follow-up a week later to reaffirm the choice and answer anything that came up since.",
      },
      {
        q: "Who is it not for?",
        a: "If you want to build mindset, habits and a long-term plan rather than settle one question, Bloom or Breakthrough will serve you far better.",
      },
    ],
  },
  {
    slug: 'bloom',
    name: 'Bloom Program',
    category: { slug: 'personalised-mentoring', name: 'Personalised Mentoring' },
    bookingSku: 'mentoring-bloom',
    tagline: 'Cultivate a visionary mindset and set goals for a bright future',
    summary:
      "Svastrino's personality-based mentoring program. Over 45–60 days it moves from a full " +
      'personality analysis through self-discovery tasks and vision building, ending in a ' +
      'personalised 5-year career plan.',
    duration: '2 months',
    sessions: '5 sessions of 2 hours each plus weekly follow-ups — about 10 hours in total',
    mode: 'Online',
    chooseIf: [
      'You want to discover your unique potential and build a customised vision',
      'You want to explore career paths that align with your strengths and goals',
      'You want to eliminate career options that do not suit you',
      'You want a personality-based mentoring program',
      'You want to find your career and life path through informed decisions',
    ],
    journey: [
      { label: 'Day 1', title: 'Complete personality analysis', description: 'Personality, qualities and background check, self-introspective questions and guidance on your evolution.' },
      { label: 'Days 2–20', title: 'Transformative self-discovery tasks', description: 'Tailored tasks for focus, alignment, balance and exploring hidden potential.' },
      { label: 'Day 21', title: 'Vision development', description: 'Understanding your personality traits and setting a clear, achievable vision — plus attitude and routine building.' },
      { label: 'Days 22–45', title: 'Regular practice & growth habits', description: 'Personalised daily development tasks and vision-to-career alignment activities.' },
      { label: 'Day 46', title: 'Career pathway planning', description: 'Mindset verification, goal alignment and expert guidance to build a 5-year career plan across 5 development areas.' },
    ],
    benefits: [
      'Uncover your true self via personality-based mentoring',
      'Transform with tailored tasks for focus and balance',
      'Discover futuristic global career opportunities',
      'Get a personalised 5-year career plan',
      'Enhance your personality and career profile',
      'Fully online — attend from home',
    ],
    brochureUrl: 'https://svastrino.com/wp-content/uploads/2025/04/bloom-new-brochure.pdf',
    sourceUrl: 'https://svastrino.com/bloom/',
    order: 3,
    // Questions people ask about this program specifically.
    faqs: [
      {
        q: "How much time do I need to give it?",
        a: "Three sessions of two hours each across about two months, plus the tasks between them and weekly follow-ups — roughly ten hours in total.",
      },
      {
        q: "What do I actually walk away with?",
        a: "A five-year career plan built around your own personality and strengths, not a template — plus the self-awareness to keep adjusting it as things change.",
      },
      {
        q: "What are the tasks between sessions?",
        a: "Short self-discovery exercises. They are where most of the change happens; the sessions make sense of what the tasks bring up.",
      },
      {
        q: "Can I do this while preparing for exams?",
        a: "Yes. The pace is deliberately spread over two months so it sits alongside school rather than competing with it.",
      },
    ],
  },
  {
    slug: 'breakthrough',
    // Sold after a call, not from a checkout page — see the Breakthrough row
    // in the emotional flow: Service Page → Talking to an Expert → payment link.
    buyMode: 'expert-call',
    name: 'Breakthrough Program',
    category: { slug: 'personalised-mentoring', name: 'Personalised Mentoring' },
    bookingSku: 'mentoring-breakthrough',
    tagline: "Ace the art of self-discipline and evolve into an 'Enterprising Leader'",
    summary:
      'A two-year personalised mentoring program to craft future leaders and entrepreneurs — ' +
      'building mindset first, then attitude, with consistent mentoring and accountability ' +
      'across academics, professional skills, experience, extracurriculars and social work.',
    duration: '2 years',
    sessions: '22 sessions of 2 hours each, at your own pace, plus weekly follow-ups — about 44 hours in total',
    mode: 'Online',
    chooseIf: [
      'You want a comprehensive analysis of your career needs and strengths',
      'You want career development mentoring aligned with your life vision',
      'You want to explore diverse career pathways',
      'You want a personal mentor monitoring your progress',
      'You want to develop self and people management skills',
      'You want to cultivate a solution-seeking mindset',
      'You want a path away from the competitive career rat race',
      'You want to evolve into a charismatic leader',
    ],
    journey: [
      { label: 'Stage 1 · Day 1', title: 'Life & background study', description: 'Understanding your life, background and starting point.' },
      { label: 'Stage 1 · Days 2–20', title: 'Tailored tasks for self-discovery', description: 'Personalised tasks that surface your strengths and patterns.' },
      { label: 'Stage 1 · Day 21', title: "Developing a leader's mindset", description: 'Building the mindset that leadership requires.' },
      { label: 'Stage 1 · Days 22–45', title: 'Crafting the right environment', description: 'Shaping surroundings that support a budding leader.' },
      { label: 'Stage 1 · Days 46–60', title: 'Aligning career plan with purpose', description: 'Connecting your career plan to your purpose of life.' },
      { label: 'Stage 2 · Months 3–24', title: 'Attitude building', description: 'Encouraging action and exploration, integrating results, consistent mentoring, self-validation, accountability, progress tracking and independent execution.' },
    ],
    benefits: [
      'Transform into a self-aware, focused and disciplined leader',
      'Develop a charismatic personality',
      'Gain exposure to futuristic career opportunities',
      'Receive a personalised 5-year career plan',
      'Create sustainable self-development processes',
      'Consistent career development mentoring',
      'Fully online — attend from home',
    ],
    sourceUrl: 'https://svastrino.com/breakthrough/',
    order: 4,
    // Questions people ask about this program specifically.
    faqs: [
      {
        q: "Why does it run for two years?",
        a: "Because mindset and character do not change in a weekend. The first months build the plan and the habits; the rest is spent applying them with someone watching your progress.",
      },
      {
        q: "Can I choose the session length?",
        a: "Yes — twenty sessions of one hour, or ten of two hours, whichever suits your pace. Both add up to the same program.",
      },
      {
        q: "What happens between sessions?",
        a: "Weekly follow-ups, tasks, and course corrections. You are not left alone for a month at a time.",
      },
      {
        q: "Is this only for students?",
        a: "It is built for students, freshers and young professionals who want to grow into leaders — not just to pick a career, but to become someone who can handle whatever they pick.",
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// FAQs  (source: svastrino.com/faqs)
// ---------------------------------------------------------------------------
const FAQS = [
  // ---- About Svastrino ----
  {
    section: 'About Svastrino',
    question: 'How and when did Svastrino start?',
    answer:
      'Founder Rohit Gala struggled to find proper career guidance himself and created Svastrino in 2009 ' +
      'to help students discover their potential and align their goals with their personalities through ' +
      'personalised mentoring programs.',
  },
  {
    section: 'About Svastrino',
    question: "What are Svastrino's vision and mission?",
    answer:
      'Our vision is to become the leading online career mentoring platform. Our mission is to empower ' +
      "individuals to explore and discover their life's purpose.",
  },

  // ---- Process basics ----
  {
    section: 'Process Basics',
    question: 'What is mentoring?',
    answer:
      "Mentoring is an ever-evolving process that plays a vital role in shaping one's personal and " +
      'professional growth, using a personality-driven approach with tailored feedback.',
  },
  {
    section: 'Process Basics',
    question: 'What is counseling?',
    answer:
      'Counseling is a process of meaningful conversation between a licensed counselor and an individual, ' +
      'exploring challenges and developing the mental and emotional tools to handle them.',
  },
  {
    section: 'Process Basics',
    question: 'How is counseling different from mentoring?',
    answer:
      'Counseling is short-term, problem-focused guidance. Mentoring is longer-term personalised training ' +
      'that provides a detailed plan for achieving your career goals.',
  },
  {
    section: 'Process Basics',
    question: 'How is mentoring done?',
    answer:
      'In five steps: we listen patiently, find the core issues, help you accept the facts, identify your ' +
      'potential, and explore all available options with you.',
  },
  {
    section: 'Process Basics',
    question: 'What attitude or mindset should I have?',
    answer:
      'Bring an open and honest attitude. Come as a patient learner who is comfortable sharing their ' +
      'thoughts and aspirations.',
  },
  {
    section: 'Process Basics',
    question: 'When should career mentoring be opted for?',
    answer:
      'The perfect time to start personalised career mentoring is now. Ideally, begin about a year before ' +
      'any major education or career decision.',
  },
  {
    section: 'Process Basics',
    question: 'How frequently should I get mentoring?',
    answer:
      'Annual mentoring is recommended so you can check your progress and plan based on the changes each ' +
      'year brings.',
  },
  {
    section: 'Process Basics',
    question: 'How should I prepare for sessions?',
    answer:
      'Reflect on your goals, list the issues you want to discuss, identify the root causes of your problems, ' +
      'trust the process, be honest, stay patient and keep a positive attitude.',
  },
  {
    section: 'Process Basics',
    question: 'What information should I share?',
    answer:
      'Share your background, qualifications, interests, passions and any factor relevant to your career plan. ' +
      'Concealing information only limits the quality of the guidance we can give.',
  },
  {
    section: 'Process Basics',
    question: 'When should I enroll in a program?',
    answer:
      "Deciding to enroll in a program is a personal choice and can be done at any time when you feel it's " +
      'right for you.',
  },

  // ---- Mentoring programs ----
  {
    section: 'Mentoring Programs',
    question: 'What is neutral mentoring?',
    answer:
      'Neutral mentoring is a unique process of personalised training and guidance in which a mentor helps ' +
      'the mentee achieve a particular outcome that is unbiased.',
  },
  {
    section: 'Mentoring Programs',
    question: 'How do I know which program to select?',
    answer:
      'Each program page has a "choose this program if…" section. Match those points against your own needs — ' +
      'or tell us where you are on the Contact page and we will recommend one.',
  },
  {
    section: 'Mentoring Programs',
    question: 'What concerns are addressed?',
    answer:
      'Stream selection, course and university decisions, interest exploration, personality analysis, ' +
      'leadership development, career clarity, aptitude assessment and entrepreneurship.',
  },
  {
    section: 'Mentoring Programs',
    question: 'Is career mentoring a one-time thing?',
    answer:
      'It depends on your needs. Immediate queries can be handled in a single session, while detailed ' +
      'personality and aptitude analysis requires a longer program.',
  },
  {
    section: 'Mentoring Programs',
    question: 'What documents should I prepare?',
    answer:
      'Academic records, extracurricular achievements, work experience letters, and any other documents ' +
      'that help us understand your academic and professional background.',
  },
  {
    section: 'Mentoring Programs',
    question: 'Will this program work online?',
    answer:
      'Yes. We have been successfully conducting online mentoring sessions since 2016, with clients across ' +
      'the Middle East, Africa and the USA.',
  },
  {
    section: 'Mentoring Programs',
    question: 'How does Svastrino verify futuristic career options?',
    answer:
      'We compare insights from the corporate world against those from top educational institutes to ' +
      'identify which career pathways are genuinely futuristic.',
  },
  {
    section: 'Mentoring Programs',
    question: 'Are sessions individual or group?',
    answer: 'All our sessions and programs are conducted on an individual level.',
  },
  {
    section: 'Mentoring Programs',
    question: 'Will my information remain confidential?',
    answer:
      'Yes. Any personal or sensitive information shared during the program remains strictly confidential ' +
      'and is never shared without your explicit consent.',
  },
  {
    section: 'Mentoring Programs',
    question: 'What if I need guidance after my session?',
    answer:
      'We follow up with you within a week after the session to provide additional suggestions and guidance.',
  },
  {
    section: 'Mentoring Programs',
    question: 'Can I reconnect months after completion?',
    answer: 'Yes — feel free to reconnect with us anytime you have queries or concerns.',
  },
  {
    section: 'Mentoring Programs',
    question: 'Will the same mentor guide me throughout?',
    answer:
      'We assign the same mentor to guide you throughout the entire program, though mentors can be changed ' +
      'if you would prefer someone else.',
  },
  {
    section: 'Mentoring Programs',
    question: 'How do I book a program?',
    answer:
      'Visit the Book Online page, or use the "Book Now" button at the bottom of each program page.',
  },
  {
    section: 'Mentoring Programs',
    question: 'What programs are available?',
    answer: "The Bull's Eye Program, the Bloom Program and the Breakthrough Program.",
  },
  {
    section: 'Mentoring Programs',
    question: 'How do I choose if I am unsure?',
    answer:
      "Start with the Bull's Eye Program. It is the shortest of the three and is built for exactly this — " +
      'getting clarity when you are stuck between options. Your mentor will tell you at the end whether a ' +
      'longer program would help you more.',
  },
]

// ---------------------------------------------------------------------------
// Success stories  (source: svastrino.com/success-stories)
//
// Every quote below was re-checked word for word against the live site in
// August 2026. The /success-stories/ page carries seven of them; the other
// five live only on the program pages they were given for, so those five
// were checked against /breakthrough/ and /model-session/ instead. These are
// real people's words, so the wording here matches the live page exactly apart
// from two obvious typing slips ("Aso" for "Also", a stray full stop) that were
// corrected so a visitor reads clean English.
// ---------------------------------------------------------------------------
const TESTIMONIALS = [
  {
    name: 'Dhrumil Satra',
    role: 'MSc in Investment Banking, University College Dublin, Ireland',
    quote:
      'Rohit is an experienced professional with good knowledge and value to provide. He helped me land one ' +
      'of the top universities in the world and guided me perfectly as a mentor throughout the process. I ' +
      'would 100% recommend him to anyone seeking any academic or professional educational and/or career advice.',
    photo: 'https://svastrino.com/wp-content/uploads/2023/03/46-Dhrumil.jpg',
    program: 'bulls-eye',
    featured: true,
  },
  {
    name: 'Shaili Sheth',
    role: 'MBA in International Management, Durham University Business School',
    quote:
      'A very good experience. Very easy to talk to and to clarify any doubts or uncertainties regarding my ' +
      'career. Mr. Rohit Gala was able to provide various different career options along with its pros and ' +
      'cons and an in-depth understanding of each of the options which helped me get a better perspective of ' +
      'which career I should be choosing. I would definitely recommend visiting him for any doubts ' +
      'regarding your career.',
    photo: 'https://svastrino.com/wp-content/uploads/2023/03/47-Shaili.jpg',
    program: 'bulls-eye',
    featured: true,
  },
  {
    name: 'Dhvanit Jain',
    role: 'FYBBA Finance, Symbiosis Centre for Management Studies',
    quote:
      'The guidance provided by Mr. Rohit Gala helped me to clear my head and choose a career option. Not ' +
      "only that, he suggested us the best possible means to reach the set goal as per our calibre. Clearly " +
      "it is 'Value for Money'.",
    photo: 'https://svastrino.com/wp-content/uploads/2023/03/48-Dhvanit.jpg',
    program: 'bulls-eye',
    featured: true,
  },
  {
    name: 'Gurjas Sahni',
    role: 'MBA in Media and Public Relations, Qatar',
    quote:
      'We got in touch with Svastrino in 2019. During our sessions, he helped us understand the value career ' +
      'adds to our life, rather than the other way round. Our experience with Mr. Rohit Gala yielded great ' +
      'results as he helped in clarifying our present, hence making us better prepared for what the future ' +
      "has in store! Would totally recommend his processes and advice. One of the best people we've " +
      "come across.",
    photo: 'https://svastrino.com/wp-content/uploads/2023/03/55-Gurjas.jpg',
    program: 'bloom',
    featured: false,
  },
  {
    name: 'Alpa Gangar',
    role: 'Parent and Owner of Gangar Tutorials',
    quote:
      'Svastrino has an incredible team of motivators, especially Rohit Sir. His words really helped me ' +
      'figure out my inner strength and to develop it even further. Also, his knowledge about career guidance ' +
      'was very appropriate and helpful in selecting the best course for my career. I recommend him strongly ' +
      'for a life changing experience.',
    photo: 'https://svastrino.com/wp-content/uploads/2023/03/56-Alpa.jpg',
    program: 'bloom',
    featured: false,
  },
  {
    name: 'Gnan Desai',
    role: 'Father of Tanishi · Territory Manager–Gulf, MINDWARE',
    quote:
      'This is honestly the best consultancy agency, hands down. The main focus of Mr. Rohit was to ' +
      "understand the child's psyche and that's not something you find everywhere. Helping kids discover " +
      'their full potential in any sector possible was also a major focus when we consulted him and it was ' +
      'really eye-opening as to how many job options the world has to offer. 10/10 for this ' +
      'consultancy, would love to consult with them again.',
    photo: 'https://svastrino.com/wp-content/uploads/2023/04/57-gnan.jpg',
    program: 'bloom',
    featured: false,
  },
  {
    name: 'Tara Chheda',
    role: 'Mother of Khushi, FYJC, NM College, Mumbai',
    quote:
      'The counselling sessions were very fruitful for me. I appreciate the unique ways of mentorship and ' +
      'the examples which were used to explain topics to me. It helped me choose my goal in my life. ' +
      'Also, the suggestions about taking up physical activities were very helpful. If my friends or ' +
      'relatives are ever in a fix to choose their career, I would like to refer you to them.',
    photo: 'https://svastrino.com/wp-content/uploads/2023/03/tara.jpg',
    program: '',
    featured: false,
  },
  {
    name: 'Iqbal Warsi',
    role: 'Brother of Actor Arshad Warsi',
    quote:
      "Svastrino & surely Mr. Rohit Gala have been a source of my kids' inspiration, guidance and support " +
      'through his career counselling — right from my first visit to Svastrino Consultancy in the year ' +
      "2015. He has been a driving force in shaping my kids' career path in the field of their interests. " +
      'I would like to thank Mr. Rohit Gala for his invaluable counselling with immense patience and an ' +
      'ever smiling face.',
    photo: 'https://svastrino.com/wp-content/uploads/2023/03/70-Iqbal.jpg',
    program: 'breakthrough',
    featured: false,
  },
  {
    name: 'Shameka Chitnis',
    role: 'A+ levels Singhania International School, Thane',
    quote:
      'I still remember the day we had our 1st session with Rohit sir 3 years back. Like everyone else, ' +
      "we were totally confused about our son's career aspirations. Rohit sir's detailed analysis in " +
      "every field helped us figure out our child's true interests & capacity. He is truly an " +
      'experienced, knowledgeable and yet, an approachable individual. Even today our son considers ' +
      'Rohit sir his ONE POINT CONTACT whenever in dilemma. We would surely & always recommend ' +
      'SVASTRINO to everyone who needs guidance in career and life.',
    photo: 'https://svastrino.com/wp-content/uploads/2023/03/71Shamika.jpg',
    program: 'breakthrough',
    featured: false,
  },
  {
    name: 'Falguni Patil',
    role: '',
    quote:
      'Initially when we started our process, I was worried that it was going to be really complicated and ' +
      'very stressful. But what made it so much easier and seamless was Svastrino and their immaculate ' +
      'support to us. As much as I am grateful for them to help us with our process, I am also extremely ' +
      'thankful for their support and guidance to us throughout the entire process and after. I can say with ' +
      'complete confidence that choosing with Svastrino Consultancy for our process was the best decision ' +
      'that we made.',
    photo: 'https://svastrino.com/wp-content/uploads/2024/03/newFalguniPatil.png',
    // Given after a Model Session, which the new site no longer offers. Live
    // has these on the Model Session page only, so rather than move them to a
    // program this person never took, they run as general success stories.
    program: '',
    featured: false,
  },
  {
    name: 'Heet Sardhara',
    role: '',
    quote:
      'Having experienced a session myself conducted by Rohit Sir, I can happily say that the experience is ' +
      'no short of spectacular and eye opening. Sir is absolutely professional and always on point, yet very ' +
      'kind and someone who will help you get the best out of you. All worth it. Big thumbs up to Rohit Sir ' +
      'and his team!',
    photo: 'https://svastrino.com/wp-content/uploads/2023/03/40-Heet.jpg',
    // Given after a Model Session, which the new site no longer offers. Live
    // has these on the Model Session page only, so rather than move them to a
    // program this person never took, they run as general success stories.
    program: '',
    featured: false,
  },
  {
    name: 'Manasi Jaguste',
    role: "Shlok's mother",
    quote:
      'As a parent it was good knowledge for me with their vast experience. This will help me in taking ' +
      'joint decision with my son.',
    photo: 'https://svastrino.com/wp-content/uploads/2023/03/39-Manasi-.jpg',
    // Given after a Model Session, which the new site no longer offers. Live
    // has these on the Model Session page only, so rather than move them to a
    // program this person never took, they run as general success stories.
    program: '',
    featured: false,
  },
]

// ---------------------------------------------------------------------------
// Career library  (source: svastrino.com/courselist)
//
// 13 streams / 52 distinct courses, pulled from the site's own WordPress REST
// API so the stream→course mapping is exact rather than inferred. Courses are
// many-to-many: several are filed under more than one stream (Interior Design
// is both Arts and Commercial Arts), which is why the link count (80) exceeds
// the course count (52). Data lives in data/career-library.json.
// ---------------------------------------------------------------------------
const CAREER_FIELDS = JSON.parse(
  fs.readFileSync(join(here, 'data', 'career-library.json'), 'utf8')
)

// ---------------------------------------------------------------------------
// Who owns which field: the seed, or the admin panel
//
// The career library has a live admin panel (Admin → Career Library) where the
// team re-orders streams, moves a course between streams and edits the course
// copy. Once a document exists that panel is the source of truth for those
// fields, so a seed re-run must never quietly undo an editor's work — the same
// rule the services seed already follows for prices. The seed therefore writes
// admin-owned fields through $setOnInsert, which Mongo applies only when it
// actually creates the document, while the fields the seed genuinely owns —
// the slug, the migrated name and the source link — stay in $set so a
// correction still lands on documents that are already live.
//
// To deliberately pull everything back from the migrated files, ask for it:
//   npm run seed:content -- --reimport      (or SEED_REIMPORT=1)
// ---------------------------------------------------------------------------
const REIMPORT = process.argv.includes('--reimport') || process.env.SEED_REIMPORT === '1'

const FIELD_ADMIN_OWNED = ['courses', 'order', 'description']

// `fields` is a course's stream membership, which the admin panel treats as the
// single source of truth (it rebuilds each stream's course list from it), and
// `active` is how the panel hides a course — both are editorial decisions.
const COURSE_ADMIN_OWNED = [
  'overview', 'topQualities', 'topJobs',
  'institutesIndia', 'institutesInternational', 'careerLadder',
  'fields', 'active',
]

// Mongo rejects an update that names the same field in both $set and
// $setOnInsert, so the seed document is split field by field instead of being
// spread wholesale into $set.
function splitUpdate(doc, adminOwned) {
  if (REIMPORT) return { $set: doc }
  const $set = {}
  const $setOnInsert = {}
  for (const [field, value] of Object.entries(doc)) {
    if (adminOwned.includes(field)) $setOnInsert[field] = value
    else $set[field] = value
  }
  return Object.keys($setOnInsert).length ? { $set, $setOnInsert } : { $set }
}

// ---------------------------------------------------------------------------

async function run() {
  await connectDB()

  for (const p of PROGRAMS) {
    // Brochures/photos point at the local copies once `fetch:media` has run.
    const doc = { ...p, brochureUrl: localMedia(p.brochureUrl || '') }
    await MentoringProgram.findOneAndUpdate({ slug: p.slug }, { $set: doc }, { upsert: true })
    console.log(`  ✓ Program: ${p.name}`)
  }
  // Model Session was retired — remove any stale copy so it can't resurface.
  await MentoringProgram.deleteMany({ slug: { $nin: PROGRAMS.map((p) => p.slug) } })
  console.log(`✓ Mentoring programs: ${PROGRAMS.length} (retired ones removed)`)

  // FAQs and testimonials have no natural slug — replace the set wholesale so
  // reruns don't accumulate duplicates. Nothing is lost today because these two
  // are read-only on the site and no admin screen writes them; if one is ever
  // added, they need the same seed/panel ownership split as the career library
  // below rather than this delete-and-reinsert.
  await Faq.deleteMany({})
  await Faq.insertMany(FAQS.map((f, i) => ({ ...f, order: i, active: true })))
  console.log(`✓ FAQs: ${FAQS.length} across ${new Set(FAQS.map((f) => f.section)).size} sections`)

  await Testimonial.deleteMany({})
  await Testimonial.insertMany(
    TESTIMONIALS.map((t, i) => ({ ...t, photo: localMedia(t.photo), order: i, active: true }))
  )
  console.log(`✓ Testimonials: ${TESTIMONIALS.length}`)

  for (const c of CAREER_FIELDS) {
    await CareerField.findOneAndUpdate({ slug: c.slug }, splitUpdate(c, FIELD_ADMIN_OWNED), { upsert: true })
  }
  const courseLinks = CAREER_FIELDS.reduce((n, f) => n + f.courses.length, 0)
  const distinct = new Set(CAREER_FIELDS.flatMap((f) => f.courses.map((c) => c.slug))).size
  // Say which way the run went, so nobody reads the counts as "everything was
  // rewritten from the files" when the panel edits were in fact left alone.
  console.log(
    `✓ Career library: ${CAREER_FIELDS.length} streams · ${distinct} courses (${courseLinks} stream links)` +
      (REIMPORT ? ' — re-imported wholesale' : ' — existing streams kept their panel edits')
  )

  // ---- Course detail pages (scraped into data/courses/<slug>.json) ----
  // Each course records which streams it belongs to, denormalised from the
  // career library above so the detail page can show breadcrumb chips.
  const fieldsBySlug = new Map()
  for (const f of CAREER_FIELDS) {
    for (const c of f.courses) {
      if (!fieldsBySlug.has(c.slug)) fieldsBySlug.set(c.slug, [])
      fieldsBySlug.get(c.slug).push({ name: f.name, slug: f.slug })
    }
  }

  const coursesDir = join(here, 'data', 'courses')
  let courseCount = 0
  if (fs.existsSync(coursesDir)) {
    const files = fs.readdirSync(coursesDir).filter((f) => f.endsWith('.json'))
    for (const file of files) {
      const c = JSON.parse(fs.readFileSync(join(coursesDir, file), 'utf8'))
      await Course.findOneAndUpdate(
        { slug: c.slug },
        splitUpdate({ ...c, fields: fieldsBySlug.get(c.slug) || [], active: true }, COURSE_ADMIN_OWNED),
        { upsert: true }
      )
      courseCount++
    }
  }
  console.log(
    courseCount
      ? `✓ Course detail pages: ${courseCount}`
      : '! No course detail pages found in data/courses/ — run the course scrape first'
  )

  // ---- Site pages: policies/legal (data/pages/<slug>.json) ----
  const pagesDir = join(here, 'data', 'pages')
  let pageCount = 0
  if (fs.existsSync(pagesDir)) {
    for (const file of fs.readdirSync(pagesDir).filter((f) => f.endsWith('.json'))) {
      const pg = JSON.parse(fs.readFileSync(join(pagesDir, file), 'utf8'))
      await SitePage.findOneAndUpdate(
        { slug: pg.slug },
        { $set: { ...pg, active: true } },
        { upsert: true }
      )
      pageCount++
    }
  }
  console.log(`✓ Site pages (policies): ${pageCount}`)

  await mongoose.disconnect()
  console.log('✓ Site content seeded.')
}

run().catch((err) => {
  console.error('✗ Seed failed:', err)
  process.exit(1)
})
