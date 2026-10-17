import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

/**
 * A gift coupon ticket as a PNG, for the email — drawn to the same measurements
 * as the site's ticket (client/src/pages/user/giftpage/GiftTicket.jsx +
 * GiftCoupons.css, the "Your gift will look like this" preview): a 560 × 228
 * card, the navy stub at 34% with its gold and crimson glows, the cream side
 * with diagonal stripes, the dashed tear line, two punched notches, the logo,
 * "A gift for your journey", the code in a dashed box, validity and how to use.
 *
 * An image because email clients strip what the design is made of (rounded
 * notches, gradients, stripes, web fonts) — a picture looks the same in every
 * inbox. The email still prints each code as text under its ticket, so it can
 * be copied.
 *
 * Fonts ship with the server (src/assets/fonts, SIL Open Font License): Inter,
 * the site's text font, and Courier Prime for the code (the site shows it in
 * Courier New). Rendered at 2× for sharp text on phones.
 */

const here = dirname(fileURLToPath(import.meta.url))
const FONT_DIR = join(here, '..', '..', '..', 'assets', 'fonts')
const FONT_FILES = [
  'Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf', 'Inter-ExtraBold.ttf', 'CourierPrime-Bold.ttf',
].map((f) => join(FONT_DIR, f))

// The email logo (489 × 168), drawn 26px tall like the site's ticket logo.
const LOGO = `data:image/png;base64,${readFileSync(join(here, '..', '..', '..', 'templates', 'emails', 'logo.png')).toString('base64')}`
const LOGO_H = 26
const LOGO_W = Math.round((489 / 168) * LOGO_H)

export const TICKET_W = 560
export const TICKET_H = 228
const STUB = Math.round(TICKET_W * 0.34) // 190

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const inr = (paise) => '₹' + (Number(paise) / 100).toLocaleString('en-IN')
const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

// A four-pointed star (✦), radius 4.5, centred on (x, y).
const star = (x, y, r = 4.5, w = 1.2) =>
  `<path d="M${x},${y - r} L${x + w},${y - w} L${x + r},${y} L${x + w},${y + w} L${x},${y + r} L${x - w},${y + w} L${x - r},${y} L${x - w},${y - w} Z"/>`

function ticketSvg({ code, value, expiresAt }) {
  const val = inr(value)
  // The site sizes the value to fit (clamp up to 38px); a long one steps down.
  const valSize = val.length > 7 ? 30 : val.length > 6 ? 34 : 38
  // Courier Prime is monospaced: 0.6em per character, plus the letter spacing.
  const codeSize = 20
  const spacing = 2.4
  const codeW = Math.round(code.length * (codeSize * 0.6 + spacing) - spacing)
  const boxX = STUB + 24
  const boxW = codeW + 24
  const right = TICKET_W - 20

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${TICKET_W}" height="${TICKET_H}" viewBox="0 0 ${TICKET_W} ${TICKET_H}">
  <defs>
    <linearGradient id="navy" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#0f2c5c"/><stop offset="1" stop-color="#0a1f43"/>
    </linearGradient>
    <radialGradient id="gold" cx="0.18" cy="0.18" r="0.42">
      <stop offset="0" stop-color="#f0c674" stop-opacity="0.28"/><stop offset="1" stop-color="#f0c674" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="red" cx="0.85" cy="0.9" r="0.45">
      <stop offset="0" stop-color="#c8102e" stop-opacity="0.35"/><stop offset="1" stop-color="#c8102e" stop-opacity="0"/>
    </radialGradient>
    <pattern id="stripes" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="10" height="20" fill="#0f2c5c" fill-opacity="0.025"/>
    </pattern>
    <clipPath id="card"><rect width="${TICKET_W}" height="${TICKET_H}" rx="18" ry="18"/></clipPath>
  </defs>

  <g clip-path="url(#card)">
    <rect x="${STUB}" width="${TICKET_W - STUB}" height="${TICKET_H}" fill="#fffaf0"/>
    <rect x="${STUB}" width="${TICKET_W - STUB}" height="${TICKET_H}" fill="url(#stripes)"/>
    <rect width="${STUB}" height="${TICKET_H}" fill="url(#navy)"/>
    <rect width="${STUB}" height="${TICKET_H}" fill="url(#gold)"/>
    <rect width="${STUB}" height="${TICKET_H}" fill="url(#red)"/>
  </g>

  <!-- tear line and the two punched notches -->
  <line x1="${STUB + 1}" y1="14" x2="${STUB + 1}" y2="${TICKET_H - 14}" stroke="#0f2c5c" stroke-opacity="0.25" stroke-width="2" stroke-dasharray="6 5"/>
  <circle cx="${STUB}" cy="0" r="12" fill="#ffffff"/>
  <circle cx="${STUB}" cy="${TICKET_H}" r="12" fill="#ffffff"/>

  <!-- stub -->
  <g font-family="Inter" text-anchor="middle">
    <text x="${STUB / 2}" y="84" font-size="11" font-weight="700" letter-spacing="2.2" fill="#f0c674">GIFT COUPON</text>
    <text x="${STUB / 2}" y="${84 + 12 + valSize}" font-size="${valSize}" font-weight="800" fill="#ffffff">${esc(val)}</text>
    <text x="${STUB / 2}" y="${84 + 34 + valSize}" font-size="12" font-weight="400" fill="#c9d3e6">off any course</text>
  </g>
  <!-- ✦ ✦ ✦ — drawn, since the font has no such glyph -->
  <g fill="#f0c674" fill-opacity="0.75">${[-22, 0, 22].map((dx) => star(STUB / 2 + dx, 84 + 56 + valSize)).join('')}</g>

  <!-- cream side -->
  <image x="${boxX}" y="18" width="${LOGO_W}" height="${LOGO_H}" xlink:href="${LOGO}" href="${LOGO}"/>
  <g font-family="Inter">
    <text x="${right}" y="36" text-anchor="end" font-size="11.5" font-weight="700" letter-spacing="0.7" fill="#8a7f6a">svastrino.com</text>
    <text x="${boxX}" y="72" font-size="13" font-weight="700" letter-spacing="0.5" fill="#c8102e">A GIFT FOR YOUR JOURNEY</text>
  </g>
  <rect x="${boxX}" y="84" width="${boxW}" height="38" rx="10" ry="10" fill="#ffffff" stroke="#0f2c5c" stroke-opacity="0.35" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="${boxX + 12}" y="110" font-family="Courier Prime" font-size="${codeSize}" font-weight="700" letter-spacing="${spacing}" fill="#0f2c5c">${esc(code)}</text>
  <g font-family="Inter">
    <text x="${boxX}" y="146" font-size="12.5" fill="#475569">Valid till <tspan font-weight="700" fill="#0f2c5c">${esc(day(expiresAt))}</tspan><tspan fill="#c9b98f">  •  </tspan>One-time use</text>
    <text x="${boxX}" y="172" font-size="12" fill="#8a7f6a">Enter the code in the coupon box at checkout on any</text>
    <text x="${boxX}" y="188" font-size="12" fill="#8a7f6a">course or programme.</text>
  </g>
</svg>`
}

/** The ticket as a PNG Buffer, 1120 × 456 (2×). */
export function ticketPng(coupon) {
  const resvg = new Resvg(ticketSvg(coupon), {
    fitTo: { mode: 'width', value: TICKET_W * 2 },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' },
    background: 'rgba(255,255,255,0)',
  })
  return resvg.render().asPng()
}
