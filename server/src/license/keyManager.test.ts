import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

let app: Express
let generateLicenseKey: typeof import('./keyManager.js').generateLicenseKey
let validateLicenseKey: typeof import('./keyManager.js').validateLicenseKey

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.LICENSE_SECRET = 'test-secret-for-unit-tests-at-least-32-chars'
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret-at-least-32-chars'
  process.env.ADMIN_USERNAME = 'admin'
  process.env.ADMIN_PASSWORD = 'admin-password-for-tests'
  process.env.DATABASE_URL = ':memory:'

  const indexModule = await import('../index.js')
  const keyManagerModule = await import('./keyManager.js')

  app = indexModule.app
  generateLicenseKey = keyManagerModule.generateLicenseKey
  validateLicenseKey = keyManagerModule.validateLicenseKey
})

describe('License key generation and validation', () => {
  it('genera una chiave valida e la valida correttamente', () => {
    const key = generateLicenseKey({
      productId: 'PEC2PDF',
      customerId: 'TEST_001',
      licenseType: 'professional',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
      maxUsers: 5,
      features: ['convert', 'protocol'],
    })
    expect(key).toBeTruthy()
    expect(key.split('.').length).toBe(2)

    const result = validateLicenseKey(key)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.payload.productId).toBe('PEC2PDF')
      expect(result.payload.licenseType).toBe('professional')
    }
  })

  it('rifiuta una chiave con firma alterata', () => {
    const key = generateLicenseKey({
      productId: 'PEC2PDF',
      customerId: 'TEST_001',
      licenseType: 'professional',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: null,
      maxUsers: 1,
      features: ['convert'],
    })
    const tampered = key.slice(0, -5) + 'XXXXX'
    const result = validateLicenseKey(tampered)
    expect(result.valid).toBe(false)
  })

  it('rifiuta una chiave scaduta', () => {
    const key = generateLicenseKey({
      productId: 'PEC2PDF',
      customerId: 'TEST_001',
      licenseType: 'trial',
      issuedAt: 1000000,
      expiresAt: 1000001,
      maxUsers: 1,
      features: [],
    })
    const result = validateLicenseKey(key)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('LICENSE_EXPIRED')
  })
})

describe('POST /api/licenses/validate', () => {
  it('ritorna 400 per richiesta malformata', async () => {
    const res = await request(app).post('/api/licenses/validate').send({})
    expect(res.status).toBe(400)
  })

  it('valida correttamente una chiave valida senza binding', async () => {
    const key = generateLicenseKey({
      productId: 'PEC2PDF',
      customerId: 'ACME',
      licenseType: 'professional',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
      maxUsers: 5,
      features: ['convert', 'protocol'],
    })
    const res = await request(app)
      .post('/api/licenses/validate')
      .send({ key, productId: 'PEC2PDF' })
    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(true)
    expect(res.body.features).toContain('convert')
    expect(res.body.bindingMode).toBe('none')
  })

  it('vincola una licenza desktop alla postazione e blocca fingerprint extra oltre il limite', async () => {
    const key = generateLicenseKey({
      productId: 'PEC2PDF',
      customerId: 'ACME_DESKTOP',
      licenseType: 'professional',
      applicationType: 'desktop',
      bindingMode: 'workstation',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
      maxUsers: 1,
      maxActivations: 1,
      features: ['convert'],
    })

    const missingFingerprint = await request(app)
      .post('/api/licenses/validate')
      .send({ key, productId: 'PEC2PDF', applicationType: 'desktop' })
    expect(missingFingerprint.status).toBe(400)
    expect(missingFingerprint.body.error).toBe('FINGERPRINT_REQUIRED')

    const firstActivation = await request(app)
      .post('/api/licenses/validate')
      .send({
        key,
        productId: 'PEC2PDF',
        applicationType: 'desktop',
        machineFingerprint: 'machine-guid-user-sid-pc-001',
        fingerprintLabel: 'PC-001',
      })
    expect(firstActivation.status).toBe(200)
    expect(firstActivation.body.bindingMode).toBe('workstation')
    expect(firstActivation.body.activationsUsed).toBe(1)

    const sameWorkstation = await request(app)
      .post('/api/licenses/validate')
      .send({
        key,
        productId: 'PEC2PDF',
        applicationType: 'desktop',
        machineFingerprint: 'machine-guid-user-sid-pc-001',
      })
    expect(sameWorkstation.status).toBe(200)
    expect(sameWorkstation.body.activationsUsed).toBe(1)

    const secondWorkstation = await request(app)
      .post('/api/licenses/validate')
      .send({
        key,
        productId: 'PEC2PDF',
        applicationType: 'desktop',
        machineFingerprint: 'machine-guid-user-sid-pc-002',
      })
    expect(secondWorkstation.status).toBe(403)
    expect(secondWorkstation.body.error).toBe('ACTIVATION_LIMIT_EXCEEDED')
  })
})

describe('Admin license generation', () => {
  it('genera una licenza desktop vincolata e la valida con fingerprint', async () => {
    const login = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'admin-password-for-tests' })
    expect(login.status).toBe(200)

    const generated = await request(app)
      .post('/api/admin/licenses')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        productId: 'PEC2PDF',
        customerId: 'ADMIN_DESKTOP',
        licenseType: 'starter',
        expiresInDays: 30,
        maxUsers: 1,
        features: ['convert'],
      })

    expect(generated.status).toBe(201)
    expect(generated.body.applicationType).toBe('desktop')
    expect(generated.body.bindingMode).toBe('workstation')
    expect(generated.body.maxActivations).toBe(1)

    const validation = await request(app)
      .post('/api/licenses/validate')
      .send({
        key: generated.body.key,
        productId: 'PEC2PDF',
        applicationType: 'desktop',
        machineFingerprint: 'admin-generated-workstation-001',
      })

    expect(validation.status).toBe(200)
    expect(validation.body.valid).toBe(true)
    expect(validation.body.bindingMode).toBe('workstation')
  })
})

describe('GET /api/health', () => {
  it('ritorna status ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})
