import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'insecure-dev-jwt-secret'

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Token admin mancante.' })
    return
  }

  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string }
    if (payload.role !== 'admin') {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Accesso non autorizzato.' })
      return
    }
    ;(req as any).adminUser = payload
    next()
  } catch {
    res.status(401).json({ error: 'INVALID_TOKEN', message: 'Token admin non valido o scaduto.' })
  }
}
