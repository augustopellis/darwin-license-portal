import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { licensesRouter } from './routes/licenses.js'
import { adminRouter } from './routes/admin.js'
import { adminLoginRouter, ensureAdminUser } from './routes/adminLogin.js'
import { healthRouter } from './routes/health.js'
import { requireAdminAuth } from './middleware/adminAuth.js'
import { initDb } from './db/database.js'

const app = express()
const PORT = Number(process.env.PORT) || 3100

// Security
app.use(helmet())
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())

// Rate limiting sulle route di validazione licenze
const validateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Troppi tentativi di validazione. Riprova tra un minuto.' },
})

// Routes pubbliche
app.use('/api/health', healthRouter)
app.use('/api/licenses', validateLimiter, licensesRouter)

// Login admin pubblico, poi route admin protette.
app.use('/api/admin', adminLoginRouter)
app.use('/api/admin', requireAdminAuth, adminRouter)

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ('type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'INVALID_JSON', message: 'Body JSON non valido.' })
    return
  }

  console.error('[error]', err.message)
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Errore interno del server' })
})

// Init DB e avvio
initDb()
ensureAdminUser()
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[darwin-license-portal] Server avviato su http://localhost:${PORT}`)
    console.log(`[darwin-license-portal] Admin API su http://localhost:${PORT}/api/admin`)
  })
}

export { app }
