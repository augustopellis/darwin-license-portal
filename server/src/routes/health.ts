import { Router } from 'express'

export const healthRouter = Router()

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'darwin-license-portal',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  })
})
