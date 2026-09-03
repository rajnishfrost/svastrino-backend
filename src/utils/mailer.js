import nodemailer from 'nodemailer'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * SMTP mailer (Gmail or any provider) configured from env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * The transport is created lazily and cached, so a missing SMTP config only
 * fails when an email is actually sent — the rest of the API keeps working.
 */
let transporter = null

function getTransport() {
  if (transporter) return transporter

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP is not configured (SMTP_HOST/USER/PASS missing)')
  }

  const port = Number(SMTP_PORT) || 587
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })
  return transporter
}

// The shield logo is embedded inline via CID so it renders in any inbox without
// depending on a publicly-reachable image URL (important while on localhost).
// The layout's <img src="cid:svastrino-logo"> resolves to this attachment.
const LOGO_CID = 'svastrino-logo'

async function sendMail({ to, subject, html, text, replyTo }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER
  return getTransport().sendMail({
    from,
    to,
    // Set where a mail is really from someone else — an enquiry, say — so that
    // hitting Reply answers them rather than our own sending address.
    ...(replyTo ? { replyTo } : {}),
    subject,
    html,
    text,
    attachments: [
      { filename: 'svastrino-logo.png', path: LOGO_PATH, cid: LOGO_CID },
    ],
  })
}

// --- Branded email template -------------------------------------------------
// Matches the Svastrino UI: white navbar-style header with the shield logo +
// wordmark, a white content card on a soft-blue page, and a blue CTA. All styles
// are inline (email clients strip <style>) and use a web-safe font stack.

const BRAND = 'Svastrino'
const NOTE_STYLE = 'margin:22px 0 0;font-size:12.5px;color:#5b6677'

// Load the shared HTML email layout once and cache it. Editing the template is
// just editing src/templates/emails/email-layout.html — no code change needed.
const __dir = dirname(fileURLToPath(import.meta.url))
const LAYOUT_PATH = join(__dir, '..', 'templates', 'emails', 'email-layout.html')
const LOGO_PATH = join(__dir, '..', 'templates', 'emails', 'logo.png')
let layoutCache = null
function layout() {
  if (layoutCache == null) {
    layoutCache = readFileSync(LAYOUT_PATH, 'utf8')
  }
  return layoutCache
}

// Escape a value before dropping it into HTML so link tokens / names can't
// break the markup. Applied to every interpolation.
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Fill the HTML layout's {{placeholders}}. `preheader`, `heading`, `intro`,
 * `cta` and `link` are required; `note` is optional (rendered as a paragraph).
 */
function template({ heading, preheader, intro, cta, link, note }) {
  const noteHtml = note ? `<p style="${NOTE_STYLE}">${esc(note)}</p>` : ''
  const values = { preheader, heading, intro, cta, link, note: noteHtml }
  return layout().replace(/{{\s*(\w+)\s*}}/g, (_, key) =>
    // `note` is pre-built HTML; everything else is escaped user/plain text.
    key === 'note' ? values.note : esc(values[key] ?? '')
  )
}

// Message builders (exported so they can be previewed/tested without sending).
export function buildVerificationEmail(link) {
  return {
    subject: `Verify your ${BRAND} email`,
    text: `Welcome to ${BRAND}! Verify your email to activate your account: ${link}`,
    html: template({
      heading: 'Confirm your email',
      preheader: `Verify your email to activate your ${BRAND} account.`,
      intro: `Welcome to ${BRAND}! Please confirm this email address to activate your account and start logging in.`,
      cta: 'Verify email',
      link,
      note: 'This link expires in 24 hours.',
    }),
  }
}

export function buildPasswordResetEmail(link) {
  return {
    subject: `Reset your ${BRAND} password`,
    text: `Reset your ${BRAND} password: ${link}`,
    html: template({
      heading: 'Reset your password',
      preheader: `Reset the password for your ${BRAND} account.`,
      intro: 'We received a request to reset your password. Click below to choose a new one.',
      cta: 'Reset password',
      link,
      note: 'This link expires in 1 hour and can be used once. If you didn’t ask for this, your password is unchanged.',
    }),
  }
}

const clientUrl = () =>
  (process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5174').replace(/\/$/, '')

/** Payment confirmation / receipt. `amount` is in paise. */
export function buildReceiptEmail({ receiptNo, item, amount, date }) {
  const money = '₹' + (Number(amount) / 100).toLocaleString('en-IN')
  const when = new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  return {
    subject: `Your ${BRAND} receipt ${receiptNo}`,
    text: `Payment received. ${item} — ${money}. Receipt ${receiptNo}, ${when}.`,
    html: template({
      heading: 'Payment received',
      preheader: `Your ${BRAND} receipt ${receiptNo}.`,
      intro: `Thank you for your purchase. ${item} — ${money}. Receipt no. ${receiptNo}, dated ${when}.`,
      cta: 'View your orders',
      link: `${clientUrl()}/settings?tab=orders`,
      note: 'This email is your payment confirmation — keep it for your records.',
    }),
  }
}

export async function sendReceiptEmail(to, details) {
  await sendMail({ to, ...buildReceiptEmail(details) })
}

/** Send the "confirm your email" link. Link expires per the service TTL. */
export async function sendVerificationEmail(to, link) {
  await sendMail({ to, ...buildVerificationEmail(link) })
}

/** Send the password-reset link. Link expires per the service TTL. */
export async function sendPasswordResetEmail(to, link) {
  await sendMail({ to, ...buildPasswordResetEmail(link) })
}

/**
 * Guest-checkout welcome: the account was auto-created during a mentoring
 * booking; the link lets them set a password and claim it (7-day validity).
 */
export function buildWelcomeSetPasswordEmail({ name, link }) {
  const first = String(name || '').split(/\s+/)[0] || 'there'
  return {
    subject: `Welcome to ${BRAND} — your account is ready`,
    text: `Hi ${first}, your ${BRAND} account was created during your booking. Set your password to access it any time: ${link}`,
    html: template({
      heading: 'Your account is ready',
      preheader: `Set a password to access your ${BRAND} account.`,
      intro: `Hi ${first}! We created a ${BRAND} account with this email while you were booking your mentoring session. Set a password below and you can log in any time to see your sessions, updates and tasks.`,
      cta: 'Set my password',
      link,
      note: 'This link is valid for 7 days. You can also use “Forgot password” on the login page later.',
    }),
  }
}

export async function sendWelcomeSetPasswordEmail(to, details) {
  await sendMail({ to, ...buildWelcomeSetPasswordEmail(details) })
}

/**
 * Mentoring booking confirmation / reschedule note. `startAt`/`endAt` are Date
 * or ISO — rendered in IST since sessions are IST-scheduled.
 */
export function buildBookingEmail({ name, programName, sessionNumber, sessionsTotal, startAt, endAt, rescheduled }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'there'
  const optsD = { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }
  const optsT = { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }
  const day = new Date(startAt).toLocaleDateString('en-IN', optsD)
  const from = new Date(startAt).toLocaleTimeString('en-IN', optsT)
  const till = new Date(endAt).toLocaleTimeString('en-IN', optsT)
  const when = `${day}, ${from} – ${till} IST`
  return {
    subject: rescheduled
      ? `Session rescheduled — ${programName}, ${day}`
      : `Session booked — ${programName}, ${day}`,
    text: `Hi ${first}, your ${programName} session ${sessionNumber} of ${sessionsTotal} is ${rescheduled ? 'now' : 'booked for'} ${when}.`,
    html: template({
      heading: rescheduled ? 'Session rescheduled 📅' : 'Session booked ✓',
      preheader: `${programName} · session ${sessionNumber} of ${sessionsTotal} · ${when}`,
      intro: `Hi ${first}! Your ${programName} session ${sessionNumber} of ${sessionsTotal} is confirmed for ${when}. Session updates and tasks from your mentor will appear on your dashboard after each session.`,
      cta: 'View my sessions',
      link: `${clientUrl()}/dashboard`,
      note: 'Need a different time? You can reschedule from your dashboard until 2 days before the session.',
    }),
  }
}

export async function sendBookingEmail(to, details) {
  await sendMail({ to, ...buildBookingEmail(details) })
}

/**
 * Daily learning nudge — sent (max once a day) when the student's next item on
 * the drip schedule is open: a new video, or today's question.
 */
/**
 * Tells the team about a new enquiry from the public site. Sent to the team,
 * not the visitor — with reply-to pointed at the person who wrote in, so
 * hitting Reply answers them directly.
 */
const ENQUIRY_SOURCE = {
  home: 'home page banner',
  'expert-call': 'Breakthrough expert-call form',
  contact: 'contact page',
}

export function buildEnquiryEmail(details) {
  const { name, email, phone, message, studentClass, city, program, preferredTime, source } = details
  const where = ENQUIRY_SOURCE[source] || ENQUIRY_SOURCE.contact
  const isCall = source === 'expert-call'

  const rows = [
    ['Name', name],
    ['Email', email],
    ['Phone', phone],
    ['Program', program],
    ['Best time to call', preferredTime],
    ['Class', studentClass],
    ['City', city],
    ['Message', message],
  ].filter(([, v]) => v)

  // A call-back request is time-sensitive in a way a general enquiry is not, so
  // it says so in the subject line — that is all the team sees on a phone.
  const subject = isCall
    ? `Call back requested — ${name}${city ? ` (${city})` : ''}`
    : `New enquiry — ${name}${city ? ` (${city})` : ''}`

  return {
    subject,
    text: `${isCall ? 'Call-back request' : 'New enquiry'} from the ${where}.\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    html: template({
      heading: isCall ? 'Call back requested 📞' : 'New enquiry 📨',
      preheader: `${name}${city ? ` · ${city}` : ''} — via the ${where}`,
      intro:
        (isCall
          ? 'Someone wants to talk to an expert before buying:<br><br>'
          : `Someone got in touch through the ${where}:<br><br>`) +
        rows.map(([k, v]) => `<strong>${esc(k)}:</strong> ${esc(v)}`).join('<br>'),
      note: isCall
        ? 'They have been told to expect a call within one working day. Send the payment link after the call.'
        : 'Reply to this email to answer them directly.',
    }),
    replyTo: email,
  }
}

/**
 * Sent to the caller once the team has spoken to them and cleared them to pay.
 * The link drops them straight into the booking wizard for that program.
 */
export function buildExpertApprovalEmail({ name, program }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'there'
  const sku = program ? `mentoring-${String(program).replace('bulls-eye', 'bullseye')}` : ''
  const link = `${clientUrl()}/book-online${sku ? `?program=${sku}` : ''}`

  return {
    subject: 'You can book your program now',
    text: `Hi ${first}, thanks for speaking with us. You can pick your first session and pay here: ${link}`,
    html: template({
      heading: 'Your program is ready to book 🎉',
      preheader: 'Pick your first session and complete the payment.',
      intro:
        `Hi ${esc(first)}! Thank you for taking the time to speak with us. ` +
        'You can now choose a date and time for your first session and complete the payment.',
      cta: 'Pick a slot and pay',
      link,
      note: 'If anything is still unclear, just reply to this email — we would rather answer first.',
    }),
  }
}

export async function sendExpertApprovalEmail(to, details) {
  await sendMail({ to, ...buildExpertApprovalEmail(details) })
}

export async function sendEnquiryEmail(to, details) {
  await sendMail({ to, ...buildEnquiryEmail(details) })
}

export function buildLearningReminderEmail({ name, courseName, taskLabel, slug }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'there'
  return {
    subject: `Today's task is ready — ${courseName}`,
    text: `Hi ${first}, ${taskLabel}. Open your course: ${clientUrl()}/learn/${slug}`,
    html: template({
      heading: "Today's task is ready 🎯",
      preheader: `${taskLabel} — keep your ${courseName} streak going.`,
      intro: `Hi ${first}! ${taskLabel}. Finishing each task on its day keeps you on schedule — and it shows in your completion report.`,
      cta: 'Continue learning',
      link: `${clientUrl()}/learn/${slug}`,
      note: 'You get at most one reminder a day, and only when something new is waiting for you.',
    }),
  }
}

export async function sendLearningReminderEmail(to, details) {
  await sendMail({ to, ...buildLearningReminderEmail(details) })
}

/**
 * Evening follow-up — sent only if the morning's task is STILL pending by
 * evening (checked again at send time; done = no e-mail).
 *
 * 20 gentle-funny taanas, rotated per student (`variant` = their nudge count):
 * 1st evening → #1, 2nd → #2 … 20th → #20, then back to #1.
 * {first} and {task} are filled in; keep them warm — students, not defaulters.
 */
const TAANAS = [
  { subject: 'Aaj ka task abhi bhi baaki hai 👀', heading: 'Aaj ka task… abhi bhi baaki hai 😅', intro: 'Hi {first}! No pressure… but "{task}" subah se wait kar raha hai. Bas 5 minute ka kaam hai. 😉' },
  { subject: 'Aapka task akela baitha hai 🥺', heading: 'Task bola — "main subah se yahin hoon…"', intro: 'Hi {first}! "{task}" ne humse shikayat ki hai ki aap aaye hi nahi. Uska akelapan door kar do? 🥲' },
  { subject: 'Reels ho gayin? Ab 5 minute idhar 😌', heading: 'Scroll break ka time!', intro: 'Hi {first}! Thumb ki exercise to ho gayi hogi… ab dimaag ki baari — "{task}" ready hai. 😄' },
  { subject: 'Ding dong! Yaad hai na? 🔔', heading: 'Yaad dilane aaye hain, daantne nahi 😇', intro: 'Hi {first}! Bas ek pyari si yaad-dihani: "{task}" aaj ka hai, aaj hi ka rahe to mazaa hai.' },
  { subject: 'Kal aap bologe "kal kar lunga"… 😏', heading: '"Kal" naam ka din calendar me nahi hota', intro: 'Hi {first}! Hum jaante hain plan kya hai — "kal pakka". Par "{task}" aaj ke naam pe likha hai. Abhi nipta do? 😏' },
  { subject: 'Report sab yaad rakhti hai 📝', heading: 'Hum bhool jayenge, report nahi 😬', intro: 'Hi {first}! "{task}" abhi bhi pending hai — aur aapki completion report ki yaaddasht hathi jaisi hai. 🐘' },
  { subject: 'Bas 5 minute — pinky promise 🤙', heading: 'Chai banne se pehle ho jayega ☕', intro: 'Hi {first}! "{task}" itna chhota hai ki chai thandi hone se pehle khatam. Timer laga ke dekho. ⏱️' },
  { subject: 'Aaj ka task: 1, Aap: 0 😅', heading: 'Scoreboard update chahiye!', intro: 'Hi {first}! Aaj ka score: Task 1 — {first} 0. Ek submit se barabari ho jayegi. "{task}" — game on? 🏏' },
  { subject: 'Phone charge hai, net chal raha hai… to phir? 🤔', heading: 'Saare bahane check kar liye humne', intro: 'Hi {first}! Phone ✓ Internet ✓ Aap ✓ … sirf "{task}" ka checkmark baaki hai. 😄' },
  { subject: 'Streak ka khayal rakhna 💔', heading: 'Roz ka roz = asli jadoo', intro: 'Hi {first}! "{task}" pending hai — aur roz-ka-roz karne wali aadat hi aage le jaati hai. Aaj ka din khali mat jaane do. 💪' },
  { subject: 'Hum dekh rahe hain 👀 (pyaar se)', heading: 'Nazar rakhi ja rahi hai… shubh nazar 😇', intro: 'Hi {first}! Mazaak alag, par "{task}" sach me aapka wait kar raha hai. Do minute de do use.' },
  { subject: 'Task ne complaint darj ki hai 😤', heading: 'Complaint #420: "Mujhe kholo"', intro: 'Hi {first}! "{task}" ne official complaint daali hai — "subah se khula hoon, koi aaya nahi." Case close kar do? 📋' },
  { subject: 'Sapne bade, task chhota — deal? 🤝', heading: 'Bade sapno ki chhoti kist', intro: 'Hi {first}! Career banana bada kaam hai, par aaj ki kist sirf "{task}" hai. Chhota kadam, roz. 🚶' },
  { subject: 'Ye question aapke bina adhoora hai 💚', heading: 'Missing: aapka answer', intro: 'Hi {first}! "{task}" bilkul taiyaar hai — bas usme aapke shabd nahi hain. Wo sirf aap de sakte ho.' },
  { subject: 'Kal wale aap naraz ho jayenge 😬', heading: 'Future-you se dosti rakho', intro: 'Hi {first}! Aaj skip karoge to kal wale {first} ko double lagega. Future-you ko gift do — "{task}" abhi. 🎁' },
  { subject: 'Ek chhota click, ek bada kadam 🚀', heading: 'Rocket bhi countdown se udta hai', intro: 'Hi {first}! 3… 2… 1… "{task}". Bas itna hi launch sequence hai aaj ka. 🚀' },
  { subject: 'Aaj nahi to kab? (Kal mat bolna) 😜', heading: 'Bas "kal" mat bolna', intro: 'Hi {first}! Sawaal simple hai: aaj nahi to kab? (Hint: jawab "kal" nahi hai 😜) "{task}" ready hai.' },
  { subject: 'Topper log abhi kar chuke honge ☕', heading: 'Bas keh rahe hain…', intro: 'Hi {first}! Kahin na kahin koi student "{task}" jaisa task karke so raha hoga… sukoon se. Wo sukoon aapka bhi ho sakta hai. ☕' },
  { subject: 'Dimaag bola: kar lo yaar 🧠', heading: 'Aapke dimaag ki taraf se message', intro: 'Hi {first}! Aapke dimaag ne bola — "mujhe 5 minute ka kaam do, main taiyaar hoon." "{task}" perfect warm-up hai. 🧠' },
  { subject: 'Last call! Raat 12 baje naya aa jayega 🌙', heading: 'Aaj ka task, aaj ki tareekh tak 🌙', intro: 'Hi {first}! Raat 12 baje schedule aage badh jayega — "{task}" abhi karoge to kal fresh start milega. Last call! 🎬' },
]

export function buildEveningNudgeEmail({ name, courseName, taskLabel, slug, variant = 0 }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'dost'
  const t = TAANAS[((variant % TAANAS.length) + TAANAS.length) % TAANAS.length]
  const fill = (s) => s.replaceAll('{first}', first).replaceAll('{task}', taskLabel)
  return {
    subject: `${t.subject} — ${courseName}`,
    text: `${fill(t.intro)} Link: ${clientUrl()}/learn/${slug}`,
    html: template({
      heading: t.heading,
      preheader: `Still pending: ${taskLabel}`,
      intro: fill(t.intro),
      cta: "Finish today's task",
      link: `${clientUrl()}/learn/${slug}`,
      note: 'Already done it by the time this landed? Then ignore us — shabash! 🎉',
    }),
  }
}

export async function sendEveningNudgeEmail(to, details) {
  await sendMail({ to, ...buildEveningNudgeEmail(details) })
}

// --- Nirmaan Scholarship: institution partner approve / reject --------------
export function buildScholarshipStatusEmail({ name, institution, status, reason }) {
  const approved = status === 'approved'
  const link = `${clientUrl()}/nirmaan-scholarship`
  const who = name ? `, ${name}` : ''
  return {
    subject: approved
      ? `${institution} is approved for the Nirmaan Scholarship`
      : 'Update on your Nirmaan Scholarship partner request',
    text: approved
      ? `Good news${who}! ${institution} has been approved as a Nirmaan Scholarship partner. Your students can now enrol: ${link}`
      : `Thank you for your interest${who}. ${institution}'s Nirmaan Scholarship partner request was not approved.${reason ? ' Reason: ' + reason : ''}`,
    html: template({
      heading: approved ? 'Your institution is approved 🎉' : 'Partner request update',
      preheader: approved
        ? 'Your students can now enrol for the Nirmaan Scholarship.'
        : 'An update on your Nirmaan Scholarship partner request.',
      intro: approved
        ? `Good news${who}! ${institution} has been approved as a Nirmaan Scholarship partner. Your students can now enrol and take the scholarship test.`
        : `Thank you for your interest${who}. After review, ${institution}'s request to partner for the Nirmaan Scholarship was not approved at this time.${reason ? ' Reason: ' + reason : ''}`,
      cta: approved ? 'View the scholarship' : 'Learn more',
      link,
    }),
  }
}
export async function sendScholarshipStatusEmail(to, details) {
  await sendMail({ to, ...buildScholarshipStatusEmail(details) })
}

// --- Nirmaan Scholarship: result announced (winner + participants) ----------
export function buildScholarshipResultEmail({ name, won, winnerName, institution }) {
  const link = `${clientUrl()}/nirmaan-scholarship`
  const who = name ? `, ${name}` : ''
  const from = institution ? ` from ${institution}` : ''
  if (won) {
    return {
      subject: 'You won the Nirmaan Scholarship 🎉',
      text: `Congratulations${who}! You topped the Nirmaan Scholarship test and won your entire Nirmaan package — free. We’ll reach out with the next steps. ${link}`,
      html: template({
        heading: 'You won! 🎉',
        preheader: 'Congratulations — you won the Nirmaan Scholarship.',
        intro: `Congratulations${who}! You topped the Nirmaan Scholarship test and won your entire Nirmaan package — completely free. We’ll reach out shortly with the next steps.`,
        cta: 'View the scholarship',
        link,
      }),
    }
  }
  return {
    subject: 'Nirmaan Scholarship — result announced',
    text: `Thank you for participating${who}! The Nirmaan Scholarship winner is ${winnerName}${from}. See details: ${link}`,
    html: template({
      heading: 'Scholarship result announced',
      preheader: 'The Nirmaan Scholarship winner has been announced.',
      intro: `Thank you for participating in the Nirmaan Scholarship${who}! The winner is ${winnerName}${from}. We truly appreciate your effort — keep an eye out for future opportunities.`,
      cta: 'View the scholarship',
      link,
    }),
  }
}
export async function sendScholarshipResultEmail(to, details) {
  await sendMail({ to, ...buildScholarshipResultEmail(details) })
}

// --- Organisation approved: portal login is ready ---------------------------
/**
 * Sent the moment an admin approves a partner organisation. The organisation's
 * owner account is created at the same time with no password, so the link is a
 * set-password link (the existing /reset-password page finishes the job) —
 * exactly the guest-checkout mechanic, reused.
 */
export function buildOrgApprovedEmail({ name, organisation, link, code }) {
  const who = name ? `, ${name}` : ''
  return {
    subject: `${organisation} is approved — set up your ${BRAND} organisation account`,
    text: `Good news${who}! ${organisation} has been approved as a Nirmaan Scholarship partner. Set your password to open your organisation portal, where you can add students and run your scholarship: ${link}${code ? ` (Organisation code: ${code})` : ''}`,
    html: template({
      heading: 'Your organisation is approved 🎉',
      preheader: `Set your password to open the ${organisation} portal.`,
      intro: `Good news${who}! ${organisation} has been approved as a Nirmaan Scholarship partner. Set a password below to open your organisation portal — from there you can bulk-add your students, set up your scholarship test and see your results.`,
      cta: 'Set my password',
      link,
      note: `${code ? `Your organisation code is ${code}. ` : ''}This link is valid for 7 days — after that use “Forgot password” on the login page.`,
    }),
  }
}
export async function sendOrgApprovedEmail(to, details) {
  await sendMail({ to, ...buildOrgApprovedEmail(details) })
}

// --- Student added by their organisation ------------------------------------
/**
 * Sent to each student an organisation imports. The account already exists (the
 * organisation vouched for the address), so this is a set-password invite plus
 * a note about the scholarship they've been entered into.
 */
export function buildStudentInviteEmail({ name, organisation, link, cycleTitle }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'there'
  const what = cycleTitle ? ` and entered you into the ${cycleTitle}` : ''
  return {
    subject: `${organisation} created your ${BRAND} account`,
    text: `Hi ${first}, ${organisation} created a ${BRAND} account for you${what}. Set your password to log in and take the scholarship test: ${link}`,
    html: template({
      heading: 'Your account is ready',
      preheader: `${organisation} created a ${BRAND} account for you.`,
      intro: `Hi ${first}! ${organisation} created a ${BRAND} account for you${what}. Set a password below — then log in to see your scholarship details and take the test when it opens.`,
      cta: 'Set my password',
      link,
      note: 'This link is valid for 7 days. You can also use “Forgot password” on the login page later.',
    }),
  }
}
export async function sendStudentInviteEmail(to, details) {
  await sendMail({ to, ...buildStudentInviteEmail(details) })
}
