import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { createReadStream } from 'node:fs'
import { extname } from 'node:path'

/**
 * Thin S3 helper used by config/uploads.js when STORAGE=s3. Keeps all AWS
 * specifics in one place so the upload adapter stays clean.
 *
 * Env (in .env.local — never commit real keys):
 *   STORAGE=s3
 *   S3_BUCKET=your-bucket
 *   AWS_REGION=ap-south-1
 *   CDN_URL=https://dxxxx.cloudfront.net   (public read origin for the bucket)
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   (or an instance/task IAM role)
 */

// Content-Type by extension — important for video/HLS so players stream it.
const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
}
export const contentTypeFor = (nameOrExt) =>
  CONTENT_TYPES[extname(nameOrExt).toLowerCase()] || 'application/octet-stream'

let _client = null
/** Lazy singleton — created only when S3 is actually used. */
export function s3() {
  if (_client) return _client
  const region = process.env.AWS_REGION
  if (!process.env.S3_BUCKET || !region) {
    throw new Error('S3 not configured — set S3_BUCKET and AWS_REGION (and CDN_URL) in the environment')
  }
  // Credentials come from the default provider chain: env vars
  // (AWS_ACCESS_KEY_ID/SECRET) locally, or an IAM role on EC2/ECS in prod.
  _client = new S3Client({ region })
  return _client
}

const bucket = () => process.env.S3_BUCKET
/** Public URL for a stored key — via CloudFront (CDN_URL) if set, else S3 REST. */
export function publicUrl(key) {
  const cdn = (process.env.CDN_URL || '').replace(/\/$/, '')
  if (cdn) return `${cdn}/${key}`
  return `https://${bucket()}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
}

/** Upload one local file to `key`. Streams (multipart) so large videos are fine. */
export async function putFile(localPath, key, contentType) {
  const up = new Upload({
    client: s3(),
    params: {
      Bucket: bucket(),
      Key: key,
      Body: createReadStream(localPath),
      ContentType: contentType || contentTypeFor(localPath),
    },
  })
  await up.done()
  return { url: publicUrl(key), key }
}

/** Delete one object by key. Best-effort — a missing object is not an error. */
export async function deleteObject(key) {
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
  } catch (err) {
    if (err?.$metadata?.httpStatusCode !== 404) {
      console.error('✗ S3 delete failed for', key, '—', err.message)
    }
  }
}
