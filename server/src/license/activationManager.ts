import crypto from 'node:crypto'
import { db } from '../db/database.js'
import { BindingMode, ApplicationType, getLicenseSecret } from './keyManager.js'

type ActivationOk = {
  ok: true
  activationId: number
  fingerprintHash: string
  activationsUsed: number
  maxActivations: number
  created: boolean
}

type ActivationFailed = {
  ok: false
  reason: 'FINGERPRINT_REQUIRED' | 'ACTIVATION_LIMIT_EXCEEDED' | 'ACTIVATION_REVOKED'
  fingerprintHash?: string
  activationsUsed?: number
  maxActivations?: number
}

export type ActivationResult = ActivationOk | ActivationFailed

export function normalizeBindingFingerprint(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!normalized || normalized.length < 8) return null
  return normalized
}

export function hashBindingFingerprint(params: {
  licenseKey: string
  productId: string
  bindingMode: BindingMode
  fingerprint: string
}): string {
  return crypto
    .createHmac('sha256', getLicenseSecret())
    .update(params.productId)
    .update('\0')
    .update(params.licenseKey)
    .update('\0')
    .update(params.bindingMode)
    .update('\0')
    .update(params.fingerprint)
    .digest('hex')
}

export function bindOrRefreshActivation(params: {
  licenseKey: string
  productId: string
  applicationType: ApplicationType
  bindingMode: BindingMode
  maxActivations: number
  fingerprint?: string
  fingerprintLabel?: string
  ip: string
  userAgent: string
}): ActivationResult {
  const fingerprint = normalizeBindingFingerprint(params.fingerprint)
  if (!fingerprint) return { ok: false, reason: 'FINGERPRINT_REQUIRED' }

  const fingerprintHash = hashBindingFingerprint({
    licenseKey: params.licenseKey,
    productId: params.productId,
    bindingMode: params.bindingMode,
    fingerprint,
  })
  const label = params.fingerprintLabel?.trim().slice(0, 120) || null
  const maxActivations = Math.max(1, params.maxActivations)

  return db.transaction((): ActivationResult => {
    const existing = db.prepare(`
      SELECT id, revoked
      FROM license_activations
      WHERE license_key = ? AND fingerprint_hash = ?
    `).get(params.licenseKey, fingerprintHash) as { id: number; revoked: number } | undefined

    if (existing?.revoked) {
      return {
        ok: false,
        reason: 'ACTIVATION_REVOKED',
        fingerprintHash,
        activationsUsed: countActiveActivations(params.licenseKey),
        maxActivations,
      }
    }

    if (existing) {
      db.prepare(`
        UPDATE license_activations
        SET last_seen_at = unixepoch(), last_ip = ?, last_user_agent = ?, fingerprint_label = COALESCE(?, fingerprint_label)
        WHERE id = ?
      `).run(params.ip, params.userAgent, label, existing.id)

      return {
        ok: true,
        activationId: existing.id,
        fingerprintHash,
        activationsUsed: countActiveActivations(params.licenseKey),
        maxActivations,
        created: false,
      }
    }

    const used = countActiveActivations(params.licenseKey)
    if (used >= maxActivations) {
      return {
        ok: false,
        reason: 'ACTIVATION_LIMIT_EXCEEDED',
        fingerprintHash,
        activationsUsed: used,
        maxActivations,
      }
    }

    const insert = db.prepare(`
      INSERT INTO license_activations (
        license_key, product_id, application_type, binding_mode, fingerprint_hash,
        fingerprint_label, last_ip, last_user_agent
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.licenseKey,
      params.productId,
      params.applicationType,
      params.bindingMode,
      fingerprintHash,
      label,
      params.ip,
      params.userAgent
    )

    return {
      ok: true,
      activationId: Number(insert.lastInsertRowid),
      fingerprintHash,
      activationsUsed: used + 1,
      maxActivations,
      created: true,
    }
  })()
}

function countActiveActivations(licenseKey: string): number {
  return (db.prepare(`
    SELECT COUNT(*) as n
    FROM license_activations
    WHERE license_key = ? AND revoked = 0
  `).get(licenseKey) as { n: number }).n
}
