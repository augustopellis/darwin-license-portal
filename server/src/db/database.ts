import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

const DB_URL = process.env.DATABASE_URL || './data/licenses.db'
const dbPath = path.resolve(DB_URL)

// Assicura che la directory esista
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

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
      issued_at   INTEGER NOT NULL,
      expires_at  INTEGER,
      max_users   INTEGER NOT NULL DEFAULT 1,
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
      default_features TEXT NOT NULL DEFAULT '[]',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(key);
    CREATE INDEX IF NOT EXISTS idx_licenses_product ON licenses(product_id);
    CREATE INDEX IF NOT EXISTS idx_licenses_customer ON licenses(customer_id);
    CREATE INDEX IF NOT EXISTS idx_validation_log_key ON validation_log(license_key);
  `)
  seedDefaultProducts()
  console.log('[db] Database inizializzato:', dbPath)
}

function seedDefaultProducts(): void {
  const count = (db.prepare('SELECT COUNT(*) as n FROM products').get() as { n: number }).n
  if (count > 0) return

  db.prepare(`
    INSERT INTO products (id, name, description, default_features, active)
    VALUES (?, ?, ?, ?, 1)
  `).run(
    'PEC2PDF',
    'pec-to-pdf-converter',
    'Conversione e gestione documentale per messaggi PEC.',
    JSON.stringify(['convert', 'protocol', 'update'])
  )
}
