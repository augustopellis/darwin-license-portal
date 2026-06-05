import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/index.js'
import { generateLicenseKey } from '../src/license/keyManager.js'

// Imposta variabili ambiente per i test
process.env.LICENSE_SECRET = 'test-secret-for-unit-tests-at-least-32-chars'
process.env.DATABASE_URL = ':memory:'

describe('License key generation and validation', () => {
  it('genera una chiave valida e la valida correttamente', () => {
    const { validateLicenseKey } = require('../src/license/keyManager.js')
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
    const { validateLicenseKey } = require('../src/license/keyManager.js')
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
    const { validateLicenseKey } = require('../src/license/keyManager.js')
    const key = generateLicenseKey({
      productId: 'PEC2PDF',
      customerId: 'TEST_001',
      licenseType: 'trial',
      issuedAt: 1000000,
      expiresAt: 1000001, // scaduta nel 1970
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

  it('valida correttamente una chiave valida', async () => {
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
  })
})

describe('GET /api/health', () => {
  it('ritorna status ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})
