# darwin-license-portal

Portale centralizzato di gestione licenze per i software darWIN.

## Documentazione rapida

- [Integrazione applicazioni client](docs/client-integration.md): guida per agenti e sviluppatori che devono far usare questo sistema ad altri prodotti.

## Prodotti supportati

| Prodotto | ID prodotto |
|---------|------------|
| pec-to-pdf-converter | `PEC2PDF` |
| *(altri prodotti darWIN)* | *(da aggiungere)* |

## Architettura

```
darwin-license-portal/
├── server/          # API backend Node.js/Express/TypeScript
│   ├── src/
│   │   ├── routes/  # API endpoints
│   │   ├── license/ # Core: generazione e validazione chiavi
│   │   └── db/      # Storage licenze (SQLite in dev, Postgres in prod)
│   └── package.json
├── admin/           # Pannello admin React (generazione licenze, stats)
│   └── package.json
└── docs/            # Specifiche, ADR, API reference
```

## API principali

### Server API
- `POST /api/licenses/validate` — valida una chiave licenza per un prodotto
- `GET  /api/licenses/:key/status` — stato pubblico della licenza
- `GET  /api/health` — health check

### Admin API
- `POST /api/admin/login` — login admin e rilascio JWT
- `GET  /api/admin/products` — catalogo prodotti licenziabili
- `POST /api/admin/products` — aggiunge un prodotto
- `PUT  /api/admin/products/:id` — modifica un prodotto
- `DELETE /api/admin/products/:id` — archivia un prodotto
- `POST /api/admin/licenses` — genera una nuova chiave licenza
- `GET  /api/admin/licenses` — elenco licenze
- `PUT  /api/admin/licenses/:key/revoke` — revoca una licenza
- `GET  /api/admin/licenses/:key/log` — log validazioni
- `GET  /api/admin/licenses/:key/activations` — elenco postazioni/istanze attivate
- `PUT  /api/admin/licenses/:key/activations/:id/revoke` — revoca una singola attivazione
- `GET  /api/admin/stats` — statistiche

Per integrare un prodotto client, usare sempre `POST /api/licenses/validate`.

### Modello chiave licenza
```
Format: <base64(payload)>.<hmac-sha256(payload, SECRET)>

Payload JSON:
{
  "productId":   "PEC2PDF",
  "customerId":  "ACME_001",
  "licenseType": "professional",  // trial | starter | professional | enterprise
  "applicationType": "desktop",    // desktop | hybrid | web
  "bindingMode": "workstation",    // none | workstation | server | tenant
  "issuedAt":    1748000000,       // Unix timestamp
  "expiresAt":   1779536000,       // Unix timestamp (null = perpetua)
  "maxUsers":    5,
  "maxActivations": 1,
  "features":    ["convert","protocol","update"]
}
```

### Logica di attivazione

La firma HMAC garantisce che la chiave non sia stata modificata. Il legame con la macchina/istanza avviene alla validazione:

- `desktop` usa di default `bindingMode: workstation` e richiede un fingerprint stabile della postazione;
- `hybrid` usa di default `bindingMode: server` per server, VM o servizio on-prem;
- `web` usa di default `bindingMode: tenant` per tenant, dominio o deployment;
- `none` mantiene il comportamento storico senza binding, da usare solo se voluto.

Per licenze vincolate, la prima chiamata a `POST /api/licenses/validate` registra l'attivazione. Lo stesso fingerprint viene riaccettato, un fingerprint nuovo consuma un altro slot fino a `maxActivations`. Oltre il limite l'API risponde con `ACTIVATION_LIMIT_EXCEEDED`. Il database salva solo l'hash del fingerprint.

### Trial policy
- Senza licenza: 30 giorni di trial completo dalla prima esecuzione
- Scaduto trial: solo funzioni base (conversione, no bridge protocollo)
- Licenza revocata: blocco immediato con messaggio di errore

### Integrazione con pec-to-pdf-converter
Il prodotto chiama `POST /api/licenses/validate` all'avvio e ogni 24h.
Vedere la guida completa in [docs/client-integration.md](docs/client-integration.md).

Risposta:
```json
{
  "valid": true,
  "productId": "PEC2PDF",
  "licenseType": "professional",
  "applicationType": "desktop",
  "bindingMode": "workstation",
  "expiresAt": "2027-01-15T00:00:00Z",
  "daysLeft": 224,
  "features": ["convert","protocol","update"],
  "maxUsers": 5,
  "maxActivations": 1,
  "activationsUsed": 1
}
```

## Stack tecnologico

- **Server:** Node.js 20, Express, TypeScript, Zod, SQLite con `better-sqlite3`
- **Admin UI:** React 18, Vite, TypeScript
- **Auth admin:** JWT
- **Deployment:** Docker Compose
- **Test:** Vitest, Supertest

## Setup sviluppo

```bash
# Server
cd server
npm install
cp .env.example .env   # imposta LICENSE_SECRET e DATABASE_URL
npm run dev            # avvia su http://localhost:3100

# Admin UI
cd admin
npm install
npm run dev            # avvia su http://localhost:5173
```

## Deploy Docker Compose

Copiare `.env.example` in `.env` nella root del progetto e impostare valori reali:

```bash
LICENSE_SECRET=<secret-64-char>
ADMIN_JWT_SECRET=<secret-64-char>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<password-admin>
CORS_ORIGIN=http://<server-ip-o-dominio>
```

Poi avviare:

```bash
docker compose up -d --build
```

Servizi esposti:

| Servizio | Porta | URL locale |
|----------|-------|------------|
| Admin UI | `80` | `http://localhost` |
| API server | `3100` | `http://localhost:3100/api/health` |

Il database SQLite usa il volume Docker `license_data`; non cancellarlo durante gli aggiornamenti.

## Variabili d'ambiente (server)

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `PORT` | Porta API | `3100` |
| `LICENSE_SECRET` | Segreto HMAC-SHA256 (min 32 char) | `change-me-in-production-xxxxx` |
| `DATABASE_URL` | SQLite path o Postgres URL | `./data/licenses.db` |
| `ADMIN_JWT_SECRET` | Segreto JWT admin | `another-secret-xxxxx` |
| `ADMIN_USERNAME` | Username admin iniziale | `admin` |
| `ADMIN_PASSWORD` | Password admin iniziale | `change-me-before-first-login` |
| `TRIAL_DAYS` | Durata trial in giorni | `30` |

## Sicurezza

- `LICENSE_SECRET` non viene mai distribuito nei prodotti client
- Il prodotto invia solo la chiave opaca al server per validarla
- Per licenze vincolate il client invia un fingerprint gia normalizzato/hashato; il server lo salva come hash HMAC
- Rate limiting su `/api/licenses/validate` (max 10 req/min per IP)
- HTTPS obbligatorio in produzione
- Log di ogni validazione con timestamp e IP

## Roadmap

- [x] Specifiche ADR iniziali
- [x] Server API core (validate + admin generate)
- [x] Modello database SQLite
- [x] Admin UI base (CRUD licenze)
- [x] Documentazione integrazione client
- [ ] Integrazione pec-to-pdf-converter (LicenseGuard middleware)
- [ ] Docker Compose deploy
- [ ] HTTPS + dominio
- [ ] Dashboard statistiche utilizzo
