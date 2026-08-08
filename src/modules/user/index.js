import { Router } from 'express'
import credentialsRoutes from './credentials/credentials.routes.js'
import skillBuildRoutes from './skillbuild/skillbuild.routes.js'
import learnRoutes from './learn/learn.routes.js'
import paymentsRoutes from './payments/payments.routes.js'
import mentoringRoutes from './mentoring/mentoring.routes.js'
import assessmentRoutes from './assessment/assessment.routes.js'
import scholarshipRoutes from './scholarship/scholarship.routes.js'
import organisationRoutes from './organisation/organisation.routes.js'
import blogsRoutes from './blogs/blogs.routes.js'
import contentRoutes from './content/content.routes.js'
import { getMe, updateProfile, changePassword } from './credentials/credentials.controller.js'
import { uploadAvatar, removeAvatar, uploadAvatarMw } from './credentials/avatar.controller.js'
import { requireUserAuth } from '../../middleware/auth.js'

// ---- User area router ----
// Mount each user-facing module here. New modules (courses, blogs, bookings,
// dashboard, …) get their own folder under modules/user/ and are mounted below.
const router = Router()

router.use('/auth', credentialsRoutes)

// Current signed-in account (used by the client AuthContext).
router.get('/profile', requireUserAuth, getMe)
router.patch('/profile', requireUserAuth, updateProfile)
router.post('/profile/avatar', requireUserAuth, uploadAvatarMw, uploadAvatar)
router.delete('/profile/avatar', requireUserAuth, removeAvatar)
router.post('/change-password', requireUserAuth, changePassword)

// Skill-Build product catalog (public — name/description + packages/pricing)
router.use('/skill-build', skillBuildRoutes)

// Learning / course player (gated by purchase)
router.use('/learn', learnRoutes)

// Payments & enrollments (checkout, orders, receipts)
router.use('/payments', paymentsRoutes)

// Counselling & mentoring — program catalog, slot calendar, bookings
router.use('/mentoring', mentoringRoutes)

// Psychometric assessment (Mindler) — ships with every package
router.use('/assessment', assessmentRoutes)

// Partner organisations — public directory + the "partner with us" application
router.use('/organisations', organisationRoutes)

// Nirmaan Scholarship — student enrolment, timed test and public winners
router.use('/scholarship', scholarshipRoutes)

// Blog archive (public — migrated from the legacy svastrino.com site)
router.use('/blogs', blogsRoutes)

// Marketing/site content: mentoring programs, FAQs, success stories, career library
router.use('/content', contentRoutes)

// router.use('/courses', coursesRoutes)

export default router
