import { Router } from 'express'
import credentialsRoutes, { adminsRouter } from './credentials/credentials.routes.js'
import rolesRoutes from './roles/roles.routes.js'
import paymentsAdminRoutes from '../user/payments/payments.admin.routes.js'
import assessmentAdminRoutes from '../user/assessment/assessment.admin.routes.js'
import mentoringAdminRoutes from '../user/mentoring/mentoring.admin.routes.js'
import scholarshipAdminRoutes from '../user/scholarship/scholarship.admin.routes.js'
import blogsAdminRoutes from './blogs/blogs.admin.routes.js'
import careerLibraryAdminRoutes from './careerlibrary/careerLibrary.admin.routes.js'
import manageRoutes from './manage/manage.routes.js'

// ---- Admin area router ----
// Mount each admin module here (content management, courses, bookings, …).
const router = Router()

router.use('/auth', credentialsRoutes)
router.use('/admins', adminsRouter) // manage admin accounts + role assignment (superadmin)
router.use('/roles', rolesRoutes)   // manage reusable role presets (superadmin)
router.use('/payments', paymentsAdminRoutes) // orders, revenue, refunds, coupons
router.use('/assessments', assessmentAdminRoutes) // psychometric: verify + attach report
router.use('/mentoring', mentoringAdminRoutes) // bookings + session updates/tasks
router.use('/scholarship', scholarshipAdminRoutes) // Nirmaan scholarship: institutions, test, results
router.use('/blogs', blogsAdminRoutes)             // blog posts (drafts + published)
router.use('/career-library', careerLibraryAdminRoutes) // streams, course pages, quick news
router.use('/', manageRoutes)                // stats, users, packages, content

export default router
