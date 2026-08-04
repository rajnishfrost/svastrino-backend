import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Loads environment variables from the server root.
 *
 * Import this FIRST (before anything that reads process.env). `.env.local` is
 * the primary file; `.env` is loaded as a fallback so either name works —
 * dotenv never overrides an already-set key, so `.env.local` wins.
 *
 * Paths are resolved relative to this file (not process.cwd()), so it works no
 * matter which directory the process was launched from.
 */
const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

dotenv.config({ path: join(serverRoot, '.env.local') })
dotenv.config({ path: join(serverRoot, '.env') })
