/** 404 handler — reached when no route matched. */
export function notFound(req, res, next) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` })
}

/** Central error handler. Any error passed to next(err) lands here. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500
  const message = err.message || 'Internal Server Error'
  if (status >= 500) console.error(err)
  // `code` lets the client branch on specific cases (e.g. EMAIL_NOT_VERIFIED)
  // without string-matching the message.
  const body = { error: message }
  if (err.code) body.code = err.code
  res.status(status).json(body)
}
