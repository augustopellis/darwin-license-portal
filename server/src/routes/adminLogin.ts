import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { db } from '../db/database.js'

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'insecure-dev-jwt-secret'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

type AdminUser = {
  id: number
  username: string
  password_hash: string
}

export const adminLoginRouter = Router()

export function ensureAdminUser(): void {
  if (!ADMIN_PASSWORD) {
    console.warn('[admin] ADMIN_PASSWORD non impostata: login admin non inizializzato.')
    return
  }

  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12)
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(ADMIN_USERNAME) as { id: number } | undefined

  if (existing) {
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(hash, ADMIN_USERNAME)
  } else {
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(ADMIN_USERNAME, hash)
  }

  console.log(`[admin] Utente admin configurato: ${ADMIN_USERNAME}`)
}

adminLoginRouter.post('/login', (req, res) => {
  const body = (req.body ?? {}) as { username?: string; password?: string }
  const { username, password } = body

  if (!username || !password) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: 'Username e password sono obbligatori.' })
    return
  }

  const user = db.prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?').get(username) as AdminUser | undefined

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Credenziali non valide.' })
    return
  }

  const token = jwt.sign({ sub: String(user.id), role: 'admin' }, JWT_SECRET, { expiresIn: '8h' })
  res.json({ token })
})
