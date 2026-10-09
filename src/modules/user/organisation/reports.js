import { Organisation } from './organisation.model.js'
import { User } from '../credentials/credentials.model.js'
import { testsForStudents } from '../assessment/assessment.service.js'
import { userTypeFor, ADMIN_URL } from '../assessment/mindler.js'

/**
 * Student Reports — the institution portal's view of its students'
 * psychometric test (the `reports` module).
 *
 * The table is built from our own records, which Mindler's getAssessmentStatus
 * keeps up to date (see syncWithMindler), so it works for every institution,
 * set up on Mindler or not. The full reports themselves stay on Mindler: the
 * institution reads them in its own Mindler admin, reached by `mindler.adminUrl`.
 *
 * Signing the institution in to that admin without a second login needs a
 * token login for admins from Mindler (they have one for students only, as of
 * 2026-10-08). Until then the button opens Mindler's sign-in page.
 */

const TEST_TYPE = { 1: 'Stream', 2: 'Career' }

export async function studentReports(orgId, { refresh = false } = {}) {
  const [org, students] = await Promise.all([
    Organisation.findById(orgId).select('mindler').lean(),
    User.find({ organisation: orgId, organisationRole: 'member' })
      .sort({ name: 1 })
      .limit(2000)
      .select('name email studentClass')
      .lean(),
  ])

  const tests = await testsForStudents(students.map((s) => s._id), { refresh })

  const rows = students.map((s) => {
    const t = tests.get(String(s._id))
    return {
      id: s._id,
      name: s.name || '—',
      email: s.email,
      studentClass: s.studentClass || '',
      testType: TEST_TYPE[userTypeFor(s.studentClass)] || null,
      // 'submitted' is a student saying they are done before Mindler agrees;
      // to the institution that is still a test in progress.
      status: !t ? 'not_started' : t.status === 'submitted' ? 'in_progress' : t.status,
      percent: t?.percent ?? null,
      startedAt: t?.startedAt || null,
      completedAt: t?.completedAt || null,
      checkedAt: t?.checkedAt || null,
    }
  })

  const count = (st) => rows.filter((r) => r.status === st).length
  return {
    students: rows,
    summary: {
      total: rows.length,
      completed: count('completed'),
      inProgress: count('in_progress'),
      notStarted: count('not_started'),
    },
    mindler: {
      connected: !!org?.mindler?.loginId,
      loginId: org?.mindler?.loginId || '',
      adminUrl: ADMIN_URL,
    },
  }
}
