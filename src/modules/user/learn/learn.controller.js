import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './learn.service.js'

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
