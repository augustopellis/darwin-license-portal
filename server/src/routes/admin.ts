import { Router } from 'express'
import { z } from 'zod'
import { generateLicenseKey, LicensePayload } from '../license/keyManager.js'
import { db } from '../db/database.js'

export const adminRouter = Router()

const GenerateLicenseSchema = z.object({
  productId: z.string().min(1),
  customerId: z.string().min(1),
  customerName: z.string().optional(),
  licenseType: z.enum(['trial', 'starter', 'professional', 'enterprise']).default('professional'),
  expiresInDays: z.number().int().positive().optional(), // null = perpetua
  maxUsers: z.number().int().positive().default(1),
  features: z.array(z.string()).default(['convert']),
  notes: z.string().optional(),
})

/**
 * POST /api/admin/licenses
 * Genera una nuova licenza e la salva nel DB.
 */
adminRouter.post('/licenses', (req, res) => {
  const parse = GenerateLicenseSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: parse.error.flatten() })
    return
  }

  const d = parse.data
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = d.expiresInDays ? issuedAt + d.expiresInDays * 86400 : null

  const payload: LicensePayload = {
    productId: d.productId,
    customerId: d.customerId,
    licenseType: d.licenseType,
    issuedAt,
    expiresAt,
    maxUsers: d.maxUsers,
    features: d.features,
  }

  const key = generateLicenseKey(payload)

  try {
    db.prepare(`
      INSERT INTO licenses (key, product_id, customer_id, customer_name, license_type, issued_at, expires_at, max_users, features, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(key, d.productId, d.customerId, d.customerName ?? null, d.licenseType, issuedAt, expiresAt, d.maxUsers, JSON.stringify(d.features), d.notes ?? null)
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'DUPLICATE_KEY', message: 'Chiave licenza già esistente (collisione estremamente rara).' })
      return
    }
    throw err
  }

  res.status(201).json({
    key,
    productId: d.productId,
    customerId: d.customerId,
    customerName: d.customerName,
    licenseType: d.licenseType,
    issuedAt: new Date(issuedAt * 1000).toISOString(),
    expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
    maxUsers: d.maxUsers,
    features: d.features,
  })
})

/**
 * GET /api/admin/licenses
 * Elenco licenze con filtri opzionali.
 */
adminRouter.get('/licenses', (req, res) => {
  const { productId, customerId, revoked } = req.query
  let sql = 'SELECT * FROM licenses WHERE 1=1'
  const params: unknown[] = []

  if (productId) { sql += ' AND product_id = ?'; params.push(productId) }
  if (customerId) { sql += ' AND customer_id = ?'; params.push(customerId) }
  if (revoked !== undefined) { sql += ' AND revoked = ?'; params.push(revoked === 'true' ? 1 : 0) }

  sql += ' ORDER BY created_at DESC LIMIT 500'

  const rows = db.prepare(sql).all(...params)
  res.json({ licenses: rows, total: rows.length })
})

/**
 * PUT /api/admin/licenses/:key/revoke
 * Revoca una licenza.
 */
adminRouter.put('/licenses/:key/revoke', (req, res) => {
  const { key } = req.params
  const { reason } = req.body as { reason?: string }

  const result = db.prepare(`
    UPDATE licenses SET revoked = 1, revoked_at = unixepoch(), revoke_reason = ?
    WHERE key = ? AND revoked = 0
  `).run(reason ?? null, key)

  if (result.changes === 0) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Licenza non trovata o già revocata.' })
    return
  }

  res.json({ revoked: true, key })
})

/**
 * GET /api/admin/licenses/:key/log
 * Log di validazioni per una licenza.
 */
adminRouter.get('/licenses/:key/log', (req, res) => {
  const { key } = req.params
  const rows = db.prepare(`
    SELECT * FROM validation_log WHERE license_key = ? ORDER BY validated_at DESC LIMIT 200
  `).all(key)
  res.json({ log: rows })
})

/**
 * GET /api/admin/stats
 * Statistiche generali.
 */
adminRouter.get('/stats', (_req, res) => {
  const total = (db.prepare('SELECT COUNT(*) as n FROM licenses').get() as any).n
  const active = (db.prepare('SELECT COUNT(*) as n FROM licenses WHERE revoked = 0').get() as any).n
  const expired = (db.prepare(`SELECT COUNT(*) as n FROM licenses WHERE revoked = 0 AND expires_at IS NOT NULL AND expires_at < unixepoch()`).get() as any).n
  const validationsToday = (db.prepare(`SELECT COUNT(*) as n FROM validation_log WHERE validated_at >= unixepoch('now','start of day')`).get() as any).n

  res.json({ total, active, expired, revoked: total - active, validationsToday })
})
