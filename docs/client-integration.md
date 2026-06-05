# Integrazione applicazioni client

Questa guida spiega come integrare un'applicazione darWIN con `darwin-license-portal`.
E' pensata per sviluppatori e agenti che lavorano in altri repository.

## Regola principale

Le applicazioni client non devono mai conoscere `LICENSE_SECRET` o generare licenze.
Devono trattare la licenza come una stringa opaca e chiamare il portale per validarla.

Endpoint pubblico consigliato:

```text
POST /api/licenses/validate
```

Usare questo endpoint all'avvio dell'app, quando l'utente inserisce o cambia licenza, e poi periodicamente durante l'uso. L'endpoint verifica firma, scadenza, prodotto, revoca e scrive il log di validazione.

## Configurazione per ogni app

Ogni app integrata deve definire:

| Valore | Descrizione | Esempio |
|--------|-------------|---------|
| `LICENSE_API_BASE_URL` | Base URL del portale licenze | `http://188.213.171.141:3100` |
| `PRODUCT_ID` | Identificativo stabile del prodotto | `PEC2PDF` |
| `LICENSE_KEY` | Chiave licenza inserita dall'utente o salvata localmente | `eyJ...` |

`PRODUCT_ID` deve combaciare con il `productId` usato quando la licenza viene generata dal pannello admin. Se non combacia, il portale risponde con `WRONG_PRODUCT`.

## Contratto API

### Health check

```http
GET /api/health
```

Risposta attesa:

```json
{
  "status": "ok",
  "service": "darwin-license-portal",
  "version": "0.1.0",
  "timestamp": "2026-06-05T12:00:00.000Z"
}
```

### Validazione licenza

```http
POST /api/licenses/validate
Content-Type: application/json
```

Body:

```json
{
  "key": "LICENSE_KEY_OPACA",
  "productId": "PEC2PDF"
}
```

Risposta valida:

```json
{
  "valid": true,
  "productId": "PEC2PDF",
  "customerId": "ACME_001",
  "licenseType": "professional",
  "expiresAt": "2027-01-15T00:00:00.000Z",
  "daysLeft": 224,
  "maxUsers": 5,
  "features": ["convert", "protocol", "update"]
}
```

Risposta non valida:

```json
{
  "valid": false,
  "error": "LICENSE_EXPIRED",
  "message": "La licenza e' scaduta. Rinnova la licenza per continuare a usare il prodotto."
}
```

Errori principali:

| HTTP | `error` | Significato | Comportamento consigliato |
|------|---------|-------------|---------------------------|
| `400` | `INVALID_REQUEST` | Body mancante o non valido | Mostrare errore tecnico e non abilitare funzioni premium |
| `402` | `LICENSE_EXPIRED` | Licenza scaduta | Disabilitare funzioni licenziate e mostrare rinnovo |
| `403` | `INVALID_SIGNATURE` | Chiave alterata o firmata con secret diverso | Richiedere nuova licenza |
| `403` | `MALFORMED_KEY` | Formato chiave non valido | Richiedere reinserimento |
| `403` | `MALFORMED_PAYLOAD` | Payload non decodificabile | Richiedere reinserimento |
| `403` | `WRONG_PRODUCT` | Licenza valida ma per altro prodotto | Bloccare uso per questo prodotto |
| `403` | `LICENSE_REVOKED` | Licenza revocata nel portale | Bloccare subito le funzioni licenziate |
| `429` | `TOO_MANY_REQUESTS` | Troppe validazioni ravvicinate | Usare cache locale e ritentare piu' tardi |

## Stato locale e cache

Ogni app dovrebbe salvare localmente:

| Campo | Uso |
|-------|-----|
| `licenseKey` | Chiave opaca inserita dall'utente |
| `lastValidationAt` | Timestamp dell'ultima validazione riuscita |
| `lastValidationResult` | Ultimo payload valido ricevuto dal server |
| `offlineGraceUntil` | Limite locale per tollerare assenza temporanea di rete |

Policy consigliata:

- Validare subito quando l'app parte.
- Validare di nuovo se l'ultima validazione valida ha piu' di 24 ore.
- In caso di errore di rete, usare l'ultimo risultato valido solo entro una finestra di grazia breve, ad esempio 3 giorni.
- Non usare cache locale per ignorare `LICENSE_REVOKED`, `WRONG_PRODUCT`, `INVALID_SIGNATURE` o `LICENSE_EXPIRED`.
- Non validare in loop: rispettare rate limit e backoff.

## Feature flags

Il campo `features` decide cosa abilitare nel prodotto.

Esempio:

```json
{
  "features": ["convert", "protocol", "update"]
}
```

Linee guida:

- Controllare feature specifiche, non solo `licenseType`.
- Tenere una modalita' base anche senza feature premium, se prevista dal prodotto.
- Non nascondere soltanto i pulsanti: proteggere anche il codice che esegue l'azione.

Esempio mapping:

| Feature | Abilita |
|---------|---------|
| `convert` | Conversione base |
| `protocol` | Bridge o protocollazione |
| `update` | Aggiornamenti automatici |
| `multi_user` | Uso con piu' utenti/postazioni |

## Flusso consigliato nell'app

1. Caricare configurazione locale e licenza salvata.
2. Se non c'e' licenza, avviare la policy trial locale del prodotto.
3. Chiamare `POST /api/licenses/validate` con `key` e `productId`.
4. Se `valid: true`, salvare il payload e abilitare le feature presenti.
5. Se la risposta e' 402 o 403, disabilitare le feature licenziate e mostrare il messaggio.
6. Se c'e' un errore di rete, usare solo una cache non scaduta e mostrare stato "validazione offline".

## Esempio TypeScript

```ts
type LicenseValidationOk = {
  valid: true
  productId: string
  customerId: string
  licenseType: 'trial' | 'starter' | 'professional' | 'enterprise'
  expiresAt: string | null
  daysLeft: number | null
  maxUsers: number
  features: string[]
}

type LicenseValidationError = {
  valid: false
  error: string
  message: string
}

type LicenseValidationResult = LicenseValidationOk | LicenseValidationError

export async function validateLicense(params: {
  apiBaseUrl: string
  productId: string
  licenseKey: string
}): Promise<LicenseValidationResult> {
  const response = await fetch(`${params.apiBaseUrl}/api/licenses/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: params.licenseKey,
      productId: params.productId,
    }),
  })

  const body = await response.json() as LicenseValidationResult

  if (!response.ok && body.valid !== false) {
    return {
      valid: false,
      error: 'VALIDATION_FAILED',
      message: `Errore validazione licenza: HTTP ${response.status}`,
    }
  }

  return body
}

export function hasFeature(result: LicenseValidationResult, feature: string): boolean {
  return result.valid && result.features.includes(feature)
}
```

## Esempio Python

```python
import requests


def validate_license(api_base_url: str, product_id: str, license_key: str) -> dict:
    response = requests.post(
        f"{api_base_url}/api/licenses/validate",
        json={"key": license_key, "productId": product_id},
        timeout=10,
    )

    data = response.json()
    if response.ok:
        return data

    return {
        "valid": False,
        "error": data.get("error", "VALIDATION_FAILED"),
        "message": data.get("message", f"Errore validazione licenza: HTTP {response.status_code}"),
    }
```

## Checklist per agenti in altri repository

Quando integri un'app con questo portale:

- Aggiungi una configurazione `LICENSE_API_BASE_URL`.
- Definisci un `PRODUCT_ID` stabile e documentalo nel repo dell'app.
- Implementa una funzione unica di validazione che chiama `POST /api/licenses/validate`.
- Salva la licenza in modo coerente con il tipo di app: file config, keychain, database utente o storage locale.
- Applica le feature dal campo `features`.
- Gestisci esplicitamente `LICENSE_EXPIRED`, `LICENSE_REVOKED`, `WRONG_PRODUCT` e assenza rete.
- Aggiungi test per licenza valida, scaduta, revocata, prodotto errato e portale non raggiungibile.
- Non inserire mai `LICENSE_SECRET`, `ADMIN_JWT_SECRET` o credenziali admin nel repo dell'app.

## Note admin

Le licenze vengono generate dal pannello admin o dalle API admin protette da JWT.
I client non devono chiamare endpoint admin.

Endpoint admin attuali:

```text
POST /api/admin/licenses
GET  /api/admin/licenses
PUT  /api/admin/licenses/:key/revoke
GET  /api/admin/licenses/:key/log
GET  /api/admin/stats
```

Tutti gli endpoint admin richiedono `Authorization: Bearer <token>`.

## Ambiente di produzione attuale

Deploy VPS Aruba Cloud:

| Servizio | URL |
|----------|-----|
| Pannello admin | `http://188.213.171.141` |
| API health | `http://188.213.171.141:3100/api/health` |
| API base URL per client | `http://188.213.171.141:3100` |

Quando verra' configurato un dominio HTTPS, aggiornare `LICENSE_API_BASE_URL` nelle app per usare `https://...`.
