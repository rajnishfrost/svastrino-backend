import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'media-manifest.json')

let manifest = null

/**
 * Map of original svastrino.com media URL → local `/uploads/content/…` path,
 * written by `npm run fetch:media`. Empty when the fetch hasn't been run.
 */
export function loadMediaManifest() {
  if (manifest) return manifest
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  } catch {
    manifest = {}
  }
  return manifest
}

/**
 * Rewrite a migrated media URL to its local copy. Falls back to the original
 * remote URL when the asset hasn't been fetched, so seeding still produces a
 * working site before `fetch:media` has run.
 */
export function localMedia(url) {
  if (!url) return url
  return loadMediaManifest()[url] || url
}

/** How many assets the manifest knows about — handy for seed logging. */
export const mediaManifestSize = () => Object.keys(loadMediaManifest()).length
