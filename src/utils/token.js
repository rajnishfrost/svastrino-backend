import jwt from 'jsonwebtoken'

const SECRET = () => process.env.JWT_SECRET || 'dev-secret'
const EXPIRES = () => process.env.JWT_EXPIRES_IN || '30d'

/**
 * Sign a JWT. `role` distinguishes user vs admin tokens so the same secret
 * can power both without one being usable in the other's guard.
 */
export function signToken(payload, role = 'user') {
  return jwt.sign({ ...payload, role }, SECRET(), { expiresIn: EXPIRES() })
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET())
}
