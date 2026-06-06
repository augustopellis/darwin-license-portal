import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

const DB_URL = process.env.DATABASE_URL || './data/licenses.db'
const dbPath = DB_URL === ':memory:' ? DB_URL : path.resolve(DB_URL)

// Assicura che la directory esista
if (dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
}

export const db = new Database(dbPath)

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key         TEXT NOT NULL UNIQUE,
      product_id  TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT,
      license_type TEXT NOT NULL DEFAULT 'professional',
      application_type TEXT NOT NULL DEFAULT 'desktop',
      binding_mode TEXT NOT NULL DEFAULT 'none',
      issued_at   INTEGER NOT NULL,
      expires_at  INTEGER,
      max_users   INTEGER NOT NULL DEFAULT 1,
      max_activations INTEGER NOT NULL DEFAULT 1,
      features    TEXT NOT NULL DEFAULT '[]',
      revoked     INTEGER NOT NULL DEFAULT 0,
      revoked_at  INTEGER,
      revoke_reason TEXT,
      notes       TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS validation_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT NOT NULL,
      product_id  TEXT,
      ip          TEXT,
      user_agent  TEXT,
      application_type TEXT,
      binding_mode TEXT,
      fingerprint_hash TEXT,
      activation_id INTEGER,
      result      TEXT NOT NULL,
      reason      TEXT,
      validated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS products (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      application_type TEXT NOT NULL DEFAULT 'desktop',
      default_binding_mode TEXT NOT NULL DEFAULT 'workstation',
      default_max_activations INTEGER NOT NULL DEFAULT 1,
      default_features TEXT NOT NULL DEFAULT '[]',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS license_activations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT NOT NULL,
      product_id  TEXT NOT NULL,
      application_type TEXT NOT NULL,
      binding_mode TEXT NOT NULL,
      fingerprint_hash TEXT NOT NULL,
      fingerprint_label TEXT,
      first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_ip     TEXT,
      last_user_agent TEXT,
      revoked     INTEGER NOT NULL DEFAULT 0,
      revoked_at  INTEGER,
      revoke_reason TEXT,
      UNIQUE(license_key, fingerprint_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(key);
    CREATE INDEX IF NOT EXISTS idx_licenses_product ON licenses(product_id);
    CREATE INDEX IF NOT EXISTS idx_licenses_customer ON licenses(customer_id);
    CREATE INDEX IF NOT EXISTS idx_validation_log_key ON validation_log(license_key);
    CREATE INDEX IF NOT EXISTS idx_license_activations_key ON license_activations(license_key);
    CREATE INDEX IF NOT EXISTS idx_license_activations_hash ON license_activations(fingerprint_hash);
  `)
  migrateExistingSchema()
  seedDefaultProducts()
  console.log('[db] Database inizializzato:', dbPath)
}

function seedDefaultProducts(): void {
  const count = (db.prepare('SELECT COUNT(*) as n FROM products').get() as { n: number }).n
  if (count > 0) return

  db.prepare(`
    INSERT INTO products (
      id, name, description, application_type, default_binding_mode,
      default_max_activations, default_features, active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    'PEC2PDF',
    'pec-to-pdf-converter',
    'Conversione e gestione documentale per messaggi PEC.',
    'desktop',
    'workstation',
    1,
    JSON.stringify(['convert', 'protocol', 'update'])
  )
}

function migrateExistingSchema(): void {
  ensureColumn('licenses', 'application_type', "TEXT NOT NULL DEFAULT 'desktop'")
  ensureColumn('licenses', 'binding_mode', "TEXT NOT NULL DEFAULT 'none'")
  ensureColumn('licenses', 'max_activations', 'INTEGER NOT NULL DEFAULT 1')
  ensureColumn('products', 'application_type', "TEXT NOT NULL DEFAULT 'desktop'")
  ensureColumn('products', 'default_binding_mode', "TEXT NOT NULL DEFAULT 'workstation'")
  ensureColumn('products', 'default_max_activations', 'INTEGER NOT NULL DEFAULT 1')
  ensureColumn('validation_log', 'application_type', 'TEXT')
  ensureColumn('validation_log', 'binding_mode', 'TEXT')
  ensureColumn('validation_log', 'fingerprint_hash', 'TEXT')
  ensureColumn('validation_log', 'activation_id', 'INTEGER')
}

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some(item => item.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}
