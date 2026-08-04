# Video DRM + Offline — AWS-phase plan

Reference doc for the production video phase. **Nothing here is implemented yet** —
today the app serves plain (unencrypted) HLS from local disk with a custom hls.js
player, a watermark and a focus-loss cover (best-effort deterrents only).

## Why DRM
Two goals are solved by the **same** stack:

| Goal | Only possible with |
|---|---|
| **Screen-recording shows black** | DRM (EME) → protected media path (browser/OS/GPU enforces it) |
| **Offline inside the app, no device file** | DRM **persistent licence** + player offline storage (IndexedDB) |

Neither can be done with plain HLS/MP4. The blackout is **not** something we code —
it is a side-effect of the protected path once content is DRM-encrypted.

## Architecture

```
Source video
  ↓ transcode + ENCRYPT (CENC for Widevine/PlayReady, SAMPLE-AES for FairPlay)
AWS MediaConvert / MediaPackage  ←SPEKE→  DRM key provider
  ↓
S3  →  CloudFront (HTTPS, signed URLs)
  ↓
Shaka Player (EME) in our app
  ↓ licence request (+ our auth token)
DRM licence server  →  key  →  CDM decrypts in protected path
```

### Pieces
1. **Packaging/encryption** — AWS **MediaConvert** (or **MediaPackage**) with **SPEKE**
   key exchange; or self-hosted **Shaka Packager** (free, more ops).
2. **DRM key + licence provider** — issues keys and runs the licence server.
   Candidates: **EZDRM** (smallest/startup-friendly), **Axinom**, **BuyDRM/KeyOS**, **Vualto**.
3. **Delivery** — S3 + **CloudFront** over **HTTPS** (EME requires a secure context) with
   signed/expiring URLs.
4. **Player** — **Shaka Player** (Google, open-source): Widevine + PlayReady + FairPlay
   built in, **and** built-in offline storage. Can run headless so we keep our own
   custom control bar.
5. **Our server** — a small endpoint that authenticates the student and returns a
   short-lived **licence token** (so only enrolled users get a licence).

## Offline (in-app) specifics
- Uses **`shaka.offline.Storage`**: stores segments in **IndexedDB** + a **persistent licence**.
- Content is **encrypted at rest** in browser storage — not a file the user can copy out.
- Set a **licence rental/expiry** (e.g. 30 days, or until the course ends).
- Call `navigator.storage.persist()` so the browser doesn't evict downloads; watch
  **storage quota** for long videos.
- A **PWA** (installable + service worker) improves storage durability and the "app"
  feel — optional but recommended alongside.
- **iOS/Safari (FairPlay) offline is the weakest link** — flow differs and is more
  restricted; a native app may be needed if iOS offline is a hard requirement.

## Support / limits (be realistic)
- **Reliable blackout**: Chrome/Edge on Windows, Android, ChromeOS; Safari (FairPlay) on macOS/iOS.
- **Inconsistent**: Firefox, Linux, and software-only **Widevine L3** — capture may still work.
- **Hardware DRM (L1)** needed for HD + strongest protection; L3 typically means
  capping quality (this is why Netflix limits some browsers to 720p).
- **Phone camera recording (analog hole) can never be stopped** — by us or by Netflix.

## Cost drivers (confirm current pricing with each vendor)
- **DRM provider**: usually a monthly minimum + a per-licence fee. EZDRM is the
  cheapest tier for small volume; Axinom/BuyDRM are enterprise-priced.
- **MediaConvert**: billed per minute of *output* (multiplied by the number of ladder
  rungs) — self-hosting Shaka Packager avoids this but adds ops.
- **S3 storage** + **CloudFront egress** (egress dominates at scale).
- **Dev effort**: a few days (packaging pipeline, licence-token endpoint, Shaka
  integration, offline download UI).
> Numbers change often — get live quotes rather than budgeting from memory.

## What changes in our code (already stubbed for this)
- `server/src/config/transcoder.js` — the **`aws` branch** (MediaConvert) is already
  stubbed; add SPEKE/DRM encryption there.
- `server/src/config/uploads.js` — the **`s3` branch** is already stubbed; return
  CloudFront URLs.
- **New**: a licence-token endpoint under the learn module (auth → short-lived token),
  enforcing enrolment/tier just like `learn.service.js` already does.
- `client/src/pages/user/learnpage/HlsPlayer.jsx` — swap hls.js for **Shaka Player**;
  **keep the existing custom control bar, watermark, focus-cover and seek-lock**.
- **New**: offline "Download / Remove download" UI on the learn page using
  `shaka.offline.Storage`, plus optional PWA (service worker + manifest).

## Suggested order
1. S3 + CloudFront delivery (no DRM) — prove signed URLs + CDN.
2. Swap player to Shaka (still clear content) — no behaviour change for users.
3. Add MediaConvert + DRM provider → encrypted output + licence server.
4. Add offline download (persistent licence) + storage quota UX.
5. Optional PWA wrapper.

## Verification
- DRM: play on Chrome/Windows → start a screen recording → the video area records **black**;
  a non-enrolled user gets **no licence** (playback fails).
- Offline: download a session → go airplane mode → it still plays; after the licence
  expiry it stops; DevTools → Application → IndexedDB shows encrypted data (no plain file).
- Fallbacks: Firefox/Linux still plays (blackout may not apply) — confirm no hard failure.
