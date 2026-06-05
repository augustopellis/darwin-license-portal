import { Router } from 'express'
import { z } from 'zod'
import { validateLicenseKey, daysLeft } from '../license/keyManager.js'
import { db } from '../db/database.js'

export const licensesRouter = Router()

const ValidateSchema = z.object({
  key: z.string().min(10),
  productId: z.string().min(1),
})

/**
 * POST /api/licenses/validate
 * Valida una chiave licenza. Chiamata dai prodotti darWIN all'avvio.
 */
licensesRouter.post('/validate', (req, res) => {
  const parse = ValidateSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: parse.error.message })
    return
  }

  const { key, productId } = parse.data
  const ip = req.ip || 'unknown'
  const userAgent = req.headers['user-agent'] || ''

  // Controlla revoca nel DB prima di validare la firma
  const row = db.prepare('SELECT revoked, revoke_reason FROM licenses WHERE key = ?').get(key) as
    | { revoked: number; revoke_reason: string | null }
    | undefined

  if (row?.revoked) {
    logValidation(key, productId, ip, userAgent, 'FAILED', 'LICENSE_REVOKED')
    res.status(403).json({ valid: false, error: 'LICENSE_REVOKED', message: 'Licenza revocata.' + (row.revoke_reason ? ` Motivo: ${row.revoke_reason}` : '') })
    return
  }

  // Valida firma e scadenza
  const result = validateLicenseKey(key)
  if (!result.valid) {
    logValidation(key, productId, ip, userAgent, 'FAILED', result.reason)
    const statusCode = result.reason === 'LICENSE_EXPIRED' ? 402 : 403
    res.status(statusCode).json({ valid: false, error: result.reason, message: humanReason(result.reason) })
    return
  }

  // Verifica che la licenza sia per il prodotto richiesto
  if (result.payload.productId !== productId) {
    logValidation(key, productId, ip, userAgent, 'FAILED', 'WRONG_PRODUCT')
    res.status(403).json({ valid: false, error: 'WRONG_PRODUCT', message: `Questa licenza è per il prodotto '${result.payload.productId}', non per '${productId}'.` })
    return
  }

  logValidation(key, productId, ip, userAgent, 'OK', null)

  const days = daysLeft(result.payload.expiresAt)
  res.json({
    valid: true,
    productId: result.payload.productId,
    customerId: result.payload.customerId,
    licenseType: result.payload.licenseType,
    expiresAt: result.payload.expiresAt ? new Date(result.payload.expiresAt * 1000).toISOString() : null,
    daysLeft: days,
    maxUsers: result.payload.maxUsers,
    features: result.payload.features,
  })
})

/**
 * GET /api/licenses/:key/status
 * Stato pubblico di una licenza (per UI dei prodotti).
 */
licensesRouter.get('/:key/status', (req, res) => {
  const { key } = req.params
  const result = validateLicenseKey(key)
  if (!result.valid) {
    res.status(result.reason === 'LICENSE_EXPIRED' ? 402 : 403).json({
      valid: false,
      error: result.reason,
      message: humanReason(result.reason),
    })
    return
  }
  const days = daysLeft(result.payload.expiresAt)
  res.json({
    valid: true,
    productId: result.payload.productId,
    licenseType: result.payload.licenseType,
    expiresAt: result.payload.expiresAt ? new Date(result.payload.expiresAt * 1000).toISOString() : null,
    daysLeft: days,
    features: result.payload.features,
  })
})

function logValidation(key: string, productId: string, ip: string, userAgent: string, result: string, reason: string | null) {
  try {
    db.prepare(`
      INSERT INTO validation_log (license_key, product_id, ip, user_agent, result, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(key, productId, ip, userAgent, result, reason)
  } catch {
    // non bloccare la risposta per errori di log
  }
}

function humanReason(reason: string): string {
  const map: Record<string, string> = {
    MALFORMED_KEY: 'Chiave licenza non valida o corrotta.',
    INVALID_SIGNATURE: 'Firma della chiave non valida. La chiave potrebbe essere stata manomessa.',
    MALFORMED_PAYLOAD: 'Payload della chiave corrotto.',
    LICENSE_EXPIRED: 'La licenza è scaduta. Rinnova la licenza per continuare a usare il prodotto.',
    WRONG_PRODUCT: 'Questa licenza non è valida per il prodotto richiesto.',
    LICENSE_REVOKED: 'La licenza è stata revocata.',
  }
  return map[reason] || `Errore di validazione: ${reason}`
}
