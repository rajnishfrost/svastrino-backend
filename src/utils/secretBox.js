import crypto from 'node:crypto'

/**
 * Reversible encryption for the few secrets we must be able to read back —
 * today an institution's Mindler sign-in password, which has to be sent to
 * Mindler as it is, so it cannot be hashed like our own users' passwords.
 *
 * AES-256-GCM, a fresh 12-byte IV per value, stored as one string
 * `v1.<iv>.<tag>.<ciphertext>` (base64url). GCM's tag means a value that was
 * tampered with, or encrypted under another key, fails to open instead of
 * opening as garbage.
 *
 * The key is CREDENTIALS_ENCRYPTION_KEY: 32 bytes, as 64 hex characters or
 * base64. It lives in the environment, never in the database, so a copy of the
 * database alone opens nothing. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Changing it makes every stored value unreadable — they would have to be
 * typed in again.
 */

const VERSION = 'v1'

function key() {
  const raw = String(process.env.CREDENTIALS_ENCRYPTION_KEY || '').trim()
  if (!raw) return null
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  return buf.length === 32 ? buf : null
}

const notConfigured = () => {
  const err = new Error('Saving passwords is not set up on this server yet (CREDENTIALS_ENCRYPTION_KEY is missing or not 32 bytes).')
  err.status = 503
  err.code = 'ENCRYPTION_NOT_CONFIGURED'
  return err
}

export const canEncrypt = () => !!key()

/** Plain text → the stored string. Throws 503 when no key is configured. */
export function encryptSecret(plain) {
  const k = key()
  if (!k) throw notConfigured()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv)
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv, tag, data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

/**
 * The stored string → plain text, or null when it cannot be opened (no key,
 * wrong key, damaged value). Callers treat null as "no password saved".
 */
export function decryptSecret(stored) {
  const k = key()
  const parts = String(stored || '').split('.')
  if (!k || parts.length !== 4 || parts[0] !== VERSION) return null
  try {
    const [, iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64url'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
