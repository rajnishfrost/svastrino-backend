# Media storage — local ↔ S3

All uploaded media flows through ONE adapter: `src/config/uploads.js`
(`saveVideo`, `saveHlsDir`, `saveAvatar`, `saveReport`, `saveImage`,
`deleteByKey`, `keyFromUrl`). Every upload site — admin video upload, blog/cover
images, avatars, Mindler report PDFs — calls these helpers and stores the
returned URL. Switching storage backends changes **nothing** else.

## Two modes (env `STORAGE`)

| Mode | Files live in | Public URL | When |
|---|---|---|---|
| `local` (default) | `server/uploads/*` | `/uploads/…` (Vite-proxied in dev) | dev / single box |
| `s3` | AWS S3 bucket | `CDN_URL/…` (CloudFront) | production |

Uploads are always staged to a temp file by multer first; the adapter then
either moves it into `server/uploads` (local) or streams it to S3 and deletes
the temp file. Video is transcoded to an HLS ladder first (see `transcoder.js`);
in S3 mode every playlist + `.ts` segment is uploaded under `hls/<id>/`.

## Switch to S3

In `.env.local` (never commit real keys):

```
STORAGE=s3
S3_BUCKET=svastrino-media
AWS_REGION=ap-south-1
CDN_URL=https://dxxxx.cloudfront.net      # CloudFront in front of the bucket
AWS_ACCESS_KEY_ID=...                      # or an EC2/ECS IAM role (preferred in prod)
AWS_SECRET_ACCESS_KEY=...
```

AWS setup checklist:
1. **Bucket** (`S3_BUCKET`) — block public access; do NOT make the bucket public.
2. **CloudFront** distribution with the bucket as origin (OAC), `CDN_URL` = its
   domain. Public reads go through CloudFront only.
3. **IAM**: the app's credentials/role need `s3:PutObject`, `s3:DeleteObject`
   (and `s3:GetObject` if you ever read back) on `arn:…:S3_BUCKET/*`.
4. Content types are set on upload (`m3u8`→`application/vnd.apple.mpegurl`,
   `ts`→`video/mp2t`, images, `pdf`) so players/browsers stream correctly.

Implementation lives in `src/config/s3.js` (lazy client, `putFile` via
`@aws-sdk/lib-storage` for large multipart video uploads, `deleteObject`,
`publicUrl`).

## Caveats for the offline video feature

Offline downloads + the service worker cache media by URL. In S3 mode those URLs
are cross-origin (CloudFront), so for `caches`/`fetch` to store them the
CloudFront distribution must send **CORS** headers (`Access-Control-Allow-Origin`
for the site origin) and the SW must treat them as cross-origin. Online HLS
playback works regardless. Wire CORS on CloudFront before relying on offline
saves in production; nothing in the app code needs to change.

## Migrating existing local files (optional)

Old assets already stored under `/uploads/*` keep working only in `local` mode.
To move to S3, sync the folder once and rewrite stored URLs:
`aws s3 sync server/uploads s3://$S3_BUCKET/` then update the DB URLs from
`/uploads/<key>` to `CDN_URL/<key>`. New uploads after the switch go straight to
S3.
