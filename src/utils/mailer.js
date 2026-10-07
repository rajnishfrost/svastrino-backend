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
 * Fill the HTML layout's {{placeholders}}. `preheader`, `heading` and `intro`
 * are required; `note` is optional (rendered as a paragraph), and so is the
 * call to action — an email whose next move belongs to US rather than to the
 * reader has no button to offer, and rendering an empty one plus a dangling
 * "or paste this link into your browser" is worse than rendering nothing.
 */
function actionBlock(cta, link) {
  if (!cta || !link) return ''
  const href = esc(link)
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
                  <tr>
                    <td align="center" style="border-radius:10px;background:#2f7ae5">
                      <a href="${href}" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${esc(cta)}</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 6px;font-size:12.5px;color:#5b6677">Or paste this link into your browser:</p>
                <p style="margin:0;font-size:12.5px;word-break:break-all"><a href="${href}" style="color:#2f7ae5;text-decoration:none">${href}</a></p>`
}

function template({ heading, preheader, intro, cta, link, note }) {
  const noteHtml = note ? `<p style="${NOTE_STYLE}">${esc(note)}</p>` : ''
  const values = { preheader, heading, intro, note: noteHtml, action: actionBlock(cta, link) }
  return layout().replace(/{{\s*(\w+)\s*}}/g, (_, key) =>
    // `note` and `action` are pre-built HTML; the rest is escaped plain text.
    key === 'note' || key === 'action' ? values[key] : esc(values[key] ?? '')
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
    subject: 'You can book your programme now',
    text: `Hi ${first}, thanks for speaking with us. You can pick your first session and pay here: ${link}`,
    html: template({
      heading: 'Your programme is ready to book 🎉',
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

/**
 * The receipt the person who enquired gets — a different letter from the one the
 * team gets, and for a different reason. Theirs is a to-do; this one only has to
 * say "it arrived, a person will call you", so that a visitor who filled in a
 * form on a page they may never return to has something in their inbox proving
 * it went somewhere.
 *
 * A call-back request already carries a promise about timing, so it repeats it
 * here; a general enquiry does not, and inventing one would be worse than
 * saying nothing. There is no call to action: the next move is ours, and a
 * button would suggest otherwise.
 */
export function buildEnquiryAckEmail({ name, source, program, preferredTime }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'there'
  const isCall = source === 'expert-call'

  const intro = isCall
    ? `Hi ${first}, thank you for asking to speak to us${program ? ` about ${program}` : ''}. `
      + 'We have your request, and one of our mentors will call you within one working day'
      + `${preferredTime ? `, around the time you asked for (${preferredTime})` : ''}. `
      + 'There is nothing to pay and nothing more to do — we will come to you.'
    : `Hi ${first}, thank you for getting in touch. We have your enquiry, and someone from our `
      + 'team will connect with you shortly to understand where you are and help you work out '
      + 'the right next step. There is nothing more you need to do for now.'

  return {
    subject: isCall ? `We have your call-back request — ${BRAND}` : `We have your enquiry — ${BRAND}`,
    text: `${intro}\n\nIf anything changes in the meantime, just reply to this email.\n\n— The ${BRAND} team`,
    html: template({
      heading: isCall ? 'Your call is booked in 📞' : 'We have your enquiry ✅',
      preheader: isCall
        ? 'One of our mentors will call you within one working day.'
        : 'Our team will connect with you shortly.',
      intro,
      note: 'If anything changes in the meantime, just reply to this email — it reaches the same team.',
    }),
  }
}

export async function sendEnquiryAckEmail(to, details) {
  await sendMail({ to, ...buildEnquiryAckEmail(details) })
}

// --- Nirmaan daily reminders -------------------------------------------------
/**
 * Notification-sized mails: a title (subject + heading), one line of body and a
 * button — nothing else, so a student reads it in a glance.
 *
 *   Part 1 — NEW_LESSON: 7 AM, today's open step is a video.
 *   Part 2 — DAILY_TASK: 7 AM, today's open step is a question.
 *   Part 3 — GENTLE:     7 PM, whatever is open is still not done.
 *
 * Each part is its own sequence per student (`variant` = how many of THAT part
 * they have had): 1st → #1, 2nd → #2 … last, then back to #1 — so nobody gets
 * the same line twice until the whole list has gone round.
 */
const NEW_LESSON = [
  { title: 'Naya lesson aa gaya', body: 'Is week ka lesson ready hai. Thoda time nikal ke, dekh lena.' },
  { title: '15 minutes apne liye?', body: 'Naya lesson ready hai. Aaj sirf 15 minute Apne Nirmaan ko de do.' },
  { title: 'Is week kya naya milega?', body: 'Aapka Naya lesson ready hai. Dekho, shayad khud ke baare mein kuch interesting pata chale.' },
  { title: 'Jawan, chalo ek aur lesson karte hain.', body: 'Naya week, naya lesson. Aajka target pura kare.' },
  { title: 'Jab time mile, start kar dena.', body: 'Is week ka lesson aa gaya hai. Koi rush nahi—bas miss mat karna.' },
  { title: 'Bas apna Nirmaan page open karo.', body: 'Naya lesson ready hai. Start karoge toh aage kaafi easy lagega.' },
  { title: 'Aaj ka thoda time khud ke naam.', body: 'Nirmaan ka naya lesson ready hai. Take some time for yourself.' },
  { title: 'Suno, naya video aa gaya hai', body: 'Is week ka Nirmaan lesson aa gaya. Jab 15 minutes mil jaayein, dekh lena.' },
  { title: 'New week, new step.', body: 'Nirmaan ka new lesson tumhara wait kar raha hai. Chalo, aage badhte hain.' },
  { title: 'Ready when you are.', body: 'Is week ka lesson available hai. Jab convenient ho, start kar dena.' },
  { title: 'Aaj ka 15-minute plan?', body: 'Naya lesson ready hai. Apne din mein bas thoda sa time apne Nirmaan ke liye nikaal lo.' },
  { title: 'Ek naya lesson. Ek naya thought.', body: 'Is week ka Nirmaan lesson ready hai. Dekho, aaj kya naya sochne ko milta hai.' },
  { title: 'Jawan, new lesson is here.', body: 'Naya Nirmaan lesson ready hai. Chalo, is week ka target complete karte hain.' },
  { title: 'Aaj thoda time apne future ko do.', body: 'Nirmaan ka naya lesson ready hai. Jab time mile, complete kar lena.' },
  { title: 'Ek naya lesson tumhara wait kar raha hai.', body: 'Jab time mile, open kar lena. Ho sakta hai is week ki learning tumhe apne future ko thoda aur clearly dekhne mein help kare.' },
  { title: 'Apne Nirmaan ke liye ek aur step lena hai.', body: 'Is week ka lesson aa gaya hai. Chalo, start karte hain.' },
  { title: 'Future ke liye kaam aaj se hi shuru hota hai.', body: 'Is week ka Nirmaan lesson ready hai. Jab time mile, dekh lena.' },
  { title: 'Ek naya lesson. Ek nayi learning.', body: 'Is week ka lesson tumhara wait kar raha hai. Open karo aur dekho aaj naya lesson kya sikhata hai.' },
  { title: 'Ek aur lesson, khud ko samajhne ka ek aur chance.', body: 'Naya lesson ready hai. Dekho, is baar apne baare mein kya naya jaanne ko milta hai.' },
  { title: 'Aaj ke 15 minutes ka kya plan hai?', body: 'Apne liye thoda time nikalo aur Nirmaan ka naya lesson start karo.' },
]

const DAILY_TASK = [
  { title: 'Aaj ka task ready hai.', body: 'Jab free ho, Apne aaj ke Nirmaan ko complete kar lena.' },
  { title: 'Aaj ke 15 minutes?', body: 'Bas itna hi chahiye. Nirmaan ka aaj ka task tumhara wait kar raha hai…' },
  { title: 'Jo aaj practice karoge, wahi kal kaam aayega.', body: 'Communication ho, discipline ho ya decision-making—Nirmaan ka task miss mat karna.' },
  { title: 'Zyada sochna nahi hai!', body: 'Dashboard open karo, question padho, aur aaj jo genuinely feel ho woh likh do.' },
  { title: 'Aaj khud ko thoda samay do.', body: 'Nirmaan ka task ready hai. Kuch minutes sirf apne thoughts ke saath spend karo.' },
  { title: 'Busy hone se pehle kar lo.', body: 'Aaj ka task abhi complete karoge toh baad mein yaad rakhne ki tension nahi.' },
  { title: 'Aaj ka Nirmaan ka task hua kya?', body: 'Nahi hua toh koi baat nahi. Abhi bhi time hai, kar lo.' },
  { title: 'Bas ek task.', body: 'Aaj hi poora course nahi karna 😄 Sirf aaj ka chhota sa task complete karna hai.' },
  { title: 'Time kam hai? Koi problem nahi.', body: 'Nirmaan ko max 15 minutes dene hain. Aaj ka task kar lo.' },
  { title: 'Aaj bhi apne liye thoda time.', body: 'Nirmaan ka task ready hai. Chalo, aaj ka task kar lete hain.' },
  { title: 'Apne Nirmaan ke liye time nahi hai?', body: 'Time hota nahi hai, nikalna padta hai- Travelling karte hua, Class ke bich main, etc.' },
  { title: 'Ek chhota task, ek useful habit.', body: 'Roz apne liye thoda time nikaalna bhi toh practice hai. Aaj ka task miss mat kerna.' },
  { title: 'Life mein har answer ready-made nahi milta.', body: 'Aaj ka Nirmaan task kholo aur jo sach mein feel karte ho, wahi likho. Right answer ki tension mat lo.' },
  { title: '15 minutes today, better clarity tomorrow.', body: 'Aaj ka task karo. Ek answer, ek thought ya ek realisation future ke decisions mein zaroor kaam aayega.' },
  { title: 'Kal ke better decisions aaj se bante hain.', body: 'Nirmaan ka aaj ka task miss mat karna. Khud ko samajhna bhi future ke liye preparation hai.' },
  { title: 'Apni life ko samajhne ke liye time nikaal rahe ho?', body: 'Nirmaan ka aaj ka task ready hai. Aaj ke 15 minutes se shuru karo.' },
  { title: 'Motivation ka wait mat karo.', body: 'Aaj bas task complete karne par focus karo. Aur apne future ke liye discipline build karo.' },
  { title: 'Nirmaan ka task tumhare liye hai, marks ke liye nahi.', body: 'Isliye right answer ki tension mat lo. Jo genuinely feel karte ho, woh likho.' },
  { title: '15 minutes nikaal sakte ho?', body: 'Aaj ka Nirmaan task kar lo. Itna time toh apne liye banta hi hai.' },
  { title: 'Aaj ka 15-minute break useful banao.', body: 'Nirmaan ka task tumhara wait kar raha hai. Ho sakta hai in kuch minutes mein apne baare mein kuch naya samajh aaye.' },
]

const GENTLE = [
  { title: 'Bas yaad dila rahe hain', body: 'Is week ka lesson abhi bhi wait kr raha hai. Jab time mile, dekh lena.' },
  { title: 'Kya aaj 15 minutes mil sakte hain?', body: 'Toh Nirmaan ka pending lesson complete kar lo. Bas itna hi.' },
  { title: 'Busy day chal raha hai?', body: 'Koi baat nahi. Jab thoda break mile, Nirmaan ko yaad kar lena.' },
  { title: 'Abhi tak start nahi kiya?', body: 'No worries. Lesson abhi bhi wahi hai. Jab time mile, shuru kar dena.' },
  { title: 'Ek small reminder…', body: 'Aaj ka Nirmaan ka task abhi bhi pending hai. Please aajhi kar lena.' },
  { title: 'Thoda time khud ke liye milega?', body: 'Agar haan, toh Nirmaan ka lesson zaroor dekh lena.' },
  { title: 'Start karne ka easiest time?', body: 'Jab tumhare paas thoda sa time ho. Aaj ka lesson ready hai.' },
  { title: 'Nirmaan yaad hai na?', body: 'Aaj ka task abhi bhi tumhara wait kar raha hai.' },
  { title: '15 minutes. Bas.', body: 'Agar din mein thoda sa time nikal sakte ho, toh aaj ka lesson kar lena.' },
  { title: 'Jab convenient ho, task kar dena.', body: 'Hum bas remind kara rahe hain. Nirmaan ka lesson ready hai.' },
  { title: 'Nirmaan aaphi ne shuru kiya hai naa?', body: 'Toh roz iske task ko pora bhi aaphi ko karna hai.' },
  { title: 'Apni life mein jo change chahte hain…', body: 'Uski practice small steps se hi hoti hai. Naya Nirmaan lesson ready hai.' },
  { title: 'Aaj ka task kal par mat chhodiye.', body: 'Baaki sab ke beech apne Nirmaan ke liye bhi thoda time nikaal lijiye.' },
  { title: 'Aaj ka small reminder 🙂', body: 'Nirmaan ka task abhi complete nahi hua hai. Jab time mile, kar lena.' },
]

const pick = (list, variant = 0) => list[((variant % list.length) + list.length) % list.length]

function buildNudge({ title, body }, { slug, cta }) {
  const link = `${clientUrl()}/learn/${slug}`
  return {
    subject: title,
    text: `${body} ${link}`,
    html: template({ heading: title, preheader: body, intro: body, cta, link }),
  }
}

/** Morning (7 AM): Part 1 when today's step is a video, Part 2 when it's a question. */
export function buildLearningReminderEmail({ slug, kind, variant = 0 }) {
  return kind === 'video'
    ? buildNudge(pick(NEW_LESSON, variant), { slug, cta: 'Lesson dekho' })
    : buildNudge(pick(DAILY_TASK, variant), { slug, cta: 'Aaj ka task karo' })
}

export async function sendLearningReminderEmail(to, details) {
  await sendMail({ to, ...buildLearningReminderEmail(details) })
}

/** Evening (7 PM): Part 3 — only reaches students whose step is still pending. */
export function buildEveningNudgeEmail({ slug, variant = 0 }) {
  return buildNudge(pick(GENTLE, variant), { slug, cta: 'Nirmaan kholo' })
}

export async function sendEveningNudgeEmail(to, details) {
  await sendMail({ to, ...buildEveningNudgeEmail(details) })
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
    text: `Good news${who}! ${organisation} has been approved as a partner. Set your password to open your organisation portal, where you can add and manage your students: ${link}${code ? ` (Organisation code: ${code})` : ''}`,
    html: template({
      heading: 'Your organisation is approved 🎉',
      preheader: `Set your password to open the ${organisation} portal.`,
      intro: `Good news${who}! ${organisation} has been approved as a partner. Set a password below to open your organisation portal — from there you can bulk-add your students and manage them.`,
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
 * organisation vouched for the address), so this is a set-password invite.
 */
export function buildStudentInviteEmail({ name, organisation, link, courses = [] }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'there'
  // A sponsored course is the reason most of these accounts exist, so the
  // invite says so: the seat opens the moment the password is set.
  const course = courses.length
    ? ` ${organisation} has also enrolled you in ${courses.join(' and ')} — it opens the moment your password is set.`
    : ''
  return {
    subject: `${organisation} created your ${BRAND} account`,
    text: `Hi ${first}, ${organisation} created a ${BRAND} account for you.${course} Set your password to log in: ${link}`,
    html: template({
      heading: 'Your account is ready',
      preheader: `${organisation} created a ${BRAND} account for you.`,
      intro: `Hi ${first}! ${organisation} created a ${BRAND} account for you.${course} Set a password below — then log in to pick up from there.`,
      cta: 'Set my password',
      link,
      note: 'This link is valid for 7 days. You can also use “Forgot password” on the login page later.',
    }),
  }
}
export async function sendStudentInviteEmail(to, details) {
  await sendMail({ to, ...buildStudentInviteEmail(details) })
}

// --- Institution: pay for its seats -----------------------------------------
/**
 * Sent when an admin sets an institution up to pay online. The link opens our
 * own /pay page, which takes the payment through Cashfree; paying adds the
 * seats straight away.
 */
export function buildInstitutionPaymentEmail({ organisation, course, students, amountInr, link }) {
  const amount = `₹${Number(amountInr).toLocaleString('en-IN')}`
  const what = `${course} for ${students} student${students === 1 ? '' : 's'}`
  return {
    subject: `Payment for ${organisation}: ${what}`,
    text: `${organisation}: please pay ${amount} for ${what}. Pay here: ${link}`,
    html: template({
      heading: 'Your payment link',
      preheader: `${amount} for ${what}.`,
      intro: `This is the payment for ${organisation}: ${what}, ${amount} in all. Once it is paid, you can add your students from your ${BRAND} portal and each one gets the course.`,
      cta: `Pay ${amount}`,
      link,
      note: 'You can pay by UPI, card or net banking. The link stays valid until it is paid.',
    }),
  }
}
export async function sendInstitutionPaymentEmail(to, details) {
  await sendMail({ to, ...buildInstitutionPaymentEmail(details) })
}
