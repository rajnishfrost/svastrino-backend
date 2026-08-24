import {
  S3Client,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
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
  '.vtt': 'text/vtt',
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

/** Upload an in-memory Buffer/string to `key` (e.g. a generated .vtt file). */
export async function putBuffer(body, key, contentType) {
  const up = new Upload({
    client: s3(),
    params: { Bucket: bucket(), Key: key, Body: body, ContentType: contentType || contentTypeFor(key) },
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

/* ---------------------------------------------------------------------------
 * Browser-direct multipart upload
 *
 * A course video is too big to travel through the app: CloudFront gives an
 * origin 60 seconds to answer and will not be persuaded past it, and even
 * reaching the container means holding a multi-gigabyte file on a task that is
 * also serving the site. So the browser is given signed URLs and uploads
 * straight to S3 — CloudFront and the load balancer are not in the path at all.
 *
 * Multipart rather than a single signed PUT because it is what makes a long
 * upload survivable: a part that fails is retried on its own, and a part that
 * succeeded is not sent twice.
 * ------------------------------------------------------------------------- */

// How long a signed part URL stays usable. Long enough for a slow connection to
// finish the part it is on, short enough that a leaked URL is not a standing
// invitation to write into the bucket.
const PART_URL_TTL_SEC = 60 * 60 // 1 hour

/** Begin a multipart upload. Returns the S3 uploadId the parts belong to. */
export async function startMultipart(key, contentType) {
  const out = await s3().send(new CreateMultipartUploadCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  }))
  return { uploadId: out.UploadId, key }
}

/**
 * A signed URL the browser PUTs one part to. Parts are numbered from 1, and S3
 * requires every part except the last to be at least 5 MB.
 */
export async function presignPart(key, uploadId, partNumber) {
  return getSignedUrl(
    s3(),
    new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: PART_URL_TTL_SEC },
  )
}

/**
 * Stitch the parts into the finished object. `parts` is [{ PartNumber, ETag }]
 * — the ETag each PUT returned — and S3 rejects the call if they are not in
 * ascending order, so they are sorted here rather than trusting the caller.
 */
export async function completeMultipart(key, uploadId, parts) {
  const ordered = [...parts]
    .map((p) => ({ PartNumber: Number(p.PartNumber), ETag: p.ETag }))
    .sort((a, b) => a.PartNumber - b.PartNumber)

  await s3().send(new CompleteMultipartUploadCommand({
    Bucket: bucket(),
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: ordered },
  }))
  return { url: publicUrl(key), key }
}

/**
 * Give up on an upload. Worth calling on any abandoned attempt: S3 keeps the
 * parts of an incomplete multipart upload, and charges for them, until the
 * upload is aborted or a lifecycle rule sweeps it.
 */
export async function abortMultipart(key, uploadId) {
  await s3().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }))
}
