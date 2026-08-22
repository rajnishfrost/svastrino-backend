/** 404 handler — reached when no route matched. */
export function notFound(req, res, next) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` })
}

/**
 * Mongo reports a unique-index violation as E11000 with a message naming the
 * database, the collection and the index — none of which a visitor should ever
 * read, and none of which tells them what to do. Turn it into a sentence about
 * the field that actually clashed. Modules that can word it better still catch
 * 11000 themselves; this is the safety net for the ones that do not.
 */
function duplicateKeyMessage(err) {
  const field = Object.keys(err.keyPattern || err.keyValue || {})[0]
  if (!field) return 'That already exists — please use a different value.'
  const value = (err.keyValue || {})[field]
  const label = field.replace(/([A-Z])/g, ' $1').toLowerCase()
  return value
    ? `That ${label} is already in use: “${value}”. Please choose a different one.`
    : `That ${label} is already in use. Please choose a different one.`
}

/** Central error handler. Any error passed to next(err) lands here. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err?.code === 11000) {
    return res.status(409).json({ error: duplicateKeyMessage(err), code: 'DUPLICATE' })
  }

  const status = err.status || 500
  const message = err.message || 'Internal Server Error'
  if (status >= 500) console.error(err)
  // `code` lets the client branch on specific cases (e.g. EMAIL_NOT_VERIFIED)
  // without string-matching the message.
  const body = { error: message }
  if (err.code) body.code = err.code
  res.status(status).json(body)
}
