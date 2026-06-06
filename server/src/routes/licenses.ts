import { Router } from 'express'
import { z } from 'zod'
import {
  ApplicationType,
  BindingMode,
  daysLeft,
  normalizeLicensePayload,
  validateLicenseKey,
} from '../license/keyManager.js'
import { bindOrRefreshActivation } from '../license/activationManager.js'
import { db } from '../db/database.js'

export const licensesRouter = Router()

const ValidateSchema = z.object({
  key: z.string().min(10),
  productId: z.string().min(1),
  applicationType: z.enum(['desktop', 'hybrid', 'web']).optional(),
  fingerprint: z.string().min(8).max(512).optional(),
  machineFingerprint: z.string().min(8).max(512).optional(),
  installationId: z.string().min(8).max(512).optional(),
  instanceId: z.string().min(8).max(512).optional(),
  fingerprintLabel: z.string().max(120).optional(),
})

type LicenseDbRow = {
  revoked: number
  revoke_reason: string | null
  application_type: ApplicationType | null
  binding_mode: BindingMode | null
  max_activations: number | null
}

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
  const fingerprint = parse.data.fingerprint
    ?? parse.data.machineFingerprint
    ?? parse.data.installationId
    ?? parse.data.instanceId

  const row = db.prepare(`
    SELECT revoked, revoke_reason, application_type, binding_mode, max_activations
    FROM licenses
    WHERE key = ?
  `).get(key) as LicenseDbRow | undefined

  if (row?.revoked) {
    logValidation({ key, productId, ip, userAgent, result: 'FAILED', reason: 'LICENSE_REVOKED' })
    res.status(403).json({
      valid: false,
      error: 'LICENSE_REVOKED',
      message: 'Licenza revocata.' + (row.revoke_reason ? ` Motivo: ${row.revoke_reason}` : ''),
    })
    return
  }

  const result = validateLicenseKey(key)
  if (!result.valid) {
    logValidation({ key, productId, ip, userAgent, result: 'FAILED', reason: result.reason })
    const statusCode = result.reason === 'LICENSE_EXPIRED' ? 402 : 403
    res.status(statusCode).json({ valid: false, error: result.reason, message: humanReason(result.reason) })
    return
  }

  const payload = normalizeLicensePayload({
    ...result.payload,
    applicationType: result.payload.applicationType ?? row?.application_type ?? undefined,
    bindingMode: result.payload.bindingMode ?? row?.binding_mode ?? undefined,
    maxActivations: result.payload.maxActivations ?? row?.max_activations ?? undefined,
  })

  if (payload.productId !== productId) {
    logValidation({
      key,
      productId,
      ip,
      userAgent,
      applicationType: payload.applicationType,
      bindingMode: payload.bindingMode,
      result: 'FAILED',
      reason: 'WRONG_PRODUCT',
    })
    res.status(403).json({
      valid: false,
      error: 'WRONG_PRODUCT',
      message: `Questa licenza e' per il prodotto '${payload.productId}', non per '${productId}'.`,
    })
    return
  }

  if (parse.data.applicationType && parse.data.applicationType !== payload.applicationType) {
    logValidation({
      key,
      productId,
      ip,
      userAgent,
      applicationType: payload.applicationType,
      bindingMode: payload.bindingMode,
      result: 'FAILED',
      reason: 'WRONG_APPLICATION_TYPE',
    })
    res.status(403).json({
      valid: false,
      error: 'WRONG_APPLICATION_TYPE',
      message: `Questa licenza e' per un'app ${payload.applicationType}, non per ${parse.data.applicationType}.`,
    })
    return
  }

  let activation: ReturnType<typeof bindOrRefreshActivation> | null = null
  if (payload.bindingMode !== 'none') {
    activation = bindOrRefreshActivation({
      licenseKey: key,
      productId,
      applicationType: payload.applicationType,
      bindingMode: payload.bindingMode,
      maxActivations: payload.maxActivations,
      fingerprint,
      fingerprintLabel: parse.data.fingerprintLabel,
      ip,
      userAgent: String(userAgent),
    })

    if (!activation.ok) {
      logValidation({
        key,
        productId,
        ip,
        userAgent,
        applicationType: payload.applicationType,
        bindingMode: payload.bindingMode,
        fingerprintHash: activation.fingerprintHash,
        result: 'FAILED',
        reason: activation.reason,
      })
      res.status(activation.reason === 'FINGERPRINT_REQUIRED' ? 400 : 403).json({
        valid: false,
        error: activation.reason,
        message: humanReason(activation.reason),
        bindingMode: payload.bindingMode,
        maxActivations: activation.maxActivations ?? payload.maxActivations,
        activationsUsed: activation.activationsUsed,
      })
      return
    }
  }

  logValidation({
    key,
    productId,
    ip,
    userAgent,
    applicationType: payload.applicationType,
    bindingMode: payload.bindingMode,
    fingerprintHash: activation?.ok ? activation.fingerprintHash : undefined,
    activationId: activation?.ok ? activation.activationId : undefined,
    result: 'OK',
    reason: null,
  })

  const days = daysLeft(payload.expiresAt)
  res.json({
    valid: true,
    productId: payload.productId,
    customerId: payload.customerId,
    licenseType: payload.licenseType,
    applicationType: payload.applicationType,
    bindingMode: payload.bindingMode,
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt * 1000).toISOString() : null,
    daysLeft: days,
    maxUsers: payload.maxUsers,
    maxActivations: payload.maxActivations,
    activationsUsed: activation?.ok ? activation.activationsUsed : null,
    features: payload.features,
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

  const payload = normalizeLicensePayload(result.payload)
  const days = daysLeft(payload.expiresAt)
  res.json({
    valid: true,
    productId: payload.productId,
    licenseType: payload.licenseType,
    applicationType: payload.applicationType,
    bindingMode: payload.bindingMode,
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt * 1000).toISOString() : null,
    daysLeft: days,
    maxActivations: payload.maxActivations,
    features: payload.features,
  })
})

function logValidation(entry: {
  key: string
  productId: string
  ip: string
  userAgent: string | string[]
  applicationType?: ApplicationType
  bindingMode?: BindingMode
  fingerprintHash?: string
  activationId?: number
  result: string
  reason: string | null
}) {
  try {
    db.prepare(`
      INSERT INTO validation_log (
        license_key, product_id, ip, user_agent, application_type,
        binding_mode, fingerprint_hash, activation_id, result, reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.key,
      entry.productId,
      entry.ip,
      Array.isArray(entry.userAgent) ? entry.userAgent.join(' ') : entry.userAgent,
      entry.applicationType ?? null,
      entry.bindingMode ?? null,
      entry.fingerprintHash ?? null,
      entry.activationId ?? null,
      entry.result,
      entry.reason
    )
  } catch {
    // non bloccare la risposta per errori di log
  }
}

function humanReason(reason: string): string {
  const map: Record<string, string> = {
    MALFORMED_KEY: 'Chiave licenza non valida o corrotta.',
    INVALID_SIGNATURE: 'Firma della chiave non valida. La chiave potrebbe essere stata manomessa.',
    MALFORMED_PAYLOAD: 'Payload della chiave corrotto.',
    LICENSE_EXPIRED: "La licenza e' scaduta. Rinnova la licenza per continuare a usare il prodotto.",
    WRONG_PRODUCT: "Questa licenza non e' valida per il prodotto richiesto.",
    LICENSE_REVOKED: "La licenza e' stata revocata.",
    WRONG_APPLICATION_TYPE: "Questa licenza non e' valida per il tipo di applicazione richiesto.",
    FINGERPRINT_REQUIRED: 'Questa licenza richiede un fingerprint stabile della postazione, server o tenant.',
    ACTIVATION_LIMIT_EXCEEDED: 'Limite di attivazioni raggiunto per questa licenza.',
    ACTIVATION_REVOKED: "Questa postazione o istanza e' stata revocata per la licenza.",
  }
  return map[reason] || `Errore di validazione: ${reason}`
}
