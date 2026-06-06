import crypto from 'node:crypto'

export const APPLICATION_TYPES = ['desktop', 'hybrid', 'web'] as const
export const BINDING_MODES = ['none', 'workstation', 'server', 'tenant'] as const

export type ApplicationType = typeof APPLICATION_TYPES[number]
export type BindingMode = typeof BINDING_MODES[number]

let warnedAboutWeakSecret = false

export interface LicensePayload {
  productId: string
  customerId: string
  licenseType: 'trial' | 'starter' | 'professional' | 'enterprise'
  issuedAt: number
  expiresAt: number | null  // null = licenza perpetua
  maxUsers: number
  features: string[]
  applicationType?: ApplicationType
  bindingMode?: BindingMode
  maxActivations?: number
}

export interface NormalizedLicensePayload extends LicensePayload {
  applicationType: ApplicationType
  bindingMode: BindingMode
  maxActivations: number
}

export function getLicenseSecret(): string {
  const secret = process.env.LICENSE_SECRET
  if ((!secret || secret.length < 32) && !warnedAboutWeakSecret) {
    warnedAboutWeakSecret = true
    console.warn('[license] WARNING: LICENSE_SECRET troppo corta o non impostata!')
  }
  return secret ?? 'insecure-dev-secret'
}

export function defaultBindingModeForApplicationType(applicationType: ApplicationType): BindingMode {
  const map: Record<ApplicationType, BindingMode> = {
    desktop: 'workstation',
    hybrid: 'server',
    web: 'tenant',
  }
  return map[applicationType]
}

export function isApplicationType(value: unknown): value is ApplicationType {
  return typeof value === 'string' && (APPLICATION_TYPES as readonly string[]).includes(value)
}

export function isBindingMode(value: unknown): value is BindingMode {
  return typeof value === 'string' && (BINDING_MODES as readonly string[]).includes(value)
}

export function normalizeLicensePayload(payload: LicensePayload): NormalizedLicensePayload {
  let applicationType: ApplicationType = 'desktop'
  let hasExplicitApplicationType = false
  if (isApplicationType(payload.applicationType)) {
    applicationType = payload.applicationType
    hasExplicitApplicationType = true
  }

  const bindingMode = isBindingMode(payload.bindingMode)
    ? payload.bindingMode
    : hasExplicitApplicationType
      ? defaultBindingModeForApplicationType(applicationType)
      : 'none'
  const maxActivations = Math.max(1, Math.trunc(Number(payload.maxActivations ?? payload.maxUsers ?? 1)))

  return {
    ...payload,
    applicationType,
    bindingMode,
    maxActivations,
  }
}

/**
 * Genera una chiave licenza firmata con HMAC-SHA256.
 * Formato: base64url(payload_json).base64url(hmac)
 */
export function generateLicenseKey(payload: LicensePayload): string {
  const secret = getLicenseSecret()
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url')
  return `${payloadB64}.${hmac}`
}

/**
 * Valida una chiave licenza.
 * Verifica firma HMAC e scadenza.
 */
export function validateLicenseKey(key: string): { valid: true; payload: LicensePayload } | { valid: false; reason: string } {
  const secret = getLicenseSecret()
  const parts = key.split('.')
  if (parts.length !== 2) return { valid: false, reason: 'MALFORMED_KEY' }

  const [payloadB64, receivedHmac] = parts

  // Verifica firma (timing-safe)
  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url')
  if (receivedHmac.length !== expectedHmac.length) return { valid: false, reason: 'INVALID_SIGNATURE' }
  const timingSafe = crypto.timingSafeEqual(Buffer.from(receivedHmac), Buffer.from(expectedHmac))
  if (!timingSafe) return { valid: false, reason: 'INVALID_SIGNATURE' }

  // Decodifica payload
  let payload: LicensePayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return { valid: false, reason: 'MALFORMED_PAYLOAD' }
  }

  // Verifica scadenza
  if (payload.expiresAt !== null) {
    const nowSec = Math.floor(Date.now() / 1000)
    if (nowSec > payload.expiresAt) return { valid: false, reason: 'LICENSE_EXPIRED' }
  }

  return { valid: true, payload }
}

/**
 * Calcola i giorni mancanti alla scadenza.
 * Ritorna null se la licenza è perpetua.
 */
export function daysLeft(expiresAt: number | null): number | null {
  if (expiresAt === null) return null
  const nowSec = Math.floor(Date.now() / 1000)
  return Math.max(0, Math.ceil((expiresAt - nowSec) / 86400))
}
