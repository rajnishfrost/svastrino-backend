import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './learn.service.js'
import { startTrial, nirmaanStanding } from './trial.js'

// GET /api/user/learn/trial  → what this student may be offered for Nirmaan
// ('none' | 'trial' | 'owned' | 'used' | 'expired'). The public Nirmaan page
// asks this to decide between "start the free trial" and "continue your course".
export const getTrial = asyncHandler(async (req, res) => {
  res.json(await nirmaanStanding(req.user.id))
})

// POST /api/user/learn/trial  → grant the 1-week free trial (once per student)
export const postTrial = asyncHandler(async (req, res) => {
  res.json(await startTrial(req.user.id))
})

// GET /api/user/learn/:slug  → gated course (sessions + drip schedule state)
export const getCourse = asyncHandler(async (req, res) => {
  const course = await service.getCourse(req.user.id, req.params.slug)
  res.json(course)
})

// POST /api/user/learn/:slug/start  → begin the course (sets schedule anchor)
export const startCourse = asyncHandler(async (req, res) => {
  const course = await service.startCourse(req.user.id, req.params.slug)
  res.json(course)
})

// POST /api/user/learn/sessions/:id/play  → count one play of this video
// The player calls this when playback STARTS. Each video may be played a fixed
// number of times; the server keeps the count so clearing the browser cannot
// reset it.
export const registerPlay = asyncHandler(async (req, res) => {
  const out = await service.registerPlay(req.user.id, req.params.id)
  res.json(out)
})

// POST /api/user/learn/sessions/:id/position  { seconds }  → where the student
// is in the video, so the next visit can offer "Resume from".
export const savePosition = asyncHandler(async (req, res) => {
  const out = await service.savePosition(req.user.id, req.params.id, req.body?.seconds)
  res.json(out)
})

// POST /api/user/learn/sessions/:id/video-done  → first 90% watch
export const videoDone = asyncHandler(async (req, res) => {
  const out = await service.markVideoDone(req.user.id, req.params.id)
  res.json(out)
})

// POST /api/user/learn/questions/:id/answer  → submit the open question's answer
export const answerQuestion = asyncHandler(async (req, res) => {
  const out = await service.submitAnswer(req.user.id, req.params.id, req.body?.text)
  res.json(out)
})

// GET /api/user/learn/:slug/report  → target vs actual days
export const getReport = asyncHandler(async (req, res) => {
  const report = await service.getReport(req.user.id, req.params.slug)
  res.json(report)
})

// GET /api/user/learn/:slug/record  → the student's own record of the course:
// the questions, the answers they wrote, and the dates. The client turns this
// into the branded PDF. It stays available for three years after the course
// year ends; the service decides how much of it may still be given out.
export const getRecord = asyncHandler(async (req, res) => {
  const record = await service.courseRecord(req.user.id, req.params.slug)
  res.json(record)
})
