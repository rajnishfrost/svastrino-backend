/**
 * The course page's fixed sections, rewritten as editor blocks.
 *
 * A course page used to be a form: a box for qualities, a box for institutes, a
 * repeater for careers and salaries, and the page drew each one into its own
 * section. That's now one document an admin writes freely — so the content that
 * lived in those boxes has to become part of the document, or the pages lose
 * everything below the overview.
 *
 * The headings match what the page printed above each section, so a reader sees
 * the same page and an admin opens the editor on content they recognise. After
 * that it's ordinary text: a heading can be renamed, a section moved or dropped.
 *
 * Used twice — by the one-off backfill, and by the seed, so importing a scraped
 * course still produces a page rather than a bare paragraph.
 */
import { textToBlocks } from './richText.js'

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim()

const clean = (list) => (Array.isArray(list) ? list.map((s) => String(s || '').trim()).filter(Boolean) : [])

const header = (text, level = 2) => ({ type: 'header', data: { text: esc(text), level } })

const list = (items, style = 'unordered') => ({
  type: 'list',
  data: { style, items: items.map((i) => ({ content: esc(i), items: [] })) },
})

/**
 * Careers and their pay, as a table — four short columns that a reader can
 * scan down, which is what the two salary figures were for. A column every job
 * left blank is dropped rather than printed empty.
 */
function careersTable(jobs) {
  const rows = jobs.filter((j) => String(j?.role || '').trim())
  if (!rows.length) return null

  const columns = [
    { head: 'Role', get: (j) => j.role },
    { head: 'What they do', get: (j) => j.description },
    { head: 'India salary', get: (j) => j.indiaSalary },
    { head: 'Global salary', get: (j) => j.globalSalary },
  ].filter((c) => rows.some((j) => String(c.get(j) || '').trim()))

  return {
    type: 'table',
    data: {
      withHeadings: true,
      stretched: false,
      content: [
        columns.map((c) => esc(c.head)),
        ...rows.map((j) => columns.map((c) => esc(c.get(j)))),
      ],
    },
  }
}

/**
 * The whole page as blocks: the overview it already has, then a section for
 * each box that holds anything.
 */
export function sectionsToBlocks(course = {}) {
  const opening =
    course.overviewBlocks?.blocks?.length
      ? course.overviewBlocks.blocks
      : textToBlocks(course.overview)?.blocks || []

  const blocks = [...opening]

  const qualities = clean(course.topQualities)
  if (qualities.length) blocks.push(header("Qualities you'll need"), list(qualities))

  const careers = careersTable(Array.isArray(course.topJobs) ? course.topJobs : [])
  if (careers) blocks.push(header('Careers & salaries'), careers)

  const india = clean(course.institutesIndia)
  const abroad = clean(course.institutesInternational)
  if (india.length || abroad.length) {
    blocks.push(header('Top institutes'))
    if (india.length) blocks.push(header('India', 3), list(india))
    if (abroad.length) blocks.push(header('International', 3), list(abroad))
  }

  const ladder = clean(course.careerLadder)
  if (ladder.length) blocks.push(header('Career ladder'), list(ladder, 'ordered'))

  return blocks.length ? { time: Date.now(), blocks, version: '2.30.0' } : null
}
