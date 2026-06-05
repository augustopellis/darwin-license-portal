import crypto from 'node:crypto'

const SECRET = process.env.LICENSE_SECRET
if (!SECRET || SECRET.length < 32) {
  console.warn('[license] WARNING: LICENSE_SECRET troppo corta o non impostata!')
}

export interface LicensePayload {
  productId: string
  customerId: string
  licenseType: 'trial' | 'starter' | 'professional' | 'enterprise'
  issuedAt: number
  expiresAt: number | null  // null = licenza perpetua
  maxUsers: number
  features: string[]
}

/**
 * Genera una chiave licenza firmata con HMAC-SHA256.
 * Formato: base64url(payload_json).base64url(hmac)
 */
export function generateLicenseKey(payload: LicensePayload): string {
  const secret = SECRET ?? 'insecure-dev-secret'
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
  const secret = SECRET ?? 'insecure-dev-secret'
  const parts = key.split('.')
  if (parts.length !== 2) return { valid: false, reason: 'MALFORMED_KEY' }

  const [payloadB64, receivedHmac] = parts

  // Verifica firma (timing-safe)
  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url')
  const timingSafe = crypto.timingSafeEqual(
    Buffer.from(receivedHmac),
    Buffer.from(expectedHmac)
  )
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
