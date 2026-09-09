/**
 * The editor's document format, and the two directions it travels.
 *
 * Editor.js hands back JSON — `{ time, blocks: [{ type, data }], version }` —
 * and that document is what an admin edits and what the course page renders.
 * But plenty of places still need the same content as a *string*: the search
 * description, the card blurb on the library grid, the line under the page
 * title. So the plain `overview` field stays, as a derived mirror of the
 * document rather than a second thing to keep in sync — an admin writes blocks,
 * the string follows on save.
 *
 * Only the blocks the course page knows how to draw survive a save. An unknown
 * block would be stored, sent to the browser, and then silently vanish at
 * render time — which looks exactly like data loss to whoever wrote it. Better
 * to drop it at the door, while the editor still has it on screen.
 */

/** Blocks the renderer understands. Anything else is dropped on save. */
const BLOCKS = new Set([
  'paragraph', 'header', 'list', 'checklist', 'table',
  'quote', 'delimiter', 'image', 'embed',
])

/** How a block may be aligned — the alignment tune writes one of these. */
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify'])

/**
 * Video services a page may embed. An embed is an iframe running somebody
 * else's code inside our page, so the list is the whole of the trust here —
 * a service that isn't named simply doesn't survive the save.
 */
const EMBED_HOSTS = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//i

/**
 * Where an image may come from: this site's own media (a relative path, which
 * is what the upload endpoint returns) or an https address.
 */
const imageUrl = (url) => {
  const u = String(url || '').trim()
  return /^\/[^/]/.test(u) || /^https:\/\//i.test(u) ? u : ''
}

/** Inline markup allowed inside a block's text. */
const INLINE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'mark', 'code', 'br', 'a'])

const MAX_BLOCKS = 200

/**
 * Keep the handful of inline tags the editor produces; unwrap the rest.
 *
 * This runs on the way IN, so what the database holds is already safe — the
 * client renderer doesn't have to be the only thing standing between a pasted
 * `<script>` and a reader. Tags are unwrapped rather than escaped: a stray
 * `<span style=…>` from a paste should lose its styling, not turn into visible
 * angle brackets in the middle of a sentence.
 */
export function sanitizeInline(html) {
  return String(html ?? '')
    // Elements whose content isn't text go with their contents.
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (whole, name, attrs) => {
      const tag = name.toLowerCase()
      if (!INLINE_TAGS.has(tag)) return ''
      if (whole.startsWith('</')) return `</${tag}>`
      if (tag === 'br') return '<br>'
      if (tag !== 'a') return `<${tag}>`

      const m = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
      const href = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim()
      // http(s), a path on this site, or an email. A `javascript:` URL never
      // gets stored — the link is kept, stripped of where it pointed.
      return /^(https?:\/\/|\/|mailto:)/i.test(href)
        ? `<a href="${href.replace(/"/g, '&quot;')}">`
        : '<a>'
    })
    .trim()
}

/** Strip every tag — for the plain-text mirror and for length checks. */
const toText = (html) =>
  String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()

/**
 * List items, cleaned and kept nested.
 *
 * The list tool writes items as objects that can hold their own children, and
 * reads plain strings back as a flat list — both shapes turn up here, one shape
 * is stored. Children are kept rather than flattened: an admin who indents a
 * point would otherwise watch the indent disappear on the next save.
 */
const listItems = (data, depth = 0) => {
  if (depth > 3) return [] // an editor can nest forever; a page needn't
  return (Array.isArray(data?.items) ? data.items : [])
    .map((it) => {
      const content = sanitizeInline(typeof it === 'string' ? it : it?.content)
      return { content, items: typeof it === 'string' ? [] : listItems(it, depth + 1) }
    })
    .filter((it) => toText(it.content) || it.items.length)
}

/** Every line of a nested item list, in reading order. */
const flattenItems = (items) =>
  (items || []).flatMap((it) => [toText(it.content), ...flattenItems(it.items)])

/**
 * Normalise whatever the panel posted into a document worth storing, or `null`
 * when there's nothing in it — an empty editor should clear the field, not
 * store an empty shell that later reads as "rich content exists".
 */
export function sanitizeBlocks(input) {
  let doc = input
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc) } catch { return null }
  }
  if (!doc || !Array.isArray(doc.blocks)) return null

  const blocks = []
  for (const raw of doc.blocks.slice(0, MAX_BLOCKS)) {
    const type = String(raw?.type || '')
    if (!BLOCKS.has(type)) continue
    const d = raw.data || {}

    // Keeping a block also keeps how it was aligned — a centred heading that
    // quietly went back to the left on save would read as the editor losing
    // the change.
    const keep = (data) => {
      const block = { type, data }
      const a = raw?.tunes?.alignment?.alignment
      if (ALIGNMENTS.has(a)) block.tunes = { alignment: { alignment: a } }
      blocks.push(block)
    }

    if (type === 'delimiter') {
      keep({})
      continue
    }

    if (type === 'list') {
      const items = listItems(d)
      if (items.length) keep({ style: d.style === 'ordered' ? 'ordered' : 'unordered', items })
      continue
    }

    if (type === 'checklist') {
      const items = (Array.isArray(d.items) ? d.items : [])
        .map((it) => ({ text: sanitizeInline(it?.text), checked: !!it?.checked }))
        .filter((it) => toText(it.text))
      if (items.length) keep({ items })
      continue
    }

    if (type === 'table') {
      const content = (Array.isArray(d.content) ? d.content : [])
        .map((row) => (Array.isArray(row) ? row.map((cell) => sanitizeInline(cell)) : []))
        .filter((row) => row.length)
      if (content.length) keep({ withHeadings: !!d.withHeadings, stretched: !!d.stretched, content })
      continue
    }

    if (type === 'image') {
      const url = imageUrl(d.file?.url || d.url)
      if (url) {
        keep({
          file: { url },
          caption: sanitizeInline(d.caption),
          withBorder: !!d.withBorder,
          withBackground: !!d.withBackground,
          stretched: !!d.stretched,
        })
      }
      continue
    }

    if (type === 'embed') {
      const embed = String(d.embed || '').trim()
      if (EMBED_HOSTS.test(embed)) {
        keep({
          service: String(d.service || '').slice(0, 40),
          source: String(d.source || '').slice(0, 500),
          embed,
          width: Number(d.width) || 580,
          height: Number(d.height) || 320,
          caption: sanitizeInline(d.caption),
        })
      }
      continue
    }

    if (type === 'quote') {
      const text = sanitizeInline(d.text)
      if (toText(text)) keep({ text, caption: sanitizeInline(d.caption) })
      continue
    }

    const text = sanitizeInline(d.text)
    if (!toText(text)) continue // an empty paragraph is the editor's cursor, not content
    if (type === 'header') {
      const level = Number(d.level)
      keep({ text, level: level >= 2 && level <= 4 ? level : 2 })
    } else {
      keep({ text })
    }
  }

  if (!blocks.length) return null
  return { time: Number(doc.time) || Date.now(), blocks, version: String(doc.version || '2.30.0') }
}

/** The alignment an admin set on a block, if it's one we can draw. */
export function alignmentOf(block) {
  const a = block?.tunes?.alignment?.alignment
  return ALIGNMENTS.has(a) ? a : null
}

/**
 * The document as plain text — paragraph per line, which is what `excerptFor`
 * and the card blurb want.
 */
export function blocksToText(doc) {
  const out = []
  for (const b of doc?.blocks || []) {
    const d = b.data || {}
    switch (b.type) {
      case 'delimiter': break
      case 'list': out.push(...flattenItems(d.items)); break
      case 'checklist': out.push(...(d.items || []).map((it) => toText(it?.text))); break
      case 'table': out.push(...(d.content || []).flat().map(toText)); break
      case 'quote': out.push(toText(d.text), toText(d.caption)); break
      case 'image':
      case 'embed': out.push(toText(d.caption)); break
      default: out.push(toText(d.text))
    }
  }
  return out.filter(Boolean).join('\n\n')
}

/**
 * A plain string as a document — one paragraph per blank-line-separated chunk.
 * Used by the backfill, and whenever a course is saved through the old plain
 * `overview` field so the two never disagree.
 */
export function textToBlocks(text) {
  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim().replace(/\s*\n\s*/g, ' '))
    .filter(Boolean)
    .map((p) => ({ type: 'paragraph', data: { text: sanitizeInline(p) } }))

  return blocks.length ? { time: Date.now(), blocks, version: '2.30.0' } : null
}
