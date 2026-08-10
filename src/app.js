import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import routes from './routes/index.js'
import { UPLOADS_ROOT } from './config/uploads.js'
import { notFound, errorHandler } from './middleware/errorHandler.js'

/**
 * Builds and configures the Express app (no listening here — see index.js).
 * Kept separate so it can be imported in tests.
 */
export function createApp() {
  const app = express()

  // Behind a proxy/load-balancer in production so express-rate-limit and
  // req.ip see the real client address (X-Forwarded-For), not the proxy's.
  //
  // TWO hops on AWS, not one:  client -> CloudFront -> ALB -> here.
  // CloudFront writes the client IP into X-Forwarded-For, then the ALB appends
  // CloudFront's IP, so the app receives "clientIP, cloudfrontIP". A value of 1
  // stops one entry too early and hands back the CloudFront edge address --
  // which would key every rate limiter on the edge instead of the user, so a
  // handful of logins would lock out everyone sharing that edge.
  //
  // Override with TRUST_PROXY when the topology differs (1 for a bare ALB,
  // 0 when running locally with no proxy at all).
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 2))

  // Secure response headers (CSP off by default — this is a JSON API, not HTML).
  app.use(helmet())

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN || 'http://localhost:5174',
      credentials: true,
    })
  )
  // Keep the raw request body around so the Razorpay webhook can verify its
  // signature against the exact bytes Razorpay signed (JSON re-stringify won't
  // byte-match). Harmless for every other route.
  app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf } }))
  app.use(express.urlencoded({ extended: true }))
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'))

  // Uploaded media (admin video uploads). Served with permissive CORS so the
  // client dev origin can stream them cross-origin.
  app.use(
    '/uploads',
    (req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next() },
    express.static(UPLOADS_ROOT)
  )

  // All API routes live under /api (then split into /user and /admin)
  app.use('/api', routes)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
