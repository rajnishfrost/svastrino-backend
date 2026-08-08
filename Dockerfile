# =============================================================================
# Svastrino API - production image
# =============================================================================
# node:20-slim (Debian), NOT alpine: the app depends on ffmpeg-static and
# ffprobe-static, which ship prebuilt glibc binaries. On alpine (musl) those
# binaries fail to exec, and video transcoding dies at runtime rather than at
# build time - a very annoying way to find out.
#
# Build for x86_64 explicitly when building on an Apple Silicon Mac, otherwise
# you get an arm64 image that Fargate (x86_64 by default) cannot run:
#   docker build --platform linux/amd64 -t <ecr-url>:latest .
# GitHub's runners are x86_64, so CI needs no flag.
# =============================================================================

FROM node:20-slim

ENV NODE_ENV=production

WORKDIR /app

# Dependencies first, so a code-only change reuses this layer.
# `npm ci` needs both files and installs exactly what the lockfile pins.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The app creates upload staging directories at import time
# (src/config/uploads.js) even when STORAGE=s3, because multer stages large
# video uploads on local disk before streaming them to S3. Those directories
# must be writable by the non-root user below.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# Never run as root. node:20-slim ships a `node` user for exactly this.
USER node

EXPOSE 5060

# Container-level liveness, independent of the ALB. ECS replaces a task that
# fails this, which catches a hung event loop - something "process is still
# alive" alone would never notice.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5060)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
