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

const ProductSchema = z.object({
  id: z.string().min(2).max(32).regex(/^[A-Z0-9_-]+$/),
  name: z.string().min(2),
  description: z.string().optional().default(''),
  defaultFeatures: z.array(z.string().min(1)).default([]),
  active: z.boolean().default(true),
})

const UpdateProductSchema = ProductSchema.omit({ id: true }).partial()

type ProductRow = {
  id: string
  name: string
  description: string | null
  default_features: string
  active: number
  created_at: number
  total_licenses?: number | null
  active_licenses?: number | null
}

/**
 * GET /api/admin/products
 * Catalogo prodotti gestibili dal portale.
 */
adminRouter.get('/products', (_req, res) => {
  const rows = db.prepare(`
    SELECT
      p.*,
      COUNT(l.id) as total_licenses,
      SUM(CASE WHEN l.revoked = 0 THEN 1 ELSE 0 END) as active_licenses
    FROM products p
    LEFT JOIN licenses l ON l.product_id = p.id
    GROUP BY p.id
    ORDER BY p.active DESC, p.name ASC
  `).all() as ProductRow[]

  res.json({ products: rows.map(serializeProduct) })
})

/**
 * POST /api/admin/products
 * Crea un nuovo prodotto licenziabile.
 */
adminRouter.post('/products', (req, res) => {
  const parse = ProductSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: parse.error.flatten() })
    return
  }

  const d = parse.data
  try {
    db.prepare(`
      INSERT INTO products (id, name, description, default_features, active)
      VALUES (?, ?, ?, ?, ?)
    `).run(d.id.toUpperCase(), d.name, d.description || null, JSON.stringify(normalizeFeatures(d.defaultFeatures)), d.active ? 1 : 0)
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'DUPLICATE_PRODUCT', message: 'Esiste gia un prodotto con questo ID.' })
      return
    }
    throw err
  }

  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(d.id.toUpperCase()) as ProductRow
  res.status(201).json({ product: serializeProduct(row) })
})

/**
 * PUT /api/admin/products/:id
 * Aggiorna un prodotto esistente.
 */
adminRouter.put('/products/:id', (req, res) => {
  const productId = req.params.id.toUpperCase()
  const parse = UpdateProductSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: parse.error.flatten() })
    return
  }

  const current = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as ProductRow | undefined
  if (!current) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Prodotto non trovato.' })
    return
  }

  const d = parse.data
  db.prepare(`
    UPDATE products
    SET name = ?, description = ?, default_features = ?, active = ?
    WHERE id = ?
  `).run(
    d.name ?? current.name,
    d.description ?? current.description,
    d.defaultFeatures ? JSON.stringify(normalizeFeatures(d.defaultFeatures)) : current.default_features,
    d.active === undefined ? current.active : d.active ? 1 : 0,
    productId
  )

  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as ProductRow
  res.json({ product: serializeProduct(row) })
})

/**
 * DELETE /api/admin/products/:id
 * Archivia un prodotto senza cancellare storico e licenze.
 */
adminRouter.delete('/products/:id', (req, res) => {
  const productId = req.params.id.toUpperCase()
  const result = db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(productId)

  if (result.changes === 0) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Prodotto non trovato.' })
    return
  }

  res.json({ archived: true, productId })
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
  const product = db.prepare('SELECT active FROM products WHERE id = ?').get(d.productId) as { active: number } | undefined
  if (!product) {
    res.status(400).json({ error: 'UNKNOWN_PRODUCT', message: 'Prodotto non presente nel catalogo licenze.' })
    return
  }
  if (!product.active) {
    res.status(400).json({ error: 'INACTIVE_PRODUCT', message: 'Prodotto archiviato: riattivalo prima di generare licenze.' })
    return
  }

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

function serializeProduct(row: ProductRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    defaultFeatures: parseFeatures(row.default_features),
    active: Boolean(row.active),
    createdAt: new Date(row.created_at * 1000).toISOString(),
    totalLicenses: Number(row.total_licenses ?? 0),
    activeLicenses: Number(row.active_licenses ?? 0),
  }
}

function parseFeatures(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeFeatures(parsed.map(String)) : []
  } catch {
    return []
  }
}

function normalizeFeatures(features: string[]): string[] {
  return Array.from(new Set(features.map(f => f.trim()).filter(Boolean)))
}
